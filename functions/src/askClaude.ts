// askClaude — natural-language schedule assistant.
//
// Architecture:
//   - HTTPS callable invoked from the Mac Manager + iOS apps.
//   - Authenticates the caller, resolves them to their household.
//   - Loads state/main for current context (shift types, members, today's
//     date) and includes a compact summary in the system prompt.
//   - Calls Anthropic with a set of tools that wrap Firestore writes.
//   - Loops on `stop_reason: "tool_use"` until Claude returns a final
//     message, then sends that back to the client.
//
// The Anthropic API key lives as a Firebase function secret, never in
// any app bundle.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// ───────────────── Types lifted from the desktop HouseholdState ──────────
// (Keeping the function self-contained — no shared types package yet.)

interface ShiftType {
  id: string; name: string; start: string; end: string;
  crossesMidnight?: boolean; sleepHours?: number;
}
interface OTShift {
  date: string; shiftTypeId: string; label: string; coworkers?: string;
}
interface Override {
  date: string; shiftTypeId: string | null; label: string;
}
interface PartnerShift {
  date: string; shiftTypeId: string; label: string;
}
interface SbEvent {
  id: string; date: string; startTime?: string; endTime?: string;
  title: string; who: "G" | "K" | "Daisy" | "family"; notes?: string;
}
interface HouseholdState {
  shiftTypes: ShiftType[];
  template: Array<string | null>;
  alt?: { enabled: boolean; refSat?: string; sat?: string; sun?: string };
  templateEndDate?: string;   // last date the recurring template applies (paused going forward)
  ot?: OTShift[];
  overrides?: Override[];
  partner?: { name: string; shifts: PartnerShift[] };
  events?: SbEvent[];
  childcareOff?: ChildcareOffDay[];
  range?: { from: string; to: string };
  selfName?: string;
}

// Resolve Gage's (self) shift on a date: an override wins; otherwise the
// weekly template applies, but only on/before templateEndDate (the template is
// paused going forward). Mirrors wallState.ts::templateShiftFor.
function templateShiftFor(
  dateIso: string,
  template: Array<string | null> | undefined,
  alt?: HouseholdState["alt"],
): string | null {
  if (!template || template.length !== 7) return null;
  const [y, m, d] = dateIso.split("-").map(Number);
  const dow = new Date(y!, m! - 1, d!).getDay();
  if (alt?.enabled && alt.refSat && (dow === 0 || dow === 6)) {
    const [ry, rm, rd] = alt.refSat.split("-").map(Number);
    const weeksFromRef = Math.round((Date.UTC(y!, m! - 1, d!) - Date.UTC(ry!, rm! - 1, rd!)) / (7 * 86_400_000));
    const onWorkingWeekend = weeksFromRef % 2 === 0;
    if (dow === 6) return onWorkingWeekend ? (alt.sat ?? null) : null;
    return onWorkingWeekend ? (alt.sun ?? null) : null;
  }
  return template[dow] ?? null;
}

/** Gage's resolved shift for a date + where it came from. */
function resolveSelfShift(state: HouseholdState, date: string): { shiftTypeId: string | null; source: "override" | "template" | "none" } {
  const ov = (state.overrides ?? []).find((o) => o.date === date);
  if (ov) return { shiftTypeId: ov.shiftTypeId, source: "override" };
  const templateActive = !state.templateEndDate || date <= state.templateEndDate;
  if (templateActive) {
    const t = templateShiftFor(date, state.template, state.alt);
    if (t) return { shiftTypeId: t, source: "template" };
  }
  return { shiftTypeId: null, source: "none" };
}
interface ChildcareOffDay {
  date: string; label?: string;
}

// ───────────────── Tool definitions surfaced to Claude ───────────────────

const MODEL = "claude-opus-4-8";

/** Tools that only read. Read-only mode is handed these and nothing else, so
 *  the model cannot write even if it decides to. */
const READ_ONLY_TOOL_NAMES = new Set(["list_shift_types", "summarize_period"]);

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "list_shift_types",
    description:
      "List every shift type configured for the household with id, name, " +
      "start/end times, and sleep hours. Call this when the user mentions " +
      "a shift by name and you need to look up its id.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "summarize_period",
    description:
      "Get a compact summary of what's scheduled (shifts, OT, events) in " +
      "a date range. Use for read-only questions like \"what's my week look like?\".",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date YYYY-MM-DD" },
        to:   { type: "string", description: "End date YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "add_override",
    description:
      "Stamp a single-day override on Gage's recurring weekly template. " +
      "Use this when Gage is picking up an unusual day, swapping to a " +
      "different shift type, or taking a normally-working day off. " +
      "If `action` is \"off\", omit shiftTypeId.",
    input_schema: {
      type: "object",
      properties: {
        date:        { type: "string", description: "YYYY-MM-DD" },
        action:      { type: "string", enum: ["work", "off"] },
        shiftTypeId: { type: "string", description: "Required when action=work." },
        label:       { type: "string", description: "Short note shown on the calendar." },
      },
      required: ["date", "action"],
    },
  },
  {
    name: "remove_override",
    description: "Delete an existing override on a specific date, restoring the template.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string" } },
      required: ["date"],
    },
  },
  {
    name: "add_ot",
    description:
      "Add an overtime shift for Gage on a specific date. OT is on top of " +
      "his regular template — use this for picked-up shifts on the side.",
    input_schema: {
      type: "object",
      properties: {
        date:        { type: "string" },
        shiftTypeId: { type: "string" },
        label:       { type: "string" },
        coworkers:   { type: "string", description: "Optional, free-text who else is on." },
      },
      required: ["date", "shiftTypeId"],
    },
  },
  {
    name: "remove_ot",
    description: "Delete the OT entry on a specific date.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string" } },
      required: ["date"],
    },
  },
  {
    name: "add_partner_shift",
    description: "Add a shift for Kaylene on a specific date.",
    input_schema: {
      type: "object",
      properties: {
        date:        { type: "string" },
        shiftTypeId: { type: "string" },
        label:       { type: "string" },
      },
      required: ["date", "shiftTypeId"],
    },
  },
  {
    name: "remove_partner_shift",
    description: "Remove Kaylene's shift on a specific date.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string" } },
      required: ["date"],
    },
  },
  {
    name: "add_event",
    description:
      "Add a personal event / appointment to the calendar. `who` is the " +
      "person it belongs to: G (Gage), K (Kaylene), Daisy, or family.",
    input_schema: {
      type: "object",
      properties: {
        date:      { type: "string" },
        title:     { type: "string" },
        who:       { type: "string", enum: ["G", "K", "Daisy", "family"] },
        startTime: { type: "string", description: "HH:MM, omit for all-day." },
        endTime:   { type: "string", description: "HH:MM" },
        notes:     { type: "string" },
      },
      required: ["date", "title", "who"],
    },
  },
  {
    name: "block_childcare",
    description:
      "Mark a date RANGE as having NO childcare available because the " +
      "caregiver (Daisy) is scheduled off. Stamps EVERY day from `from` to " +
      "`to` inclusive in a single call — always prefer this over making many " +
      "per-day calls. Use it for requests like \"Daisy is off next week\", " +
      "\"no childcare July 5 through 11\", or \"block off that whole week\". " +
      "Days marked this way show a red bar on the calendar. For a single day, " +
      "pass the same date for `from` and `to`. Never use add_event for this.",
    input_schema: {
      type: "object",
      properties: {
        from:  { type: "string", description: "First day YYYY-MM-DD (inclusive)." },
        to:    { type: "string", description: "Last day YYYY-MM-DD (inclusive). Same as `from` for one day." },
        label: { type: "string", description: "Optional note; defaults to \"Daisy – Scheduled Off\"." },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "unblock_childcare",
    description:
      "Remove the no-childcare mark from a date range (the caregiver is " +
      "available again). Clears EVERY day from `from` to `to` inclusive.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "First day YYYY-MM-DD (inclusive)." },
        to:   { type: "string", description: "Last day YYYY-MM-DD (inclusive)." },
      },
      required: ["from", "to"],
    },
  },
];

// ───────────────── Helpers ──────────────────────────────────────────────

function findShiftTypeId(state: HouseholdState, hint: string): string | null {
  const all = state.shiftTypes || [];
  const exact = all.find((s) => s.id === hint);
  if (exact) return exact.id;
  const byName = all.find(
    (s) => s.name.toLowerCase() === hint.toLowerCase(),
  );
  if (byName) return byName.id;
  const partial = all.find(
    (s) => s.name.toLowerCase().includes(hint.toLowerCase()),
  );
  return partial ? partial.id : null;
}

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function genEventId(): string {
  return `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Every YYYY-MM-DD from `from` to `to` inclusive (local calendar days).
 *  Returns [] for an invalid or inverted range; capped at ~1 year as a guard. */
function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return out;
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  let guard = 0;
  while (cur <= end && guard < 400) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`);
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return out;
}

// ───────────────── Tool execution ──────────────────────────────────────

interface ExecCtx {
  householdId: string;
  uid: string;
}

async function execTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ExecCtx,
): Promise<unknown> {
  const db = getFirestore();
  const ref = db.collection("households").doc(ctx.householdId)
    .collection("state").doc("main");
  const snap = await ref.get();
  const state = (snap.data() ?? {}) as HouseholdState;

  switch (name) {
    case "list_shift_types":
      return (state.shiftTypes ?? []).map((s) => ({
        id: s.id, name: s.name,
        start: s.start, end: s.end,
        crossesMidnight: !!s.crossesMidnight,
        sleepHours: s.sleepHours ?? 0,
      }));

    case "summarize_period": {
      const from = String(input.from);
      const to = String(input.to);
      const ot = (state.ot ?? []).filter((o) => o.date >= from && o.date <= to);
      const partner = (state.partner?.shifts ?? []).filter((p) => p.date >= from && p.date <= to);
      const events = (state.events ?? []).filter((e) => e.date >= from && e.date <= to);
      const childcareOff = (state.childcareOff ?? []).filter((c) => c.date >= from && c.date <= to);
      const stName = (id: string | null) => (id ? ((state.shiftTypes ?? []).find((s) => s.id === id)?.name ?? id) : null);
      // Resolved per-day schedule so the model can SEE what's actually scheduled
      // (Gage's shift + whether it's a one-off override or from his template),
      // instead of guessing from raw arrays.
      const days = datesInRange(from, to).map((date) => {
        const self = resolveSelfShift(state, date);
        const k = partner.find((p) => p.date === date);
        const o = ot.find((x) => x.date === date);
        return {
          date,
          gage: self.shiftTypeId
            ? { shift: stName(self.shiftTypeId), shiftTypeId: self.shiftTypeId, source: self.source }
            : (self.source === "override" ? "off (override set)" : "off"),
          kaylene: k ? { shift: stName(k.shiftTypeId), shiftTypeId: k.shiftTypeId } : "off",
          ot: o ? { shift: stName(o.shiftTypeId), shiftTypeId: o.shiftTypeId } : null,
          events: events.filter((e) => e.date === date).map((e) => e.title),
          noChildcare: childcareOff.some((c) => c.date === date),
        };
      });
      return { from, to, days, shiftTypeCount: (state.shiftTypes ?? []).length };
    }

    case "add_override": {
      const date = String(input.date);
      const action = input.action === "off" ? "off" : "work";
      const shiftTypeId = action === "work"
        ? findShiftTypeId(state, String(input.shiftTypeId ?? ""))
        : null;
      if (action === "work" && !shiftTypeId) {
        return { error: `Unknown shift type "${input.shiftTypeId}". Call list_shift_types first.` };
      }
      const label = String(input.label ?? (action === "off" ? "Day off" : ""));
      const overrides = (state.overrides ?? []).filter((o) => o.date !== date);
      overrides.push({ date, shiftTypeId, label });
      await ref.set({ ...state, overrides });
      return { ok: true, date, action, shiftTypeId, label };
    }

    case "remove_override": {
      const date = String(input.date);
      const overrides = (state.overrides ?? []).filter((o) => o.date !== date);
      if (overrides.length === (state.overrides ?? []).length) {
        return { ok: true, info: `No override existed on ${date}.` };
      }
      await ref.set({ ...state, overrides });
      return { ok: true, date };
    }

    case "add_ot": {
      const date = String(input.date);
      const stId = findShiftTypeId(state, String(input.shiftTypeId ?? ""));
      if (!stId) return { error: `Unknown shift type "${input.shiftTypeId}".` };
      const label = String(input.label ?? "");
      const coworkers = input.coworkers ? String(input.coworkers) : undefined;
      const ot = (state.ot ?? []).filter((o) => o.date !== date);
      ot.push({ date, shiftTypeId: stId, label, ...(coworkers ? { coworkers } : {}) });
      await ref.set({ ...state, ot });
      return { ok: true, date, shiftTypeId: stId, label };
    }

    case "remove_ot": {
      const date = String(input.date);
      const ot = (state.ot ?? []).filter((o) => o.date !== date);
      await ref.set({ ...state, ot });
      return { ok: true, date };
    }

    case "add_partner_shift": {
      const date = String(input.date);
      const stId = findShiftTypeId(state, String(input.shiftTypeId ?? ""));
      if (!stId) return { error: `Unknown shift type "${input.shiftTypeId}".` };
      const label = String(input.label ?? "");
      const partner = state.partner ?? { name: "Kaylene", shifts: [] };
      const shifts = (partner.shifts ?? []).filter((p) => p.date !== date);
      shifts.push({ date, shiftTypeId: stId, label });
      await ref.set({ ...state, partner: { ...partner, shifts } });
      return { ok: true, date, shiftTypeId: stId, label };
    }

    case "remove_partner_shift": {
      const date = String(input.date);
      const partner = state.partner ?? { name: "Kaylene", shifts: [] };
      const shifts = (partner.shifts ?? []).filter((p) => p.date !== date);
      await ref.set({ ...state, partner: { ...partner, shifts } });
      return { ok: true, date };
    }

    case "add_event": {
      const ev: SbEvent = {
        id: genEventId(),
        date: String(input.date),
        title: String(input.title),
        who: (["G", "K", "Daisy", "family"].includes(String(input.who))
          ? String(input.who) : "family") as SbEvent["who"],
      };
      if (input.startTime) ev.startTime = String(input.startTime);
      if (input.endTime) ev.endTime = String(input.endTime);
      if (input.notes) ev.notes = String(input.notes);
      const events = [...(state.events ?? []), ev];
      await ref.set({ ...state, events });
      return { ok: true, event: ev };
    }

    case "block_childcare": {
      const dates = datesInRange(String(input.from), String(input.to));
      if (dates.length === 0) {
        return { error: "Invalid or empty date range. Pass from/to as YYYY-MM-DD with from <= to." };
      }
      const label = (input.label ? String(input.label).trim() : "") || "Daisy – Scheduled Off";
      const list = [...(state.childcareOff ?? [])];
      const have = new Set(list.map((c) => c.date));
      const added: string[] = [];
      for (const date of dates) {
        if (have.has(date)) continue;
        list.push({ date, label });
        have.add(date);
        added.push(date);
      }
      await ref.set({ ...state, childcareOff: list });
      return { ok: true, marked: dates, newlyAdded: added, alreadyMarked: dates.length - added.length, label };
    }

    case "unblock_childcare": {
      const dates = new Set(datesInRange(String(input.from), String(input.to)));
      if (dates.size === 0) {
        return { error: "Invalid or empty date range. Pass from/to as YYYY-MM-DD with from <= to." };
      }
      const before = (state.childcareOff ?? []).length;
      const list = (state.childcareOff ?? []).filter((c) => !dates.has(c.date));
      await ref.set({ ...state, childcareOff: list });
      return { ok: true, cleared: [...dates], removed: before - list.length };
    }
  }
  return { error: `Unknown tool: ${name}` };
}

// ───────────────── The callable ──────────────────────────────────────────

interface AskRequest {
  message?: string;
  /** "read" withholds every write tool; anything else behaves as before. */
  mode?: "read" | "write";
  history?: Array<{
    role: "user" | "assistant";
    content: string | Anthropic.Messages.ContentBlockParam[];
  }>;
}

interface AskResponse {
  reply: string;
  /** Which model answered, surfaced in the panel beside the mode control. */
  model?: string;
  /** Echoed back so the UI can show what the turn actually ran as. */
  mode?: "read" | "write";
  /** Full updated conversation so the client can pass it back on the next turn. */
  messages: Array<{
    role: "user" | "assistant";
    content: string | Anthropic.Messages.ContentBlockParam[];
  }>;
}

export const askClaude = onCall<AskRequest, Promise<AskResponse>>(
  { secrets: [ANTHROPIC_API_KEY], region: "us-central1", cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to use this.");

    const message = (request.data.message ?? "").trim();
    if (!message) throw new HttpsError("invalid-argument", "Empty message.");

    // "read" withholds every write tool. The system prompt also says so, but
    // the tool list is what actually enforces it.
    const readOnly = request.data.mode === "read";
    const activeTools = readOnly ? TOOLS.filter((t) => READ_ONLY_TOOL_NAMES.has(t.name)) : TOOLS;

    // 1. Resolve the caller to their household.
    const db = getFirestore();
    const hhSnap = await db.collection("households")
      .where("memberUids", "array-contains", uid).limit(1).get();
    if (hhSnap.empty) throw new HttpsError("failed-precondition", "No household found.");
    const householdId = hhSnap.docs[0].id;
    const householdData = hhSnap.docs[0].data();
    const role = householdData.roles?.[uid] ?? "partner";
    if (role === "supporting") {
      throw new HttpsError("permission-denied", "Caregivers can't edit the schedule.");
    }

    // 2. Load current state for system-prompt context.
    const stateSnap = await db.collection("households").doc(householdId)
      .collection("state").doc("main").get();
    const state = (stateSnap.data() ?? {}) as HouseholdState;
    const today = isoToday();
    const memberNames = householdData.memberNames ?? {};
    const userName = String(memberNames[uid] ?? "the user");

    const systemPrompt =
      `You are nucleusAI, the assistant inside Nucleus, the ${householdData.name ?? "Bass"} ` +
      `household's schedule app. If asked what you are, say you are nucleusAI. ` +
      `Today is ${today}. You are talking to ${userName}.\n\n` +
      `Their shift types (id → name, hours):\n` +
      ((state.shiftTypes ?? []).map((s) => `  ${s.id} → ${s.name} (${s.start}-${s.end})`).join("\n") || "  (none configured)") +
      `\n\nHousehold members: ${Object.values(memberNames).join(", ") || "unknown"}\n` +
      `The calendar is open-ended — schedules are individual dated entries, not a fixed window. ` +
      `When the user names a day number or weekday without a month (e.g. "the 2nd", "Friday"), ` +
      `resolve it to the nearest such date on or after today (${today}); roll into next month when ` +
      `the number has already passed this month. Only ask which month if it's genuinely ambiguous. ` +
      `To see what's actually scheduled on a date, call summarize_period for that date rather than ` +
      `assuming the calendar is empty or bounded.\n\n` +
      `Conventions:\n` +
      `- "Gage" is the household admin. His recurring schedule comes from a weekly template.\n` +
      `- "Kaylene" is Gage's partner. Her shifts are individual dated entries.\n` +
      `- "Daisy" is the family's caregiver (supporting role), not an editor. When Daisy is off, there is no childcare that day.\n` +
      `- When the user picks up an unusual day for Gage, use add_override (action="work").\n` +
      `- When Gage takes off a day he normally works, use add_override (action="off").\n` +
      `- When Gage picks up extra hours on a side gig, use add_ot.\n` +
      `- Kaylene's shifts always go through add_partner_shift.\n` +
      `- To mark days with NO childcare (Daisy scheduled off, or "block off" a week for childcare), use block_childcare with a from/to range — it stamps the whole range in ONE call, so a full week is reliably covered. Never use add_event or add_override for childcare availability. Use unblock_childcare to restore childcare.\n\n` +
      `Editing Gage's shifts:\n` +
      `- ALWAYS call summarize_period for the affected dates first to see what's actually there. Each day reports Gage's shift and its "source" ("override" = a one-off, "template" = from his weekly template).\n` +
      `- To REMOVE / cancel Gage's shift on a day: if source is "override", call remove_override for that date; if source is "template", call add_override with action="off". Either way he ends up with no working shift that day. Do NOT add anything.\n` +
      `- To MOVE Gage's shift from one day to another, do BOTH steps in the same confirmed action: (1) remove/cancel it on the OLD day (per the rule above), and (2) add_override action="work" on the NEW day using the same shift type it had. A move is never just an add — if you only add, the old shift is still there.\n` +
      `- When the user asks for multiple changes in one message, carry out EVERY part after they confirm. Never stop after the first tool call.\n\n` +
      `Behavior:\n` +
      `- For read-only questions, call list_shift_types or summarize_period as needed and answer concisely.\n` +
      `- For changes, first describe what you'll do in plain English and ASK for confirmation. ` +
      `Only call write tools (add_override, add_ot, add_partner_shift, add_event, remove_*) after the user confirms.\n` +
      `- Always state dates in human-friendly form (e.g. "Friday June 19") in your replies.\n` +
      `- Keep replies short. One paragraph max unless the user asks for more detail.\n\n` +
      `IMPORTANT formatting rules:\n` +
      `- Plain prose only. Never use markdown.\n` +
      `- No asterisks for emphasis, no double-asterisks for bold, no underscores for italic.\n` +
      `- No # headers, no - bullet lists, no numbered lists, no \`code\` backticks.\n` +
      `- Write the way you would speak to a family member in iMessage.` +
      (readOnly
        ? `\n\nYou are in READ-ONLY mode: you can look at the schedule but you cannot change it. ` +
          `No write tool is available to you. If the user asks for a change, say plainly that you're ` +
          `in read-only mode and they can switch you to make changes, then describe what the change ` +
          `would be so they can decide.`
        : "");

    // 3. Tool-use loop.
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    const history = Array.isArray(request.data.history) ? request.data.history.slice() : [];
    const messages: Anthropic.Messages.MessageParam[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: message },
    ];

    let finalText = "";
    const MAX_ROUNDS = 6;   // generous cap for tool chains
    for (let i = 0; i < MAX_ROUNDS; i++) {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        tools: activeTools,
        messages,
      });
      logger.info("askClaude turn", { stopReason: resp.stop_reason, contentBlocks: resp.content.length });

      // Append the assistant message.
      messages.push({ role: "assistant", content: resp.content });

      if (resp.stop_reason !== "tool_use") {
        // Pull the text out.
        finalText = resp.content
          .filter((c): c is Anthropic.Messages.TextBlock => c.type === "text")
          .map((c) => c.text).join("\n").trim();
        break;
      }

      // Execute each tool_use in parallel.
      const toolUses = resp.content.filter(
        (c): c is Anthropic.Messages.ToolUseBlock => c.type === "tool_use",
      );
      const toolResults = await Promise.all(toolUses.map(async (tu) => {
        try {
          const out = await execTool(tu.name, tu.input as Record<string, unknown>, { householdId, uid });
          return {
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: JSON.stringify(out),
          };
        } catch (e) {
          return {
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
            is_error: true,
          };
        }
      }));
      messages.push({ role: "user", content: toolResults });
    }

    // Audit log — every askClaude turn, helpful for debugging unexpected edits.
    try {
      await db.collection("households").doc(householdId)
        .collection("askClaudeLog").add({
          uid, userMessage: message,
          finalReply: finalText.slice(0, 1500),
          at: FieldValue.serverTimestamp(),
        });
    } catch { /* best-effort */ }

    return {
      reply: finalText || "(no reply)",
      model: MODEL,
      mode: readOnly ? "read" : "write",
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string | Anthropic.Messages.ContentBlockParam[],
      })),
    };
  },
);

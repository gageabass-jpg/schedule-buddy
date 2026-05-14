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
  ot?: OTShift[];
  overrides?: Override[];
  partner?: { name: string; shifts: PartnerShift[] };
  events?: SbEvent[];
  range?: { from: string; to: string };
  selfName?: string;
}

// ───────────────── Tool definitions surfaced to Claude ───────────────────

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
      const overrides = (state.overrides ?? []).filter((o) => o.date >= from && o.date <= to);
      const ot = (state.ot ?? []).filter((o) => o.date >= from && o.date <= to);
      const partner = (state.partner?.shifts ?? []).filter((p) => p.date >= from && p.date <= to);
      const events = (state.events ?? []).filter((e) => e.date >= from && e.date <= to);
      return { from, to, overrides, ot, partnerShifts: partner, events,
        template: state.template, shiftTypeCount: (state.shiftTypes ?? []).length };
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
  }
  return { error: `Unknown tool: ${name}` };
}

// ───────────────── The callable ──────────────────────────────────────────

interface AskRequest {
  message?: string;
  history?: Array<{
    role: "user" | "assistant";
    content: string | Anthropic.Messages.ContentBlockParam[];
  }>;
}

interface AskResponse {
  reply: string;
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
      `You are an AI assistant for the ${householdData.name ?? "Bass"} household's ` +
      `schedule app. Today is ${today}. You are talking to ${userName}.\n\n` +
      `Their shift types (id → name, hours):\n` +
      ((state.shiftTypes ?? []).map((s) => `  ${s.id} → ${s.name} (${s.start}-${s.end})`).join("\n") || "  (none configured)") +
      `\n\nHousehold members: ${Object.values(memberNames).join(", ") || "unknown"}\n` +
      `Date range covered by the calendar: ${state.range?.from ?? "?"} to ${state.range?.to ?? "?"}\n\n` +
      `Conventions:\n` +
      `- "Gage" is the household admin. His recurring schedule comes from a weekly template.\n` +
      `- "Kaylene" is Gage's partner. Her shifts are individual dated entries.\n` +
      `- "Daisy" is a caregiver (supporting role), not an editor.\n` +
      `- When the user picks up an unusual day for Gage, use add_override (action="work").\n` +
      `- When Gage takes off a day he normally works, use add_override (action="off").\n` +
      `- When Gage picks up extra hours on a side gig, use add_ot.\n` +
      `- Kaylene's shifts always go through add_partner_shift.\n\n` +
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
      `- Write the way you would speak to a family member in iMessage.`;

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
        model: "claude-sonnet-4-5",
        max_tokens: 1500,
        system: systemPrompt,
        tools: TOOLS,
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
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string | Anthropic.Messages.ContentBlockParam[],
      })),
    };
  },
);

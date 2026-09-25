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

// ───────────────── The shared domain ─────────────────────────────────────
// These types and the week-resolution logic are the same modules the Mac app
// renders from (shared/, copied in at build time). The function used to keep
// its own copy of both; when they drifted, nucleusAI answered confidently
// with a schedule the calendar disagreed with.

import {
  buildShiftMap, selfShiftId, expandCustomTemplateTypes,
  type HouseholdState, type OTShift, type PartnerShift, type Override,
  type ShiftType, type Event as SbEvent, type ChildcareOffDay,
} from "./shared/state";
import { dayKindFromShifts, type ShiftMap } from "./shared/schedule";
import { computeOverlapCandidates, parentDaySegments } from "./shared/computeOverlap";

// ───────────────── Tool definitions surfaced to Claude ───────────────────

const MODEL = "claude-opus-4-8";

/** Tools that only read. Read-only mode is handed these and nothing else, so
 *  the model cannot write even if it decides to. */
const READ_ONLY_TOOL_NAMES = new Set([
  "list_shift_types", "summarize_period", "coverage_gaps", "rest_windows",
  "list_events", "list_coverage_requests", "get_household", "get_schedule_rules",
]);

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
    name: "coverage_gaps",
    description:
      "The windows in a date range when nobody is home for the kids, computed " +
      "by the same engine the Childcare tab draws. Use for \"who has Monday " +
      "morning?\" or to check whether a change leaves a hole.",
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
    name: "rest_windows",
    description:
      "The rest a person's shifts protect in a date range — the hours before " +
      "and after a night — and which of them nobody is home to cover. Use for " +
      "\"is Kaylene getting any rest?\" or \"what does this do to her week?\".",
    input_schema: {
      type: "object",
      properties: {
        who:  { type: "string", enum: ["G", "K", "D"], description: "G = self, K = partner, D = dependent" },
        from: { type: "string" },
        to:   { type: "string" },
      },
      required: ["who", "from", "to"],
    },
  },
  {
    name: "list_events",
    description:
      "Personal events and appointments in a date range, with who they belong " +
      "to and whether anybody is off that day. This is only life events and " +
      "appointments — work shifts and the dependent's school days are not " +
      "here; use summarize_period for those.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
  },
  {
    name: "list_coverage_requests",
    description:
      "Childcare cover asked of caregivers, and where each one stands " +
      "(pending, confirmed, declined). Use before offering to ask again.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_household",
    description:
      "Who is in the household: names, who works where, pay cadence, the time " +
      "zone, and which schedules can be imported. Use to answer questions " +
      "about people rather than dates.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_schedule_rules",
    description:
      "The recurring rules behind the calendar: each person's weekly template " +
      "and its window, whether the old shared template is still applying, and " +
      "any schedule blocks. Use when asked why a day looks the way it does.",
    input_schema: { type: "object", properties: {} },
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
    name: "add_school_day",
    description:
      "Put a school or class day on the dependent's own timeline (Daisy). Use " +
      "when the user says she has class, a half day, or a one-off campus day. " +
      "Pass shiftTypeId when the hours match a catalog type, otherwise just a " +
      "label like \"class\" or \"half day\".",
    input_schema: {
      type: "object",
      properties: {
        date:        { type: "string", description: "YYYY-MM-DD" },
        label:       { type: "string", description: "e.g. \"class\", \"half day\", \"no school\"" },
        shiftTypeId: { type: "string", description: "Optional — only if a catalog type matches her hours." },
      },
      required: ["date", "label"],
    },
  },
  {
    name: "remove_school_day",
    description: "Take the dependent's school day off a specific date.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string" } },
      required: ["date"],
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
  // A template slot can hold an inline custom time rather than a catalog id.
  // The app expands those into synthetic shift types before it renders; without
  // the same step the day has no resolvable type and silently disappears —
  // which is how Daisy's 10a-2p class week became invisible here.
  //
  // Reads use this view. Writes keep using `state`, because the synthetic
  // types must never be saved back into the catalog.
  const view = expandCustomTemplateTypes(state);

  switch (name) {
    case "list_shift_types":
      return (state.shiftTypes ?? []).map((s) => ({
        id: s.id, name: s.name,
        start: s.start, end: s.end,
        crossesMidnight: !!s.crossesMidnight,
        sleepHours: s.sleepHours ?? 0,
      }));

    // ── Derived views ─────────────────────────────────────────────────────
    // These run the same engine the Childcare tab draws from, so an answer
    // here and the calendar cannot disagree.

    case "coverage_gaps": {
      const from = String(input.from), to = String(input.to);
      const shifts = buildShiftMap(view, from, to);
      const gaps = computeOverlapCandidates(shifts, view)
        .filter((c) => c.date >= from && c.date <= to);
      const requested = new Set(
        (state.coverageRequests ?? [])
          .filter((r) => r.status === "confirmed" || r.status === "pending")
          .map((r) => r.date),
      );
      return {
        from, to,
        gaps: gaps.map((c) => ({
          date: c.date,
          from: c.startTime,
          to: c.endTime,
          endsNextDay: c.endsNextDay,
          label: c.label,
          why: c.reason,
          coverAlreadyRequested: requested.has(c.date),
        })),
        note: gaps.length === 0 ? "Nobody is left without cover in this range." : undefined,
      };
    }

    case "rest_windows": {
      const who = String(input.who) as "G" | "K" | "D";
      const from = String(input.from), to = String(input.to);
      // "D" has no protected rest — only the two parents work shifts.
      if (who === "D") return { who, from, to, days: [], note: "Rest windows are tracked for the two parents." };
      const shifts = buildShiftMap(view, from, to);
      const gaps = computeOverlapCandidates(shifts, view);
      const days = datesInRange(from, to).map((date) => {
        const { work, sleep } = parentDaySegments(date, who, shifts, view);
        const asClock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        return {
          date,
          working: work.map((r) => ({ from: asClock(r.startMin), to: asClock(r.endMin) })),
          protectedRest: sleep.map((r) => ({ from: asClock(r.startMin), to: asClock(r.endMin) })),
          uncovered: gaps.filter((c) => c.date === date).map((c) => c.label),
        };
      }).filter((d) => d.working.length > 0 || d.protectedRest.length > 0 || d.uncovered.length > 0);
      return { who, from, to, days };
    }

    // ── The rest of the document ──────────────────────────────────────────

    case "list_events": {
      const from = String(input.from), to = String(input.to);
      const shifts = buildShiftMap(view, from, to);
      return (state.events ?? [])
        .filter((e) => e.date >= from && e.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((e) => ({
          id: e.id, date: e.date, title: e.title, who: e.who,
          startTime: e.startTime ?? null, endTime: e.endTime ?? null,
          notes: e.notes ?? null,
          isAppointment: !!e.healthId,
          repeats: !!e.seriesId,
          dayKind: dayKindFromShifts(shifts[e.date]),
        }));
    }

    case "list_coverage_requests":
      return (state.coverageRequests ?? []).map((r) => ({
        date: r.date, status: r.status,
        startTime: r.startTime ?? null, endTime: r.endTime ?? null,
        notes: r.notes ?? null,
        caregiver: r.caregiverUid ?? null,
      }));

    case "get_household":
      return {
        householdName: state.householdName ?? null,
        self: { name: state.selfName ?? "Gage", employer: state.employers?.G ?? null },
        partner: { name: state.partner?.name ?? "Kaylene", employer: state.employers?.K ?? null },
        dependent: {
          name: state.dependents?.daisy?.name ?? "Daisy",
          employer: state.employers?.D ?? null,
          hasOwnSchedule: (state.dependents?.daisy?.shifts ?? []).length > 0,
        },
        timeZone: state.timeZone ?? null,
        paydays: state.paydays ?? null,
      };

    case "get_schedule_rules":
      return {
        weeklyTemplates: state.weeklyTemplates ?? null,
        sharedTemplateStillApplies: !state.templateEndDate,
        sharedTemplateEndedAfter: state.templateEndDate ?? null,
        altWeekend: state.alt ?? null,
        scheduleBlocks: (state.scheduleBlocks ?? []).map((b) => ({
          from: b.startDate, to: b.endDate, label: b.label ?? null, notes: b.notes ?? null,
        })),
        childcareOffDays: (state.childcareOff ?? []).map((c) => c.date),
      };

    case "summarize_period": {
      const from = String(input.from);
      const to = String(input.to);
      const ot = (state.ot ?? []).filter((o) => o.date >= from && o.date <= to);
      const partner = (state.partner?.shifts ?? []).filter((p) => p.date >= from && p.date <= to);
      const events = (state.events ?? []).filter((e) => e.date >= from && e.date <= to);
      const childcareOff = (state.childcareOff ?? []).filter((c) => c.date >= from && c.date <= to);
      // The view's catalog, so a synthetic custom-time type resolves to a name
      // ("10a-2p") instead of leaking its raw __cst_ id into the answer.
      const stName = (id: string | null) => (id ? ((view.shiftTypes ?? []).find((s) => s.id === id)?.name ?? id) : null);
      // Resolved per-day schedule so the model can SEE what's actually scheduled
      // (Gage's shift + whether it's a one-off override or from his template),
      // instead of guessing from raw arrays.
      // Daisy's days come from her weekly class template as well as one-off
      // entries, so read her off the same map the calendar draws rather than
      // the raw array — the template days are invisible in the array.
      const rendered = buildShiftMap(view, from, to);
      const days = datesInRange(from, to).map((date) => {
        const self = selfShiftId(view, date);
        const k = partner.find((p) => p.date === date);
        const o = ot.find((x) => x.date === date);
        return {
          date,
          gage: self.shiftTypeId
            ? { shift: stName(self.shiftTypeId), shiftTypeId: self.shiftTypeId, source: self.source.kind }
            : (self.source.kind === "override" ? "off (override set)" : "off"),
          kaylene: k ? { shift: stName(k.shiftTypeId), shiftTypeId: k.shiftTypeId } : "off",
          ot: o ? { shift: stName(o.shiftTypeId), shiftTypeId: o.shiftTypeId } : null,
          daisy: (() => {
            const hers = (rendered[date] ?? []).filter((x) => x.who === "D");
            if (hers.length === 0) return "no class listed";
            return hers.map((x) => ({
              school: x.shiftTypeId ? stName(x.shiftTypeId) : (x.label || "class"),
              label: x.label,
              recurring: x.source === undefined,
            }));
          })(),
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

    case "add_school_day": {
      const date = String(input.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pass date as YYYY-MM-DD." };
      const label = String(input.label ?? "class").trim() || "class";
      const shiftTypeId = input.shiftTypeId ? String(input.shiftTypeId) : undefined;
      if (shiftTypeId && !(state.shiftTypes ?? []).some((t) => t.id === shiftTypeId)) {
        return { error: `No shift type with id ${shiftTypeId}. Call list_shift_types, or leave it out and pass a label.` };
      }
      const existing = state.dependents?.daisy;
      // Replace any entry already on that date rather than stacking a second.
      const kept = (existing?.shifts ?? []).filter((x) => x.date !== date);
      const entry = { date, label, ...(shiftTypeId ? { shiftTypeId } : {}) };
      await ref.set({
        ...state,
        dependents: {
          ...(state.dependents ?? {}),
          daisy: { name: existing?.name || "Daisy", shifts: [...kept, entry] },
        },
      });
      return { ok: true, date, label, shiftTypeId: shiftTypeId ?? null, replacedExisting: kept.length !== (existing?.shifts ?? []).length };
    }

    case "remove_school_day": {
      const date = String(input.date);
      const existing = state.dependents?.daisy;
      const before = (existing?.shifts ?? []).length;
      const kept = (existing?.shifts ?? []).filter((x) => x.date !== date);
      if (kept.length === before) return { ok: true, date, removed: 0, note: "Nothing was listed on that date." };
      await ref.set({
        ...state,
        dependents: {
          ...(state.dependents ?? {}),
          daisy: { name: existing?.name || "Daisy", shifts: kept },
        },
      });
      return { ok: true, date, removed: before - kept.length };
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
      `- For read-only questions, call the tool that actually knows the answer and answer concisely:\n` +
      `  summarize_period for what's scheduled on given dates — INCLUDING the dependent's school and class\n` +
      `  days, which live on her schedule and are NOT events, so list_events will never show them;\n` +
      `  coverage_gaps for who has the kids and when nobody does;\n` +
      `  rest_windows for whether someone is getting rest between shifts; list_events for appointments;\n` +
      `  list_coverage_requests for whether cover was already asked for; get_household for names, employers,\n` +
      `  pay cadence and time zone; get_schedule_rules for the recurring templates and blocks behind a day.\n` +
      `- coverage_gaps and rest_windows run the same engine the app's Childcare tab draws, so quote them\n` +
      `  rather than working coverage out yourself from shifts — your arithmetic will disagree with the screen.\n` +
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

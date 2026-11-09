import type { ImportRecord } from "../state";
import { SCHEDULE_IMPORTS } from "../scheduleImports";

/**
 * Where an uploaded schedule ends. Each upload leaves a record in state.imports;
 * the last day it has a shift for the person is the end of that schedule period,
 * and the month grid plants a flag there: green for Gage, purple for Kaylene.
 */

export type EndWho = "G" | "K";

/** Their flag colours: green and purple, on purpose not their calendar hues.
 *  Lighter on the dark ground, deeper on the light one, so each reads on both. */
export function scheduleEndColor(who: EndWho, dark: boolean): string {
  if (who === "G") return dark ? "#4ADE80" : "#15803D";
  return dark ? "#C084FC" : "#7E22CE";
}

// Which schedule slots belong to whom. Daisy's school schedule isn't a work
// period and has no flag.
const whoBySchedule = new Map<string, EndWho>();
for (const s of SCHEDULE_IMPORTS) {
  if (s.target === "self-ot") whoBySchedule.set(s.id, "G");
  else if (s.target === "partner") whoBySchedule.set(s.id, "K");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What state.imports can hold. The Mac writes ImportRecord. The phone writes the
 * same shape once an upload is settled (Gage's go straight in; Kaylene's are kept
 * in that shape when approved), but while one of Kaylene's waits for approval it
 * is a request: a person and its days, no schedule id, status "pending".
 * Rejected requests are deleted, so they leave nothing to flag.
 */
export type AnyImportRecord = Partial<ImportRecord> & {
  person?: string;
  status?: string;
  days?: Array<{ date?: unknown } | null>;
};

/** Whose schedule an upload was, or undefined when it gets no flag (Daisy's, or unrecognised). */
function whoOf(rec: AnyImportRecord): EndWho | undefined {
  if (typeof rec.scheduleId === "string") return whoBySchedule.get(rec.scheduleId);
  if (rec.status === "pending") return rec.person === "G" ? "G" : rec.person === "K" ? "K" : undefined;
  return undefined;
}

/**
 * The last day an upload covers: the day it recorded, or for a record from
 * before that was kept, the last day it changed (a pending phone request lists
 * every day it holds, so that is its real end).
 */
export function lastDayOf(rec: AnyImportRecord): string | null {
  if (typeof rec.lastShiftDate === "string" && ISO_DATE.test(rec.lastShiftDate)) return rec.lastShiftDate;
  const dated = [
    ...(Array.isArray(rec.addedDates) ? rec.addedDates : []),
    ...(Array.isArray(rec.days) ? rec.days.map((d) => d?.date) : []),
  ].filter((d): d is string => typeof d === "string" && ISO_DATE.test(d));
  return dated.length ? dated.reduce((a, b) => (b > a ? b : a)) : null;
}

/** The part of the household state the last-shift lookup reads. */
export interface ScheduledState {
  shiftTypes?: ReadonlyArray<{ id: string }>;
  ot?: ReadonlyArray<{ date: string; shiftTypeId: string | null }>;
  overrides?: ReadonlyArray<{ date: string; shiftTypeId: string | null }>;
  partner?: { shifts?: ReadonlyArray<{ date: string; shiftTypeId: string | null }> };
}

/**
 * The last day a person has a dated work shift, whether or not any upload record
 * says so. For Gage that's his one-off days (an override that names a shift, an
 * off override doesn't count) and his OT entries; for Kaylene her dated shifts.
 * The recurring template is left out on purpose: it has no last day. A shift
 * whose type is gone from the catalog isn't drawn on the calendar, so it
 * doesn't count here either.
 */
export function lastScheduledDay(state: ScheduledState, who: EndWho): string | null {
  const known = new Set((state.shiftTypes ?? []).map((t) => t.id));
  const entries = who === "G" ? [...(state.overrides ?? []), ...(state.ot ?? [])] : (state.partner?.shifts ?? []);
  let last: string | null = null;
  for (const e of entries) {
    if (!e || !e.shiftTypeId || !known.has(e.shiftTypeId) || !ISO_DATE.test(e.date)) continue;
    if (last === null || e.date > last) last = e.date;
  }
  return last;
}

/** The flags with `who` added on `date`, unless they're already there. Returns a new map. */
export function withScheduleEnd(ends: ReadonlyMap<string, EndWho[]>, date: string | null, who: EndWho): Map<string, EndWho[]> {
  const out = new Map(ends);
  if (!date) return out;
  const here = out.get(date) ?? [];
  if (!here.includes(who)) out.set(date, [...here, who].sort());
  return out;
}

/**
 * Date → who has a schedule ending that day. Daisy's uploads and anything
 * unrecognised are skipped, and uploads that end on the same day count once.
 */
export function scheduleEndsByDate(imports: ReadonlyArray<AnyImportRecord | null> | null | undefined): Map<string, EndWho[]> {
  const sets = new Map<string, Set<EndWho>>();
  for (const rec of imports ?? []) {
    if (!rec) continue;
    const who = whoOf(rec);
    if (!who) continue;
    const date = lastDayOf(rec);
    if (!date) continue;
    const set = sets.get(date) ?? new Set<EndWho>();
    set.add(who);
    sets.set(date, set);
  }
  return new Map([...sets].map(([date, set]) => [date, [...set].sort()]));
}

/**
 * Where a person's schedule ends, from every source there is: the last day they
 * have a dated shift, or the last day an upload says it covers, whichever is
 * later. The sidebar's end-of-period to-dos use it to tell whether their next
 * schedule has been uploaded.
 */
export function scheduleEndOf(
  state: ScheduledState & { imports?: ReadonlyArray<AnyImportRecord | null> | null },
  who: EndWho,
): string | null {
  let end = lastScheduledDay(state, who);
  for (const [date, whos] of scheduleEndsByDate(state.imports)) {
    if (whos.includes(who) && (end === null || date > end)) end = date;
  }
  return end;
}

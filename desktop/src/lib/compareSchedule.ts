import type { ParsedShiftRow } from "../global";
import type { ShiftMap } from "../data";
import { parseTimeRange } from "./parseScheduleXlsx";

/**
 * Lay an uploaded spreadsheet next to what the app already has for the same
 * person and say where they disagree.
 *
 * The sheet speaks for every day between its first and last dated column, so a
 * day with no cell for the person is a day off, and an app shift on it is a
 * disagreement. Shifts are compared by their hours, not by shift-type id: the
 * sheet only has clock times, and two types with the same hours are the same
 * shift as far as anyone is concerned.
 */

export type Who = "G" | "K" | "D";

export interface Hours { start: string; end: string }

export interface SheetShift extends Partial<Hours> {
  label: string;
  note?: string;
  /** The sheet only gave a start ("3"); the end is the one every shift type
   *  starting then shares. It isn't compared, only used to apply. */
  endInferred?: boolean;
}

export interface AppShiftInfo extends Hours {
  name: string;
  note?: string;
}

export type DiffKind = "different" | "sheet-only" | "app-only";

export interface ShiftDiff {
  /** Stable key for the row: `${date}`. One per day. */
  date: string;
  kind: DiffKind;
  /** What the sheet says that day; absent when the sheet has no shift. */
  sheet?: SheetShift;
  /** What the app has that day; empty when it has none. */
  app: AppShiftInfo[];
  /** Why the app's side can't be changed here (a weekly template), if so. */
  locked?: string;
}

export interface OnCallDiff {
  date: string;
  /** "sheet-only": the sheet has the asterisk, the app doesn't. */
  kind: "sheet-only" | "app-only";
}

export interface Comparison {
  from: string;
  to: string;
  /** Days with a shift on both sides, hours agreeing (or unreadable on the sheet). */
  matches: number;
  diffs: ShiftDiff[];
  onCall: OnCallDiff[];
  /** The last day the sheet has a shift for this person, within from–to. Where
   *  the schedule period ends, whether or not that day differs from the app. */
  lastShiftDate?: string;
}

export interface CompareInput {
  rows: ParsedShiftRow[];
  onCallDates?: string[];
  from: string;
  to: string;
  who: Who;
  shifts: ShiftMap;
  shiftTypes: Array<{ id: string; name: string; start: string; end: string }>;
  /** Dates (and only those) where this person's app shifts can be removed. */
  canRemove?: (date: string) => boolean;
  /** Kaylene's on-call days already in the app. Omit for anyone else. */
  appOnCall?: string[];
}

const LOCKED = "It comes from a weekly template. Change it under Templates.";

export function compareSchedule(input: CompareInput): Comparison {
  const { from, to, who, shifts, shiftTypes } = input;
  const types = new Map(shiftTypes.map((t) => [t.id, t]));
  const canRemove = input.canRemove ?? (() => true);

  const sheetByDate = new Map<string, SheetShift>();
  for (const r of input.rows) {
    if (r.date < from || r.date > to || sheetByDate.has(r.date)) continue;
    const hours = r.start ? { start: r.start, end: r.end } : parseTimeRange(r.label || "");
    let end = hours?.end;
    let endInferred = false;
    if (hours && !end) {
      const ends = new Set(shiftTypes.filter((t) => t.start === hours.start).map((t) => t.end));
      if (ends.size === 1) { end = [...ends][0]; endInferred = true; }
    }
    sheetByDate.set(r.date, {
      label: r.label,
      ...(r.note ? { note: r.note } : {}),
      ...(hours ? { start: hours.start, ...(end ? { end } : {}), ...(endInferred ? { endInferred } : {}) } : {}),
    });
  }

  const appByDate = new Map<string, AppShiftInfo[]>();
  for (const [date, list] of Object.entries(shifts)) {
    if (date < from || date > to) continue;
    for (const s of list) {
      if (s.who !== who) continue;
      const t = s.shiftTypeId ? types.get(s.shiftTypeId) : undefined;
      if (!t) continue;       // a shift with no hours can't be compared
      const arr = appByDate.get(date) ?? [];
      arr.push({ name: t.name, start: t.start, end: t.end, ...(s.note ? { note: s.note } : {}) });
      appByDate.set(date, arr);
    }
  }

  const diffs: ShiftDiff[] = [];
  let matches = 0;
  const dates = [...new Set([...sheetByDate.keys(), ...appByDate.keys()])].sort();
  for (const date of dates) {
    const sheet = sheetByDate.get(date);
    const app = appByDate.get(date) ?? [];
    if (sheet && app.length === 0) {
      diffs.push({ date, kind: "sheet-only", sheet, app });
    } else if (!sheet && app.length > 0) {
      diffs.push({ date, kind: "app-only", app, ...(canRemove(date) ? {} : { locked: LOCKED }) });
    } else if (sheet && app.length > 0) {
      // A sheet that only names the start is compared on the start alone.
      const same = sheet.start === undefined ||
        app.some((a) => a.start === sheet.start && (sheet.end === undefined || sheet.endInferred || a.end === sheet.end));
      if (same) matches++;
      else diffs.push({ date, kind: "different", sheet, app, ...(canRemove(date) ? {} : { locked: LOCKED }) });
    }
  }

  const onCall: OnCallDiff[] = [];
  if (who === "K") {
    const inRange = (d: string) => d >= from && d <= to;
    const sheetSet = new Set((input.onCallDates ?? []).filter(inRange));
    const appSet = new Set((input.appOnCall ?? []).filter(inRange));
    for (const d of sheetSet) if (!appSet.has(d)) onCall.push({ date: d, kind: "sheet-only" });
    for (const d of appSet) if (!sheetSet.has(d)) onCall.push({ date: d, kind: "app-only" });
    onCall.sort((a, b) => a.date.localeCompare(b.date));
  }

  const sheetDates = [...sheetByDate.keys()].sort();
  const lastShiftDate = sheetDates[sheetDates.length - 1];
  return { from, to, matches, diffs, onCall, ...(lastShiftDate ? { lastShiftDate } : {}) };
}

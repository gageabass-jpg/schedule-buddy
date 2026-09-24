import type { DayKind } from "./theme";

export type Who = "G" | "K" | "D";

/**
 * Where a rendered shift chip came from in the underlying state. Used to
 * power edit/delete: discrete entries (override/ot/partner) can be mutated
 * directly; recurring ones (template/alt-weekend) need an override to
 * change a single date.
 */
export type ShiftSource =
  | { kind: "template" }
  | { kind: "alt-weekend" }
  | { kind: "override" }
  | { kind: "ot"; index: number }
  | { kind: "partner"; index: number };

export interface Shift {
  who: Who;
  label: string;
  /** Provenance from state/main. Undefined for demo data. */
  source?: ShiftSource;
  /** When source.kind is override/ot, the shiftTypeId so editors can prefill. */
  shiftTypeId?: string;
  /** Free text from the stored entry — e.g. who else is on that shift. */
  note?: string;
  /** Where this shift is worked. Falls back to the person's employer. */
  where?: string;
}
export type ShiftMap = Record<string, Shift[]>;

// Inferred from the original screenshots (Apr 5 — ~Jun 27 2026)
const RAW: Array<[string, Array<[Who, string]>]> = [
  // April
  ["2026-04-08", [["G", "3p"], ["K", "7p"]]],
  ["2026-04-09", [["G", "7p"], ["K", "7p"]]],
  ["2026-04-10", [["G", "7p"]]],
  ["2026-04-11", [["G", "11p"]]],
  ["2026-04-12", [["G", "3p"], ["G", "11p"], ["K", "7p"]]],
  ["2026-04-14", [["G", "3p"], ["K", "8a"]]],
  ["2026-04-15", [["K", "7p"]]],
  ["2026-04-16", [["G", "7p"], ["K", "7p"]]],
  ["2026-04-17", [["G", "7p"]]],
  ["2026-04-22", [["G", "3p"]]],
  ["2026-04-23", [["G", "7p"], ["K", "7p"]]],
  ["2026-04-24", [["G", "7p"], ["K", "7p"]]],
  ["2026-04-25", [["G", "11p"], ["K", "7p"]]],
  ["2026-04-26", [["G", "11p"], ["K", "7p"]]],
  ["2026-04-27", [["K", "7p"]]],
  ["2026-04-29", [["G", "3p"]]],
  ["2026-04-30", [["G", "7p"]]],
  // May
  ["2026-05-01", [["G", "7p"]]],
  ["2026-05-02", [["K", "7p"]]],
  ["2026-05-03", [["K", "7p"]]],
  ["2026-05-05", [["K", "8a"]]],
  ["2026-05-06", [["G", "3p"], ["K", "7p"]]],
  ["2026-05-07", [["G", "7p"], ["K", "7p"]]],
  ["2026-05-08", [["G", "7p"]]],
  ["2026-05-09", [["G", "11p"]]],
  ["2026-05-10", [["G", "11p"]]],
  ["2026-05-13", [["G", "3p"]]],
  ["2026-05-14", [["G", "7p"]]],
  ["2026-05-15", [["G", "7p"]]],
  ["2026-05-20", [["G", "3p"]]],
  ["2026-05-21", [["G", "7p"]]],
  ["2026-05-22", [["G", "7p"]]],
  ["2026-05-23", [["G", "11p"]]],
  ["2026-05-27", [["G", "3p"]]],
  ["2026-05-28", [["G", "7p"]]],
  ["2026-05-29", [["G", "7p"]]],
  // June
  ["2026-06-03", [["G", "3p"]]],
  ["2026-06-04", [["G", "7p"]]],
  ["2026-06-05", [["G", "7p"]]],
  ["2026-06-06", [["G", "11p"]]],
  ["2026-06-07", [["G", "11p"]]],
  ["2026-06-10", [["G", "3p"]]],
  ["2026-06-11", [["G", "7p"]]],
  ["2026-06-12", [["G", "7p"]]],
  ["2026-06-13", [["G", "11p"]]],
  ["2026-06-14", [["G", "11p"]]],
  ["2026-06-17", [["G", "3p"]]],
  ["2026-06-18", [["G", "7p"]]],
  ["2026-06-19", [["G", "7p"]]],
  ["2026-06-20", [["G", "11p"]]],
  ["2026-06-21", [["G", "11p"]]],
  ["2026-06-24", [["G", "3p"]]],
  ["2026-06-25", [["G", "7p"]]],
  ["2026-06-26", [["G", "7p"]]],
  ["2026-06-27", [["G", "11p"]]],
];

export const DEMO_SHIFTS: ShiftMap = Object.fromEntries(
  RAW.map(([date, list]) => [date, list.map(([who, label]) => ({ who, label }))])
);

export function fmtDate(y: number, mo: number, d: number): string {
  return `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function dayKindFromShifts(shifts: Shift[] | undefined): DayKind {
  if (!shifts || shifts.length === 0) return "off";
  const hasG = shifts.some((s) => s.who === "G");
  const hasK = shifts.some((s) => s.who === "K");
  if (hasG && hasK) return "both";
  if (hasG) return "g";
  return "k";
}

export interface MonthCell { y: number; mo: number; d: number; other: boolean; }

export function buildMonthGrid(y: number, mo: number): MonthCell[][] {
  const first = new Date(y, mo, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const prevDays = new Date(y, mo, 0).getDate();
  const cells: MonthCell[] = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push({ y, mo: mo - 1, d: prevDays - startWeekday + 1 + i, other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ y, mo, d, other: false });
  let nd = 1;
  while (cells.length % 7 !== 0 || cells.length < 42) {
    cells.push({ y, mo: mo + 1, d: nd++, other: true });
    if (cells.length >= 42) break;
  }
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const WEEKDAYS_3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

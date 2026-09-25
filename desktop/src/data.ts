// Desktop-only calendar helpers. The schedule vocabulary itself — Shift,
// ShiftMap, Who, DayKind, fmtDate, dayKindFromShifts, the month names — lives
// in shared/ so the Cloud Functions reason about it identically.
export * from "../../shared/schedule";

import { type ShiftMap, type Who } from "../../shared/schedule";

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
  RAW.map(([date, list]) => [date, list.map(([who, label]) => ({ who, label }))]),
);

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


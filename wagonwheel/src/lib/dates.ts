import { dayIndex, isoFromDayIndex, weekdayOf } from "@nucleus/ui/lib/timelineAxis";

// Calendar days as "YYYY-MM-DD", local time, never a time zone. The day-index maths
// is the shared timeline code, so a date means the same thing here and on the Gantt.

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHS_3 = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAYS_3 = WEEKDAYS.map((d) => d.slice(0, 3));

export function toIso(y: number, month0: number, d: number): string {
  return `${y}-${String(month0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Today, from the local clock. */
export function todayIso(now: Date = new Date()): string {
  return toIso(now.getFullYear(), now.getMonth(), now.getDate());
}

export function parts(iso: string): { y: number; m0: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m0: m - 1, d };
}

export const addDays = (iso: string, n: number): string => isoFromDayIndex(dayIndex(iso) + n);
/** a minus b, in whole days. */
export const diffDays = (a: string, b: string): number => dayIndex(a) - dayIndex(b);
export const weekday = (iso: string): number => weekdayOf(dayIndex(iso));

/** The same day-of-month in another month, clamped to that month's last day. */
export function addMonths(iso: string, n: number): string {
  const { y, m0, d } = parts(iso);
  const t = m0 + n;
  const ny = y + Math.floor(t / 12);
  const nm = ((t % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return toIso(ny, nm, Math.min(d, last));
}

export interface GridCell { iso: string; day: number; inMonth: boolean }

/** Six weeks, Sunday first, the way the sidebar calendar draws a month. */
export function monthGrid(year: number, month0: number): GridCell[] {
  const first = toIso(year, month0, 1);
  const start = addDays(first, -weekday(first));
  return Array.from({ length: 42 }, (_, i) => {
    const iso = addDays(start, i);
    const p = parts(iso);
    return { iso, day: p.d, inMonth: p.m0 === month0 };
  });
}

/** "Monday, November 9" */
export function formatLong(iso: string): string {
  const { m0, d } = parts(iso);
  return `${WEEKDAYS[weekday(iso)]}, ${MONTHS[m0]} ${d}`;
}

/** "Nov 9", or "Nov 9, 2027" when it is not the current year. */
export function formatShort(iso: string, today: string): string {
  const { y, m0, d } = parts(iso);
  return y === parts(today).y ? `${MONTHS_3[m0]} ${d}` : `${MONTHS_3[m0]} ${d}, ${y}`;
}

/** "Today", "Tomorrow", "Yesterday", "in 3 days", "3 days ago". */
export function relativeDay(iso: string, today: string): string {
  const n = diffDays(iso, today);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** "Nov 9 – Dec 31", "Nov 9 →", "→ Dec 31", or "". */
export function formatRange(start: string | null, end: string | null, today: string): string {
  if (start && end) return `${formatShort(start, today)} – ${formatShort(end, today)}`;
  if (start) return `${formatShort(start, today)} →`;
  if (end) return `→ ${formatShort(end, today)}`;
  return "";
}

// Stretches: runs of consecutive days one person works. The calendar marks
// Kaylene's with a fire, and says which day of the run a date is ("2/3").

import type { ShiftMap, Who } from "../data";

export interface StretchDay {
  /** 1-based position in the run. */
  day: number;
  /** How many days the run lasts. */
  of: number;
}

/** "2026-09-30" → "2026-10-01". */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return n.toISOString().slice(0, 10);
}

/**
 * Every date that sits in a run of at least `minLength` consecutive days
 * `who` works, with its place in the run. A single day on its own isn't a
 * stretch. Runs are only as complete as the map: build it a little wider than
 * the dates you show so a run crossing the edge counts its hidden days.
 */
export function stretchesFor(shifts: ShiftMap, who: Who, minLength = 2): Map<string, StretchDay> {
  const days = Object.keys(shifts)
    .filter((k) => shifts[k]?.some((s) => s.who === who))
    .sort();
  const out = new Map<string, StretchDay>();
  let run: string[] = [];
  const flush = () => {
    if (run.length >= minLength) run.forEach((k, i) => out.set(k, { day: i + 1, of: run.length }));
    run = [];
  };
  for (const k of days) {
    if (run.length && nextDay(run[run.length - 1]) !== k) flush();
    run.push(k);
  }
  flush();
  return out;
}

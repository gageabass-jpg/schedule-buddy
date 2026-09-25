// Shared schedule vocabulary.
//
// This module and its siblings are the one definition of what a shift is and
// how the week resolves. The Mac app, the Cloud Functions and anything else
// that reasons about the schedule import them rather than keeping a copy —
// four separate implementations is how nucleusAI ends up confidently
// disagreeing with the calendar.
//
// Keep this free of UI, Firebase and Node: it is compiled for a browser
// bundle and for a CommonJS function runtime alike.

/** How a day reads at a glance: who is working. */
export type DayKind = "g" | "k" | "both" | "off";

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

export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const WEEKDAYS_3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

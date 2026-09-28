// US federal holidays, computed from their rules so every year is right
// without a list to maintain. Gage and Kaylene both get holiday pay for shifts
// worked on them, so the calendar marks those shifts.
//
// Dates are the holiday itself, not the "observed" weekday an office closes
// when a fixed-date holiday lands on a weekend: shift work pays the actual day.

export interface Holiday {
  /** YYYY-MM-DD */
  date: string;
  /** Full name, for the day popover, the day card and nucleusAI. */
  name: string;
  /** Fits in a calendar cell. */
  short: string;
}

const iso = (y: number, m0: number, d: number) =>
  `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The nth (1-based) weekday (0 = Sunday) of a month. */
function nthWeekday(y: number, m0: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(y, m0, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** The last given weekday of a month. */
function lastWeekday(y: number, m0: number, weekday: number): number {
  const lastDate = new Date(Date.UTC(y, m0 + 1, 0));
  return lastDate.getUTCDate() - ((lastDate.getUTCDay() - weekday + 7) % 7);
}

export function federalHolidays(y: number): Holiday[] {
  return [
    { date: iso(y, 0, 1), name: "New Year's Day", short: "New Year's Day" },
    { date: iso(y, 0, nthWeekday(y, 0, 1, 3)), name: "Martin Luther King Jr. Day", short: "MLK Day" },
    { date: iso(y, 1, nthWeekday(y, 1, 1, 3)), name: "Presidents' Day", short: "Presidents' Day" },
    { date: iso(y, 4, lastWeekday(y, 4, 1)), name: "Memorial Day", short: "Memorial Day" },
    { date: iso(y, 5, 19), name: "Juneteenth", short: "Juneteenth" },
    { date: iso(y, 6, 4), name: "Independence Day", short: "July 4th" },
    { date: iso(y, 8, nthWeekday(y, 8, 1, 1)), name: "Labor Day", short: "Labor Day" },
    { date: iso(y, 9, nthWeekday(y, 9, 1, 2)), name: "Columbus Day", short: "Columbus Day" },
    { date: iso(y, 10, 11), name: "Veterans Day", short: "Veterans Day" },
    { date: iso(y, 10, nthWeekday(y, 10, 4, 4)), name: "Thanksgiving", short: "Thanksgiving" },
    { date: iso(y, 11, 25), name: "Christmas Day", short: "Christmas" },
  ];
}

const byYear = new Map<number, Map<string, Holiday>>();

/** The federal holiday on a date (YYYY-MM-DD), if there is one. */
export function holidayOn(date: string): Holiday | undefined {
  const y = Number(date.slice(0, 4));
  if (!Number.isFinite(y)) return undefined;
  let year = byYear.get(y);
  if (!year) {
    year = new Map(federalHolidays(y).map((h) => [h.date, h]));
    byYear.set(y, year);
  }
  return year.get(date);
}

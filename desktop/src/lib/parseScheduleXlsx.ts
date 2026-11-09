import * as XLSX from "xlsx";
import type { ParsedShiftRow } from "../global";

/**
 * Read a schedule straight out of a spreadsheet export.
 *
 * The unit's .xlsx is laid out like the paper board: a header row of real
 * dates, then one row per person whose first cell is their name. Because the
 * dates and the times are text rather than pixels, this needs no vision model
 * — it is exact, free, and cannot mis-read a "0" as an "O".
 *
 * A cell reads "<start>-<end> <coworkers>", e.g. "6-230 Lacey" or
 * "6-630 Lacey/Emily". A lone "/" (or an empty cell) means no shift.
 */

export interface SheetShiftType {
  id: string;
  name: string;
  start: string;   // HH:MM
  end: string;     // HH:MM
}

export interface XlsxParseResult {
  rows: ParsedShiftRow[];
  /** Dated columns that held something for this person — the cross-check. */
  countedDays: number;
  /** Names found in the sheet's first column, when the person isn't there. */
  peopleFound: string[];
  monthCovered?: string;
  /** The first and last dated column in the sheet: every day in between is one
   *  the sheet speaks for, whether or not this person has a shift on it. */
  dateFrom?: string;
  dateTo?: string;
  /** Days whose cell carries an asterisk: on call. A bare "*" is on call with
   *  no shift, so it is here and not in rows (or countedDays). */
  onCallDates?: string[];
  error?: string;
}

// "V" is a vacation day: the person isn't working it.
const OFF_MARKERS = new Set(["/", "-", "off", "x", "—", "–", "v"]);

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "6" → 6:00, "230" → 2:30, "1130" → 11:30. Returns minutes from midnight. */
function readClock(token: string): number | null {
  const m = /^(\d{1,4})(?::(\d{2}))?\s*([ap])?/i.exec(token.trim());
  if (!m) return null;
  const digits = m[1];
  let hour: number;
  let min: number;
  if (m[2] !== undefined) {
    hour = Number(digits);
    min = Number(m[2]);
  } else if (digits.length <= 2) {
    hour = Number(digits);
    min = 0;
  } else {
    hour = Number(digits.slice(0, digits.length - 2));
    min = Number(digits.slice(-2));
  }
  if (!Number.isFinite(hour) || !Number.isFinite(min) || hour > 23 || min > 59) return null;
  const mer = m[3]?.toLowerCase();
  if (mer === "p" && hour < 12) hour += 12;
  if (mer === "a" && hour === 12) hour = 0;
  return hour * 60 + min;
}

/**
 * Which half of the day a bare clock number belongs to, from the section of the
 * sheet its row sits under: DAY SHIFT rows start in the morning, EVENING rows
 * in the afternoon, MIDNIGHT rows late at night (a "3" there is three in the
 * morning).
 */
export type ShiftBias = "am" | "pm" | "night";

function applyBias(minutes: number, bias?: ShiftBias): number {
  const hour = Math.floor(minutes / 60);
  if (hour >= 12) return minutes;
  if (bias === "pm" && hour >= 1) return minutes + 720;
  if (bias === "night" && hour >= 6) return minutes + 720;
  return minutes;
}

function biasFor(section: string): ShiftBias | undefined {
  if (/evening/i.test(section)) return "pm";
  if (/midnight|night/i.test(section)) return "night";
  if (/day/i.test(section)) return "am";
  return undefined;
}

/**
 * One cell's shift: a range ("6-230", "11a-11:30p") or just a start ("3" under
 * EVENING, "7" under DAY), which the sheet uses for the usual shift of the day.
 * A start-only cell has no end here; whoever uses it fills the end in from the
 * shift types that start then.
 */
export function parseShiftCell(
  text: string,
  bias?: ShiftBias,
): { start: string; end?: string; matched: string } | null {
  const range = parseTimeRange(text, bias);
  if (range) return range;
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?(?!\d)/i.exec(text);
  if (!m) return null;
  const startMin = readClock(m[0]);
  if (startMin === null) return null;
  const at = m[3] ? startMin : applyBias(startMin, bias);
  return { start: `${pad(Math.floor(at / 60))}:${pad(at % 60)}`, matched: m[0] };
}

/**
 * "6-230" → 06:00 / 14:30. The sheet writes bare clock numbers with no
 * meridiem, so the end is rolled forward by twelve hours until the shift is
 * at least two hours long — a 6-to-2:30 shift is never half an hour.
 */
export function parseTimeRange(
  text: string,
  bias?: ShiftBias,
): { start: string; end: string; matched: string } | null {
  const range = /(\d{1,4}(?::\d{2})?\s*[ap]?)\s*(?:-|–|—|to)\s*(\d{1,4}(?::\d{2})?\s*[ap]?)/i.exec(text);
  if (!range) return null;
  let startMin = readClock(range[1]);
  let endMin = readClock(range[2]);
  if (startMin === null || endMin === null) return null;
  if (!/[ap]/i.test(range[1])) startMin = applyBias(startMin, bias);
  const explicitEnd = /[ap]/i.test(range[2]);
  if (!explicitEnd) {
    let guard = 0;
    while (endMin - startMin < 120 && guard < 2) { endMin += 720; guard++; }
  }
  if (endMin >= 1440) endMin -= 1440;   // crosses midnight
  return {
    start: `${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}`,
    end: `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`,
    matched: range[0],
  };
}

/**
 * The sheet runs names together — "LaceyAlexx" for what it writes elsewhere
 * as "Lacey/Emily". Split where a capital follows a lower-case letter so both
 * spellings read the same.
 */
function splitRunTogetherNames(note: string): string {
  return note.replace(/([a-z])([A-Z])/g, "$1/$2");
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Does this sheet row name the person we're importing for? */
function isPersonRow(first: string, personLabel: string): boolean {
  const a = first.toLowerCase().replace(/[^a-z]/g, "");
  const b = personLabel.toLowerCase().replace(/[^a-z]/g, "");
  return a.length > 0 && (a === b || a.startsWith(b) || b.startsWith(a));
}

/**
 * Dated columns written as text ("10/25") rather than real dates. The year
 * isn't in the cells, so it comes from the sheet's title ("… to November 21,
 * 2026"), which names the year the last column falls in; going back from
 * there, a month that jumps up means the year before.
 */
function textDateColumns(grid: unknown[][]): { dates: Array<{ col: number; date: Date }>; headerIdx: number } {
  let best: Array<{ col: number; m: number; d: number }> = [];
  let headerIdx = -1;
  grid.forEach((row, i) => {
    const found: Array<{ col: number; m: number; d: number }> = [];
    (row ?? []).forEach((v, col) => {
      const hit = typeof v === "string" ? /^\s*(\d{1,2})\/(\d{1,2})\s*$/.exec(v) : null;
      if (hit && Number(hit[1]) >= 1 && Number(hit[1]) <= 12 && Number(hit[2]) >= 1 && Number(hit[2]) <= 31) {
        found.push({ col, m: Number(hit[1]), d: Number(hit[2]) });
      }
    });
    if (found.length > best.length) { best = found; headerIdx = i; }
  });
  if (best.length < 3) return { dates: [], headerIdx: -1 };

  let year = new Date().getFullYear();
  for (const row of grid.slice(0, Math.max(headerIdx, 1))) {
    for (const v of row ?? []) {
      const y = typeof v === "string" ? /\b(20\d{2})\b/.exec(v) : null;
      if (y) year = Number(y[1]);
    }
  }
  const dates: Array<{ col: number; date: Date }> = [];
  let y = year;
  for (let i = best.length - 1; i >= 0; i--) {
    if (i < best.length - 1 && best[i].m > best[i + 1].m) y--;
    dates.unshift({ col: best[i].col, date: new Date(y, best[i].m - 1, best[i].d) });
  }
  return { dates, headerIdx };
}

/** A section heading row: "DAY SHIFT", "MIDNIGHT" — capitals, nothing else in the row. */
function isSectionRow(row: unknown[] | undefined): boolean {
  const first = cellText((row ?? [])[0]);
  if (first.length < 3 || /[a-z]/.test(first)) return false;
  return (row ?? []).slice(1).every((v) => cellText(v) === "");
}

/** The column labels at the head of a roster, which are not people. */
const LABEL_ROWS = new Set(["day", "date", "name", "staff"]);

export function parseScheduleXlsx(
  data: ArrayBuffer,
  personLabel: string,
  shiftTypes: SheetShiftType[],
): XlsxParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: "array", cellDates: true });
  } catch {
    return { rows: [], countedDays: 0, peopleFound: [], error: "Couldn't open that spreadsheet." };
  }

  // Remembered across sheets so a "couldn't find them" error can still say
  // whose rows the file does contain.
  const seenPeople: string[] = [];
  let sawDates = false;

  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1, raw: true, blankrows: true, defval: null,
    });

    // The header row is whichever row holds the most real dates — or, failing
    // that, the most dates written as text ("10/25").
    let headerIdx = -1;
    let dates: Array<{ col: number; date: Date }> = [];
    grid.forEach((row, i) => {
      const found: Array<{ col: number; date: Date }> = [];
      (row ?? []).forEach((v, col) => {
        if (v instanceof Date && !Number.isNaN(v.getTime())) found.push({ col, date: v });
      });
      if (found.length > dates.length) { dates = found; headerIdx = i; }
    });
    if (headerIdx < 0 || dates.length < 3) {
      ({ dates, headerIdx } = textDateColumns(grid as unknown[][]));
    }
    if (headerIdx < 0 || dates.length < 3) continue;
    sawDates = true;

    // The person's row is the one whose first cell is their name. Rows sit
    // under headings (DAY SHIFT, EVENING SHIFT…) that say which half of the day
    // a bare "3" means.
    const people: string[] = [];
    let personIdx = -1;
    let section = "";
    let personSection = "";
    for (let i = 0; i < grid.length; i++) {
      const first = cellText((grid[i] ?? [])[0]);
      if (!first || i === headerIdx) continue;
      if (isSectionRow(grid[i] as unknown[])) { section = first; continue; }
      if (LABEL_ROWS.has(first.toLowerCase()) || i < headerIdx) continue;
      people.push(first);
      if (personIdx < 0 && isPersonRow(first, personLabel)) { personIdx = i; personSection = section; }
    }
    for (const name of people) if (!seenPeople.includes(name)) seenPeople.push(name);
    if (personIdx < 0) continue;

    const bias = biasFor(personSection);
    const rows: ParsedShiftRow[] = [];
    const onCallDates: string[] = [];
    let countedDays = 0;
    const personRow = grid[personIdx] ?? [];

    for (const { col, date } of dates) {
      const raw = cellText(personRow[col]);
      // An asterisk marks the day on call, with or without a shift beside it.
      if (raw.includes("*")) onCallDates.push(dateKey(date));
      const text = raw.replace(/\*/g, " ").replace(/\s+/g, " ").trim();
      if (!text || OFF_MARKERS.has(text.toLowerCase())) continue;
      countedDays++;
      const times = parseShiftCell(text, bias);
      // The times become the label; whatever else is in the cell is a note —
      // usually who else is on ("Lacey", "Terra/Lacey"), sometimes a marker.
      const label = times ? times.matched.trim() : text;
      const note = times
        ? splitRunTogetherNames(text.replace(times.matched, "").replace(/\s+/g, " ").trim())
        : "";
      const match = times?.end
        ? shiftTypes.find((s) => s.start === times.start && s.end === times.end)
        : undefined;
      rows.push({
        date: dateKey(date),
        shiftTypeId: match?.id ?? null,
        label,
        confidence: times ? 1 : 0.4,
        ...(times ? { start: times.start, ...(times.end ? { end: times.end } : {}) } : {}),
        ...(note ? { note } : {}),
      });
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    const monthCovered = rows.length ? rows[0].date.slice(0, 7) : undefined;
    onCallDates.sort();
    const keys = dates.map((d) => dateKey(d.date)).sort();
    return { rows, countedDays, peopleFound: people, monthCovered, onCallDates, dateFrom: keys[0], dateTo: keys[keys.length - 1] };
  }

  return {
    rows: [],
    countedDays: 0,
    peopleFound: seenPeople,
    error: sawDates
      ? `Couldn't find a row for ${personLabel} in that spreadsheet.`
      : "Couldn't find the dates in that spreadsheet.",
  };
}

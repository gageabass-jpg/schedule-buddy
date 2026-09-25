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
  error?: string;
}

const OFF_MARKERS = new Set(["/", "-", "off", "x", "—", "–"]);

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
 * "6-230" → 06:00 / 14:30. The sheet writes bare clock numbers with no
 * meridiem, so the end is rolled forward by twelve hours until the shift is
 * at least two hours long — a 6-to-2:30 shift is never half an hour.
 */
export function parseTimeRange(text: string): { start: string; end: string; matched: string } | null {
  const range = /(\d{1,4}(?::\d{2})?\s*[ap]?)\s*(?:-|–|—|to)\s*(\d{1,4}(?::\d{2})?\s*[ap]?)/i.exec(text);
  if (!range) return null;
  const startMin = readClock(range[1]);
  let endMin = readClock(range[2]);
  if (startMin === null || endMin === null) return null;
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

  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1, raw: true, blankrows: true, defval: null,
    });

    // The header row is whichever row holds the most real dates.
    let headerIdx = -1;
    let dates: Array<{ col: number; date: Date }> = [];
    grid.forEach((row, i) => {
      const found: Array<{ col: number; date: Date }> = [];
      (row ?? []).forEach((v, col) => {
        if (v instanceof Date && !Number.isNaN(v.getTime())) found.push({ col, date: v });
      });
      if (found.length > dates.length) { dates = found; headerIdx = i; }
    });
    if (headerIdx < 0 || dates.length < 3) continue;

    // The person's row is the one whose first cell is their name.
    const people: string[] = [];
    let personIdx = -1;
    for (let i = 0; i < grid.length; i++) {
      const first = cellText((grid[i] ?? [])[0]);
      if (!first || i === headerIdx) continue;
      people.push(first);
      if (personIdx < 0 && isPersonRow(first, personLabel)) personIdx = i;
    }
    if (personIdx < 0) continue;

    const rows: ParsedShiftRow[] = [];
    let countedDays = 0;
    const personRow = grid[personIdx] ?? [];

    for (const { col, date } of dates) {
      const text = cellText(personRow[col]);
      if (!text || OFF_MARKERS.has(text.toLowerCase())) continue;
      countedDays++;
      const times = parseTimeRange(text);
      // The times become the label; whatever else is in the cell is a note —
      // usually who else is on ("Lacey", "Terra/Lacey"), sometimes a marker.
      const label = times ? times.matched.trim() : text;
      const note = times
        ? splitRunTogetherNames(text.replace(times.matched, "").replace(/\s+/g, " ").trim())
        : "";
      const match = times
        ? shiftTypes.find((s) => s.start === times.start && s.end === times.end)
        : undefined;
      rows.push({
        date: dateKey(date),
        shiftTypeId: match?.id ?? null,
        label,
        confidence: times ? 1 : 0.4,
        ...(note ? { note } : {}),
      });
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    const monthCovered = rows.length ? rows[0].date.slice(0, 7) : undefined;
    return { rows, countedDays, peopleFound: people, monthCovered };
  }

  return {
    rows: [],
    countedDays: 0,
    peopleFound: [],
    error: `Couldn't find a row for ${personLabel} in that spreadsheet.`,
  };
}

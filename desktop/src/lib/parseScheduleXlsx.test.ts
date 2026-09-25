import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseScheduleXlsx, parseTimeRange } from "./parseScheduleXlsx";

/**
 * The reader for the unit's spreadsheet export. These cases are the real
 * cells from a September–October roster, including the ones that were read
 * wrongly before: four-digit times, and names run together without a slash.
 */

describe("parseTimeRange", () => {
  it("reads a bare clock range as a day shift", () => {
    expect(parseTimeRange("6-230")).toMatchObject({ start: "06:00", end: "14:30" });
  });

  it("rolls the end forward rather than believing in a half-hour shift", () => {
    // "6-630" read literally is 30 minutes; it means 6am to 6:30pm.
    expect(parseTimeRange("6-630")).toMatchObject({ start: "06:00", end: "18:30" });
  });

  it("honours an explicit meridiem instead of guessing", () => {
    expect(parseTimeRange("11p-730a")).toMatchObject({ start: "23:00", end: "07:30" });
    expect(parseTimeRange("930a-6p")).toMatchObject({ start: "09:30", end: "18:00" });
  });

  it("reports what it consumed, so the rest can become a note", () => {
    expect(parseTimeRange("6-230 Lacey")?.matched.trim()).toBe("6-230");
  });

  it("returns null when there is no range at all", () => {
    expect(parseTimeRange("V")).toBeNull();
    expect(parseTimeRange("holiday")).toBeNull();
  });
});

/** Build a workbook shaped like the real export: a date header row, then one
 *  row per person whose first cell is their name. */
function sheet(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out as ArrayBuffer;
}

const D = (iso: string) => new Date(`${iso}T00:00:00`);

const TYPES = [
  { id: "t_day", name: "6a-230p", start: "06:00", end: "14:30" },
  { id: "t_long", name: "6a-630p", start: "06:00", end: "18:30" },
];

describe("parseScheduleXlsx", () => {
  const rows = [
    ["Revised 9/23", "M", "T", "W", "TH"],
    [null, D("2026-09-28"), D("2026-09-29"), D("2026-09-30"), D("2026-10-01")],
    ["Gage", "3p-1130p", "/", "", "3p-1130p"],
    ["Kaylene", "6-230 Lacey", "6-630 LaceyAlexx", "/", "6-230 Terra/Lacey"],
  ];

  it("extracts only the named person's row", () => {
    const res = parseScheduleXlsx(sheet(rows), "Kaylene", TYPES);
    expect(res.error).toBeUndefined();
    expect(res.rows.map((r) => r.date)).toEqual(["2026-09-28", "2026-09-29", "2026-10-01"]);
  });

  it("matches a shift type by its hours, not its name", () => {
    const res = parseScheduleXlsx(sheet(rows), "Kaylene", TYPES);
    expect(res.rows.map((r) => r.shiftTypeId)).toEqual(["t_day", "t_long", "t_day"]);
  });

  it("keeps the rest of the cell as a note and splits run-together names", () => {
    const res = parseScheduleXlsx(sheet(rows), "Kaylene", TYPES);
    expect(res.rows.map((r) => r.note)).toEqual(["Lacey", "Lacey/Alexx", "Terra/Lacey"]);
  });

  it("treats a lone slash as a day off", () => {
    const res = parseScheduleXlsx(sheet(rows), "Kaylene", TYPES);
    expect(res.rows.find((r) => r.date === "2026-09-30")).toBeUndefined();
  });

  it("counts the filled cells it saw, as a cross-check on the rows", () => {
    const res = parseScheduleXlsx(sheet(rows), "Kaylene", TYPES);
    expect(res.countedDays).toBe(res.rows.length);
  });

  it("leaves the type unmatched rather than guessing when nothing fits", () => {
    const res = parseScheduleXlsx(sheet(rows), "Gage", TYPES);
    expect(res.rows.every((r) => r.shiftTypeId === null)).toBe(true);
  });

  it("names who it did find when the person isn't in the sheet", () => {
    const res = parseScheduleXlsx(sheet(rows), "Daisy", TYPES);
    expect(res.error).toMatch(/Daisy/);
    expect(res.peopleFound).toContain("Kaylene");
  });
});

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

  it("reads the labels the review table offers to make a type from", () => {
    // "10a-730p" is what the photo said on the row that couldn't be saved.
    expect(parseTimeRange("10a-730p")).toMatchObject({ start: "10:00", end: "19:30" });
    expect(parseTimeRange("10a-5p")).toMatchObject({ start: "10:00", end: "17:00" });
    expect(parseTimeRange("7p-730a")).toMatchObject({ start: "19:00", end: "07:30" });
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

  it("reports the span of dated columns, so a day off is a day the sheet covers", () => {
    const res = parseScheduleXlsx(sheet(rows), "Kaylene", TYPES);
    expect(res.dateFrom).toBe("2026-09-28");
    expect(res.dateTo).toBe("2026-10-01");
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

  describe("on call (the asterisk)", () => {
    const onCall = [
      ["Revised 9/23", "M", "T", "W", "TH"],
      [null, D("2026-09-28"), D("2026-09-29"), D("2026-09-30"), D("2026-10-01")],
      ["Kaylene", "6-230* Lacey", "*", "/", "6-230 Terra"],
    ];

    it("marks a day on call whether or not it also has a shift", () => {
      const res = parseScheduleXlsx(sheet(onCall), "Kaylene", TYPES);
      expect(res.onCallDates).toEqual(["2026-09-28", "2026-09-29"]);
    });

    it("keeps the asterisk out of the shift's label and note", () => {
      const res = parseScheduleXlsx(sheet(onCall), "Kaylene", TYPES);
      const row = res.rows.find((r) => r.date === "2026-09-28");
      expect(row).toMatchObject({ shiftTypeId: "t_day", label: "6-230", note: "Lacey" });
    });

    it("does not turn an asterisk-only day into a shift, or count it as one", () => {
      const res = parseScheduleXlsx(sheet(onCall), "Kaylene", TYPES);
      expect(res.rows.map((r) => r.date)).toEqual(["2026-09-28", "2026-10-01"]);
      expect(res.countedDays).toBe(res.rows.length);
    });

    it("reports no on-call days when there are no asterisks", () => {
      const res = parseScheduleXlsx(sheet(rows), "Kaylene", TYPES);
      expect(res.onCallDates).toEqual([]);
    });
  });

  it("names who it did find when the person isn't in the sheet", () => {
    const res = parseScheduleXlsx(sheet(rows), "Daisy", TYPES);
    expect(res.error).toMatch(/Daisy/);
    expect(res.peopleFound).toContain("Kaylene");
  });
});

/** The unit's roster as it is really laid out: dates written as text under a
 *  title, people grouped under shift headings, a bare "3" meaning the usual
 *  3p start, "V" for vacation. */
describe("parseScheduleXlsx on the roster layout", () => {
  const roster = [
    ["Staff Schedule — October 25 to November 21, 2026", null, null, null, null],
    ["Day", "S", "M", "T", "W"],
    ["Date", "10/25", "10/26", "10/27", "10/28"],
    ["DAY SHIFT", "", "", "", ""],
    ["Lana (SP)", "", "7a-4p\r\n1.5 V", "7a-530p", "7a-530p"],
    ["Angela (T)", "7", "", "7", "V"],
    ["EVENING SHIFT", "", "", "", ""],
    ["Brayden", "", "1-11:30p", "1-11:30p", "1-11:30p"],
    ["Gage", "3", "/", "3", "V"],
    ["MIDNIGHT", "", "", "", ""],
    ["Jarrod", "11", "", "11 CT", "V"],
  ];
  const TYPES = [{ id: "late", name: "3p-1130p", start: "15:00", end: "23:30" }];

  it("reads dates written as text, taking the year from the title", () => {
    const res = parseScheduleXlsx(sheet(roster), "Gage", TYPES);
    expect(res.error).toBeUndefined();
    expect(res.dateFrom).toBe("2026-10-25");
    expect(res.dateTo).toBe("2026-10-28");
  });

  it("reads a bare number under EVENING as an afternoon start with no end", () => {
    const res = parseScheduleXlsx(sheet(roster), "Gage", TYPES);
    expect(res.rows.map((r) => [r.date, r.start, r.end])).toEqual([
      ["2026-10-25", "15:00", undefined],
      ["2026-10-27", "15:00", undefined],
    ]);
  });

  it("reads a bare number by its section: morning under DAY, late night under MIDNIGHT", () => {
    expect(parseScheduleXlsx(sheet(roster), "Angela", TYPES).rows[0]).toMatchObject({ start: "07:00" });
    expect(parseScheduleXlsx(sheet(roster), "Jarrod", TYPES).rows[0]).toMatchObject({ start: "23:00" });
  });

  it("puts a range's unmarked start in the afternoon under EVENING", () => {
    const res = parseScheduleXlsx(sheet(roster), "Brayden", TYPES);
    expect(res.rows[0]).toMatchObject({ start: "13:00", end: "23:30" });
  });

  it("treats V as a day off and keeps the rest of the cell as a note", () => {
    const res = parseScheduleXlsx(sheet(roster), "Jarrod", TYPES);
    expect(res.rows.map((r) => r.date)).toEqual(["2026-10-25", "2026-10-27"]);
    expect(res.rows[1].note).toBe("CT");
  });

  it("does not list the Day and Date label rows as people", () => {
    const res = parseScheduleXlsx(sheet(roster), "Nobody", TYPES);
    expect(res.peopleFound).toEqual(["Lana (SP)", "Angela (T)", "Brayden", "Gage", "Jarrod"]);
  });

  it("rolls the year over when the dates cross New Year", () => {
    const res = parseScheduleXlsx(sheet([
      ["Staff Schedule — December 28 to January 3, 2027", null, null, null],
      ["Date", "12/28", "12/29", "1/3"],
      ["EVENING SHIFT", "", "", ""],
      ["Gage", "3", "3", "3"],
    ]), "Gage", TYPES);
    expect(res.dateFrom).toBe("2026-12-28");
    expect(res.dateTo).toBe("2027-01-03");
  });
});

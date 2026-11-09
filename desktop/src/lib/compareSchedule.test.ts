import { describe, expect, it } from "vitest";
import { compareSchedule } from "./compareSchedule";
import type { ShiftMap } from "../data";

const TYPES = [
  { id: "day", name: "6a-230p", start: "06:00", end: "14:30" },
  { id: "late", name: "3p-1130p", start: "15:00", end: "23:30" },
];
const row = (date: string, label: string, note?: string) => ({ date, shiftTypeId: null, label, confidence: 1, ...(note ? { note } : {}) });
const shift = (id: string, who: "G" | "K" | "D" = "G") => ({ who, label: id, shiftTypeId: id });

const base = { from: "2026-10-24", to: "2026-10-28", who: "G" as const, shiftTypes: TYPES };

describe("compareSchedule", () => {
  it("counts a day as a match when the hours agree, whatever the shift type is called", () => {
    const shifts: ShiftMap = { "2026-10-24": [shift("day")] };
    const res = compareSchedule({ ...base, rows: [row("2026-10-24", "6-230")], shifts });
    expect(res.matches).toBe(1);
    expect(res.diffs).toEqual([]);
  });

  it("finds a shift the app has and the sheet doesn't (the day the sheet says is off)", () => {
    const shifts: ShiftMap = { "2026-10-25": [shift("late")] };
    const res = compareSchedule({ ...base, rows: [row("2026-10-24", "6-230")], shifts });
    expect(res.diffs).toMatchObject([
      { date: "2026-10-24", kind: "sheet-only" },
      { date: "2026-10-25", kind: "app-only", app: [{ start: "15:00" }] },
    ]);
  });

  it("finds the same day with different hours", () => {
    const shifts: ShiftMap = { "2026-10-26": [shift("late")] };
    const res = compareSchedule({ ...base, rows: [row("2026-10-26", "6-230")], shifts });
    expect(res.diffs).toMatchObject([{ date: "2026-10-26", kind: "different", sheet: { start: "06:00", end: "14:30" } }]);
  });

  it("matches when any one of several app shifts that day has the sheet's hours", () => {
    const shifts: ShiftMap = { "2026-10-26": [shift("late"), shift("day")] };
    const res = compareSchedule({ ...base, rows: [row("2026-10-26", "6-230")], shifts });
    expect(res.matches).toBe(1);
  });

  it("takes a sheet cell it can't read as agreeing when the app has a shift that day", () => {
    const shifts: ShiftMap = { "2026-10-26": [shift("late")] };
    const res = compareSchedule({ ...base, rows: [row("2026-10-26", "V")], shifts });
    expect(res.diffs).toEqual([]);
    expect(res.matches).toBe(1);
  });

  it("ignores other people's shifts and days outside the sheet", () => {
    const shifts: ShiftMap = {
      "2026-10-25": [shift("late", "K")],
      "2026-11-02": [shift("late")],
    };
    const res = compareSchedule({ ...base, rows: [], shifts });
    expect(res.diffs).toEqual([]);
  });

  it("locks a row whose app side comes from a weekly template", () => {
    const shifts: ShiftMap = { "2026-10-25": [shift("late")] };
    const res = compareSchedule({ ...base, rows: [], shifts, canRemove: () => false });
    expect(res.diffs[0].locked).toMatch(/template/i);
  });

  it("compares Kaylene's on-call days both ways", () => {
    const res = compareSchedule({
      ...base, who: "K", rows: [], shifts: {},
      onCallDates: ["2026-10-24", "2026-10-26"],
      appOnCall: ["2026-10-26", "2026-10-27", "2026-12-01"],
    });
    expect(res.onCall).toEqual([
      { date: "2026-10-24", kind: "sheet-only" },
      { date: "2026-10-27", kind: "app-only" },
    ]);
  });

  it("compares a sheet that only names the start on the start alone", () => {
    const shifts: ShiftMap = { "2026-10-25": [shift("late")] };
    const rows = [{ date: "2026-10-25", shiftTypeId: null, label: "3", confidence: 1, start: "15:00" }];
    const res = compareSchedule({ ...base, rows, shifts });
    expect(res.matches).toBe(1);
    expect(res.diffs).toEqual([]);
  });

  it("fills in the end from the shift type that starts then, to apply it", () => {
    const rows = [{ date: "2026-10-25", shiftTypeId: null, label: "3", confidence: 1, start: "15:00" }];
    const res = compareSchedule({ ...base, rows, shifts: {} });
    expect(res.diffs[0].sheet).toMatchObject({ start: "15:00", end: "23:30", endInferred: true });
  });

  it("leaves the end unknown when no shift type, or several ends, start then", () => {
    const rows = [{ date: "2026-10-25", shiftTypeId: null, label: "7", confidence: 1, start: "07:00" }];
    const res = compareSchedule({ ...base, rows, shifts: {} });
    expect(res.diffs[0].sheet?.end).toBeUndefined();
  });

  it("reports the last day the sheet has a shift, even when that day already matches", () => {
    // Only the 24th differs, but the sheet runs to the 28th: the period ends there.
    const shifts: ShiftMap = { "2026-10-28": [shift("day")] };
    const res = compareSchedule({ ...base, rows: [row("2026-10-24", "6-230"), row("2026-10-28", "6-230")], shifts });
    expect(res.diffs.map((d) => d.date)).toEqual(["2026-10-24"]);
    expect(res.lastShiftDate).toBe("2026-10-28");
  });

  it("has no last shift day for a sheet with no shifts", () => {
    const res = compareSchedule({ ...base, rows: [], shifts: {} });
    expect(res.lastShiftDate).toBeUndefined();
  });
});

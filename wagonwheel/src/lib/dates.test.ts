import { describe, expect, it } from "vitest";
import { addDays, addMonths, diffDays, formatLong, formatRange, formatShort, monthGrid, relativeDay, todayIso, weekday } from "./dates";

describe("dates", () => {
  it("reads today from the local clock", () => {
    expect(todayIso(new Date(2026, 10, 9, 23, 59))).toBe("2026-11-09");
    expect(todayIso(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });

  it("adds days across month, year and leap-day edges", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(diffDays("2026-11-12", "2026-11-09")).toBe(3);
  });

  it("clamps a month step to the shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -2)).toBe("2025-11-15");
  });

  it("knows the weekday", () => {
    expect(weekday("2026-11-09")).toBe(1);   // Monday
    expect(weekday("2026-11-08")).toBe(0);   // Sunday
  });

  it("lays a month on six Sunday-first weeks, as the sidebar draws it", () => {
    const g = monthGrid(2026, 10);   // November 2026
    expect(g).toHaveLength(42);
    expect(g[0]).toMatchObject({ iso: "2026-11-01", day: 1, inMonth: true });   // Nov 1 2026 is a Sunday
    expect(g[29]).toMatchObject({ iso: "2026-11-30", inMonth: true });
    expect(g[30]).toMatchObject({ iso: "2026-12-01", inMonth: false });
    expect(g[41].iso).toBe("2026-12-12");
    const feb = monthGrid(2026, 1);
    expect(feb[0].iso).toBe("2026-02-01");   // Sunday
    expect(monthGrid(2026, 2)[0].iso).toBe("2026-03-01");
    expect(monthGrid(2026, 4)[0]).toMatchObject({ iso: "2026-04-26", inMonth: false });   // May 1 2026 is a Friday
  });

  it("words dates for people", () => {
    expect(formatLong("2026-11-09")).toBe("Monday, November 9");
    expect(formatShort("2026-11-09", "2026-11-01")).toBe("Nov 9");
    expect(formatShort("2027-01-02", "2026-11-01")).toBe("Jan 2, 2027");
    expect(relativeDay("2026-11-09", "2026-11-09")).toBe("Today");
    expect(relativeDay("2026-11-10", "2026-11-09")).toBe("Tomorrow");
    expect(relativeDay("2026-11-08", "2026-11-09")).toBe("Yesterday");
    expect(relativeDay("2026-11-12", "2026-11-09")).toBe("in 3 days");
    expect(relativeDay("2026-11-02", "2026-11-09")).toBe("7 days ago");
    expect(formatRange("2026-11-01", "2026-12-31", "2026-11-09")).toBe("Nov 1 – Dec 31");
    expect(formatRange(null, "2026-12-31", "2026-11-09")).toBe("→ Dec 31");
    expect(formatRange(null, null, "2026-11-09")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { federalHolidays, holidayOn } from "../../../shared/holidays";

describe("federal holidays", () => {
  it("lands every 2026 holiday on the right date", () => {
    expect(federalHolidays(2026).map((h) => h.date)).toEqual([
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-04",
      "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
    ]);
  });

  it("moves the weekday holidays with the year", () => {
    const d = (name: string) => federalHolidays(2027).find((h) => h.name === name)!.date;
    expect(d("Thanksgiving")).toBe("2027-11-25");
    expect(d("Memorial Day")).toBe("2027-05-31");
    expect(d("Labor Day")).toBe("2027-09-06");
  });

  it("looks up a date", () => {
    expect(holidayOn("2026-11-26")?.name).toBe("Thanksgiving");
    expect(holidayOn("2026-11-27")).toBeUndefined();
  });
});

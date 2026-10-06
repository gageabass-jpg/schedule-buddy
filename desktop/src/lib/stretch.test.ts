import { describe, expect, it } from "vitest";
import { stretchesFor } from "./stretch";
import type { ShiftMap } from "../data";

const K = { who: "K" as const, label: "Night" };
const G = { who: "G" as const, label: "Day" };

describe("stretchesFor", () => {
  it("numbers each day of a run and skips lone days", () => {
    const shifts: ShiftMap = {
      "2026-09-01": [K],
      "2026-09-03": [K], "2026-09-04": [K, G], "2026-09-05": [K],
      "2026-09-06": [G],
    };
    const s = stretchesFor(shifts, "K");
    expect(s.has("2026-09-01")).toBe(false);
    expect(s.get("2026-09-03")).toEqual({ day: 1, of: 3 });
    expect(s.get("2026-09-04")).toEqual({ day: 2, of: 3 });
    expect(s.get("2026-09-05")).toEqual({ day: 3, of: 3 });
    expect(s.has("2026-09-06")).toBe(false);
  });

  it("runs across a month end", () => {
    const shifts: ShiftMap = { "2026-09-30": [K], "2026-10-01": [K] };
    expect(stretchesFor(shifts, "K").get("2026-10-01")).toEqual({ day: 2, of: 2 });
  });

  it("only counts the person asked about", () => {
    const shifts: ShiftMap = { "2026-09-01": [G], "2026-09-02": [G] };
    expect(stretchesFor(shifts, "K").size).toBe(0);
  });
});

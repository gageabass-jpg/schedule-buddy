import { describe, expect, it } from "vitest";
import { dayKindFromShifts } from "../data";

const G = { who: "G" as const, label: "Day" };
const K = { who: "K" as const, label: "Night" };
const D = { who: "D" as const, label: "Class" };

describe("dayKindFromShifts", () => {
  it("counts a day only Daisy has something on as both parents off", () => {
    expect(dayKindFromShifts([D])).toBe("off");
  });
  it("still sees who works when Daisy also has class", () => {
    expect(dayKindFromShifts([K, D])).toBe("k");
    expect(dayKindFromShifts([G, D])).toBe("g");
    expect(dayKindFromShifts([G, K, D])).toBe("both");
  });
  it("treats an empty day as off", () => {
    expect(dayKindFromShifts([])).toBe("off");
    expect(dayKindFromShifts(undefined)).toBe("off");
  });
});

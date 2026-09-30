import { describe, expect, it } from "vitest";
import { coverageAnswered, coverageAnswerText, shiftKeysOf } from "./changeNotices";
import type { HouseholdState } from "../state";

const statuses = (o: Record<string, string>) => new Map(Object.entries(o));

describe("coverage answers", () => {
  it("counts only what changed in this snapshot", () => {
    const before = statuses({ a: "confirmed", b: "confirmed", c: "pending" });
    const after = statuses({ a: "confirmed", b: "confirmed", c: "declined" });
    // Two requests already confirmed earlier this month don't make this an approval.
    expect(coverageAnswered(before, after)).toEqual({ confirmed: 0, declined: 1 });
    expect(coverageAnswerText("Daisy", 0, 1)).toBe("Daisy declined a coverage request.");
  });

  it("ignores requests that didn't move, or moved to anything but an answer", () => {
    const before = statuses({ a: "pending", b: "pending" });
    const after = statuses({ a: "pending", b: "issue", c: "pending" });
    expect(coverageAnswered(before, after)).toEqual({ confirmed: 0, declined: 0 });
    expect(coverageAnswerText("Daisy", 0, 0)).toBeNull();
  });

  it("counts a brand-new request that arrives already answered", () => {
    expect(coverageAnswered(statuses({}), statuses({ a: "confirmed" }))).toEqual({ confirmed: 1, declined: 0 });
  });

  it("says what happened, specifically", () => {
    expect(coverageAnswerText("Daisy", 1, 0)).toBe("Daisy confirmed a coverage request.");
    expect(coverageAnswerText("Daisy", 3, 0)).toBe("Daisy confirmed 3 coverage requests.");
    expect(coverageAnswerText("Daisy", 0, 1)).toBe("Daisy declined a coverage request.");
    expect(coverageAnswerText("Daisy", 0, 2)).toBe("Daisy declined 2 coverage requests.");
    expect(coverageAnswerText("Daisy", 2, 1)).toBe("Daisy confirmed 2 and declined 1 coverage request.");
    expect(coverageAnswerText("Marta", 1, 2)).toBe("Marta confirmed 1 and declined 2 coverage requests.");
  });

  it("never talks about the month", () => {
    for (const [c, d] of [[1, 0], [4, 0], [0, 3], [2, 2]]) {
      expect(coverageAnswerText("Daisy", c, d)).not.toMatch(/month|\//);
    }
  });
});

describe("shift keys", () => {
  const state = (ot: Array<{ date: string; shiftTypeId: string; coworkers?: string }>) =>
    ({ ot, overrides: [], partner: { name: "K", shifts: [] } }) as unknown as HouseholdState;

  it("tell apart two same-type shifts on one date", () => {
    const one = shiftKeysOf(state([{ date: "2026-10-02", shiftTypeId: "n" }]));
    const two = shiftKeysOf(state([{ date: "2026-10-02", shiftTypeId: "n" }, { date: "2026-10-02", shiftTypeId: "n", coworkers: "Sam" }]));
    expect(two.size).toBe(2);
    const added = [...two].filter((k) => !one.has(k));
    expect(added).toHaveLength(1);
    const removed = [...one].filter((k) => !two.has(k));
    expect(removed).toHaveLength(0);
  });

  it("are the same for the same schedule, so a redraw announces nothing", () => {
    const s = state([{ date: "2026-10-02", shiftTypeId: "n" }, { date: "2026-10-02", shiftTypeId: "n" }]);
    expect([...shiftKeysOf(s)]).toEqual([...shiftKeysOf(structuredClone(s))]);
  });

  it("don't change when only a note changes", () => {
    const a = shiftKeysOf(state([{ date: "2026-10-02", shiftTypeId: "n", coworkers: "Sam" }]));
    const b = shiftKeysOf(state([{ date: "2026-10-02", shiftTypeId: "n", coworkers: "Pat" }]));
    expect([...a]).toEqual([...b]);
  });
});

import { describe, expect, it } from "vitest";
import {
  computeOverlapCandidates, hmToMin, parentDaySegments,
  TIMELINE_START_MIN, TIMELINE_END_MIN,
} from "./computeOverlap";
import type { HouseholdState } from "../state";
import type { ShiftMap } from "../data";

/**
 * The coverage engine decides when nobody is home for the kids, and it is the
 * one piece of logic here that is wrong quietly rather than loudly — a missed
 * window just doesn't appear. These cases pin the behaviour the Childcare tab
 * draws: where a shift sits on the day axis, the rest it protects either side
 * of a night, and whether two people being out at once is flagged.
 */

const DAY = { id: "day", name: "Day (12hr)", start: "07:00", end: "19:30" };
const NIGHT = {
  id: "night", name: "Night (12hr)", start: "19:00", end: "07:30",
  crossesMidnight: true, sleepHours: 8, preSleepHours: 4,
};

function stateWith(): HouseholdState {
  return {
    shiftTypes: [DAY, NIGHT],
    template: [],
    overrides: [],
    ot: [],
    partner: { name: "Kaylene", shifts: [] },
    _migrations: [],
  } as unknown as HouseholdState;
}

const shifts = (map: Record<string, Array<{ who: "G" | "K" | "D"; shiftTypeId: string }>>): ShiftMap =>
  Object.fromEntries(
    Object.entries(map).map(([d, list]) => [d, list.map((s) => ({ ...s, label: s.shiftTypeId }))]),
  ) as unknown as ShiftMap;

describe("hmToMin", () => {
  it("reads a clock time as minutes from the day's start", () => {
    expect(hmToMin("00:00")).toBe(0);
    expect(hmToMin("07:30")).toBe(450);
  });

  it("pushes a next-day time past the 24h mark so ranges stay ordered", () => {
    expect(hmToMin("07:30", true)).toBe(450 + 1440);
    expect(hmToMin("07:30", true)).toBeGreaterThan(hmToMin("23:00"));
  });
});

describe("parentDaySegments", () => {
  it("puts a day shift's work where it falls on the axis", () => {
    const st = stateWith();
    const map = shifts({ "2026-09-28": [{ who: "K", shiftTypeId: "day" }] });
    const { work } = parentDaySegments("2026-09-28", "K", map, st);
    expect(work).toHaveLength(1);
    expect(work[0].startMin).toBe(hmToMin("07:00"));
    expect(work[0].endMin).toBe(hmToMin("19:30"));
  });

  it("protects rest before a night shift", () => {
    const st = stateWith();
    const map = shifts({ "2026-09-28": [{ who: "K", shiftTypeId: "night" }] });
    const { sleep } = parentDaySegments("2026-09-28", "K", map, st);
    expect(sleep.length).toBeGreaterThan(0);
    // The pre-shift block has to end before she leaves, not when work starts.
    expect(Math.max(...sleep.map((s) => s.endMin))).toBeLessThan(hmToMin("19:00"));
  });

  it("protects rest on the morning after a night shift", () => {
    const st = stateWith();
    const map = shifts({ "2026-09-27": [{ who: "K", shiftTypeId: "night" }] });
    const { sleep } = parentDaySegments("2026-09-28", "K", map, st);
    expect(sleep.length).toBeGreaterThan(0);
    // It lands in the morning of the following day, after she gets home.
    expect(Math.min(...sleep.map((s) => s.startMin))).toBeGreaterThanOrEqual(hmToMin("07:30"));
  });

  it("clamps everything to the waking axis it is drawn on", () => {
    const st = stateWith();
    const map = shifts({ "2026-09-28": [{ who: "K", shiftTypeId: "night" }] });
    const { work, sleep } = parentDaySegments("2026-09-28", "K", map, st);
    for (const r of [...work, ...sleep]) {
      expect(r.startMin).toBeGreaterThanOrEqual(TIMELINE_START_MIN);
      expect(r.endMin).toBeLessThanOrEqual(TIMELINE_END_MIN);
    }
  });

  it("returns nothing on a day the person doesn't work", () => {
    const st = stateWith();
    const { work, sleep } = parentDaySegments("2026-09-28", "K", shifts({}), st);
    expect(work).toHaveLength(0);
    expect(sleep).toHaveLength(0);
  });
});

describe("computeOverlapCandidates", () => {
  it("flags a day both parents are out at once", () => {
    const st = stateWith();
    const map = shifts({
      "2026-09-28": [{ who: "G", shiftTypeId: "day" }, { who: "K", shiftTypeId: "day" }],
    });
    const found = computeOverlapCandidates(map, st).filter((c) => c.date === "2026-09-28");
    expect(found.length).toBeGreaterThan(0);
  });

  it("says nothing when only one parent is working", () => {
    const st = stateWith();
    const map = shifts({ "2026-09-28": [{ who: "G", shiftTypeId: "day" }] });
    expect(computeOverlapCandidates(map, st).filter((c) => c.date === "2026-09-28")).toHaveLength(0);
  });

  it("says nothing on an empty day", () => {
    expect(computeOverlapCandidates(shifts({}), stateWith())).toHaveLength(0);
  });

  it("gives every window a start before its end once midnight is accounted for", () => {
    const st = stateWith();
    const map = shifts({
      "2026-09-28": [{ who: "G", shiftTypeId: "night" }, { who: "K", shiftTypeId: "day" }],
    });
    for (const c of computeOverlapCandidates(map, st)) {
      expect(hmToMin(c.endTime, c.endsNextDay)).toBeGreaterThan(hmToMin(c.startTime));
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_PX_PER_DAY, MIN_PX_PER_DAY, clampPpd, dayAtViewportX, dayIndex, eventBlocks,
  fitPpd, isoFromDayIndex, lodFor, monthSpans, packRows, personBlocks, scrollLeftFor,
  timelineData, weekdayOf, zoomedScrollLeft, type TlBlock,
} from "./timelineAxis";
import type { HouseholdState } from "../state";
import type { ShiftMap } from "../data";

/**
 * The timeline is one continuous axis. These cases pin the parts that fail
 * quietly: a zoom that drifts off the time under the cursor, a night shift
 * that gets cut at midnight, and day math that slips an hour across DST.
 */

const NIGHT = {
  id: "night", name: "Night (12hr)", start: "19:00", end: "07:30",
  crossesMidnight: true, sleepHours: 8,
};

const state = {
  shiftTypes: [NIGHT],
  template: [], overrides: [], ot: [],
  _migrations: [],
} as unknown as HouseholdState;

const block = (id: string, startMin: number, endMin: number): TlBlock =>
  ({ id, kind: "event", startMin, endMin, label: id, date: "2026-10-05" });

describe("day index", () => {
  it("round-trips an ISO date", () => {
    expect(isoFromDayIndex(dayIndex("2026-10-05"))).toBe("2026-10-05");
  });

  it("steps one day across a DST change", () => {
    // US clocks fall back on 2026-11-01.
    expect(dayIndex("2026-11-02") - dayIndex("2026-10-31")).toBe(2);
    expect(isoFromDayIndex(dayIndex("2026-11-01") + 1)).toBe("2026-11-02");
  });

  it("knows the weekday", () => {
    expect(weekdayOf(dayIndex("2026-10-05"))).toBe(1);   // Monday
    expect(weekdayOf(dayIndex("2026-10-04"))).toBe(0);   // Sunday
  });
});

describe("zoom", () => {
  it("keeps the time under the cursor fixed", () => {
    const gutter = 100, vx = 400, oldPpd = 100, newPpd = 700, scrollLeft = 5000;
    const before = dayAtViewportX(scrollLeft, vx, gutter, oldPpd);
    const next = zoomedScrollLeft(scrollLeft, vx, gutter, oldPpd, newPpd);
    expect(dayAtViewportX(next, vx, gutter, newPpd)).toBeCloseTo(before, 9);
  });

  it("centres a day with scrollLeftFor", () => {
    const sl = scrollLeftFor(12.5, 500, 100, 200);
    expect(dayAtViewportX(sl, 500, 100, 200)).toBeCloseTo(12.5, 9);
  });

  it("clamps to the limits", () => {
    expect(clampPpd(1)).toBe(MIN_PX_PER_DAY);
    expect(clampPpd(1e9)).toBe(MAX_PX_PER_DAY);
  });

  it("fits a span to the track", () => {
    expect(fitPpd(7, 1400)).toBe(200);
    expect(fitPpd(60, 600)).toBe(MIN_PX_PER_DAY);   // 10 px/day is below the floor
  });
});

describe("level of detail", () => {
  it("labels hours when a day is wide, days when a month is", () => {
    expect(lodFor(1200).hourStep).toBe(1);
    expect(lodFor(500).hourStep).toBe(3);
    expect(lodFor(40).hourStep).toBe(0);
    expect(lodFor(1200).topIsDays).toBe(true);
    expect(lodFor(40).topIsDays).toBe(false);
  });
});

describe("personBlocks", () => {
  it("keeps a night shift as one block across midnight", () => {
    const shifts: ShiftMap = {
      "2026-10-05": [{ who: "G", label: "7p", shiftTypeId: "night" }],
    } as unknown as ShiftMap;
    const idx = dayIndex("2026-10-05");
    const work = personBlocks(state, shifts, "G", idx, idx + 1).filter((b) => b.kind === "work");
    expect(work).toHaveLength(1);
    expect(work[0].startMin).toBe(idx * 1440 + 19 * 60);
    expect(work[0].endMin).toBe((idx + 1) * 1440 + 7 * 60 + 30);
  });

  it("adds the rest after the shift, and none for Daisy", () => {
    const shifts: ShiftMap = {
      "2026-10-05": [{ who: "G", label: "7p", shiftTypeId: "night" }],
    } as unknown as ShiftMap;
    const idx = dayIndex("2026-10-05");
    const rest = personBlocks(state, shifts, "G", idx, idx).filter((b) => b.kind === "rest");
    expect(rest.length).toBeGreaterThan(0);
    expect(rest[0].startMin).toBeGreaterThan((idx + 1) * 1440);
    expect(personBlocks(state, shifts, "D", idx, idx)).toHaveLength(0);
  });

  it("skips another person's shifts", () => {
    const shifts: ShiftMap = {
      "2026-10-05": [{ who: "K", label: "7p", shiftTypeId: "night" }],
    } as unknown as ShiftMap;
    const idx = dayIndex("2026-10-05");
    expect(personBlocks(state, shifts, "G", idx, idx)).toHaveLength(0);
  });
});

describe("eventBlocks", () => {
  const idx = dayIndex("2026-10-05");
  const ev = (over: object) =>
    ({ id: "x", date: "2026-10-05", title: "Dentist", who: "G", ...over }) as never;

  it("fills the day for an untimed event", () => {
    const [b] = eventBlocks([ev({})], idx, idx);
    expect(b.allDay).toBe(true);
    expect(b.endMin - b.startMin).toBe(1440);
  });

  it("defaults a missing end to one hour", () => {
    const [b] = eventBlocks([ev({ startTime: "14:00" })], idx, idx);
    expect(b.endMin - b.startMin).toBe(60);
  });

  it("ends the next day when the end is before the start", () => {
    const [b] = eventBlocks([ev({ startTime: "22:00", endTime: "02:00" })], idx, idx);
    expect(b.endMin - b.startMin).toBe(240);
  });

  it("drops events outside the window", () => {
    expect(eventBlocks([ev({ date: "2027-01-01" })], idx, idx + 7)).toHaveLength(0);
  });
});

describe("packRows", () => {
  it("stacks overlapping blocks and reuses a free row", () => {
    const a = block("a", 0, 100), b = block("b", 50, 150), c = block("c", 120, 200);
    const { rows, count } = packRows([a, b, c]);
    expect(count).toBe(2);
    expect(rows.get("a")).toBe(0);
    expect(rows.get("b")).toBe(1);
    expect(rows.get("c")).toBe(0);
  });

  it("uses one row when nothing overlaps", () => {
    expect(packRows([block("a", 0, 10), block("b", 20, 30)]).count).toBe(1);
  });

  it("separates blocks closer than the gap", () => {
    expect(packRows([block("a", 0, 100), block("b", 110, 200)], 30).count).toBe(2);
  });
});

describe("monthSpans", () => {
  it("splits a window at month boundaries and clips the ends", () => {
    const spans = monthSpans(dayIndex("2026-10-28"), dayIndex("2026-11-03"));
    expect(spans.map((s) => s.days)).toEqual([4, 3]);
    expect(spans[0].label).toBe("October 2026");
    expect(spans[1].startIdx).toBe(dayIndex("2026-11-01"));
  });
});

describe("timelineData — Daisy's lane", () => {
  const SCHOOL = { id: "school", name: "School", start: "08:00", end: "15:00", crossesMidnight: false };
  const withDaisy = (extra: object) => ({
    ...state,
    shiftTypes: [NIGHT, SCHOOL],
    partner: { name: "Kaylene", shifts: [] },
    dependents: { daisy: { name: "Daisy", shifts: [] } },
    ...extra,
  }) as unknown as HouseholdState;
  const idx = dayIndex("2026-10-06");   // a Tuesday

  it("draws one block for a school day that is also a D shift", () => {
    // A typed template slot makes buildShiftMap emit a "D" shift AND
    // daisyDayRanges report the same hours.
    const st = withDaisy({ weeklyTemplates: { daisy: { days: [null, null, "school", null, null, null, null] } } });
    const d = timelineData(st, [], idx, idx);
    expect(Object.values(d.shifts).flat().some((s) => s.who === "D")).toBe(true);
    expect(d.D).toHaveLength(1);
    expect(d.D![0].kind).toBe("school");
  });

  it("draws one block for a dated school entry", () => {
    const st = withDaisy({ dependents: { daisy: { name: "Daisy", shifts: [{ date: "2026-10-06", shiftTypeId: "school", label: "School" }] } } });
    expect(timelineData(st, [], idx, idx).D).toHaveLength(1);
  });

  it("still draws a custom start/end slot, which is never a D shift", () => {
    const st = withDaisy({ weeklyTemplates: { daisy: { days: [null, null, { start: "09:00", end: "14:00" }, null, null, null, null] } } });
    const d = timelineData(st, [], idx, idx);
    expect(d.D).toHaveLength(1);
    expect(d.D![0].endMin - d.D![0].startMin).toBe(300);
  });

  it("has no Daisy lane without a dependent", () => {
    expect(timelineData(state, [], idx, idx).D).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { lastDayOf, lastScheduledDay, scheduleEndColor, scheduleEndOf, scheduleEndsByDate, withScheduleEnd } from "./scheduleEnds";

const rec = (scheduleId: string, addedDates: string[], lastShiftDate?: string) => ({
  id: `imp_${scheduleId}_${addedDates[0] ?? "none"}`,
  scheduleId,
  importedAt: 0,
  addedDates,
  noteCount: addedDates.length,
  ...(lastShiftDate ? { lastShiftDate } : {}),
});

describe("lastDayOf", () => {
  it("prefers the day the upload recorded over the days it changed", () => {
    // A comparison only writes the days that differed, so the sheet's real last
    // day (the 29th) can be later than anything it changed (the 24th).
    expect(lastDayOf(rec("gage-nights", ["2026-11-02", "2026-11-24"], "2026-11-29"))).toBe("2026-11-29");
  });

  it("falls back to the last day an older record changed", () => {
    expect(lastDayOf(rec("gage-nights", ["2026-11-24", "2026-11-02", "2026-11-17"]))).toBe("2026-11-24");
  });

  it("has nothing for a record with no usable dates", () => {
    expect(lastDayOf(rec("gage-nights", []))).toBeNull();
    expect(lastDayOf({ addedDates: ["soon", "11/29"] })).toBeNull();
    expect(lastDayOf({})).toBeNull();
  });
});

describe("scheduleEndsByDate", () => {
  it("puts Gage's and Kaylene's uploads on their own last days", () => {
    const ends = scheduleEndsByDate([
      rec("gage-nights", ["2026-11-02"], "2026-11-29"),
      rec("kaylene-nights", ["2026-11-03"], "2026-11-28"),
    ]);
    expect(ends.get("2026-11-29")).toEqual(["G"]);
    expect(ends.get("2026-11-28")).toEqual(["K"]);
    expect(ends.size).toBe(2);
  });

  it("shows both people on a day their schedules end together, once each", () => {
    const ends = scheduleEndsByDate([
      rec("kaylene-nights", ["2026-11-03"], "2026-11-29"),
      rec("gage-nights", ["2026-11-02"], "2026-11-29"),
      rec("gage-nights", ["2026-11-09"], "2026-11-29"),   // the same sheet uploaded again
    ]);
    expect(ends.get("2026-11-29")).toEqual(["G", "K"]);
  });

  it("marks every upload's end, so a run of four-week schedules leaves a flag at each", () => {
    const ends = scheduleEndsByDate([
      rec("gage-nights", [], "2026-11-29"),
      rec("gage-nights", [], "2026-12-27"),
    ]);
    expect([...ends.keys()].sort()).toEqual(["2026-11-29", "2026-12-27"]);
  });

  it("skips Daisy's schedule, unknown schedules, and records it can't place", () => {
    const ends = scheduleEndsByDate([
      rec("daisy-school", ["2026-11-20"], "2026-11-20"),
      rec("some-other-slot", ["2026-11-21"], "2026-11-21"),
      // A phone request for Daisy, still pending.
      { id: "imp_d", person: "Daisy", status: "pending", days: [{ date: "2026-11-22" }] },
      // A person but no status and no schedule id: nothing says whose it settled as.
      { id: "imp_x", person: "K", days: [{ date: "2026-11-23" }] },
      null,
    ]);
    expect(ends.size).toBe(0);
  });

  it("flags the phone's uploads: Gage's own, and Kaylene's once approved, are kept in the Mac's shape", () => {
    const ends = scheduleEndsByDate([
      rec("gage-nights", ["2026-11-02", "2026-11-27"], "2026-11-27"),   // Gage's phone upload, in directly
      rec("kaylene-nights", ["2026-11-03", "2026-11-26"], "2026-11-26"), // Kaylene's, after Gage approved it
    ]);
    expect(ends.get("2026-11-27")).toEqual(["G"]);
    expect(ends.get("2026-11-26")).toEqual(["K"]);
  });

  it("flags a phone upload of Kaylene's that is still waiting for approval, at its last listed day", () => {
    const ends = scheduleEndsByDate([
      { id: "imp_k", person: "K", status: "pending", days: [{ date: "2026-12-14" }, { date: "2026-12-27" }, { date: "2026-12-01" }] },
    ]);
    expect(ends.get("2026-12-27")).toEqual(["K"]);
    expect(ends.size).toBe(1);
  });

  it("prefers a pending request's recorded last day over scanning its list", () => {
    const ends = scheduleEndsByDate([
      { id: "imp_k", person: "K", status: "pending", lastShiftDate: "2026-12-26", days: [{ date: "2026-12-27" }] },
    ]);
    expect([...ends.keys()]).toEqual(["2026-12-26"]);
  });

  it("ignores a pending request with no days or odd dates", () => {
    expect(scheduleEndsByDate([{ id: "a", person: "K", status: "pending", days: [] }]).size).toBe(0);
    expect(scheduleEndsByDate([{ id: "b", person: "K", status: "pending", days: [{ date: "tomorrow" }, null, {}] }]).size).toBe(0);
  });

  it("is empty when there are no imports", () => {
    expect(scheduleEndsByDate(undefined).size).toBe(0);
    expect(scheduleEndsByDate([]).size).toBe(0);
  });
});

describe("lastScheduledDay", () => {
  const shiftTypes = [{ id: "day" }, { id: "night" }];

  it("is Gage's last dated work shift, from his overrides and his OT entries", () => {
    const state = {
      shiftTypes,
      overrides: [{ date: "2026-12-07", shiftTypeId: "day" }, { date: "2026-11-30", shiftTypeId: "night" }],
      ot: [{ date: "2026-12-21", shiftTypeId: "day" }],
    };
    expect(lastScheduledDay(state, "G")).toBe("2026-12-21");
    expect(lastScheduledDay({ ...state, ot: [] }, "G")).toBe("2026-12-07");
  });

  it("doesn't count a day off, a shift type that's gone, or a malformed date", () => {
    const state = {
      shiftTypes,
      overrides: [
        { date: "2026-12-30", shiftTypeId: null },          // an off day written over the template
        { date: "2027-01-05", shiftTypeId: "deleted" },     // its type is no longer in the catalog
        { date: "next week", shiftTypeId: "day" },
        { date: "2026-12-07", shiftTypeId: "day" },
      ],
      ot: [],
    };
    expect(lastScheduledDay(state, "G")).toBe("2026-12-07");
  });

  it("is Kaylene's last dated shift, and never Gage's entries", () => {
    const state = {
      shiftTypes,
      overrides: [{ date: "2026-12-30", shiftTypeId: "day" }],
      ot: [],
      partner: { shifts: [{ date: "2026-12-12", shiftTypeId: "night" }, { date: "2026-12-02", shiftTypeId: "day" }] },
    };
    expect(lastScheduledDay(state, "K")).toBe("2026-12-12");
    expect(lastScheduledDay(state, "G")).toBe("2026-12-30");
  });

  it("is null when there are no dated shifts (a recurring template alone has no last day)", () => {
    expect(lastScheduledDay({ shiftTypes, overrides: [], ot: [] }, "G")).toBeNull();
    expect(lastScheduledDay({}, "G")).toBeNull();
    expect(lastScheduledDay({}, "K")).toBeNull();
  });
});

describe("withScheduleEnd", () => {
  it("adds the person on the day when no upload record put them there", () => {
    const ends = scheduleEndsByDate([rec("kaylene-nights", [], "2026-11-19")]);
    const next = withScheduleEnd(ends, "2026-12-21", "G");
    expect(next.get("2026-12-21")).toEqual(["G"]);
    expect(next.get("2026-11-19")).toEqual(["K"]);
  });

  it("doesn't double up when an upload record already flagged that day", () => {
    const ends = scheduleEndsByDate([rec("gage-nights", [], "2026-12-21")]);
    expect(withScheduleEnd(ends, "2026-12-21", "G").get("2026-12-21")).toEqual(["G"]);
  });

  it("sits beside the other person's flag on a shared day, in a steady order", () => {
    const ends = scheduleEndsByDate([rec("kaylene-nights", [], "2026-12-21")]);
    expect(withScheduleEnd(ends, "2026-12-21", "G").get("2026-12-21")).toEqual(["G", "K"]);
  });

  it("changes nothing for no date, and never alters the map it was given", () => {
    const ends = scheduleEndsByDate([rec("gage-nights", [], "2026-11-29")]);
    expect([...withScheduleEnd(ends, null, "G")]).toEqual([...ends]);
    withScheduleEnd(ends, "2026-12-21", "G");
    expect(ends.has("2026-12-21")).toBe(false);
  });
});

describe("scheduleEndColor", () => {
  it("is green for Gage and purple for Kaylene, on both grounds", () => {
    expect(scheduleEndColor("G", true)).toBe("#4ADE80");
    expect(scheduleEndColor("G", false)).toBe("#15803D");
    expect(scheduleEndColor("K", true)).toBe("#C084FC");
    expect(scheduleEndColor("K", false)).toBe("#7E22CE");
  });
});

describe("scheduleEndOf", () => {
  const shiftTypes = [{ id: "day" }];

  it("is the later of the last dated shift and the last day an upload covers", () => {
    const state = {
      shiftTypes,
      overrides: [{ date: "2026-12-07", shiftTypeId: "day" }],
      imports: [rec("gage-nights", ["2026-12-01"], "2026-12-18")],
    };
    expect(scheduleEndOf(state, "G")).toBe("2026-12-18");
    expect(scheduleEndOf({ ...state, imports: [rec("gage-nights", ["2026-12-01"], "2026-12-02")] }, "G")).toBe("2026-12-07");
  });

  it("keeps each person's schedule to themselves", () => {
    const state = {
      shiftTypes,
      partner: { shifts: [{ date: "2026-12-11", shiftTypeId: "day" }] },
      imports: [rec("gage-nights", ["2026-12-01"], "2026-12-18")],
    };
    expect(scheduleEndOf(state, "K")).toBe("2026-12-11");
    expect(scheduleEndOf(state, "G")).toBe("2026-12-18");
  });

  it("is null for someone with nothing scheduled", () => {
    expect(scheduleEndOf({ shiftTypes }, "K")).toBeNull();
    expect(scheduleEndOf({ shiftTypes, imports: [null] }, "G")).toBeNull();
  });
});

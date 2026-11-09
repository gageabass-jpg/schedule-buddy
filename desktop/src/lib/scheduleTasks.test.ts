import { describe, expect, it } from "vitest";
import { periodOf, scheduleTasks, TASKS_LINGER_MS, visibleTasks, type ScheduleTasksInput } from "./scheduleTasks";

// 2026-10-24 is a Saturday, so periods run Oct 24 – Nov 20, Nov 21 – Dec 18, …
const REF = "2026-10-24";

const base: ScheduleTasksInput = {
  refSat: REF, today: "2026-11-16",
  gEnd: "2026-11-20", kEnd: "2026-11-20",
  hasPartner: true, childcare: true, gapDays: 0,
  names: { G: "Gage", K: "Kaylene" },
};
const at = (over: Partial<ScheduleTasksInput>) => scheduleTasks({ ...base, ...over });

describe("periodOf", () => {
  it("finds the 4-week Saturday-to-Friday period a day falls in", () => {
    expect(periodOf(REF, "2026-10-24")).toEqual({ start: "2026-10-24", end: "2026-11-20" });
    expect(periodOf(REF, "2026-11-07")).toEqual({ start: "2026-10-24", end: "2026-11-20" });
    expect(periodOf(REF, "2026-11-20")).toEqual({ start: "2026-10-24", end: "2026-11-20" });
    expect(periodOf(REF, "2026-11-21")).toEqual({ start: "2026-11-21", end: "2026-12-18" });
  });

  it("counts back before the reference day too", () => {
    expect(periodOf(REF, "2026-10-23")).toEqual({ start: "2026-09-26", end: "2026-10-23" });
  });
});

describe("when the list shows", () => {
  it("stays away until the last week of the period", () => {
    expect(at({ today: "2026-11-07" })).toBeNull();
    expect(at({ today: "2026-11-13" })).toBeNull();
  });

  it("appears for the last seven days, the end day included", () => {
    expect(at({ today: "2026-11-14" })?.periodEnd).toBe("2026-11-20");
    expect(at({ today: "2026-11-20" })?.ended).toBe(false);
  });

  it("stays after the period ends, for two weeks, then lets go", () => {
    const late = at({ today: "2026-11-25", gEnd: "2026-11-20" });
    expect(late).toMatchObject({ periodEnd: "2026-11-20", ended: true });
    expect(at({ today: "2026-12-04", gEnd: "2026-11-20" })).not.toBeNull();
    expect(at({ today: "2026-12-05", gEnd: "2026-11-20" })).toBeNull();
  });

  it("keeps a finished list through the grace weeks too, so it can be seen to be done", () => {
    expect(at({ today: "2026-11-25", gEnd: "2026-12-18", kEnd: "2026-12-18" })).toMatchObject({ ended: true, allComplete: true });
  });

  it("stays quiet with no reference day to count from", () => {
    expect(at({ refSat: undefined })).toBeNull();
    expect(at({ refSat: "soon" })).toBeNull();
  });
});

describe("the items", () => {
  it("lists Kaylene's upload, then Gage's, both pending while their schedules stop at the period's end", () => {
    const r = at({});
    expect(r?.items.map((i) => [i.id, i.title, i.status])).toEqual([
      ["upload-K", "Upload Kaylene's Schedule", "pending"],
      ["upload-G", "Upload Gage's Schedule", "pending"],
    ]);
  });

  it("ticks an upload once that person has a shift after the period ends", () => {
    const r = at({ gEnd: "2026-12-18" });
    expect(r?.items.find((i) => i.id === "upload-G")?.status).toBe("completed");
    expect(r?.items.find((i) => i.id === "upload-K")?.status).toBe("pending");
  });

  it("doesn't tick for a shift on the last day itself, or for no shifts at all", () => {
    expect(at({ gEnd: "2026-11-20" })?.items.find((i) => i.id === "upload-G")?.status).toBe("pending");
    expect(at({ gEnd: null })?.items.find((i) => i.id === "upload-G")?.status).toBe("pending");
  });

  it("doesn't tick for a schedule that only spills a day or two over (a Saturday shift after a Friday end)", () => {
    expect(at({ gEnd: "2026-11-21" })?.items.find((i) => i.id === "upload-G")?.status).toBe("pending");
    expect(at({ gEnd: "2026-11-26" })?.items.find((i) => i.id === "upload-G")?.status).toBe("pending");
  });

  it("ticks once the schedule reaches a week into the next period", () => {
    expect(at({ gEnd: "2026-11-27" })?.items.find((i) => i.id === "upload-G")?.status).toBe("completed");
  });

  it("stays on screen, all ticked, in the last week", () => {
    const r = at({ gEnd: "2026-12-18", kEnd: "2026-12-18" });
    expect(r?.items.every((i) => i.status === "completed")).toBe(true);
    expect(r?.allComplete).toBe(true);
  });

  it("isn't all complete while a gap is left, even with both uploads done", () => {
    expect(at({ gEnd: "2026-12-18", kEnd: "2026-12-18", gapDays: 1 })?.allComplete).toBe(false);
    expect(at({ gEnd: "2026-12-18", kEnd: "2026-12-18", gapDays: 0 })?.allComplete).toBe(true);
  });

  it("adds Reconcile Childcare Gaps only when there are gaps", () => {
    expect(at({ gapDays: 0 })?.items.some((i) => i.id === "gaps")).toBe(false);
    expect(at({ gapDays: 3 })?.items.at(-1)).toEqual({ id: "gaps", title: "Reconcile Childcare Gaps", status: "pending", detail: "3 days" });
    expect(at({ gapDays: 1 })?.items.at(-1)?.detail).toBe("1 day");
  });

  it("leaves out Kaylene without a partner, and the gaps without childcare", () => {
    const r = at({ hasPartner: false, childcare: false, gapDays: 4 });
    expect(r?.items.map((i) => i.id)).toEqual(["upload-G"]);
  });

  it("keeps the list for a late gap even when both uploads are done", () => {
    const r = at({ today: "2026-11-25", gEnd: "2026-12-18", kEnd: "2026-12-18", gapDays: 2 });
    expect(r?.items.map((i) => [i.id, i.status])).toEqual([
      ["upload-K", "completed"], ["upload-G", "completed"], ["gaps", "pending"],
    ]);
  });
});

describe("visibleTasks", () => {
  const finished = at({ gEnd: "2026-12-18", kEnd: "2026-12-18" })!;
  const pending = at({})!;
  const doneAt = Date.parse("2026-11-16T15:00:00Z");

  it("shows nothing (the empty state) when there is no list", () => {
    expect(visibleTasks(null, null, doneAt)).toBeNull();
  });

  it("keeps a finished list for 24 hours, then retires it", () => {
    const done = { periodEnd: finished.periodEnd, at: doneAt };
    expect(visibleTasks(finished, done, doneAt)).toBe(finished);
    expect(visibleTasks(finished, done, doneAt + TASKS_LINGER_MS - 1)).toBe(finished);
    expect(visibleTasks(finished, done, doneAt + TASKS_LINGER_MS)).toBeNull();
  });

  it("shows a finished list until it has been recorded as finished", () => {
    expect(visibleTasks(finished, null, doneAt + 10 * TASKS_LINGER_MS)).toBe(finished);
  });

  it("ignores when some other period was finished", () => {
    expect(visibleTasks(finished, { periodEnd: "2026-10-23", at: doneAt }, doneAt + 10 * TASKS_LINGER_MS)).toBe(finished);
  });

  it("never retires a list that still has something to do", () => {
    expect(visibleTasks(pending, { periodEnd: pending.periodEnd, at: doneAt }, doneAt + 10 * TASKS_LINGER_MS)).toBe(pending);
  });
});

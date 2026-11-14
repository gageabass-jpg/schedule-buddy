import { describe, expect, it } from "vitest";
import type { Milestone, Project, Snapshot, Task } from "@shared/types";
import { compareByActivity, compareTasks, dashboard, dayContents, dayMarkers, describeMarkers, inboxTasks, projectProgress, subtaskProgress, visibleTasks } from "./derive";

const TODAY = "2026-11-09";
const NOW = Date.UTC(2026, 10, 9, 12);
const DAY = 86_400_000;

let n = 0;
const project = (o: Partial<Project> = {}): Project => ({ id: `p${++n}`, name: "P", description: "", status: "active", color: null, startDate: null, targetDate: null, githubRepo: null, archivedAt: null, createdAt: 1, updatedAt: 1, ...o });
const task = (o: Partial<Task> = {}): Task => ({ id: `t${++n}`, projectId: null, parentId: null, title: "T", description: "", status: "not_started", priority: "medium", startDate: null, dueDate: null, completedAt: null, createdAt: n, updatedAt: NOW, ...o });
const milestone = (o: Partial<Milestone> = {}): Milestone => ({ id: `m${++n}`, projectId: "p", name: "M", description: "", targetDate: TODAY, completedAt: null, createdAt: 1, updatedAt: 1, ...o });
const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ projects: [], tasks: [], milestones: [], notes: [], services: [], serviceCharges: [], settings: {}, ...o });

describe("inbox", () => {
  it("is open, unsorted, top-level tasks, newest first", () => {
    const old = task({ createdAt: 1 });
    const fresh = task({ createdAt: 9 });
    const done = task({ status: "done" });
    const sorted = task({ projectId: "p1" });
    const sub = task({ parentId: old.id });
    expect(inboxTasks([old, fresh, done, sorted, sub]).map((t) => t.id)).toEqual([fresh.id, old.id]);
  });
});

describe("progress", () => {
  it("counts top-level tasks only", () => {
    const p = project();
    const a = task({ projectId: p.id, status: "done" });
    const b = task({ projectId: p.id });
    const sub = task({ projectId: p.id, parentId: b.id, status: "done" });
    expect(projectProgress(p.id, [a, b, sub])).toEqual({ done: 1, total: 2, pct: 50 });
    expect(subtaskProgress(b.id, [a, b, sub])).toEqual({ done: 1, total: 1 });
    expect(projectProgress("none", [])).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

describe("archived projects", () => {
  it("drop out of every view, but inbox tasks stay", () => {
    const arch = project({ archivedAt: 5, targetDate: TODAY });
    const live = project();
    const s = snap({
      projects: [arch, live],
      tasks: [task({ projectId: arch.id, dueDate: TODAY }), task({ projectId: live.id, dueDate: TODAY }), task({ dueDate: TODAY })],
      milestones: [milestone({ projectId: arch.id })],
    });
    expect(visibleTasks(s)).toHaveLength(2);
    const m = dayMarkers(s, TODAY).get(TODAY)!;
    expect(m.due).toBe(2);
    expect(m.milestones).toBe(0);
    expect(m.deadlines).toBe(0);
  });
});

describe("calendar markers", () => {
  it("count due, overdue, start, milestone and deadline per day", () => {
    const p = project({ targetDate: "2026-11-20" });
    const s = snap({
      projects: [p],
      tasks: [
        task({ projectId: p.id, dueDate: "2026-11-05" }),            // overdue
        task({ projectId: p.id, dueDate: "2026-11-05", status: "done" }),   // done: not shown
        task({ projectId: p.id, dueDate: "2026-11-12", startDate: "2026-11-10" }),
      ],
      milestones: [milestone({ projectId: p.id, targetDate: "2026-11-12" }), milestone({ projectId: p.id, targetDate: "2026-11-13", completedAt: 1 })],
    });
    const m = dayMarkers(s, TODAY);
    expect(m.get("2026-11-05")).toMatchObject({ due: 1, overdue: 1 });
    expect(m.get("2026-11-10")).toMatchObject({ starts: 1, due: 0 });
    expect(m.get("2026-11-12")).toMatchObject({ due: 1, overdue: 0, milestones: 1 });
    expect(m.get("2026-11-13")).toBeUndefined();   // a completed milestone leaves no mark
    expect(m.get("2026-11-20")).toMatchObject({ deadlines: 1 });
    expect(describeMarkers(m.get("2026-11-12"))).toBe("1 task due · 1 milestone");
    expect(describeMarkers(m.get("2026-11-05"))).toBe("1 task due (1 overdue)");
    expect(describeMarkers(undefined)).toBe("");
  });

  it("a completed project has no deadline mark", () => {
    const p = project({ status: "completed", targetDate: "2026-11-20" });
    expect(dayMarkers(snap({ projects: [p] }), TODAY).size).toBe(0);
  });
});

describe("a day's contents", () => {
  it("lists what is due, starting, a milestone or a deadline, and overdue only on today", () => {
    const p = project({ targetDate: "2026-11-10" });
    const late = task({ projectId: p.id, dueDate: "2026-11-01" });
    const due = task({ projectId: p.id, dueDate: "2026-11-10" });
    const start = task({ projectId: p.id, startDate: "2026-11-10" });
    const s = snap({ projects: [p], tasks: [late, due, start], milestones: [milestone({ projectId: p.id, targetDate: "2026-11-10" })] });
    const d = dayContents(s, "2026-11-10", TODAY);
    expect(d.due.map((t) => t.id)).toEqual([due.id]);
    expect(d.starting.map((t) => t.id)).toEqual([start.id]);
    expect(d.milestones).toHaveLength(1);
    expect(d.deadlines.map((x) => x.id)).toEqual([p.id]);
    expect(d.overdue).toEqual([]);
    expect(dayContents(s, TODAY, TODAY).overdue.map((t) => t.id)).toEqual([late.id]);
  });
});

describe("ordering", () => {
  it("open before done, soonest due first, undated last, then priority", () => {
    const a = task({ dueDate: "2026-11-12" });
    const b = task({ dueDate: "2026-11-10", priority: "low" });
    const c = task({ dueDate: "2026-11-10", priority: "high" });
    const d = task({});
    const e = task({ status: "done", dueDate: "2026-11-01" });
    expect([a, b, c, d, e].sort(compareTasks).map((t) => t.id)).toEqual([c.id, b.id, a.id, d.id, e.id]);
  });
});

describe("dashboard", () => {
  it("separates overdue, due soon and milestones, and shows in Needs attention only what the others do not", () => {
    const p = project({ updatedAt: 50 });
    const q = project({ updatedAt: 90 });
    const done = project({ status: "completed", updatedAt: 99 });
    const overdue = task({ projectId: p.id, dueDate: "2026-11-02", priority: "high" });
    const soon = task({ projectId: p.id, dueDate: "2026-11-11" });
    const hot = task({ projectId: p.id, dueDate: "2026-11-13", priority: "high" });       // due soon: not repeated in attention
    const far = task({ projectId: p.id, dueDate: "2027-03-01" });
    const urgentNoDate = task({ projectId: p.id, priority: "high" });                     // nothing will remind you
    const stale = task({ projectId: q.id, status: "in_progress", updatedAt: NOW - 9 * DAY });
    const staleAndLate = task({ projectId: q.id, status: "in_progress", dueDate: "2026-11-01", updatedAt: NOW - 20 * DAY });   // overdue: not repeated
    const fine = task({ projectId: q.id, status: "in_progress", updatedAt: NOW - 1 * DAY });
    const finished = task({ projectId: q.id, status: "done", dueDate: "2026-11-01" });
    const s = snap({
      projects: [p, q, done],
      tasks: [overdue, soon, hot, far, urgentNoDate, stale, staleAndLate, fine, finished],
      milestones: [milestone({ projectId: p.id, targetDate: "2026-11-15" }), milestone({ projectId: p.id, targetDate: "2026-11-12" }), milestone({ projectId: p.id, completedAt: 1 })],
    });
    const d = dashboard(s, TODAY, NOW);
    expect(d.openTasks).toBe(8);
    expect(d.overdue.map((t) => t.id).sort()).toEqual([overdue.id, staleAndLate.id].sort());
    expect(d.dueSoon.map((t) => t.id)).toEqual([soon.id, hot.id]);
    expect(d.attention.map((a) => a.task.id).sort()).toEqual([urgentNoDate.id, stale.id].sort());
    expect(d.attention.find((a) => a.task.id === stale.id)!.reason).toBe("In progress · untouched 9 days");
    expect(d.attention.find((a) => a.task.id === urgentNoDate.id)!.reason).toBe("High priority · no due date");
    // No task appears in two of the three lists.
    const ids = [...d.overdue, ...d.dueSoon, ...d.attention.map((a) => a.task)].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(d.milestones.map((m) => m.targetDate)).toEqual(["2026-11-12", "2026-11-15"]);
    expect(d.activeProjects.map((x) => x.id)).toEqual([q.id, p.id]);   // newest activity first; the completed one is not active
    expect(d.recent[0].id).toBe(done.id);
  });
});

describe("most recently active first", () => {
  it("settles a tie the same way every time: creation time, then name, then id", () => {
    const a = project({ name: "Alpha", updatedAt: 100, createdAt: 1, id: "z" });
    const b = project({ name: "Beta", updatedAt: 100, createdAt: 2, id: "y" });
    const c = project({ name: "Gamma", updatedAt: 100, createdAt: 2, id: "x" });
    const newest = project({ name: "Zeta", updatedAt: 200, createdAt: 0, id: "w" });
    const want = [newest.id, b.id, c.id, a.id];   // newest first; then the later-created; then by name
    // Every input order gives the same answer, so a random id order cannot change what you see.
    for (const input of [[a, b, c, newest], [newest, c, b, a], [c, a, newest, b], [b, newest, a, c]]) {
      expect([...input].sort(compareByActivity).map((p) => p.id)).toEqual(want);
    }
  });
});

import { describe, expect, it } from "vitest";
import type { Project, Snapshot, Task } from "@shared/types";
import { buildBoard, CELL_LIMIT, compareInCell, isClosedColumn, visibleInCell } from "./board";

let n = 0;
const project = (o: Partial<Project> = {}): Project => ({ id: `p${++n}`, name: "P", description: "", status: "active", statusLine: "", key: "PRJ", color: null, startDate: null, targetDate: null, githubRepo: null, archivedAt: null, createdAt: n, updatedAt: 1, ...o });
const task = (o: Partial<Task> = {}): Task => ({ id: `t${++n}`, projectId: null, parentId: null, number: null, title: "T", description: "", status: "not_started", priority: "medium", startDate: null, dueDate: null, completedAt: null, githubRef: null, createdAt: n, updatedAt: 1, ...o });
const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ projects: [], tasks: [], milestones: [], notes: [], services: [], serviceCharges: [], settings: {}, ...o });

describe("buildBoard", () => {
  it("makes a row for each project that is not archived, in the order they were made", () => {
    const a = project({ name: "A" });
    const gone = project({ name: "Gone", archivedAt: 5 });
    const b = project({ name: "B" });
    expect(buildBoard(snap({ projects: [a, gone, b] })).rows.map((r) => r.project.name)).toEqual(["A", "B"]);
  });

  it("files each task under its status, and counts them by status and in all", () => {
    const p = project();
    const tasks = [
      task({ projectId: p.id, status: "not_started" }), task({ projectId: p.id, status: "not_started" }),
      task({ projectId: p.id, status: "in_progress" }), task({ projectId: p.id, status: "stalled" }),
      task({ projectId: p.id, status: "done" }), task({ projectId: p.id, status: "discontinued" }),
    ];
    const board = buildBoard(snap({ projects: [p], tasks }));
    expect(board.totals).toEqual({ not_started: 2, in_progress: 1, stalled: 1, done: 1, discontinued: 1 });
    expect(board.tasks).toBe(6);
    expect(board.rows[0]).toMatchObject({ open: 4, closed: 2 });
  });

  it("leaves out subtasks, inbox tasks and tasks of an archived project", () => {
    const p = project();
    const old = project({ archivedAt: 9 });
    const top = task({ projectId: p.id });
    const sub = task({ projectId: p.id, parentId: top.id });
    const loose = task();
    const hidden = task({ projectId: old.id });
    const board = buildBoard(snap({ projects: [p, old], tasks: [top, sub, loose, hidden] }));
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].cells.not_started.map((t) => t.id)).toEqual([top.id]);
    expect(board.tasks).toBe(1);
  });

  it("shows open columns in identifier order, and closed columns with the latest first", () => {
    const p = project();
    const three = task({ projectId: p.id, number: 3 });
    const one = task({ projectId: p.id, number: 1 });
    const two = task({ projectId: p.id, number: 2 });
    const unnumbered = task({ projectId: p.id, number: null });
    const early = task({ projectId: p.id, status: "done", completedAt: 100 });
    const late = task({ projectId: p.id, status: "done", completedAt: 900 });
    const dropped = task({ projectId: p.id, status: "discontinued", updatedAt: 500 });
    const board = buildBoard(snap({ projects: [p], tasks: [three, unnumbered, one, two, early, late, dropped] }));
    expect(board.rows[0].cells.not_started.map((t) => t.id)).toEqual([one.id, two.id, three.id, unnumbered.id]);
    expect(board.rows[0].cells.done.map((t) => t.id)).toEqual([late.id, early.id]);
    expect(board.rows[0].cells.discontinued.map((t) => t.id)).toEqual([dropped.id]);
  });

  it("is empty, not broken, with nothing in it", () => {
    expect(buildBoard(snap())).toEqual({ rows: [], totals: { not_started: 0, in_progress: 0, stalled: 0, done: 0, discontinued: 0 }, tasks: 0 });
  });
});

describe("visibleInCell", () => {
  const many = (count: number): Task[] => Array.from({ length: count }, () => task());

  it("shows everything while it fits, and folds the rest of a closed cell after three", () => {
    expect(visibleInCell(many(3), "done", false)).toMatchObject({ hidden: 0 });
    const folded = visibleInCell(many(10), "done", false);
    expect([folded.shown.length, folded.hidden]).toEqual([CELL_LIMIT.done, 7]);
  });

  it("folds an open cell later, after twelve", () => {
    expect(visibleInCell(many(12), "not_started", false).hidden).toBe(0);
    expect(visibleInCell(many(15), "not_started", false)).toMatchObject({ hidden: 3 });
  });

  it("shows all of it when expanded", () => {
    const all = many(10);
    expect(visibleInCell(all, "done", true)).toEqual({ shown: all, hidden: 0 });
  });
});

describe("columns", () => {
  it("treat Complete and Discontinued as closed", () => {
    expect(["not_started", "in_progress", "stalled", "done", "discontinued"].map((s) => isClosedColumn(s as never))).toEqual([false, false, false, true, true]);
  });
  it("sort a task with no number after the numbered ones", () => {
    expect(compareInCell("not_started")(task({ number: 5 }), task({ number: null }))).toBeLessThan(0);
  });
});

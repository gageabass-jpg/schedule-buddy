import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { AppError } from "./errors.js";
import { Workspace } from "./repo.js";

let ws: Workspace;
let clock: number;
let n: number;

beforeEach(() => {
  clock = 1_000_000;
  n = 0;
  ws = new Workspace(openDatabase(":memory:"), () => (clock += 1000), () => `id-${++n}`);
});

const message = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (e) { return e instanceof AppError ? `${e.code}: ${e.message}` : `other: ${String(e)}`; }
  return undefined;
};
const find = (id: string) => ws.snapshot().tasks.find((t) => t.id === id)!;

/** Two projects, two top-level tasks in the first, one in the second, and a subtask under the first. */
function seed() {
  const a = ws.createProject({ name: "A" }).id;
  const b = ws.createProject({ name: "B" }).id;
  const parent1 = ws.createTask({ title: "Parent 1", projectId: a }).id;
  const parent2 = ws.createTask({ title: "Parent 2", projectId: b }).id;
  const loose = ws.createTask({ title: "Loose" }).id;
  const sub = ws.createTask({ title: "Sub", parentId: parent1 }).id;
  return { a, b, parent1, parent2, loose, sub };
}

describe("lifting a subtask", () => {
  it("makes it a top-level task, in the project it was in, with the same id and its notes", () => {
    const { a, parent1, sub } = seed();
    const note = ws.createNote({ taskId: sub, body: "keep me" }).id;
    ws.updateTask(sub, { parentId: null });
    expect(find(sub)).toMatchObject({ parentId: null, projectId: a });
    expect(ws.snapshot().notes.find((x) => x.id === note)?.taskId).toBe(sub);
    expect(ws.snapshot().tasks.filter((t) => t.parentId === parent1)).toHaveLength(0);
  });

  it("can move to another project in the same change", () => {
    const { b, sub } = seed();
    ws.updateTask(sub, { parentId: null, projectId: b });
    expect(find(sub)).toMatchObject({ parentId: null, projectId: b });
  });

  it("can be sent to the inbox in the same change", () => {
    const { sub } = seed();
    ws.updateTask(sub, { parentId: null, projectId: null });
    expect(find(sub)).toMatchObject({ parentId: null, projectId: null });
  });

  it("does nothing to a task that is already top-level", () => {
    const { a, parent1 } = seed();
    ws.updateTask(parent1, { parentId: null });
    expect(find(parent1)).toMatchObject({ parentId: null, projectId: a });
  });
});

describe("making a task a subtask", () => {
  it("puts a top-level task under a parent, in the parent's project, keeping its id and notes", () => {
    const { b, parent2, loose } = seed();
    const note = ws.createNote({ taskId: loose, body: "still here" }).id;
    ws.updateTask(loose, { parentId: parent2 });
    expect(find(loose)).toMatchObject({ parentId: parent2, projectId: b });
    expect(ws.snapshot().notes.find((x) => x.id === note)?.taskId).toBe(loose);
  });

  it("moves a subtask to another parent, and into that parent's project", () => {
    const { b, parent1, parent2, sub } = seed();
    ws.updateTask(sub, { parentId: parent2 });
    expect(find(sub)).toMatchObject({ parentId: parent2, projectId: b });
    expect(ws.snapshot().tasks.filter((t) => t.parentId === parent1)).toHaveLength(0);
  });

  it("ignores a project in the same patch: a subtask lives in its parent's project", () => {
    const { a, parent1, loose } = seed();
    ws.updateTask(loose, { parentId: parent1, projectId: "does-not-matter" });
    expect(find(loose)).toMatchObject({ parentId: parent1, projectId: a });
  });

  it("is a no-op for the parent it already has", () => {
    const { a, parent1, sub } = seed();
    ws.updateTask(sub, { parentId: parent1 });
    expect(find(sub)).toMatchObject({ parentId: parent1, projectId: a });
  });

  it("can change other fields in the same patch", () => {
    const { parent2, loose } = seed();
    ws.updateTask(loose, { parentId: parent2, title: "Renamed", priority: "high" });
    expect(find(loose)).toMatchObject({ parentId: parent2, title: "Renamed", priority: "high" });
  });
});

describe("the one-level rule still holds", () => {
  it("refuses to make a task its own subtask", () => {
    const { loose } = seed();
    expect(message(() => ws.updateTask(loose, { parentId: loose }))).toBe("validation: A task cannot be a subtask of itself.");
  });

  it("refuses a parent that is itself a subtask", () => {
    const { loose, sub } = seed();
    expect(message(() => ws.updateTask(loose, { parentId: sub }))).toBe("validation: A subtask cannot have subtasks of its own.");
  });

  it("refuses to make a task that has subtasks into a subtask", () => {
    const { parent1, parent2 } = seed();
    expect(message(() => ws.updateTask(parent1, { parentId: parent2 }))).toContain("has subtasks of its own");
  });

  it("refuses a parent that does not exist, and changes nothing", () => {
    const { a, loose } = seed();
    expect(message(() => ws.updateTask(loose, { parentId: "ghost" }))).toContain("not_found");
    expect(find(loose)).toMatchObject({ parentId: null, projectId: null });
    expect(a).toBeTruthy();
  });

  it("refuses all of it in one piece: a bad patch changes none of its fields", () => {
    const { parent1, parent2 } = seed();
    expect(message(() => ws.updateTask(parent1, { parentId: parent2, title: "Should not stick" }))).toBeDefined();
    expect(find(parent1).title).toBe("Parent 1");
  });
});

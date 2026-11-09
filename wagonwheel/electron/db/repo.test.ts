import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./database.js";
import { Workspace } from "./repo.js";
import { AppError } from "./errors.js";

let db: DatabaseSync;
let clock: number;
let n: number;
let ws: Workspace;

beforeEach(() => {
  db = openDatabase(":memory:");
  clock = 1_000_000;
  n = 0;
  ws = new Workspace(db, () => (clock += 1000), () => `id-${++n}`);
});

const code = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (e) { return e instanceof AppError ? `${e.code}: ${e.message}` : `other: ${String(e)}`; }
  return undefined;
};

describe("projects", () => {
  it("starts empty", () => {
    expect(ws.snapshot()).toEqual({ projects: [], tasks: [], milestones: [], notes: [], settings: {} });
  });

  it("creates a project and cleans the input", () => {
    const { id, snapshot } = ws.createProject({ name: "  Wagonwheel  ", color: "#c62845", startDate: "2026-11-01", targetDate: "2026-12-31" });
    const p = snapshot.projects.find((x) => x.id === id)!;
    expect(p).toMatchObject({ name: "Wagonwheel", status: "active", color: "#C62845", startDate: "2026-11-01", targetDate: "2026-12-31", archivedAt: null });
  });

  it("refuses bad input with a message a person can act on", () => {
    expect(code(() => ws.createProject({ name: "   " }))).toBe("validation: The project name cannot be empty.");
    expect(code(() => ws.createProject({ name: "x", startDate: "2026-02-30" }))).toBe("validation: The start date is not a valid date.");
    expect(code(() => ws.createProject({ name: "x", startDate: "2026-12-01", targetDate: "2026-11-01" }))).toBe("validation: The start date is after the target date.");
    expect(code(() => ws.createProject({ name: "x", color: "red" }))).toBe("validation: The colour must look like #C62845.");
    expect(code(() => ws.createProject({ name: "x", status: "nope" as never }))).toContain("The status is not one of");
    expect(ws.snapshot().projects).toHaveLength(0);
  });

  it("updates only what the patch names; null clears a date", () => {
    const { id } = ws.createProject({ name: "A", description: "d", startDate: "2026-11-01", targetDate: "2026-12-01" });
    const { snapshot } = ws.updateProject(id, { name: "B", targetDate: null });
    expect(snapshot.projects[0]).toMatchObject({ name: "B", description: "d", startDate: "2026-11-01", targetDate: null });
  });

  it("archives and unarchives, keeping the first archive time", () => {
    const { id } = ws.createProject({ name: "A" });
    const first = ws.updateProject(id, { archived: true }).snapshot.projects[0].archivedAt;
    expect(first).not.toBeNull();
    expect(ws.updateProject(id, { archived: true }).snapshot.projects[0].archivedAt).toBe(first);
    expect(ws.updateProject(id, { archived: false }).snapshot.projects[0].archivedAt).toBeNull();
  });

  it("reports a missing project", () => {
    expect(code(() => ws.updateProject("nope", { name: "x" }))).toBe("not_found: That project no longer exists.");
    expect(code(() => ws.deleteProject("nope"))).toBe("not_found: That project no longer exists.");
  });

  it("deletes a project with its tasks, subtasks, milestones and notes", () => {
    const { id: p } = ws.createProject({ name: "A" });
    const { id: t } = ws.createTask({ title: "t", projectId: p });
    ws.createTask({ title: "sub", parentId: t });
    ws.createMilestone({ projectId: p, name: "m", targetDate: "2026-12-01" });
    ws.createNote({ projectId: p, body: "n" });
    ws.createNote({ taskId: t, body: "n2" });
    const { id: other } = ws.createProject({ name: "B" });
    ws.createTask({ title: "keep", projectId: other });
    const s = ws.deleteProject(p);
    expect(s.projects.map((x) => x.id)).toEqual([other]);
    expect(s.tasks.map((x) => x.title)).toEqual(["keep"]);
    expect(s.milestones).toHaveLength(0);
    expect(s.notes).toHaveLength(0);
  });
});

describe("tasks", () => {
  it("a task with no project is in the inbox", () => {
    const { snapshot } = ws.createTask({ title: "Idea" });
    expect(snapshot.tasks[0]).toMatchObject({ projectId: null, parentId: null, status: "not_started", priority: "medium" });
  });

  it("assigns a task to a project and moves it between projects", () => {
    const a = ws.createProject({ name: "A" }).id;
    const b = ws.createProject({ name: "B" }).id;
    const t = ws.createTask({ title: "t" }).id;
    expect(ws.updateTask(t, { projectId: a }).snapshot.tasks[0].projectId).toBe(a);
    expect(ws.updateTask(t, { projectId: b }).snapshot.tasks[0].projectId).toBe(b);
    expect(ws.updateTask(t, { projectId: null }).snapshot.tasks[0].projectId).toBeNull();
  });

  it("refuses a project that does not exist, and writes nothing", () => {
    expect(code(() => ws.createTask({ title: "t", projectId: "nope" }))).toBe("not_found: That project no longer exists.");
    expect(ws.snapshot().tasks).toHaveLength(0);
  });

  it("checks the dates", () => {
    expect(code(() => ws.createTask({ title: "t", startDate: "2026-11-10", dueDate: "2026-11-01" }))).toBe("validation: The start date is after the due date.");
    const t = ws.createTask({ title: "t", dueDate: "2026-11-01" }).id;
    expect(code(() => ws.updateTask(t, { startDate: "2026-11-05" }))).toBe("validation: The start date is after the due date.");
    expect(ws.updateTask(t, { dueDate: null }).snapshot.tasks[0].dueDate).toBeNull();
  });

  it("sets completedAt when a task is done and clears it when it is reopened", () => {
    const t = ws.createTask({ title: "t" }).id;
    const done = ws.updateTask(t, { status: "done" }).snapshot.tasks[0];
    expect(done.status).toBe("done");
    expect(done.completedAt).not.toBeNull();
    // A second save of a done task keeps the first completion time.
    expect(ws.updateTask(t, { title: "t2" }).snapshot.tasks[0].completedAt).toBe(done.completedAt);
    const open = ws.updateTask(t, { status: "in_progress" }).snapshot.tasks[0];
    expect(open.completedAt).toBeNull();
  });

  it("creates a task that is already done", () => {
    expect(ws.createTask({ title: "t", status: "done" }).snapshot.tasks[0].completedAt).not.toBeNull();
  });
});

describe("subtasks", () => {
  it("share the parent's project and follow it when it moves", () => {
    const a = ws.createProject({ name: "A" }).id;
    const b = ws.createProject({ name: "B" }).id;
    const parent = ws.createTask({ title: "parent", projectId: a }).id;
    const sub = ws.createTask({ title: "sub", parentId: parent }).id;
    expect(ws.snapshot().tasks.find((t) => t.id === sub)).toMatchObject({ parentId: parent, projectId: a });
    ws.updateTask(parent, { projectId: b });
    expect(ws.snapshot().tasks.find((t) => t.id === sub)!.projectId).toBe(b);
  });

  it("ignores a project change on a subtask", () => {
    const a = ws.createProject({ name: "A" }).id;
    const b = ws.createProject({ name: "B" }).id;
    const parent = ws.createTask({ title: "parent", projectId: a }).id;
    const sub = ws.createTask({ title: "sub", parentId: parent }).id;
    ws.updateTask(sub, { projectId: b });
    expect(ws.snapshot().tasks.find((t) => t.id === sub)!.projectId).toBe(a);
  });

  it("go one level deep only", () => {
    const parent = ws.createTask({ title: "parent" }).id;
    const sub = ws.createTask({ title: "sub", parentId: parent }).id;
    expect(code(() => ws.createTask({ title: "deep", parentId: sub }))).toBe("validation: A subtask cannot have subtasks of its own.");
  });

  it("are deleted with their parent", () => {
    const parent = ws.createTask({ title: "parent" }).id;
    ws.createTask({ title: "sub", parentId: parent });
    expect(ws.deleteTask(parent).tasks).toHaveLength(0);
  });
});

describe("milestones", () => {
  it("need a project, a name and a date", () => {
    const p = ws.createProject({ name: "A" }).id;
    expect(code(() => ws.createMilestone({ projectId: p, name: "", targetDate: "2026-12-01" }))).toBe("validation: The milestone name cannot be empty.");
    expect(code(() => ws.createMilestone({ projectId: p, name: "m", targetDate: "" }))).toBe("validation: A milestone needs a target date.");
    expect(code(() => ws.createMilestone({ projectId: "nope", name: "m", targetDate: "2026-12-01" }))).toBe("not_found: That project no longer exists.");
  });

  it("complete and reopen", () => {
    const p = ws.createProject({ name: "A" }).id;
    const m = ws.createMilestone({ projectId: p, name: "Ship", targetDate: "2026-12-01" }).id;
    expect(ws.updateMilestone(m, { completed: true }).snapshot.milestones[0].completedAt).not.toBeNull();
    expect(ws.updateMilestone(m, { completed: false, targetDate: "2026-12-15" }).snapshot.milestones[0]).toMatchObject({ completedAt: null, targetDate: "2026-12-15" });
    expect(ws.deleteMilestone(m).milestones).toHaveLength(0);
  });
});

describe("notes", () => {
  it("belong to a project or a task, not both and not neither", () => {
    const p = ws.createProject({ name: "A" }).id;
    const t = ws.createTask({ title: "t", projectId: p }).id;
    expect(code(() => ws.createNote({ body: "x" }))).toBe("validation: A note belongs to a project or to a task.");
    expect(code(() => ws.createNote({ projectId: p, taskId: t, body: "x" }))).toBe("validation: A note belongs to a project or to a task.");
    expect(code(() => ws.createNote({ projectId: p, body: "   " }))).toBe("validation: A note cannot be empty.");
    expect(code(() => ws.createNote({ taskId: "nope", body: "x" }))).toBe("not_found: That task no longer exists.");
    expect(ws.snapshot().notes).toHaveLength(0);
  });

  it("can be edited and deleted", () => {
    const p = ws.createProject({ name: "A" }).id;
    const note = ws.createNote({ projectId: p, body: "first" }).id;
    expect(ws.updateNote(note, "second").snapshot.notes[0].body).toBe("second");
    expect(ws.deleteNote(note).notes).toHaveLength(0);
  });
});

describe("a project's updatedAt", () => {
  it("moves when anything inside it changes", () => {
    const p = ws.createProject({ name: "A" }).id;
    const at = () => ws.snapshot().projects[0].updatedAt;
    let last = at();
    const step = (label: string, fn: () => void) => {
      fn();
      expect(at(), label).toBeGreaterThan(last);
      last = at();
    };
    let t = "";
    step("task created", () => { t = ws.createTask({ title: "t", projectId: p }).id; });
    step("task updated", () => ws.updateTask(t, { status: "done" }));
    step("task note", () => ws.createNote({ taskId: t, body: "n" }));
    step("milestone", () => ws.createMilestone({ projectId: p, name: "m", targetDate: "2026-12-01" }));
    step("task deleted", () => ws.deleteTask(t));
  });
});

describe("settings", () => {
  it("stores the workspace name", () => {
    expect(ws.setSetting("workspaceName", "  Studio  ").settings.workspaceName).toBe("Studio");
    expect(ws.setSetting("workspaceName", "Lab").settings.workspaceName).toBe("Lab");
  });

  it("refuses an empty or very long workspace name, and odd keys", () => {
    expect(code(() => ws.setSetting("workspaceName", "  "))).toBe("validation: The workspace name cannot be empty.");
    expect(code(() => ws.setSetting("workspaceName", "x".repeat(61)))).toContain("too long");
    expect(code(() => ws.setSetting("bad key!", "x"))).toBe("validation: That setting name is not allowed.");
  });
});

describe("transactions", () => {
  it("roll back a change that fails part way", () => {
    const p = ws.createProject({ name: "A" }).id;
    // The task insert succeeds, then the project update that follows it is refused.
    // Nothing from the change may stay behind.
    db.exec("CREATE TRIGGER boom BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'boom'); END");
    expect(code(() => ws.createTask({ title: "t", projectId: p }))).toMatch(/^other: .*boom/);
    expect(ws.snapshot().tasks).toHaveLength(0);
    // The connection is still usable afterwards.
    db.exec("DROP TRIGGER boom");
    expect(ws.createTask({ title: "t", projectId: p }).snapshot.tasks).toHaveLength(1);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrate, openDatabase, stageRestore } from "./database.js";
import { backfillIdentifiers } from "./identifiers.js";
import { MIGRATIONS } from "./migrations.js";
import { Workspace } from "./repo.js";

// Project keys (RXM), task numbers (RXM-4), the status line and the two newer task statuses, through the same Workspace the app uses.

let db: DatabaseSync;
let ws: Workspace;
let clock: number;
let n: number;
beforeEach(() => {
  clock = 1_000_000;
  n = 0;
  db = openDatabase(":memory:");
  ws = new Workspace(db, () => (clock += 1000), () => `id-${++n}`);
});
afterEach(() => { db.close(); });

const project = (name: string, extra: Record<string, unknown> = {}) => ws.createProject({ name, ...extra }).id;
const task = (title: string, extra: Record<string, unknown> = {}) => ws.createTask({ title, ...extra }).id;
const get = (id: string) => ws.snapshot().tasks.find((t) => t.id === id)!;
const proj = (id: string) => ws.snapshot().projects.find((p) => p.id === id)!;

describe("project keys", () => {
  it("are made from the name when none is given", () => {
    expect(proj(project("RxManager")).key).toBe("RXM");
    expect(proj(project("Nucleus Manager")).key).toBe("NM");
  });

  it("do not repeat: a second project that would get the same key gets another", () => {
    const a = project("Nucleus Manager");
    const b = project("Nova Mail");   // NM again
    expect(proj(a).key).toBe("NM");
    expect(proj(b).key).not.toBe("NM");
    expect(proj(b).key).toMatch(/^[A-Z0-9]{2,5}$/);
  });

  it("can be chosen, in any case, and are stored as capitals", () => {
    expect(proj(project("Anything", { key: "rx" })).key).toBe("RX");
  });

  it("refuse a key that is too short, too long or has a stray character", () => {
    for (const key of ["R", "ABCDEF", "R-X", "R X"]) {
      expect(() => ws.createProject({ name: "X", key }), key).toThrow(/2 to 5 capital letters or digits/);
    }
  });

  it("refuse another project's key, naming the project", () => {
    project("RxManager");
    expect(() => ws.createProject({ name: "Other", key: "RXM" })).toThrow(/RXM is already the key of "RxManager"/);
    const b = project("Other");
    expect(() => ws.updateProject(b, { key: "rxm" })).toThrow(/already the key/);
  });

  it("can be kept when the project is saved again, and changed, which renames its tasks' identifiers", () => {
    const p = project("RxManager");
    const t = task("A", { projectId: p });
    ws.updateProject(p, { name: "RxManager 2", key: "RXM" });   // its own key does not count against it
    expect(proj(p).key).toBe("RXM");
    ws.updateProject(p, { key: "rm" });
    expect(proj(p).key).toBe("RM");
    expect(get(t).number).toBe(1);   // the number is the task's; the front is the project's
  });

  it("stay when an edit does not mention them", () => {
    const p = project("RxManager");
    ws.updateProject(p, { description: "x" });
    expect(proj(p).key).toBe("RXM");
  });
});

describe("task numbers", () => {
  it("count up from 1 in each project, and an inbox task has none", () => {
    const a = project("Alpha");
    const b = project("Beta");
    const a1 = task("a1", { projectId: a });
    const a2 = task("a2", { projectId: a });
    const b1 = task("b1", { projectId: b });
    const loose = task("loose");
    expect([get(a1).number, get(a2).number, get(b1).number, get(loose).number]).toEqual([1, 2, 1, null]);
  });

  it("go to subtasks too, so every task can be named", () => {
    const a = project("Alpha");
    const parent = task("parent", { projectId: a });
    const sub = task("sub", { parentId: parent });
    expect([get(parent).number, get(sub).number]).toEqual([1, 2]);
  });

  it("are never reused: deleting the newest task does not give its number to the next", () => {
    const a = project("Alpha");
    task("one", { projectId: a });
    const two = task("two", { projectId: a });
    ws.deleteTask(two);
    expect(get(task("three", { projectId: a })).number).toBe(3);
  });

  it("are given afresh when a task goes to another project, together with its subtasks, and the old numbers stay used", () => {
    const a = project("Alpha");
    const b = project("Beta");
    const parent = task("parent", { projectId: a });
    const sub = task("sub", { parentId: parent });
    task("b-first", { projectId: b });
    ws.updateTask(parent, { projectId: b });
    expect([get(parent).projectId, get(parent).number, get(sub).projectId, get(sub).number]).toEqual([b, 2, b, 3]);
    expect(get(task("next in alpha", { projectId: a })).number).toBe(3);   // 1 and 2 were used there
  });

  it("go away with the project when a task is sent to the inbox, and come back new when it is filed again", () => {
    const a = project("Alpha");
    const t = task("t", { projectId: a });
    ws.updateTask(t, { projectId: null });
    expect(get(t).number).toBeNull();
    ws.updateTask(t, { projectId: a });
    expect(get(t).number).toBe(2);
  });

  it("are unique in a project, as the database itself insists", () => {
    const a = project("Alpha");
    task("one", { projectId: a });
    expect(() => db.exec(`INSERT INTO tasks (id, project_id, number, title, created_at, updated_at) VALUES ('dup', '${a}', 1, 'Dup', 1, 1)`)).toThrow(/UNIQUE/);
  });
});

describe("the status line", () => {
  it("is empty to begin with, and set on create or later", () => {
    const p = project("Alpha");
    expect(proj(p).statusLine).toBe("");
    expect(proj(project("Beta", { statusLine: "Pending App Store review" })).statusLine).toBe("Pending App Store review");
    ws.updateProject(p, { statusLine: "In TestFlight" });
    expect(proj(p).statusLine).toBe("In TestFlight");
  });

  it("is one line: spaces and line breaks collapse and the ends are trimmed", () => {
    const p = project("Alpha", { statusLine: "  Waiting\non   review \n" });
    expect(proj(p).statusLine).toBe("Waiting on review");
  });

  it("holds 60 characters and refuses 61", () => {
    const ok = "x".repeat(60);
    expect(proj(project("Alpha", { statusLine: ok })).statusLine).toBe(ok);
    expect(() => ws.createProject({ name: "Beta", statusLine: "x".repeat(61) })).toThrow(/too long \(the limit is 60 characters\)/);
  });

  it("is cleared by an empty string and kept when an edit does not mention it", () => {
    const p = project("Alpha", { statusLine: "Stalled on legal" });
    ws.updateProject(p, { description: "x" });
    expect(proj(p).statusLine).toBe("Stalled on legal");
    ws.updateProject(p, { statusLine: "" });
    expect(proj(p).statusLine).toBe("");
  });
});

describe("task statuses", () => {
  it("accept Stalled and Discontinued, and refuse anything else", () => {
    const p = project("Alpha");
    const t = task("t", { projectId: p });
    expect(ws.updateTask(t, { status: "stalled" }).snapshot.tasks.find((x) => x.id === t)!.status).toBe("stalled");
    expect(ws.updateTask(t, { status: "discontinued" }).snapshot.tasks.find((x) => x.id === t)!.status).toBe("discontinued");
    expect(() => ws.updateTask(t, { status: "paused" as never })).toThrow(/not one of: not_started, in_progress, stalled, done, discontinued/);
  });

  it("only Complete records a completion: a Discontinued task was not finished", () => {
    const t = task("t");
    ws.updateTask(t, { status: "done" });
    expect(get(t).completedAt).not.toBeNull();
    ws.updateTask(t, { status: "discontinued" });
    expect(get(t).completedAt).toBeNull();
    expect(get(task("u", { status: "discontinued" })).completedAt).toBeNull();
    expect(get(task("v", { status: "done" })).completedAt).not.toBeNull();
  });
});

describe("backfillIdentifiers", () => {
  it("does nothing, and writes nothing, when every project has a key and every task a number", () => {
    const p = project("Alpha");
    task("t", { projectId: p });
    const before = JSON.stringify(ws.snapshot());
    const changes = () => Number((db.prepare("SELECT total_changes() AS c").get() as { c: number }).c);
    const c0 = changes();
    backfillIdentifiers(db);
    expect(changes()).toBe(c0);
    expect(JSON.stringify(ws.snapshot())).toBe(before);
  });

  it("fills in what is missing, oldest first, without touching updated_at, and a second run changes nothing", () => {
    const p = project("RxManager");
    const t1 = task("one", { projectId: p });
    const t2 = task("two", { projectId: p });
    db.exec("UPDATE tasks SET number = NULL; UPDATE projects SET key = NULL, next_task_number = 1");
    const stamped = ws.snapshot().tasks.map((t) => t.updatedAt);
    backfillIdentifiers(db);
    expect(proj(p).key).toBe("RXM");
    expect([get(t1).number, get(t2).number]).toEqual([1, 2]);
    expect(ws.snapshot().tasks.map((t) => t.updatedAt)).toEqual(stamped);
    const once = JSON.stringify(ws.snapshot());
    backfillIdentifiers(db);
    expect(JSON.stringify(ws.snapshot())).toBe(once);
  });

  it("does not hand out a number that is in use, even if the counter was left behind", () => {
    const p = project("Alpha");
    task("one", { projectId: p });
    task("two", { projectId: p });
    db.exec("UPDATE projects SET next_task_number = 1");   // a file edited by hand
    expect(get(task("three", { projectId: p })).number).toBe(3);
  });
});

describe("a restore from a backup that has no keys or numbers", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-ids-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("gives them out, keeping every task and note", () => {
    const backup = path.join(dir, "old.db");
    const old = new DatabaseSync(backup);
    old.exec("PRAGMA foreign_keys = ON");
    migrate(old, null, MIGRATIONS.slice(0, 5));
    old.exec("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'RxManager', 1, 1)");
    old.exec("INSERT INTO tasks (id, project_id, title, status, created_at, updated_at) VALUES ('t1', 'p1', 'First', 'done', 5, 5), ('t2', 'p1', 'Second', 'not_started', 6, 6)");
    old.exec("INSERT INTO notes (id, task_id, body, created_at, updated_at) VALUES ('n1', 't2', 'note', 1, 1)");
    old.close();

    const staged = path.join(dir, "staged.db");
    stageRestore(backup, staged);
    const fresh = openDatabase(staged);
    const snap = new Workspace(fresh).snapshot();
    expect(snap.projects.map((p) => [p.id, p.key])).toEqual([["p1", "RXM"]]);
    expect(snap.tasks.map((t) => [t.id, t.number])).toEqual([["t1", 1], ["t2", 2]]);
    expect(snap.notes.map((x) => x.taskId)).toEqual(["t2"]);
    expect(fresh.prepare("SELECT next_task_number AS n FROM projects").get()).toEqual({ n: 3 });
    fresh.close();
  });

  it("keeps the keys and numbers a newer backup already has", () => {
    const backup = path.join(dir, "new.db");
    const src = openDatabase(backup);
    const w = new Workspace(src, () => 1, (() => { let i = 0; return () => `x${++i}`; })());
    const p = w.createProject({ name: "RxManager", key: "RXN", statusLine: "In review" }).id;
    w.createTask({ title: "a", projectId: p });
    const gone = w.createTask({ title: "b", projectId: p }).id;
    w.createTask({ title: "c", projectId: p });
    w.deleteTask(gone);   // leaves a gap in the numbers: 1 and 3
    src.close();

    const staged = path.join(dir, "staged.db");
    stageRestore(backup, staged);
    const fresh = openDatabase(staged);
    const snap = new Workspace(fresh).snapshot();
    expect(snap.projects[0]).toMatchObject({ key: "RXN", statusLine: "In review" });
    expect(snap.tasks.map((t) => t.number)).toEqual([1, 3]);
    expect(fresh.prepare("SELECT next_task_number AS n FROM projects").get()).toEqual({ n: 4 });
    fresh.close();
  });
});

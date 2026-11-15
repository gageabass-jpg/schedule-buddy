import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrate, openDatabase, SCHEMA_VERSION } from "./database.js";
import { MIGRATIONS } from "./migrations.js";
import { AppError } from "./errors.js";
import { Workspace } from "./repo.js";

let ws: Workspace;
let n: number;
beforeEach(() => {
  n = 0;
  ws = new Workspace(openDatabase(":memory:"), () => 1_000_000, () => `id-${++n}`);
});

const message = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (e) { return e instanceof AppError ? `${e.code}: ${e.message}` : `other: ${String(e)}`; }
  return undefined;
};

describe("a task or milestone remembers where it came from on GitHub", () => {
  it("keeps the id it was made with, trimmed, and none when none is given", () => {
    const p = ws.createProject({ name: "P" }).id;
    const a = ws.createTask({ title: "A", projectId: p, githubRef: "  o/r#1 " }).id;
    const b = ws.createTask({ title: "B", projectId: p }).id;
    const m = ws.createMilestone({ projectId: p, name: "M", targetDate: "2026-12-01", githubRef: "o/r@milestone:3" }).id;
    const s = ws.snapshot();
    expect(s.tasks.find((t) => t.id === a)?.githubRef).toBe("o/r#1");
    expect(s.tasks.find((t) => t.id === b)?.githubRef).toBeNull();
    expect(s.milestones.find((x) => x.id === m)?.githubRef).toBe("o/r@milestone:3");
  });

  it("treats a blank id as none, and refuses one with spaces or an absurd length", () => {
    expect(ws.createTask({ title: "A", githubRef: "   " }).snapshot.tasks[0].githubRef).toBeNull();
    expect(message(() => ws.createTask({ title: "B", githubRef: "o/r #1" }))).toBe("validation: The GitHub reference is not valid.");
    expect(message(() => ws.createTask({ title: "C", githubRef: "x".repeat(301) }))).toBe("validation: The GitHub reference is not valid.");
  });

  it("refuses the same item twice in one project, without regard to case, and says so", () => {
    const p = ws.createProject({ name: "P" }).id;
    ws.createTask({ title: "A", projectId: p, githubRef: "o/r#1" });
    expect(message(() => ws.createTask({ title: "A again", projectId: p, githubRef: "O/R#1" }))).toBe("validation: That item from GitHub (O/R#1) is already in this project.");
    expect(ws.snapshot().tasks).toHaveLength(1);
    ws.createMilestone({ projectId: p, name: "M", targetDate: "2026-12-01", githubRef: "o/r@milestone:3" });
    expect(message(() => ws.createMilestone({ projectId: p, name: "M2", targetDate: "2026-12-02", githubRef: "o/r@milestone:3" }))).toContain("already in this project");
  });

  it("allows the same item in another project, and plain tasks without an id any number of times", () => {
    const a = ws.createProject({ name: "A" }).id;
    const b = ws.createProject({ name: "B" }).id;
    ws.createTask({ title: "x", projectId: a, githubRef: "o/r#1" });
    expect(message(() => ws.createTask({ title: "x", projectId: b, githubRef: "o/r#1" }))).toBeUndefined();
    ws.createTask({ title: "plain", projectId: a });
    expect(message(() => ws.createTask({ title: "plain", projectId: a }))).toBeUndefined();
  });

  it("holds even if the code check were skipped: the database has a unique index", () => {
    const db = openDatabase(":memory:");
    const w = new Workspace(db, () => 1, () => `i-${++n}`);
    const p = w.createProject({ name: "P" }).id;
    w.createTask({ title: "A", projectId: p, githubRef: "o/r#1" });
    expect(() => db.exec(`INSERT INTO tasks (id, project_id, title, github_ref, created_at, updated_at) VALUES ('dup', '${p}', 'D', 'O/R#1', 1, 1)`)).toThrow(/UNIQUE/);
  });

  it("is set when an item is made and does not change when it is edited", () => {
    const p = ws.createProject({ name: "P" }).id;
    const t = ws.createTask({ title: "A", projectId: p, githubRef: "o/r#1" }).id;
    ws.updateTask(t, { title: "Renamed", description: "Rewritten", githubRef: "o/r#2" } as never);
    expect(ws.snapshot().tasks.find((x) => x.id === t)?.githubRef).toBe("o/r#1");
  });
});

describe("migration 5 reads the id back out of what earlier scans wrote", () => {
  const upgrade = (seed: (db: DatabaseSync) => void): Workspace => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-ref-"));
    const file = path.join(dir, "w.db");
    const old = new DatabaseSync(file);
    old.exec("PRAGMA foreign_keys = ON");
    migrate(old, null, MIGRATIONS.slice(0, 4));
    seed(old);
    old.close();
    const db = openDatabase(file);
    expect(Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(SCHEMA_VERSION);
    return new Workspace(db);
  };
  const task = (db: DatabaseSync, id: string, project: string | null, description: string): void => {
    db.prepare("INSERT INTO tasks (id, project_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)").run(id, project, id, description);
  };

  it("fills in issues, pull requests and milestones, and leaves everything else alone", () => {
    const after = upgrade((db) => {
      db.exec("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p', 'P', 1, 1)");
      task(db, "issue", "p", "Body\n\nFrom GitHub: https://github.com/o/r/issues/12");
      task(db, "pull", "p", "Opened by bot.\n\nFrom GitHub: https://github.com/o/r/pull/7");
      task(db, "mile", "p", "0 of 0 issues closed.\n\nFrom GitHub: https://github.com/o/r/milestone/3\n");
      task(db, "roadmap", "p", "In README.md.\n\nFrom GitHub: https://github.com/o/r/blob/main/README.md");
      task(db, "edited", "p", "From GitHub: https://github.com/o/r/issues/5\n\nI added more below.");
      task(db, "prose", "p", "see https://github.com/o/r/issues/1 later");
      task(db, "plain", "p", "");
      db.exec("INSERT INTO milestones (id, project_id, name, description, target_date, created_at, updated_at) VALUES ('m', 'p', 'v1', 'Progress.\n\nFrom GitHub: https://github.com/o/r/milestone/9', '2026-12-01', 1, 1)");
    });
    const s = after.snapshot();
    const ref = (id: string) => s.tasks.find((t) => t.id === id)?.githubRef;
    expect(ref("issue")).toBe("o/r#12");
    expect(ref("pull")).toBe("o/r!7");
    expect(ref("mile")).toBe("o/r@milestone:3");
    expect(ref("roadmap")).toBeNull();
    expect(ref("edited")).toBeNull();
    expect(ref("prose")).toBeNull();
    expect(ref("plain")).toBeNull();
    expect(s.milestones[0].githubRef).toBe("o/r@milestone:9");
    // Nothing else about the tasks changed.
    expect(s.tasks.find((t) => t.id === "issue")?.description).toBe("Body\n\nFrom GitHub: https://github.com/o/r/issues/12");
  });

  it("does not fail on duplicates made by the old bug: the oldest copy keeps the id", () => {
    const after = upgrade((db) => {
      db.exec("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p', 'P', 1, 1), ('q', 'Q', 1, 1)");
      task(db, "first", "p", "A\n\nFrom GitHub: https://github.com/o/r/issues/1");
      task(db, "second", "p", "B\n\nFrom GitHub: https://github.com/o/r/issues/1");
      task(db, "other-project", "q", "C\n\nFrom GitHub: https://github.com/o/r/issues/1");
      task(db, "inbox-a", null, "D\n\nFrom GitHub: https://github.com/o/r/issues/2");
      task(db, "inbox-b", null, "E\n\nFrom GitHub: https://github.com/o/r/issues/2");
    });
    const ref = (id: string) => after.snapshot().tasks.find((t) => t.id === id)?.githubRef;
    expect(ref("first")).toBe("o/r#1");
    expect(ref("second")).toBeNull();
    expect(ref("other-project")).toBe("o/r#1");   // another project may hold the same item
    expect(ref("inbox-a")).toBe("o/r#2");
    expect(ref("inbox-b")).toBeNull();
    expect(after.snapshot().tasks).toHaveLength(5);   // nothing was dropped
  });
});

describe("moving an imported task into a project that already has that GitHub item", () => {
  it("says so in words instead of showing SQLite's error, and changes nothing", () => {
    const a = ws.createProject({ name: "A" }).id;
    const b = ws.createProject({ name: "B" }).id;
    ws.createTask({ title: "Already in B", projectId: b, githubRef: "o/r#1" });
    const t = ws.createTask({ title: "Same item in A", projectId: a, githubRef: "o/r#1" }).id;
    expect(message(() => ws.updateTask(t, { projectId: b }))).toBe('validation: "Same item in A" cannot go there: that item from GitHub (o/r#1) is already in that project.');
    expect(ws.snapshot().tasks.find((x) => x.id === t)?.projectId).toBe(a);
  });

  it("says the inbox when the inbox is where the copy is", () => {
    const a = ws.createProject({ name: "A" }).id;
    ws.createTask({ title: "Loose", githubRef: "o/r#1" });
    const t = ws.createTask({ title: "In A", projectId: a, githubRef: "o/r#1" }).id;
    expect(message(() => ws.updateTask(t, { projectId: null }))).toBe('validation: "In A" cannot go there: that item from GitHub (o/r#1) is already in the inbox.');
  });

  it("checks the subtasks too, since they go with the task", () => {
    const a = ws.createProject({ name: "A" }).id;
    const b = ws.createProject({ name: "B" }).id;
    ws.createTask({ title: "Copy in B", projectId: b, githubRef: "o/r#7" });
    const parent = ws.createTask({ title: "Parent", projectId: a }).id;
    ws.createTask({ title: "Child", parentId: parent, githubRef: "o/r#7" });
    expect(message(() => ws.updateTask(parent, { projectId: b }))).toBe('validation: "Child" cannot go there: that item from GitHub (o/r#7) is already in that project.');
    expect(ws.snapshot().tasks.find((x) => x.id === parent)?.projectId).toBe(a);
  });

  it("applies when a subtask is lifted out with a new project, or moved under a parent in another project", () => {
    const a = ws.createProject({ name: "A" }).id;
    const b = ws.createProject({ name: "B" }).id;
    ws.createTask({ title: "Copy in B", projectId: b, githubRef: "o/r#2" });
    const parentA = ws.createTask({ title: "Parent A", projectId: a }).id;
    const parentB = ws.createTask({ title: "Parent B", projectId: b }).id;
    const sub = ws.createTask({ title: "Sub", parentId: parentA, githubRef: "o/r#2" }).id;
    expect(message(() => ws.updateTask(sub, { parentId: null, projectId: b }))).toContain("cannot go there");
    expect(message(() => ws.updateTask(sub, { parentId: parentB }))).toContain("cannot go there");
    expect(ws.snapshot().tasks.find((x) => x.id === sub)).toMatchObject({ parentId: parentA, projectId: a });
  });

  it("lets a move through when the other project holds a different item, and when the project does not change", () => {
    const a = ws.createProject({ name: "A" }).id;
    const b = ws.createProject({ name: "B" }).id;
    ws.createTask({ title: "Other item in B", projectId: b, githubRef: "o/r#2" });
    const t = ws.createTask({ title: "In A", projectId: a, githubRef: "o/r#1" }).id;
    expect(message(() => ws.updateTask(t, { title: "Renamed" }))).toBeUndefined();       // not a move
    expect(message(() => ws.updateTask(t, { projectId: a }))).toBeUndefined();            // same project
    expect(message(() => ws.updateTask(t, { projectId: b }))).toBeUndefined();            // different item there
    expect(ws.snapshot().tasks.find((x) => x.id === t)?.projectId).toBe(b);
  });
});

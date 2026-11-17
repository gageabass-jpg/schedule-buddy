import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { backupDatabase, checkBackupFile, migrate, openDatabase, replaceDatabaseFile, SCHEMA_VERSION } from "./database.js";
import { MIGRATIONS, type Migration } from "./migrations.js";
import { Workspace } from "./repo.js";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-db-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const version = (db: DatabaseSync) => Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);

describe("openDatabase", () => {
  it("creates the file and the schema", () => {
    const file = path.join(dir, "nested", "w.db");
    const db = openDatabase(file);
    expect(fs.existsSync(file)).toBe(true);
    expect(version(db)).toBe(SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name).sort();
    expect(tables).toEqual(["milestones", "notes", "projects", "service_charges", "services", "settings", "tasks"]);
    db.close();
  });

  it("keeps the data across a close and reopen", () => {
    const file = path.join(dir, "w.db");
    let db = openDatabase(file);
    new Workspace(db).createProject({ name: "Persisted" });
    db.close();
    db = openDatabase(file);
    expect(new Workspace(db).snapshot().projects.map((p) => p.name)).toEqual(["Persisted"]);
    db.close();
  });

  it("enforces foreign keys", () => {
    const db = openDatabase(path.join(dir, "w.db"));
    expect(() => db.exec("INSERT INTO milestones (id, project_id, name, target_date, created_at, updated_at) VALUES ('m','none','n','2026-01-01',1,1)")).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it("refuses a database from a newer version of the app, and leaves it alone", () => {
    const file = path.join(dir, "w.db");
    const raw = new DatabaseSync(file);
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    raw.close();
    expect(() => openDatabase(file)).toThrow(/newer version/);
    const check = new DatabaseSync(file);
    expect(version(check)).toBe(SCHEMA_VERSION + 1);
    check.close();
  });

  it("says what is wrong when the file is not a database", () => {
    const file = path.join(dir, "w.db");
    fs.writeFileSync(file, "this is not a sqlite file, and it is long enough to be read as one header".repeat(10));
    expect(() => openDatabase(file)).toThrow(/could not be opened/);
  });
});

describe("migrate", () => {
  const v1: Migration = { version: 1, name: "one", sql: "CREATE TABLE a (x INTEGER)" };
  const v2: Migration = { version: 2, name: "two", sql: "CREATE TABLE b (y INTEGER)" };

  it("copies a database with data aside before it changes shape", () => {
    const file = path.join(dir, "w.db");
    const db = new DatabaseSync(file);
    migrate(db, null, [v1]);
    db.exec("INSERT INTO a VALUES (7)");
    migrate(db, file, [v1, v2]);
    expect(version(db)).toBe(2);
    const bak = new DatabaseSync(`${file}.before-v2.bak`, { readOnly: true });
    expect(bak.prepare("SELECT x FROM a").get()).toEqual({ x: 7 });
    expect(version(bak)).toBe(1);
    bak.close();
    db.close();
  });

  it("upgrades a real version-1 workspace to add the GitHub column, keeping every project", () => {
    const file = path.join(dir, "w.db");
    const old = new DatabaseSync(file);
    old.exec("PRAGMA foreign_keys = ON");
    migrate(old, null, MIGRATIONS.slice(0, 1));
    old.exec("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'Old project', 1, 1)");
    old.exec("INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES ('t1', 'p1', 'Old task', 1, 1)");
    expect(version(old)).toBe(1);
    old.close();

    const db = openDatabase(file);   // what the app does on launch
    expect(version(db)).toBe(SCHEMA_VERSION);
    const snap = new Workspace(db).snapshot();
    expect(snap.projects).toHaveLength(1);
    expect(snap.projects[0]).toMatchObject({ id: "p1", name: "Old project", githubRepo: null });
    expect(snap.tasks.map((t) => t.title)).toEqual(["Old task"]);
    // the old file was copied aside first, still at version 1
    const bak = new DatabaseSync(`${file}.before-v2.bak`, { readOnly: true });
    expect(version(bak)).toBe(1);
    bak.close();
    // and the new column works, with one project per repository enforced by the database itself
    db.exec("UPDATE projects SET github_repo = 'o/r' WHERE id = 'p1'");
    db.exec("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p2', 'Other', 1, 1)");
    expect(() => db.exec("UPDATE projects SET github_repo = 'O/R' WHERE id = 'p2'")).toThrow(/UNIQUE/);
    db.exec("UPDATE projects SET github_repo = NULL WHERE id = 'p1'");
    db.exec("UPDATE projects SET github_repo = NULL WHERE id = 'p2'");   // many unconnected projects are fine
    db.close();
  });

  it("upgrades a real version-2 workspace to add Services, keeping every project, task and connected repo", () => {
    const file = path.join(dir, "w.db");
    const old = new DatabaseSync(file);
    old.exec("PRAGMA foreign_keys = ON");
    migrate(old, null, MIGRATIONS.slice(0, 2));
    old.exec("INSERT INTO projects (id, name, github_repo, created_at, updated_at) VALUES ('p1', 'RxManager', 'o/rx', 1, 1)");
    old.exec("INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES ('t1', 'p1', 'Old task', 1, 1)");
    old.exec("INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('t2', 'In the inbox', 1, 1)");
    old.exec("INSERT INTO settings (key, value) VALUES ('workspaceName', 'Mine')");
    expect(version(old)).toBe(2);
    old.close();

    const db = openDatabase(file);   // what the app does on launch
    expect(version(db)).toBe(SCHEMA_VERSION);
    const ws = new Workspace(db);
    const snap = ws.snapshot();
    expect(snap.projects[0]).toMatchObject({ id: "p1", name: "RxManager", githubRepo: "o/rx" });
    expect(snap.tasks.map((t) => t.title).sort()).toEqual(["In the inbox", "Old task"]);
    expect(snap.settings).toEqual({ workspaceName: "Mine" });
    expect(snap.services).toEqual([]);
    expect(snap.serviceCharges).toEqual([]);
    // the old file was copied aside first, still at version 2
    const bak = new DatabaseSync(`${file}.before-v3.bak`, { readOnly: true });
    expect(version(bak)).toBe(2);
    bak.close();
    // and the new tables work, one charge per service per month enforced by the database itself
    const sid = ws.createService({ name: "Vercel" }).id;
    db.exec(`INSERT INTO service_charges (id, service_id, month, amount_cents, source, created_at, updated_at) VALUES ('c1', '${sid}', '2026-11', 100, 'manual', 1, 1)`);
    expect(() => db.exec(`INSERT INTO service_charges (id, service_id, month, amount_cents, source, created_at, updated_at) VALUES ('c2', '${sid}', '2026-11', 200, 'manual', 1, 1)`)).toThrow(/UNIQUE/);
    expect(() => db.exec(`INSERT INTO service_charges (id, service_id, month, amount_cents, source, created_at, updated_at) VALUES ('c3', 'none', '2026-10', 200, 'manual', 1, 1)`)).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it("upgrades a real version-3 workspace to add the paid flag, keeping every recorded bill, all of them paid", () => {
    const file = path.join(dir, "w.db");
    const old = new DatabaseSync(file);
    old.exec("PRAGMA foreign_keys = ON");
    migrate(old, null, MIGRATIONS.slice(0, 3));
    old.exec("INSERT INTO services (id, name, created_at, updated_at) VALUES ('s1', 'Vercel', 1, 1)");
    old.exec("INSERT INTO service_charges (id, service_id, month, amount_cents, source, created_at, updated_at) VALUES ('c1', 's1', '2026-10', 2120, 'manual', 1, 1)");
    old.exec("INSERT INTO service_charges (id, service_id, month, amount_cents, source, created_at, updated_at) VALUES ('c2', 's1', '2026-09', 2120, 'vercel', 1, 1)");
    expect(version(old)).toBe(3);
    old.close();

    const db = openDatabase(file);   // what the app does on launch
    expect(version(db)).toBe(SCHEMA_VERSION);   // this test is about the 3 to 4 step, but the app goes on to the latest
    const snap = new Workspace(db).snapshot();
    expect(snap.services.map((s) => s.name)).toEqual(["Vercel"]);
    expect(snap.serviceCharges.map((c) => [c.id, c.month, c.amountCents, c.source, c.paid])).toEqual([["c2", "2026-09", 2120, "vercel", true], ["c1", "2026-10", 2120, "manual", true]]);
    // the old file was copied aside first, still at version 3
    const bak = new DatabaseSync(`${file}.before-v4.bak`, { readOnly: true });
    expect(version(bak)).toBe(3);
    bak.close();
    // the flag is 0 or 1 and nothing else, enforced by the database itself
    expect(() => db.exec("UPDATE service_charges SET paid = 2")).toThrow(/CHECK/);
    db.exec("UPDATE service_charges SET paid = 0 WHERE id = 'c1'");
    expect(new Workspace(db).snapshot().serviceCharges.find((c) => c.id === "c1")?.paid).toBe(false);
    db.close();
  });

  it("upgrades a real version-5 workspace to add the new statuses, project keys and task numbers, keeping every task, subtask and note", () => {
    const file = path.join(dir, "w.db");
    const old = new DatabaseSync(file);
    old.exec("PRAGMA foreign_keys = ON");
    migrate(old, null, MIGRATIONS.slice(0, 5));
    old.exec("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'RxManager', 1, 1), ('p2', 'Nucleus Manager', 2, 2)");
    old.exec(`INSERT INTO tasks (id, project_id, parent_id, title, status, github_ref, completed_at, created_at, updated_at) VALUES
      ('t1', 'p1', NULL, 'First', 'done', 'o/r#1', 11, 10, 10),
      ('t2', 'p1', NULL, 'Second', 'in_progress', NULL, NULL, 20, 20),
      ('t3', 'p1', 't2', 'A subtask', 'not_started', NULL, NULL, 30, 30),
      ('t4', 'p2', NULL, 'Other project', 'not_started', NULL, NULL, 5, 5),
      ('t5', NULL, NULL, 'In the inbox', 'not_started', NULL, NULL, 40, 40)`);
    old.exec("INSERT INTO notes (id, task_id, body, created_at, updated_at) VALUES ('n1', 't2', 'a note on a task', 1, 1)");
    old.exec("INSERT INTO notes (id, project_id, body, created_at, updated_at) VALUES ('n2', 'p1', 'a note on a project', 1, 1)");
    expect(version(old)).toBe(5);
    old.close();

    const db = openDatabase(file);   // what the app does on launch
    expect(version(db)).toBe(SCHEMA_VERSION);
    // every row came across, and the notes and the subtask still point at what they pointed at
    const snap = new Workspace(db).snapshot();
    expect(snap.tasks.map((t) => [t.id, t.projectId, t.parentId, t.status, t.githubRef, t.completedAt])).toEqual([
      ["t4", "p2", null, "not_started", null, null],
      ["t1", "p1", null, "done", "o/r#1", 11],
      ["t2", "p1", null, "in_progress", null, null],
      ["t3", "p1", "t2", "not_started", null, null],
      ["t5", null, null, "not_started", null, null],
    ]);
    expect(snap.notes.map((n) => [n.id, n.projectId, n.taskId])).toEqual([["n1", null, "t2"], ["n2", "p1", null]]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });   // switched back on after the rebuild
    // keys from the names, numbers oldest first, none for the inbox
    expect(snap.projects.map((p) => [p.id, p.key, p.statusLine])).toEqual([["p1", "RXM", ""], ["p2", "NM", ""]]);
    expect(Object.fromEntries(snap.tasks.map((t) => [t.id, t.number]))).toEqual({ t1: 1, t2: 2, t3: 3, t4: 1, t5: null });
    expect(db.prepare("SELECT id, next_task_number AS n FROM projects ORDER BY id").all()).toEqual([{ id: "p1", n: 4 }, { id: "p2", n: 2 }]);
    // the old file was copied aside first, still at version 5, with the old statuses only
    const bak = new DatabaseSync(`${file}.before-v6.bak`, { readOnly: true });
    expect(version(bak)).toBe(5);
    bak.close();
    // the table is what it was: cascades and the one-GitHub-item-per-project rule still hold, and the new statuses are allowed
    expect(() => db.exec("INSERT INTO tasks (id, project_id, title, github_ref, created_at, updated_at) VALUES ('x', 'p1', 'Again', 'O/R#1', 1, 1)")).toThrow(/UNIQUE/);
    db.exec("UPDATE tasks SET status = 'stalled' WHERE id = 't2'");
    db.exec("UPDATE tasks SET status = 'discontinued' WHERE id = 't4'");
    expect(() => db.exec("UPDATE tasks SET status = 'paused' WHERE id = 't2'")).toThrow(/CHECK/);
    db.exec("DELETE FROM tasks WHERE id = 't2'");
    expect(db.prepare("SELECT id FROM tasks WHERE id = 't3'").get()).toBeUndefined();
    expect(db.prepare("SELECT id FROM notes WHERE id = 'n1'").get()).toBeUndefined();
    db.close();
  });

  it("switches foreign keys off around a rebuild that asks for it, and back on, so what points at the table survives", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const tables: Migration = {
      version: 1, name: "tables",
      sql: "CREATE TABLE a (id TEXT PRIMARY KEY); CREATE TABLE b (id TEXT PRIMARY KEY, a_id TEXT REFERENCES a(id) ON DELETE CASCADE)",
    };
    migrate(db, null, [tables]);
    db.exec("INSERT INTO a VALUES ('a1'); INSERT INTO b VALUES ('b1', 'a1')");
    const rebuild: Migration = {
      version: 2, name: "rebuild a", foreignKeysOff: true,
      sql: "CREATE TABLE a_new (id TEXT PRIMARY KEY, extra TEXT); INSERT INTO a_new (id) SELECT id FROM a; DROP TABLE a; ALTER TABLE a_new RENAME TO a",
    };
    migrate(db, null, [tables, rebuild]);
    expect(db.prepare("SELECT count(*) AS n FROM b").get()).toEqual({ n: 1 });   // dropping `a` did not cascade into `b`
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  it("refuses to commit a rebuild that leaves a row pointing at nothing, and still switches foreign keys back on", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const tables: Migration = {
      version: 1, name: "tables",
      sql: "CREATE TABLE a (id TEXT PRIMARY KEY); CREATE TABLE b (id TEXT PRIMARY KEY, a_id TEXT REFERENCES a(id))",
    };
    migrate(db, null, [tables]);
    const dangling: Migration = { version: 2, name: "bad rebuild", foreignKeysOff: true, sql: "INSERT INTO b VALUES ('b2', 'nobody')" };
    expect(() => migrate(db, null, [tables, dangling])).toThrow(/version 2 \(bad rebuild\) failed.*some b rows would point at something that is not there/);
    expect(version(db)).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM b").get()).toEqual({ n: 0 });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  it("rolls a failed migration back completely", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, null, [v1]);
    const bad: Migration = { version: 2, name: "bad", sql: "CREATE TABLE b (y INTEGER); CREATE TABLE a (x INTEGER)" };
    expect(() => migrate(db, null, [v1, bad])).toThrow(/version 2 \(bad\) failed/);
    expect(version(db)).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").get()).toBeUndefined();
    db.close();
  });
});

describe("backup and restore", () => {
  it("backs up a live database, including what is still in the WAL", async () => {
    const file = path.join(dir, "w.db");
    const db = openDatabase(file);
    const ws = new Workspace(db);
    ws.createProject({ name: "In the WAL" });
    const dest = path.join(dir, "copy.db");
    await backupDatabase(db, dest);
    expect(() => checkBackupFile(dest)).not.toThrow();
    const copy = openDatabase(dest);
    expect(new Workspace(copy).snapshot().projects.map((p) => p.name)).toEqual(["In the WAL"]);
    copy.close();
    db.close();
  });

  it("refuses files that are not a restorable Wagonwheel database", () => {
    const text = path.join(dir, "a.db");
    fs.writeFileSync(text, "hello");
    expect(() => checkBackupFile(text)).toThrow(/cannot be restored/);

    const empty = path.join(dir, "b.db");
    const e = new DatabaseSync(empty);
    e.exec("CREATE TABLE x (y)");
    e.close();
    expect(() => checkBackupFile(empty)).toThrow(/not a Wagonwheel database/);

    const newer = path.join(dir, "c.db");
    const n = openDatabase(newer);
    n.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    n.close();
    expect(() => checkBackupFile(newer)).toThrow(/newer version/);
  });

  it("swaps the file and drops the old WAL", async () => {
    const live = path.join(dir, "live.db");
    const a = openDatabase(live);
    new Workspace(a).createProject({ name: "Old" });
    const other = path.join(dir, "other.db");
    const b = openDatabase(other);
    new Workspace(b).createProject({ name: "From backup" });
    b.close();
    a.close();
    replaceDatabaseFile(live, other);
    const reopened = openDatabase(live);
    expect(new Workspace(reopened).snapshot().projects.map((p) => p.name)).toEqual(["From backup"]);
    reopened.close();
  });
});

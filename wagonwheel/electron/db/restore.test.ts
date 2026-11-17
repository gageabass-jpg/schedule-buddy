import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { backupDatabase, checkBackupFile, migrate, openDatabase, OWNED_TABLES, SCHEMA_VERSION, stageRestore } from "./database.js";
import { MIGRATIONS } from "./migrations.js";
import { Workspace } from "./repo.js";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-restore-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const file = (name: string): string => path.join(dir, name);
const version = (db: DatabaseSync): number => Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
const objects = (db: DatabaseSync): { type: string; name: string }[] =>
  db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all() as { type: string; name: string }[];

/** A real backup: a workspace with a bit of everything in it, written the way the app writes one. */
async function makeBackup(name = "backup.db"): Promise<string> {
  const db = openDatabase(file(`live-${name}`));
  const ws = new Workspace(db);
  const p = ws.createProject({ name: "Wagonwheel", githubRepo: "gageabass-jpg/wagonwheel", color: "#0F6E64" }).id;
  const t = ws.createTask({ title: "Ship it", projectId: p, priority: "high", dueDate: "2026-12-01" }).id;
  ws.createTask({ title: "Write the README", parentId: t });
  ws.createNote({ taskId: t, body: "A note on the task" });
  ws.createNote({ projectId: p, body: "A note on the project" });
  ws.createMilestone({ projectId: p, name: "Beta", targetDate: "2026-12-15" });
  ws.setSetting("workspaceName", "Gage's Workspace");
  const s = ws.createService({ name: "Vercel", plan: "Pro", kind: "usage", provider: "vercel", amountCents: 2120 }).id;
  ws.setCharge({ serviceId: s, month: "2026-11", amountCents: 2120, paid: false });
  const dest = file(name);
  await backupDatabase(db, dest);
  db.close();
  return dest;
}

const data = (ws: Workspace) => {
  const s = ws.snapshot();
  return { projects: s.projects, tasks: s.tasks, milestones: s.milestones, notes: s.notes, services: s.services, serviceCharges: s.serviceCharges, settings: s.settings };
};

describe("the list of tables a restore copies", () => {
  it("is exactly the tables the schema makes", () => {
    const db = openDatabase(":memory:");
    const made = objects(db).filter((o) => o.type === "table").map((o) => o.name).sort();
    expect([...OWNED_TABLES].sort()).toEqual(made);
    db.close();
  });
});

describe("checkBackupFile refuses a file that carries more than data", () => {
  async function tampered(sql: string): Promise<string> {
    const backup = await makeBackup("tampered.db");
    const db = new DatabaseSync(backup);
    db.exec(sql);
    db.close();
    return backup;
  }

  it("accepts a real backup", async () => {
    const f = await makeBackup();
    expect(() => checkBackupFile(f)).not.toThrow();
  });

  it("refuses a trigger", async () => {
    const f = await tampered("CREATE TRIGGER sneaky AFTER INSERT ON notes BEGIN UPDATE settings SET value = 'x'; END");
    expect(() => checkBackupFile(f)).toThrow(/a trigger \(sneaky\)/);
  });

  it("refuses a view", async () => {
    const f = await tampered("CREATE VIEW everything AS SELECT * FROM tasks");
    expect(() => checkBackupFile(f)).toThrow(/a view \(everything\)/);
  });

  it("refuses a table the app does not use", async () => {
    const f = await tampered("CREATE TABLE loot (secret TEXT)");
    expect(() => checkBackupFile(f)).toThrow(/a table this app does not use \(loot\)/);
  });

  it("refuses a virtual table, where this SQLite can make one", async () => {
    const backup = await makeBackup("virtual.db");
    const db = new DatabaseSync(backup);
    let made = true;
    try { db.exec("CREATE VIRTUAL TABLE notes_search USING fts5(body)"); } catch { made = false; }
    db.close();
    if (made) expect(() => checkBackupFile(backup)).toThrow(/virtual table|does not use/);
  });
});

describe("stageRestore", () => {
  it("builds a new file with every row of the backup, and nothing else", async () => {
    const backup = await makeBackup();
    const staged = file("staged.db");
    stageRestore(backup, staged);

    const original = openDatabase(backup);
    const rebuilt = openDatabase(staged);
    expect(data(new Workspace(rebuilt))).toEqual(data(new Workspace(original)));
    expect(version(rebuilt)).toBe(SCHEMA_VERSION);
    // Only the app's own schema: the tables and indexes the migrations make, no more.
    const fresh = openDatabase(":memory:");
    expect(objects(rebuilt).sort((a, b) => a.name.localeCompare(b.name))).toEqual(objects(fresh).sort((a, b) => a.name.localeCompare(b.name)));
    for (const db of [original, rebuilt, fresh]) db.close();
  });

  it("keeps ids, so a subtask is still under its parent and a note is still on its task", async () => {
    const backup = await makeBackup();
    stageRestore(backup, file("staged.db"));
    const db = openDatabase(file("staged.db"));
    const s = new Workspace(db).snapshot();
    const parent = s.tasks.find((t) => t.title === "Ship it")!;
    expect(s.tasks.find((t) => t.title === "Write the README")?.parentId).toBe(parent.id);
    expect(s.notes.find((n) => n.body === "A note on the task")?.taskId).toBe(parent.id);
    expect(s.serviceCharges[0]).toMatchObject({ month: "2026-11", amountCents: 2120, paid: false });
    db.close();
  });

  it("leaves no -wal, -shm or working copy behind, and the original untouched", async () => {
    const backup = await makeBackup();
    const before = fs.readFileSync(backup);
    stageRestore(backup, file("staged.db"));
    expect(fs.readdirSync(dir).filter((f) => /staged\.db.*(-wal|-shm|\.src)$/.test(f))).toEqual([]);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith("backup.db") && f !== "backup.db")).toEqual([]);
    expect(fs.readFileSync(backup).equals(before)).toBe(true);
  });

  it("brings in a backup from an older version, with the newer columns at their defaults", () => {
    // A version-1 database, as the first release made it, with a project, a task and a note.
    const old = file("v1.db");
    const db = new DatabaseSync(old);
    db.exec("PRAGMA journal_mode = WAL");
    migrate(db, null, MIGRATIONS.slice(0, 1));
    db.exec(`
      INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'Old project', 1, 1);
      INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES ('t1', 'p1', 'Old task', 1, 1);
      INSERT INTO notes (id, task_id, body, created_at, updated_at) VALUES ('n1', 't1', 'Old note', 1, 1);
    `);
    db.close();

    stageRestore(old, file("staged.db"));
    const rebuilt = openDatabase(file("staged.db"));
    const s = new Workspace(rebuilt).snapshot();
    expect(version(rebuilt)).toBe(SCHEMA_VERSION);
    expect(s.projects).toMatchObject([{ id: "p1", name: "Old project", githubRepo: null }]);
    expect(s.tasks).toMatchObject([{ id: "t1", title: "Old task", projectId: "p1" }]);
    expect(s.notes).toMatchObject([{ id: "n1", taskId: "t1" }]);
    expect(s.services).toEqual([]);
    rebuilt.close();
  });

  it("refuses a file with a trigger, and leaves nothing staged", async () => {
    const backup = await makeBackup("trigger.db");
    const db = new DatabaseSync(backup);
    db.exec("CREATE TRIGGER sneaky AFTER INSERT ON notes BEGIN DELETE FROM tasks; END");
    db.close();
    expect(() => stageRestore(backup, file("staged.db"))).toThrow(/cannot be restored/);
    expect(fs.existsSync(file("staged.db"))).toBe(false);
  });

  it("refuses rows that point at something that is not there, and leaves nothing staged", async () => {
    const backup = await makeBackup("orphan.db");
    const db = new DatabaseSync(backup);
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES ('orphan', 'no-such-project', 'Lost', 1, 1)");
    db.close();
    expect(() => stageRestore(backup, file("staged.db"))).toThrow(/point at things that are not in the backup/);
    expect(fs.existsSync(file("staged.db"))).toBe(false);
    expect(fs.existsSync(file("staged.db.src"))).toBe(false);
  });

  it("refuses rows the schema's own rules reject, naming the table", async () => {
    const backup = await makeBackup("bad-status.db");
    const db = new DatabaseSync(backup);
    // Take away the CHECK by rebuilding the table, then plant a status the app never writes.
    db.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE tasks RENAME TO tasks_old;
      CREATE TABLE tasks AS SELECT * FROM tasks_old;
      DROP TABLE tasks_old;
      UPDATE tasks SET status = 'sideways' WHERE title = 'Ship it';
    `);
    db.close();
    expect(() => stageRestore(backup, file("staged.db"))).toThrow(/cannot be restored/);
    expect(fs.existsSync(file("staged.db"))).toBe(false);
  });

  it("does not fail on a file that is not a database at all", () => {
    const text = file("text.db");
    fs.writeFileSync(text, "hello");
    expect(() => stageRestore(text, file("staged.db"))).toThrow(/cannot be restored/);
  });
});

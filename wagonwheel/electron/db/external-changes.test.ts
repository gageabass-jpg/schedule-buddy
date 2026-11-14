import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./database.js";
import { Workspace } from "./repo.js";
import { watchForOtherWriters } from "./external-changes.js";

let dir: string;
const open: DatabaseSync[] = [];
const connect = (file: string): DatabaseSync => { const db = openDatabase(file); open.push(db); return db; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-ext-")); });
afterEach(() => { for (const db of open.splice(0)) { try { db.close(); } catch { /* closed */ } } fs.rmSync(dir, { recursive: true, force: true }); });

describe("watchForOtherWriters", () => {
  it("fires when another connection changes the file, and not for this connection's own changes", () => {
    const file = path.join(dir, "w.db");
    const mine = connect(file);
    const theirs = connect(file);
    let fired = 0;
    const w = watchForOtherWriters(() => mine, () => { fired++; }, 60_000);

    w.check();
    expect(fired).toBe(0);
    new Workspace(mine).createProject({ name: "Made here" });       // the app's own write
    w.check();
    expect(fired).toBe(0);

    new Workspace(theirs).createProject({ name: "Made by Claude Code" });   // another process's write
    w.check();
    expect(fired).toBe(1);
    w.check();
    expect(fired).toBe(1);                                         // once per change, not on every look

    new Workspace(theirs).createProject({ name: "Another" });
    w.check();
    expect(fired).toBe(2);
    w.stop();
  });

  it("starts counting afresh on a new connection instead of reporting the swap as a change", () => {
    const file = path.join(dir, "w.db");
    let db = connect(file);
    const other = connect(file);
    let fired = 0;
    const w = watchForOtherWriters(() => db, () => { fired++; }, 60_000);
    w.check();
    new Workspace(other).createProject({ name: "x" });
    db = connect(file);                                            // what a restore or "start fresh" does
    w.check();
    expect(fired).toBe(0);
    new Workspace(other).createProject({ name: "y" });
    w.check();
    expect(fired).toBe(1);
    w.stop();
  });

  it("does nothing while there is no database, and survives one that is closed", () => {
    const file = path.join(dir, "w.db");
    const db = connect(file);
    let current: DatabaseSync | null = null;
    let fired = 0;
    const w = watchForOtherWriters(() => current, () => { fired++; }, 60_000);
    w.check();
    current = db;
    w.check();
    db.close();
    expect(() => w.check()).not.toThrow();
    expect(fired).toBe(0);
    w.stop();
  });

  it("checks on its own timer", async () => {
    const file = path.join(dir, "w.db");
    const mine = connect(file);
    const theirs = connect(file);
    let fired = 0;
    const w = watchForOtherWriters(() => mine, () => { fired++; }, 15);
    new Workspace(theirs).createProject({ name: "later" });
    await new Promise((r) => setTimeout(r, 120));
    w.stop();
    expect(fired).toBe(1);
  });
});

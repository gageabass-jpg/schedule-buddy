import { DatabaseSync, backup } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { APP_BUSY_TIMEOUT_MS } from "./busy.js";
import { AppError } from "./errors.js";
import { MIGRATIONS, SCHEMA_VERSION, type Migration } from "./migrations.js";

// node:sqlite is part of Node (and so of Electron). It is marked experimental in
// Node. Every call to it lives in electron/db/, so a change in its API stays here.

export { SCHEMA_VERSION };

const userVersion = (db: DatabaseSync): number =>
  Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);

/** Open (and create, and migrate) the database file. Throws AppError("database").
 *  `busyTimeoutMs` is how long this connection waits for another writer before giving up. */
export function openDatabase(file: string, busyTimeoutMs: number = APP_BUSY_TIMEOUT_MS): DatabaseSync {
  let db: DatabaseSync | null = null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existed = fs.existsSync(file);
    db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))}`);
    migrate(db, existed ? file : null);
    return db;
  } catch (err) {
    try { db?.close(); } catch { /* already closed */ }
    if (err instanceof AppError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new AppError(
      "database",
      `The workspace database could not be opened (${reason}). The file is ${file}.`,
    );
  }
}

/** Bring the schema up to date. Each migration runs in one transaction.
 *  `backupOf` is the file to copy aside first, when the database already holds data. */
export function migrate(
  db: DatabaseSync,
  backupOf: string | null = null,
  migrations: Migration[] = MIGRATIONS,   // a parameter so tests can add a v2
): void {
  const current = userVersion(db);
  const latest = migrations[migrations.length - 1].version;
  if (current > latest) {
    throw new AppError(
      "database",
      `This database was made by a newer version of Nucleus Wagonwheel (schema ${current}; this version understands up to ${latest}). Update the app to open it.`,
    );
  }
  const pending = migrations.filter((m) => m.version > current);
  if (pending.length === 0) return;

  // A database with data in it gets a copy before it changes shape.
  if (backupOf && current > 0) {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    fs.copyFileSync(backupOf, `${backupOf}.before-v${pending[0].version}.bak`);
  }

  for (const m of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new AppError(
        "database",
        `Updating the database to version ${m.version} (${m.name}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** A consistent single-file copy of the live database. WAL mode is handled by SQLite. */
export async function backupDatabase(db: DatabaseSync, destination: string): Promise<void> {
  try {
    await backup(db, destination);
  } catch (err) {
    throw new AppError("database", `The backup could not be written: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Is this file a Wagonwheel database this version can restore from? Throws AppError("validation"). */
export function checkBackupFile(file: string): void {
  let probe: DatabaseSync | null = null;
  try {
    probe = new DatabaseSync(file, { readOnly: true });
    const check = probe.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (check.integrity_check !== "ok") throw new Error("the file failed SQLite's integrity check");
    const version = userVersion(probe);
    if (version < 1) throw new Error("it is not a Wagonwheel database");
    if (version > SCHEMA_VERSION) {
      throw new Error(`it was made by a newer version of the app (schema ${version})`);
    }
    const tables = new Set(
      (probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name),
    );
    for (const t of ["projects", "tasks", "milestones", "notes", "settings"]) {
      if (!tables.has(t)) throw new Error(`the ${t} table is missing`);
    }
  } catch (err) {
    throw new AppError(
      "validation",
      `That file cannot be restored: ${err instanceof Error ? err.message : String(err)}.`,
    );
  } finally {
    try { probe?.close(); } catch { /* already closed */ }
  }
}

/** Put a checked backup in place of the database file. The caller closes its own
 *  handle first, and copies the live database aside before calling this. */
export function replaceDatabaseFile(file: string, source: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    try { fs.rmSync(file + suffix, { force: true }); } catch { /* none */ }
  }
  fs.copyFileSync(source, file);
}

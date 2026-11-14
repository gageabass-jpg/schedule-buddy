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

/**
 * Every table this app owns, parents before the tables that point at them. A restore copies the rows of
 * these tables, and nothing else, out of a backup. A test keeps this list equal to the schema, so a
 * migration that adds a table cannot be forgotten here.
 */
export const OWNED_TABLES = ["projects", "tasks", "milestones", "notes", "settings", "services", "service_charges"] as const;

/** The tables a backup of any version has: the ones the first migration made. */
const REQUIRED_TABLES: readonly string[] = ["projects", "tasks", "milestones", "notes", "settings"];

/** Is this file a Wagonwheel database this version can restore from? Throws AppError("validation").
 *  Only tables of this app and plain indexes are accepted: a trigger, a view, a virtual table or a table
 *  the app does not use means the file is not a backup this app made. */
export function checkBackupFile(file: string): void {
  let probe: DatabaseSync | null = null;
  try {
    probe = new DatabaseSync(file, { readOnly: true });
    // Nothing in the file's own schema may run while it is read.
    probe.exec("PRAGMA trusted_schema = OFF");
    const check = probe.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (check.integrity_check !== "ok") throw new Error("the file failed SQLite's integrity check");
    const version = userVersion(probe);
    if (version < 1) throw new Error("it is not a Wagonwheel database");
    if (version > SCHEMA_VERSION) {
      throw new Error(`it was made by a newer version of the app (schema ${version})`);
    }
    const objects = probe.prepare("SELECT type, name, sql FROM sqlite_master").all() as { type: string; name: string; sql: string | null }[];
    const owned = new Set<string>(OWNED_TABLES);
    const tables = new Set<string>();
    for (const o of objects) {
      if (o.type === "table") {
        if (/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(o.sql ?? "")) throw new Error(`it has a virtual table (${o.name}), which this app never makes`);
        // SQLite's own bookkeeping tables are harmless: nothing is copied from them.
        if (owned.has(o.name)) tables.add(o.name);
        else if (!o.name.startsWith("sqlite_")) throw new Error(`it has a table this app does not use (${o.name})`);
      } else if (o.type === "trigger") {
        throw new Error(`it has a trigger (${o.name}), which this app never makes`);
      } else if (o.type === "view") {
        throw new Error(`it has a view (${o.name}), which this app never makes`);
      } else if (o.type !== "index") {
        throw new Error(`it has something this app does not use (${o.type} ${o.name})`);
      }
    }
    for (const t of REQUIRED_TABLES) {
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

const quote = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

/**
 * Build a new database file at `staged` that holds the rows of the backup at `source`, and nothing else.
 *
 * A backup is not trusted as a file: SQLite keeps a database's whole schema (triggers, views, indexes) inside
 * it, so putting a stranger's file in place of ours would run whatever it carries. Instead the app's own schema
 * is built fresh, and only the rows of the tables the app owns are copied in, column by column. A backup from an
 * older version works too: it gets the columns it has, and the newer ones take their defaults.
 *
 * Throws AppError("validation") if the backup is not usable; `staged` is gone then. The caller deletes it when
 * it is done with it.
 */
export function stageRestore(source: string, staged: string): void {
  const readCopy = `${staged}.src`;
  const clear = (): void => {
    for (const f of [staged, readCopy]) {
      for (const suffix of ["", "-wal", "-shm", "-journal"]) {
        try { fs.rmSync(f + suffix, { force: true }); } catch { /* none */ }
      }
    }
  };
  clear();
  let fresh: DatabaseSync | null = null;
  try {
    // Everything reads a copy, so opening the backup can never leave a -wal or -shm file next to the person's original.
    fs.copyFileSync(source, readCopy);
    checkBackupFile(readCopy);
    fresh = openDatabase(staged);
    fresh.exec("PRAGMA trusted_schema = OFF");
    // Parents are copied before the rows that point at them, but a task's parent is a task, so the check
    // comes after the copy, for everything at once.
    fresh.exec("PRAGMA foreign_keys = OFF");
    fresh.prepare("ATTACH DATABASE ? AS backup").run(readCopy);

    const columnsOf = (schema: "main" | "backup", table: string): string[] =>
      (fresh!.prepare(`PRAGMA ${schema}.table_info(${quote(table)})`).all() as { name: string }[]).map((c) => c.name);

    for (const table of OWNED_TABLES) {
      const have = columnsOf("backup", table);
      if (have.length === 0) continue;   // a backup from before this table existed
      const theirs = new Set(have);
      const cols = columnsOf("main", table).filter((c) => theirs.has(c)).map(quote).join(", ");
      try {
        fresh.exec(`INSERT INTO main.${quote(table)} (${cols}) SELECT ${cols} FROM backup.${quote(table)}`);
      } catch (err) {
        throw new Error(`the ${table} could not be read in (${err instanceof Error ? err.message : String(err)})`, { cause: err });
      }
    }

    const dangling = fresh.prepare("PRAGMA foreign_key_check").all() as { table: string }[];
    if (dangling.length > 0) throw new Error(`some ${dangling[0].table} rows point at things that are not in the backup`);
    const check = fresh.prepare("PRAGMA main.integrity_check").get() as { integrity_check: string };
    if (check.integrity_check !== "ok") throw new Error("the rebuilt workspace failed SQLite's integrity check");

    fresh.exec("DETACH DATABASE backup");
    fresh.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    fresh.close();
    fresh = null;
    for (const suffix of ["-wal", "-shm"]) {
      try { fs.rmSync(readCopy + suffix, { force: true }); } catch { /* none */ }
    }
    fs.rmSync(readCopy, { force: true });
  } catch (err) {
    try { fresh?.close(); } catch { /* already closed */ }
    clear();
    if (err instanceof AppError) throw err;
    throw new AppError(
      "validation",
      `That file cannot be restored: ${err instanceof Error ? err.message : String(err)}.`,
    );
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

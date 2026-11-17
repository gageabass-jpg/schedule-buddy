import type { DatabaseSync } from "node:sqlite";
import { AppError } from "./errors.js";

/**
 * The app and Claude Code's connector are two connections to one file. SQLite lets only one of them write
 * at a time; the other waits up to `busy_timeout` and then fails with SQLITE_BUSY ("database is locked").
 * These helpers are what a writer does about that.
 */

/** How long the app's own connection waits for the other writer. The window stops while it waits, so this stays short. */
export const APP_BUSY_TIMEOUT_MS = 5_000;
/** The connector has no window to freeze, so it waits longer. */
export const CONNECTOR_BUSY_TIMEOUT_MS = 10_000;
/** How many more times the connector tries to start a write after the wait runs out. */
export const CONNECTOR_BEGIN_RETRIES = 2;

/** SQLITE_BUSY is 5 and SQLITE_LOCKED is 6; the low byte of the code says which, whatever the extended code adds. */
export function isBusy(err: unknown): boolean {
  const code = (err as { errcode?: unknown } | null)?.errcode;
  if (typeof code !== "number") return false;
  const base = code & 0xff;
  return base === 5 || base === 6;
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Start a write transaction. This is the one place a retry is always safe: `BEGIN IMMEDIATE` takes the
 * write lock before anything has run, so a failure here has changed nothing. (Retrying a whole tool call
 * would not be safe, since part of it may already have been written.) When every try is busy the person
 * gets a sentence they can act on instead of SQLite's.
 */
export function beginImmediate(
  db: Pick<DatabaseSync, "exec">,
  retries = 0,
  wait: (ms: number) => void = pause,
): void {
  for (let attempt = 0; ; attempt++) {
    try {
      db.exec("BEGIN IMMEDIATE");
      return;
    } catch (err) {
      if (!isBusy(err)) throw err;
      if (attempt >= retries) {
        throw new AppError("database", "Wagonwheel is busy saving another change. Wait a moment and try again.");
      }
      wait(250 * (attempt + 1));
    }
  }
}

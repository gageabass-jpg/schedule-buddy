import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { AppError } from "./errors.js";
import { APP_BUSY_TIMEOUT_MS, beginImmediate, CONNECTOR_BUSY_TIMEOUT_MS, isBusy } from "./busy.js";
import { openDatabase } from "./database.js";
import { Workspace } from "./repo.js";

const busyError = (errcode = 5): Error => Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR", errcode });

describe("isBusy", () => {
  it("recognises SQLITE_BUSY and SQLITE_LOCKED, with or without an extended code", () => {
    expect(isBusy(busyError(5))).toBe(true);
    expect(isBusy(busyError(6))).toBe(true);
    expect(isBusy(busyError(5 | (2 << 8)))).toBe(true);   // an extended BUSY code
  });

  it("does not mistake other errors for it", () => {
    expect(isBusy(busyError(19))).toBe(false);   // a constraint failure
    expect(isBusy(new Error("nope"))).toBe(false);
    expect(isBusy(null)).toBe(false);
    expect(isBusy("database is locked")).toBe(false);
  });
});

describe("beginImmediate", () => {
  it("starts the transaction straight away when nothing is in the way", () => {
    const exec = vi.fn();
    beginImmediate({ exec }, 2, vi.fn());
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("BEGIN IMMEDIATE");
  });

  it("tries again after a busy answer, waiting a little longer each time", () => {
    const exec = vi.fn().mockImplementationOnce(() => { throw busyError(); }).mockImplementationOnce(() => { throw busyError(); });
    const wait = vi.fn();
    beginImmediate({ exec }, 2, wait);
    expect(exec).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map((c) => c[0])).toEqual([250, 500]);
  });

  it("gives up with a sentence a person can act on once the retries are used", () => {
    const exec = vi.fn(() => { throw busyError(); });
    let caught: unknown;
    try { beginImmediate({ exec }, 2, vi.fn()); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("database");
    expect((caught as AppError).message).toBe("Wagonwheel is busy saving another change. Wait a moment and try again.");
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it("does not retry when no retries are allowed, as in the app", () => {
    const exec = vi.fn(() => { throw busyError(); });
    expect(() => beginImmediate({ exec }, 0, vi.fn())).toThrow(AppError);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("lets any other error through untouched, and does not retry it", () => {
    const boom = new Error("disk I/O error");
    const exec = vi.fn(() => { throw boom; });
    expect(() => beginImmediate({ exec }, 2, vi.fn())).toThrow(boom);
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe("two connections to one file", () => {
  let dir: string | null = null;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null; });

  const setup = (): { file: string } => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-busy-"));
    return { file: path.join(dir, "wagonwheel.db") };
  };
  const timeoutOf = (db: DatabaseSync): number => Number((db.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout);

  it("gives the connector a longer wait than the app", () => {
    const { file } = setup();
    const app = openDatabase(file);
    const connector = openDatabase(file, CONNECTOR_BUSY_TIMEOUT_MS);
    expect(timeoutOf(app)).toBe(APP_BUSY_TIMEOUT_MS);
    expect(timeoutOf(connector)).toBe(CONNECTOR_BUSY_TIMEOUT_MS);
    expect(CONNECTOR_BUSY_TIMEOUT_MS).toBeGreaterThan(APP_BUSY_TIMEOUT_MS);
    app.close(); connector.close();
  });

  it("a write waits out the other writer's lock and then goes through", () => {
    const { file } = setup();
    const holder = openDatabase(file);
    const writer = openDatabase(file, 20);   // a short wait, so the first try runs out of time
    holder.exec("BEGIN IMMEDIATE");
    // The first try is busy; the lock is let go before the second.
    const ws = new Workspace(writer, undefined, undefined, undefined, 1);
    const real = writer.exec.bind(writer);
    let tries = 0;
    writer.exec = ((sql: string): void => {
      if (sql === "BEGIN IMMEDIATE" && ++tries === 2) holder.exec("ROLLBACK");
      real(sql);
    }) as typeof writer.exec;
    const change = ws.createProject({ name: "Made while the other side was writing" });
    expect(tries).toBe(2);
    expect(change.snapshot.projects.map((p) => p.name)).toEqual(["Made while the other side was writing"]);
    holder.close(); writer.close();
  });

  it("with no retries, a busy file is reported plainly and nothing is written", () => {
    const { file } = setup();
    const holder = openDatabase(file);
    const writer = openDatabase(file, 20);
    holder.exec("BEGIN IMMEDIATE");
    const ws = new Workspace(writer);
    expect(() => ws.createProject({ name: "Blocked" })).toThrow("Wagonwheel is busy saving another change");
    holder.exec("ROLLBACK");
    expect(ws.snapshot().projects).toHaveLength(0);
    holder.close(); writer.close();
  });
});

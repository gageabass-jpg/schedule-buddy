import type { DatabaseSync } from "node:sqlite";

/**
 * Notices when something other than this connection changes the database (Claude Code, through the
 * Wagonwheel connector, writes to the same file while the app is open), so the window can refresh.
 *
 * SQLite's `PRAGMA data_version` is made for this: on a connection it changes only when ANOTHER
 * connection commits, never for the connection's own writes, so the app's own changes cause no
 * refresh. Reading it is cheap, so it is checked every second.
 */
export function watchForOtherWriters(
  getDb: () => DatabaseSync | null,
  onChange: () => void,
  intervalMs = 1000,
): { stop(): void; check(): void } {
  let handle: DatabaseSync | null = null;
  let seen: number | null = null;

  const check = (): void => {
    const db = getDb();
    if (!db) { handle = null; seen = null; return; }
    try {
      const now = Number((db.prepare("PRAGMA data_version").get() as { data_version: number }).data_version);
      // A new connection (after a restore, say) starts its count from where it is; the window reloads on its own then.
      if (db !== handle) { handle = db; seen = now; return; }
      if (seen !== null && now !== seen) onChange();
      seen = now;
    } catch {
      // closed or busy: look again next time
    }
  };

  const timer = setInterval(check, intervalMs);
  timer.unref?.();
  check();
  return { stop: () => clearInterval(timer), check };
}

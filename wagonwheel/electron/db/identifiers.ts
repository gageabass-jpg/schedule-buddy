import type { DatabaseSync } from "node:sqlite";
import { suggestProjectKey } from "../../shared/project-key.js";
import { beginImmediate } from "./busy.js";

// A project's key and its tasks' numbers (RXM-4). The migration that added the columns leaves them empty for what
// was already here; this fills them in. It also runs after a restore from a backup that was made before they existed.
// It is idempotent: with nothing missing it reads and returns, and never takes the write lock.

/**
 * The number the next task in a project gets, and counts it. It only goes up: a task that is deleted, or moved to
 * another project, leaves its number behind, so an identifier in a note or a commit message never points at a different
 * task later. Call it inside a transaction.
 */
export function allocateTaskNumber(db: DatabaseSync, projectId: string): number {
  const row = db
    .prepare(
      `SELECT p.next_task_number AS next, (SELECT coalesce(max(number), 0) FROM tasks WHERE project_id = p.id) AS top
         FROM projects p WHERE p.id = ?`,
    )
    .get(projectId) as { next: number; top: number } | undefined;
  if (!row) throw new Error("allocateTaskNumber: no such project");
  // `next` can only lag behind the largest number if a file was edited by hand; never hand out one that is in use.
  const n = Math.max(Number(row.next), Number(row.top) + 1);
  db.prepare("UPDATE projects SET next_task_number = ? WHERE id = ?").run(n + 1, projectId);
  return n;
}

/** Give every project without a key one, and every task in a project without a number one. Oldest first, so the order the work was made in is the order it is numbered in. */
export function backfillIdentifiers(db: DatabaseSync, beginRetries = 0): void {
  const missing = db
    .prepare(
      `SELECT (SELECT count(*) FROM projects WHERE key IS NULL) AS projects,
              (SELECT count(*) FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.number IS NULL) AS tasks`,
    )
    .get() as { projects: number; tasks: number };
  if (Number(missing.projects) === 0 && Number(missing.tasks) === 0) return;

  beginImmediate(db, beginRetries);
  try {
    // Read again now that the write lock is held: the app and the connector open the same file, and the other one may have done this.
    const taken = new Set(
      (db.prepare("SELECT upper(key) AS key FROM projects WHERE key IS NOT NULL").all() as { key: string }[]).map((r) => r.key),
    );
    const unkeyed = db.prepare("SELECT id, name FROM projects WHERE key IS NULL ORDER BY created_at, id").all() as { id: string; name: string }[];
    const setKey = db.prepare("UPDATE projects SET key = ? WHERE id = ?");
    for (const p of unkeyed) {
      const key = suggestProjectKey(p.name, taken);
      taken.add(key);
      setKey.run(key, p.id);
    }

    const projects = db
      // A task whose project is not there (a damaged backup) is left alone: the restore's own check names it, in words.
      .prepare("SELECT DISTINCT t.project_id AS id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.number IS NULL")
      .all() as { id: string }[];
    const unnumbered = db.prepare("SELECT id FROM tasks WHERE project_id = ? AND number IS NULL ORDER BY created_at, rowid");
    const setNumber = db.prepare("UPDATE tasks SET number = ? WHERE id = ?");
    for (const p of projects) {
      for (const t of unnumbered.all(p.id) as { id: string }[]) setNumber.run(allocateTaskNumber(db, p.id), t.id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

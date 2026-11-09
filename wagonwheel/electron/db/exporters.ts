import type { Snapshot } from "../../shared/types.js";

// Pure functions: a Snapshot in, file text out. The dialogs and the disk are in ipc.ts.

const iso = (ms: number | null): string => (ms == null ? "" : new Date(ms).toISOString());

/** One CSV cell. A cell that starts with = + - @ would run as a formula in Excel or
 *  Numbers, so it gets a leading apostrophe. Quotes follow RFC 4180. */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  // The BOM makes Excel read the file as UTF-8. CRLF is what RFC 4180 asks for.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function buildCsvFiles(s: Snapshot): Record<string, string> {
  const projectName = new Map(s.projects.map((p) => [p.id, p.name]));
  const taskTitle = new Map(s.tasks.map((t) => [t.id, t.title]));

  const topLevel = s.tasks.filter((t) => !t.parentId);
  const counts = (projectId: string) => {
    const mine = topLevel.filter((t) => t.projectId === projectId);
    return { done: mine.filter((t) => t.status === "done").length, total: mine.length };
  };

  return {
    "projects.csv": csv(
      ["id", "name", "status", "archived", "color", "start_date", "target_date", "tasks_done", "tasks_total", "description", "created_at", "updated_at"],
      s.projects.map((p) => {
        const c = counts(p.id);
        return [p.id, p.name, p.status, p.archivedAt ? "yes" : "no", p.color, p.startDate, p.targetDate, c.done, c.total, p.description, iso(p.createdAt), iso(p.updatedAt)];
      }),
    ),
    "tasks.csv": csv(
      ["id", "project", "parent_task", "title", "status", "priority", "start_date", "due_date", "completed_at", "description", "created_at", "updated_at"],
      s.tasks.map((t) => [
        t.id, t.projectId ? projectName.get(t.projectId) ?? "" : "(inbox)", t.parentId ? taskTitle.get(t.parentId) ?? "" : "",
        t.title, t.status, t.priority, t.startDate, t.dueDate, iso(t.completedAt), t.description, iso(t.createdAt), iso(t.updatedAt),
      ]),
    ),
    "milestones.csv": csv(
      ["id", "project", "name", "target_date", "completed_at", "description", "created_at", "updated_at"],
      s.milestones.map((m) => [m.id, projectName.get(m.projectId) ?? "", m.name, m.targetDate, iso(m.completedAt), m.description, iso(m.createdAt), iso(m.updatedAt)]),
    ),
    "notes.csv": csv(
      ["id", "project", "task", "body", "created_at", "updated_at"],
      s.notes.map((n) => [
        n.id, n.projectId ? projectName.get(n.projectId) ?? "" : "", n.taskId ? taskTitle.get(n.taskId) ?? "" : "",
        n.body, iso(n.createdAt), iso(n.updatedAt),
      ]),
    ),
  };
}

export function buildJsonExport(s: Snapshot, schemaVersion: number, exportedAt: number): string {
  return JSON.stringify(
    {
      app: "Nucleus Wagonwheel",
      format: 1,
      schemaVersion,
      exportedAt: new Date(exportedAt).toISOString(),
      settings: s.settings,
      projects: s.projects,
      tasks: s.tasks,
      milestones: s.milestones,
      notes: s.notes,
    },
    null,
    2,
  );
}

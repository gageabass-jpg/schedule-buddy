import { TASK_STATUSES, type Project, type Snapshot, type Task, type TaskStatus } from "@shared/types";
import { liveProjects } from "./derive";

// The Board's data: a row for each project, a column for each status, the tasks that belong in each cell. Pure, so it is tested without a window.

/** How many chips a cell shows before it folds the rest under "+N more". Closed columns fold early: a project accumulates Complete tasks without end. */
export const CELL_LIMIT: Record<TaskStatus, number> = { not_started: 12, in_progress: 12, stalled: 12, done: 3, discontinued: 3 };

/** The columns that hold finished or cancelled work, which "Show all closed" opens up. */
export const CLOSED_STATUSES: readonly TaskStatus[] = ["done", "discontinued"];
export const isClosedColumn = (status: TaskStatus): boolean => CLOSED_STATUSES.includes(status);

export interface BoardRow {
  project: Project;
  /** The project's top-level tasks in each status, in the order the cell shows them. */
  cells: Record<TaskStatus, Task[]>;
  open: number;
  closed: number;
}

export interface Board {
  rows: BoardRow[];
  /** Tasks in each status across every row. */
  totals: Record<TaskStatus, number>;
  tasks: number;
}

const emptyCells = (): Record<TaskStatus, Task[]> => ({ not_started: [], in_progress: [], stalled: [], done: [], discontinued: [] });

/** The time a closed task was closed: when it was completed, or, for one that was cancelled, when it was last changed. */
const closedAt = (t: Task): number => t.completedAt ?? t.updatedAt;

/** Open columns read in identifier order (RXM-1, RXM-2, …), which is the order the work was thought of in; a closed column puts the latest first. */
export function compareInCell(status: TaskStatus): (a: Task, b: Task) => number {
  if (isClosedColumn(status)) return (a, b) => closedAt(b) - closedAt(a) || a.createdAt - b.createdAt;
  return (a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.createdAt - b.createdAt;
}

/**
 * One row per project that is not archived, in the order the projects were made. Only top-level tasks are on the board
 * (a subtask is part of its task) and a task with no project is not (it has no row to be in).
 */
export function buildBoard(s: Snapshot): Board {
  const rows: BoardRow[] = liveProjects(s).map((project) => ({ project, cells: emptyCells(), open: 0, closed: 0 }));
  const byProject = new Map(rows.map((r) => [r.project.id, r]));
  const totals = Object.fromEntries(TASK_STATUSES.map((st) => [st, 0])) as Record<TaskStatus, number>;
  let tasks = 0;
  for (const t of s.tasks) {
    if (t.parentId || !t.projectId) continue;
    const row = byProject.get(t.projectId);
    if (!row) continue;   // in an archived project
    row.cells[t.status].push(t);
    totals[t.status]++;
    tasks++;
    if (isClosedColumn(t.status)) row.closed++; else row.open++;
  }
  for (const row of rows) for (const st of TASK_STATUSES) row.cells[st].sort(compareInCell(st));
  return { rows, totals, tasks };
}

/** What a cell shows: all of its tasks when `expanded`, else the first few, and how many are folded away. */
export function visibleInCell(tasks: Task[], status: TaskStatus, expanded: boolean): { shown: Task[]; hidden: number } {
  const limit = CELL_LIMIT[status];
  if (expanded || tasks.length <= limit) return { shown: tasks, hidden: 0 };
  return { shown: tasks.slice(0, limit), hidden: tasks.length - limit };
}

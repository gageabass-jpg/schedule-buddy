import type { Milestone, Project, Snapshot, Task } from "@shared/types";
import { addDays, diffDays, formatShort, relativeDay } from "./dates";

// Everything the views compute from a Snapshot. Pure, so it is tested without a window.

// ── Basics ──────────────────────────────────────────────────────────────────

export const isOpen = (t: Task): boolean => t.status !== "done";
export const isOverdue = (t: Task, today: string): boolean => isOpen(t) && !!t.dueDate && t.dueDate < today;

/** Most recently active first. Ties (two projects touched in the same millisecond) are settled
 *  by creation time, then name, then id, so the order never depends on a random id. */
export function compareByActivity(a: Project, b: Project): number {
  return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const byId = <T extends { id: string }>(items: T[]): Map<string, T> => new Map(items.map((i) => [i.id, i]));

/** Tasks in a project that has not been archived, and tasks with no project (the inbox). */
export function visibleTasks(s: Snapshot): Task[] {
  const archived = new Set(s.projects.filter((p) => p.archivedAt).map((p) => p.id));
  return s.tasks.filter((t) => !t.projectId || !archived.has(t.projectId));
}

export function liveProjects(s: Snapshot): Project[] {
  return s.projects.filter((p) => !p.archivedAt);
}

/** Unsorted: no project, not a subtask, not finished. This is the sidebar count. */
export const inboxTasks = (tasks: Task[]): Task[] =>
  tasks.filter((t) => !t.projectId && !t.parentId && isOpen(t)).sort((a, b) => b.createdAt - a.createdAt);

export const subtasksOf = (tasks: Task[], parentId: string): Task[] =>
  tasks.filter((t) => t.parentId === parentId).sort((a, b) => a.createdAt - b.createdAt);

export interface Progress { done: number; total: number; pct: number }

/** Share of a project's top-level tasks that are done. Subtasks are part of their task. */
export function projectProgress(projectId: string, tasks: Task[]): Progress {
  const mine = tasks.filter((t) => t.projectId === projectId && !t.parentId);
  const done = mine.filter((t) => t.status === "done").length;
  return { done, total: mine.length, pct: mine.length ? Math.round((done / mine.length) * 100) : 0 };
}

/** Subtask counts for the "2/5" chip on a task row. */
export function subtaskProgress(parentId: string, tasks: Task[]): { done: number; total: number } {
  const subs = tasks.filter((t) => t.parentId === parentId);
  return { done: subs.filter((t) => t.status === "done").length, total: subs.length };
}

// ── Priority order ──────────────────────────────────────────────────────────

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/** Open first, then soonest due (no date last), then highest priority, then oldest. */
export function compareTasks(a: Task, b: Task): number {
  if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt;
}

// ── The calendar ────────────────────────────────────────────────────────────

export interface DayMarkers {
  /** Open tasks due this day. */
  due: number;
  /** Of those, how many were due before today. */
  overdue: number;
  /** Open tasks that start this day. */
  starts: number;
  /** Milestones that are not yet complete. */
  milestones: number;
  /** Projects whose target date this is. */
  deadlines: number;
}

const blank = (): DayMarkers => ({ due: 0, overdue: 0, starts: 0, milestones: 0, deadlines: 0 });

/** What is on each day, for the sidebar calendar. Only days that have something are in the map. */
export function dayMarkers(s: Snapshot, today: string): Map<string, DayMarkers> {
  const out = new Map<string, DayMarkers>();
  const at = (iso: string): DayMarkers => {
    let m = out.get(iso);
    if (!m) { m = blank(); out.set(iso, m); }
    return m;
  };
  for (const t of visibleTasks(s)) {
    if (!isOpen(t)) continue;
    if (t.dueDate) {
      const m = at(t.dueDate);
      m.due++;
      if (t.dueDate < today) m.overdue++;
    }
    if (t.startDate) at(t.startDate).starts++;
  }
  const live = new Set(liveProjects(s).map((p) => p.id));
  for (const ms of s.milestones) if (!ms.completedAt && live.has(ms.projectId)) at(ms.targetDate).milestones++;
  for (const p of liveProjects(s)) if (p.targetDate && p.status !== "completed") at(p.targetDate).deadlines++;
  return out;
}

export const markerTotal = (m: DayMarkers | undefined): number => (m ? m.due + m.starts + m.milestones + m.deadlines : 0);

/** One line for a tooltip: "2 tasks due · 1 milestone". */
export function describeMarkers(m: DayMarkers | undefined): string {
  if (!m) return "";
  const bits: string[] = [];
  if (m.due) bits.push(`${m.due} ${m.due === 1 ? "task" : "tasks"} due${m.overdue ? ` (${m.overdue} overdue)` : ""}`);
  if (m.starts) bits.push(`${m.starts} ${m.starts === 1 ? "task starts" : "tasks start"}`);
  if (m.milestones) bits.push(`${m.milestones} ${m.milestones === 1 ? "milestone" : "milestones"}`);
  if (m.deadlines) bits.push(`${m.deadlines} project ${m.deadlines === 1 ? "deadline" : "deadlines"}`);
  return bits.join(" · ");
}

export interface DayContents {
  due: Task[];
  starting: Task[];
  milestones: Milestone[];
  deadlines: Project[];
  /** Only for today: open tasks that were due before it. */
  overdue: Task[];
}

export function dayContents(s: Snapshot, iso: string, today: string): DayContents {
  const tasks = visibleTasks(s);
  const live = new Set(liveProjects(s).map((p) => p.id));
  return {
    due: tasks.filter((t) => t.dueDate === iso).sort(compareTasks),
    starting: tasks.filter((t) => t.startDate === iso && isOpen(t)).sort(compareTasks),
    milestones: s.milestones.filter((m) => m.targetDate === iso && live.has(m.projectId)),
    deadlines: liveProjects(s).filter((p) => p.targetDate === iso),
    overdue: iso === today ? tasks.filter((t) => isOverdue(t, today)).sort(compareTasks) : [],
  };
}

// ── The dashboard ───────────────────────────────────────────────────────────

export interface Attention { task: Task; reason: string }

export interface Dashboard {
  openTasks: number;
  activeProjects: Project[];
  overdue: Task[];
  dueSoon: Task[];
  milestones: Milestone[];
  recent: Project[];
  attention: Attention[];
}

const DUE_SOON_DAYS = 14;
const STALE_DAYS = 7;
const DAY_MS = 86_400_000;

export function dashboard(s: Snapshot, today: string, nowMs: number): Dashboard {
  const tasks = visibleTasks(s);
  const live = liveProjects(s);
  const open = tasks.filter(isOpen);
  const overdue = open.filter((t) => isOverdue(t, today)).sort(compareTasks);
  const dueSoon = open
    .filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= addDays(today, DUE_SOON_DAYS))
    .sort(compareTasks);

  // What falls through the cracks: work that Overdue and Due soon do not already show.
  //  - high priority and no date at all (nothing will ever remind you of it);
  //  - "in progress" for a week without being touched (it has probably stalled).
  const listed = new Set([...overdue, ...dueSoon].map((t) => t.id));
  const attention: Attention[] = [];
  for (const t of open) {
    if (listed.has(t.id)) continue;
    if (t.priority === "high" && !t.dueDate && t.status === "not_started") {
      attention.push({ task: t, reason: "High priority · no due date" });
    } else if (t.status === "in_progress" && nowMs - t.updatedAt >= STALE_DAYS * DAY_MS) {
      const days = Math.floor((nowMs - t.updatedAt) / DAY_MS);
      attention.push({ task: t, reason: `In progress · untouched ${days} days` });
    }
  }
  attention.sort((a, b) => compareTasks(a.task, b.task));

  const liveIds = new Set(live.map((p) => p.id));
  const milestones = s.milestones
    .filter((m) => !m.completedAt && liveIds.has(m.projectId))
    .sort((a, b) => (a.targetDate < b.targetDate ? -1 : a.targetDate > b.targetDate ? 1 : 0))
    .slice(0, 6);

  return {
    openTasks: open.length,
    activeProjects: live.filter((p) => p.status !== "completed").sort(compareByActivity),
    overdue,
    dueSoon,
    milestones,
    recent: [...live].sort(compareByActivity).slice(0, 4),
    attention,
  };
}

/** "Nov 9 · in 3 days" for a due date. */
export const dueLabel = (iso: string, today: string): string => {
  const rel = relativeDay(iso, today);
  return Math.abs(diffDays(iso, today)) <= 1 ? rel : `${formatShort(iso, today)} · ${rel}`;
};

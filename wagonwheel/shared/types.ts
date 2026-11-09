// The data contract between the Electron main process (SQLite) and the renderer.
// Types and small constants only. No Node, no DOM, no React: both sides import this.
//
// Dates are local calendar days as "YYYY-MM-DD" (no time zone, no clock time),
// the same shape Nucleus Manager uses. Timestamps are epoch milliseconds.

export const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ["not_started", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ["low", "medium", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  /** Optional accent, "#RRGGBB". */
  color: string | null;
  startDate: string | null;
  targetDate: string | null;
  /** Set when archived; archived projects leave the dashboard and the sidebar counts. */
  archivedAt: number | null;
  createdAt: number;
  /** Bumped by any change to the project or to its tasks, milestones or notes. */
  updatedAt: number;
}

export interface Task {
  id: string;
  /** Null = unsorted: the task sits in the inbox. */
  projectId: string | null;
  /** Set for a subtask. Subtasks are one level deep and share the parent's project. */
  parentId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description: string;
  targetDate: string;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** A short note on a project or on a task. Exactly one of the two ids is set. */
export interface Note {
  id: string;
  projectId: string | null;
  taskId: string | null;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export type Settings = Record<string, string>;

export const SETTING_WORKSPACE_NAME = "workspaceName";
export const DEFAULT_WORKSPACE_NAME = "Gage's Workspace";

/** Everything the UI shows, in one object. A personal workspace is small, so each
 *  change returns a fresh snapshot instead of a hand-written patch. */
export interface Snapshot {
  projects: Project[];
  tasks: Task[];
  milestones: Milestone[];
  notes: Note[];
  settings: Settings;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface ProjectInput {
  name: string;
  description?: string;
  status?: ProjectStatus;
  color?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
}
export type ProjectPatch = Partial<ProjectInput> & { archived?: boolean };

export interface TaskInput {
  title: string;
  projectId?: string | null;
  /** Makes this a subtask. Its project is taken from the parent. */
  parentId?: string | null;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  startDate?: string | null;
  dueDate?: string | null;
}
export type TaskPatch = Partial<Omit<TaskInput, "parentId">>;

export interface MilestoneInput {
  projectId: string;
  name: string;
  description?: string;
  targetDate: string;
  completed?: boolean;
}
export type MilestonePatch = Partial<Omit<MilestoneInput, "projectId">>;

export interface NoteInput {
  projectId?: string | null;
  taskId?: string | null;
  body: string;
}

// ── Results and errors ──────────────────────────────────────────────────────

/** A change: the id it touched or made, and the workspace as it is now. */
export interface Change {
  id: string;
  snapshot: Snapshot;
}

export type ErrorCode =
  | "validation"   // the input is not acceptable; the message says why, in words a person can act on
  | "not_found"
  | "database";    // SQLite refused, or the file is unusable

export interface WagonwheelError {
  code: ErrorCode;
  message: string;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: WagonwheelError };

export interface DataInfo {
  path: string;
  sizeBytes: number;
  schemaVersion: number;
}

/** Where a backup or export went. */
export interface SavedFile {
  path: string;
}

/** Commands the app menu sends to the window. */
export type MenuCommand =
  | "new-task"
  | "new-project"
  | "go-dashboard"
  | "go-projects"
  | "go-tasks"
  | "go-timeline"
  | "go-inbox"
  | "focus-capture"
  | "backup"
  | "export-json"
  | "export-csv"
  | "restore";

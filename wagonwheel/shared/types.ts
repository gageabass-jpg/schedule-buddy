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
  /** The GitHub repository connected to this project, "owner/name". One repository belongs to one project. */
  githubRepo: string | null;
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
  /** The GitHub scan's id for the item this came from ("owner/name#12"), or null. A rescan looks here, not at the description. */
  githubRef: string | null;
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
  /** The GitHub scan's id for the milestone this came from ("owner/name@milestone:3"), or null. */
  githubRef: string | null;
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

// ── Services: what the workspace pays for each month ───────────────────────

/** Flat fee: the same every month. Usage-based: it moves with use, so it can surprise. */
export const SERVICE_KINDS = ["flat", "usage"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];
export const SERVICE_KIND_LABEL: Record<ServiceKind, string> = { flat: "Flat fee", usage: "Usage-based" };

export const SERVICE_STATUSES = ["active", "cancelled"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/** The services whose usage Wagonwheel can check for itself. Every bill is typed in from its invoice. */
export const SERVICE_PROVIDERS = ["vercel"] as const;
export type ServiceProvider = (typeof SERVICE_PROVIDERS)[number];
export const SERVICE_PROVIDER_LABEL: Record<ServiceProvider, string> = { vercel: "Vercel" };

export const CHARGE_SOURCES = ["manual", "vercel"] as const;
export type ChargeSource = (typeof CHARGE_SOURCES)[number];

/** A service the workspace pays for: Supabase, Vercel, GitHub, Google Workspace, Firebase… */
export interface Service {
  id: string;
  name: string;
  /** The plan, in words ("Pro", "Business Standard"). May be empty. */
  plan: string;
  kind: ServiceKind;
  /** Whose usage Wagonwheel can check beyond the plan, or null. Bills are always typed in. */
  provider: ServiceProvider | null;
  /** The usual monthly fee, in cents. 0 means not set. */
  amountCents: number;
  /** The day of the month the bill comes, 1 to 31, or null. */
  billingDay: number | null;
  /** The page where the bill lives, an https address, or null. */
  billingUrl: string | null;
  notes: string;
  status: ServiceStatus;
  /** When the bill was last read from the provider, or null. */
  lastSyncedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** What one service actually charged for one month. One per service per month. */
export interface ServiceCharge {
  id: string;
  serviceId: string;
  /** "YYYY-MM". */
  month: string;
  amountCents: number;
  source: ChargeSource;
  /** False for a bill that has been issued or charged but not paid yet (a failed payment, an overdue invoice). It counts toward the month, and toward what is owed, until it is marked paid. */
  paid: boolean;
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
  services: Service[];
  serviceCharges: ServiceCharge[];
  settings: Settings;
  /**
   * Which read of the database this is. The app's main process counts up each time it reads one, so the
   * window can drop a reply that arrives after a newer one. Absent where nothing counts (the connector,
   * tests, an empty window), and then nothing is dropped.
   */
  revision?: number;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface ProjectInput {
  name: string;
  description?: string;
  status?: ProjectStatus;
  color?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  /** "owner/name", or null to disconnect. */
  githubRepo?: string | null;
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
  /** Set only when the task is made from a GitHub scan; see Task.githubRef. One per project. */
  githubRef?: string | null;
}
/** `parentId` moves a task: a task id makes it (or moves it to be) a subtask of that task, in that task's project;
 *  null lifts a subtask back to a top-level task, in the project it is in. Its id and notes stay either way.
 *  Where an item came from on GitHub is set when it is made and does not change. */
export type TaskPatch = Partial<Omit<TaskInput, "githubRef">>;

export interface MilestoneInput {
  projectId: string;
  name: string;
  description?: string;
  targetDate: string;
  completed?: boolean;
  /** Set only when the milestone is made from a GitHub scan; see Milestone.githubRef. One per project. */
  githubRef?: string | null;
}
export type MilestonePatch = Partial<Omit<MilestoneInput, "projectId" | "githubRef">>;

export interface NoteInput {
  projectId?: string | null;
  taskId?: string | null;
  body: string;
}

export interface ServiceInput {
  name: string;
  plan?: string;
  kind?: ServiceKind;
  provider?: ServiceProvider | null;
  /** The usual monthly fee, in cents. */
  amountCents?: number;
  billingDay?: number | null;
  /** An https address, or null for none. */
  billingUrl?: string | null;
  notes?: string;
  status?: ServiceStatus;
}
export type ServicePatch = Partial<ServiceInput>;

/** What a service charged for a month, typed in by hand. It replaces any figure already there for that month. */
export interface ChargeInput {
  serviceId: string;
  /** "YYYY-MM". */
  month: string;
  amountCents: number;
  /** Default true. False records a bill that is owed and not yet paid. */
  paid?: boolean;
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
  | "database"     // SQLite refused, or the file is unusable
  | "github"       // GitHub could not be reached, or refused the sign-in or the request
  | "services"     // a service's billing could not be reached, or refused the token
  | "connector";   // Claude Code's tool could not be run, or refused the change

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
  | "go-services"
  | "scan-github"
  | "open-connectors"
  | "focus-capture"
  | "backup"
  | "export-json"
  | "export-csv"
  | "restore";

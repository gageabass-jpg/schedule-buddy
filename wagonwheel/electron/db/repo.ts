import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  PRIORITIES, PROJECT_STATUSES, SERVICE_KINDS, SERVICE_PROVIDERS, SERVICE_PROVIDER_LABEL, SERVICE_STATUSES, TASK_STATUSES,
  type Change, type ChargeInput, type ChargeSource, type Milestone, type MilestoneInput, type MilestonePatch, type Note, type NoteInput,
  type Priority, type Project, type ProjectInput, type ProjectPatch, type ProjectStatus,
  type Service, type ServiceCharge, type ServiceInput, type ServiceKind, type ServicePatch, type ServiceProvider, type ServiceStatus,
  type Settings, type Snapshot, type Task, type TaskInput, type TaskPatch, type TaskStatus,
} from "../../shared/types.js";
import { beginImmediate } from "./busy.js";
import { invalid, notFound } from "./errors.js";

// All the SQL for the workspace. The renderer never sees it.
// Every change runs in one transaction and hands back the whole workspace.

type Row = Record<string, SQLInputValue>;

const NAME_MAX = 120;
const TEXT_MAX = 20_000;

// ── Validation ──────────────────────────────────────────────────────────────

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function name(value: string, what: string): string {
  const v = (value ?? "").trim();
  if (!v) throw invalid(`${what} cannot be empty.`);
  if (v.length > NAME_MAX) throw invalid(`${what} is too long (the limit is ${NAME_MAX} characters).`);
  return v;
}

function text(value: string | undefined, what: string): string {
  const v = (value ?? "").trim();
  if (v.length > TEXT_MAX) throw invalid(`${what} is too long (the limit is ${TEXT_MAX} characters).`);
  return v;
}

function date(value: string | null | undefined, what: string): string | null {
  if (value == null || value === "") return null;
  if (!isValidDate(value)) throw invalid(`${what} is not a valid date.`);
  return value;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw invalid(`${what} is not one of: ${allowed.join(", ")}.`);
  return value as T;
}

function color(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) throw invalid("The colour must look like #C62845.");
  return value.toUpperCase();
}

/** "owner/name" as GitHub spells them, or null for none. */
function repoName(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  const v = value.trim();
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(v)) throw invalid("The GitHub repository must look like owner/name.");
  return v;
}

function order(start: string | null, end: string | null, message: string): void {
  if (start && end && start > end) throw invalid(message);
}

const CENTS_MAX = 100_000_000;   // $1,000,000 a month: far past anything real, and keeps a typo from becoming a number that breaks the screen

/** A whole number of cents, from 0 up. */
function cents(value: number | undefined, what: string): number {
  const v = value ?? 0;
  if (!Number.isInteger(v) || v < 0) throw invalid(`${what} must be an amount of money, not less than zero.`);
  if (v > CENTS_MAX) throw invalid(`${what} is too large.`);
  return v;
}

/** The day of the month a bill comes: 1 to 31, or null for none. */
function billingDay(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 31) throw invalid("The billing day must be a day of the month, 1 to 31.");
  return value;
}

/** Where a bill lives: an https address, or null for none. Nothing else is kept, so a link in the app can never run a script or open a file. */
function httpsUrl(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  const v = value.trim();
  let u: URL;
  try { u = new URL(v); } catch { throw invalid("The billing page must be a web address, such as https://vercel.com/account/billing."); }
  if (u.protocol !== "https:" || v.length > 500) throw invalid("The billing page must be a web address that starts with https:// (and is not very long).");
  return u.toString();
}

/** "YYYY-MM". */
function monthKey(value: string, what: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? "")) throw invalid(`${what} must look like 2026-11.`);
  return value;
}

// ── Row mapping ─────────────────────────────────────────────────────────────

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string => String(v ?? "");
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

const toProject = (r: Row): Project => ({
  id: str(r.id), name: str(r.name), description: str(r.description),
  status: str(r.status) as ProjectStatus, color: strOrNull(r.color),
  startDate: strOrNull(r.start_date), targetDate: strOrNull(r.target_date),
  githubRepo: strOrNull(r.github_repo),
  archivedAt: numOrNull(r.archived_at), createdAt: num(r.created_at), updatedAt: num(r.updated_at),
});

const toTask = (r: Row): Task => ({
  id: str(r.id), projectId: strOrNull(r.project_id), parentId: strOrNull(r.parent_id),
  title: str(r.title), description: str(r.description),
  status: str(r.status) as TaskStatus, priority: str(r.priority) as Priority,
  startDate: strOrNull(r.start_date), dueDate: strOrNull(r.due_date),
  completedAt: numOrNull(r.completed_at), createdAt: num(r.created_at), updatedAt: num(r.updated_at),
});

const toMilestone = (r: Row): Milestone => ({
  id: str(r.id), projectId: str(r.project_id), name: str(r.name), description: str(r.description),
  targetDate: str(r.target_date), completedAt: numOrNull(r.completed_at),
  createdAt: num(r.created_at), updatedAt: num(r.updated_at),
});

const toNote = (r: Row): Note => ({
  id: str(r.id), projectId: strOrNull(r.project_id), taskId: strOrNull(r.task_id),
  body: str(r.body), createdAt: num(r.created_at), updatedAt: num(r.updated_at),
});

const toService = (r: Row): Service => ({
  id: str(r.id), name: str(r.name), plan: str(r.plan),
  kind: str(r.kind) as ServiceKind, provider: strOrNull(r.provider) as ServiceProvider | null,
  amountCents: num(r.amount_cents), billingDay: numOrNull(r.billing_day), billingUrl: strOrNull(r.billing_url),
  notes: str(r.notes), status: str(r.status) as ServiceStatus, lastSyncedAt: numOrNull(r.last_synced_at),
  createdAt: num(r.created_at), updatedAt: num(r.updated_at),
});

const toCharge = (r: Row): ServiceCharge => ({
  id: str(r.id), serviceId: str(r.service_id), month: str(r.month), amountCents: num(r.amount_cents),
  source: str(r.source) as ChargeSource, paid: num(r.paid) === 1, createdAt: num(r.created_at), updatedAt: num(r.updated_at),
});

// ── The workspace ───────────────────────────────────────────────────────────

export class Workspace {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = randomUUID,
    /** Counts the reads. The app gives it one so the window can ignore a reply that arrives late; without one a snapshot carries no revision. */
    private readonly nextRevision?: () => number,
    /** How many more times to try starting a write when the other connection holds the lock. The app waits and fails; the connector retries. */
    private readonly beginRetries: number = 0,
  ) {}

  // Reading

  snapshot(): Snapshot {
    // Numbered first, so a read that starts later can never carry a lower number.
    const revision = this.nextRevision?.();
    const all = (sql: string): Row[] => this.db.prepare(sql).all() as Row[];
    const settings: Settings = {};
    for (const r of all("SELECT key, value FROM settings")) settings[str(r.key)] = str(r.value);
    return {
      ...(revision === undefined ? {} : { revision }),
      projects: all("SELECT * FROM projects ORDER BY created_at, id").map(toProject),
      tasks: all("SELECT * FROM tasks ORDER BY created_at, id").map(toTask),
      milestones: all("SELECT * FROM milestones ORDER BY target_date, created_at, id").map(toMilestone),
      notes: all("SELECT * FROM notes ORDER BY created_at, id").map(toNote),
      services: all("SELECT * FROM services ORDER BY created_at, id").map(toService),
      serviceCharges: all("SELECT * FROM service_charges ORDER BY month, created_at, id").map(toCharge),
      settings,
    };
  }

  // Projects

  createProject(input: ProjectInput): Change {
    const row = this.cleanProject(input);
    const id = this.newId();
    const t = this.now();
    return this.change(id, () => {
      this.repoIsFree(row.githubRepo, id);
      this.run(
        `INSERT INTO projects (id, name, description, status, color, start_date, target_date, github_repo, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        id, row.name, row.description, row.status, row.color, row.startDate, row.targetDate, row.githubRepo, t, t,
      );
    });
  }

  /** A repository can be connected to one project. Says which one has it, so the person can act on it. */
  private repoIsFree(repo: string | null, exceptProjectId: string): void {
    if (!repo) return;
    const owner = this.db.prepare("SELECT name FROM projects WHERE lower(github_repo) = lower(?) AND id <> ?").get(repo, exceptProjectId) as { name: string } | undefined;
    if (owner) throw invalid(`${repo} is already connected to the project "${owner.name}". A repository can belong to one project.`);
  }

  updateProject(id: string, patch: ProjectPatch): Change {
    return this.change(id, () => {
      const cur = this.project(id);
      const row = this.cleanProject({
        name: patch.name ?? cur.name,
        description: patch.description ?? cur.description,
        status: patch.status ?? cur.status,
        color: patch.color !== undefined ? patch.color : cur.color,
        startDate: patch.startDate !== undefined ? patch.startDate : cur.startDate,
        targetDate: patch.targetDate !== undefined ? patch.targetDate : cur.targetDate,
        githubRepo: patch.githubRepo !== undefined ? patch.githubRepo : cur.githubRepo,
      });
      this.repoIsFree(row.githubRepo, id);
      const archivedAt = patch.archived === undefined ? cur.archivedAt : patch.archived ? (cur.archivedAt ?? this.now()) : null;
      this.run(
        `UPDATE projects SET name = ?, description = ?, status = ?, color = ?, start_date = ?, target_date = ?,
                github_repo = ?, archived_at = ?, updated_at = ? WHERE id = ?`,
        row.name, row.description, row.status, row.color, row.startDate, row.targetDate, row.githubRepo, archivedAt, this.now(), id,
      );
    });
  }

  deleteProject(id: string): Snapshot {
    this.tx(() => {
      this.project(id);
      this.run("DELETE FROM projects WHERE id = ?", id);   // tasks, milestones and notes go with it
    });
    return this.snapshot();
  }

  private cleanProject(input: ProjectInput) {
    const row = {
      name: name(input.name, "The project name"),
      description: text(input.description, "The description"),
      status: oneOf(input.status ?? "active", PROJECT_STATUSES, "The status"),
      color: color(input.color),
      startDate: date(input.startDate, "The start date"),
      targetDate: date(input.targetDate, "The target date"),
      githubRepo: repoName(input.githubRepo),
    };
    order(row.startDate, row.targetDate, "The start date is after the target date.");
    return row;
  }

  // Tasks

  createTask(input: TaskInput): Change {
    const title = name(input.title, "The task title");
    const description = text(input.description, "The description");
    const status = oneOf(input.status ?? "not_started", TASK_STATUSES, "The status");
    const priority = oneOf(input.priority ?? "medium", PRIORITIES, "The priority");
    const startDate = date(input.startDate, "The start date");
    const dueDate = date(input.dueDate, "The due date");
    order(startDate, dueDate, "The start date is after the due date.");
    const id = this.newId();
    const t = this.now();
    return this.change(id, () => {
      let projectId: string | null = null;
      let parentId: string | null = null;
      if (input.parentId) {
        const parent = this.task(input.parentId);
        if (parent.parentId) throw invalid("A subtask cannot have subtasks of its own.");
        parentId = parent.id;
        projectId = parent.projectId;
      } else if (input.projectId) {
        projectId = this.project(input.projectId).id;
      }
      this.run(
        `INSERT INTO tasks (id, project_id, parent_id, title, description, status, priority, start_date, due_date,
                            completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, projectId, parentId, title, description, status, priority, startDate, dueDate,
        status === "done" ? t : null, t, t,
      );
      this.touchProject(projectId, t);
    });
  }

  updateTask(id: string, patch: TaskPatch): Change {
    return this.change(id, () => {
      const cur = this.task(id);
      const title = patch.title !== undefined ? name(patch.title, "The task title") : cur.title;
      const description = patch.description !== undefined ? text(patch.description, "The description") : cur.description;
      const status = patch.status !== undefined ? oneOf(patch.status, TASK_STATUSES, "The status") : cur.status;
      const priority = patch.priority !== undefined ? oneOf(patch.priority, PRIORITIES, "The priority") : cur.priority;
      const startDate = patch.startDate !== undefined ? date(patch.startDate, "The start date") : cur.startDate;
      const dueDate = patch.dueDate !== undefined ? date(patch.dueDate, "The due date") : cur.dueDate;
      order(startDate, dueDate, "The start date is after the due date.");

      // A subtask always lives in its parent's project; only a top-level task can move.
      let projectId = cur.projectId;
      let parentId = cur.parentId;
      const newParent = patch.parentId === undefined ? undefined : patch.parentId || null;
      if (newParent !== undefined && newParent !== cur.parentId) {
        if (newParent === null) {
          // Promoted to a top-level task: it stays in the project it is in, unless the same patch moves it.
          parentId = null;
          if (patch.projectId !== undefined) projectId = patch.projectId ? this.project(patch.projectId).id : null;
        } else {
          // Made (or moved to be) a subtask: one level deep, in the new parent's project. Its id and notes stay.
          if (newParent === id) throw invalid("A task cannot be a subtask of itself.");
          const parent = this.task(newParent);
          if (parent.parentId) throw invalid("A subtask cannot have subtasks of its own.");
          if (this.get("SELECT 1 AS n FROM tasks WHERE parent_id = ? LIMIT 1", id)) {
            throw invalid("This task has subtasks of its own, so it cannot become a subtask. Move or remove them first.");
          }
          parentId = parent.id;
          projectId = parent.projectId;
        }
      } else if (!cur.parentId && patch.projectId !== undefined) {
        projectId = patch.projectId ? this.project(patch.projectId).id : null;
      }

      const t = this.now();
      const completedAt = status === "done" ? (cur.status === "done" ? cur.completedAt ?? t : t) : null;
      this.run(
        `UPDATE tasks SET project_id = ?, parent_id = ?, title = ?, description = ?, status = ?, priority = ?, start_date = ?,
                due_date = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
        projectId, parentId, title, description, status, priority, startDate, dueDate, completedAt, t, id,
      );
      if (projectId !== cur.projectId) {
        this.run("UPDATE tasks SET project_id = ?, updated_at = ? WHERE parent_id = ?", projectId, t, id);
        this.touchProject(cur.projectId, t);
      }
      this.touchProject(projectId, t);
    });
  }

  deleteTask(id: string): Snapshot {
    this.tx(() => {
      const cur = this.task(id);
      this.run("DELETE FROM tasks WHERE id = ?", id);     // subtasks and notes go with it
      this.touchProject(cur.projectId, this.now());
    });
    return this.snapshot();
  }

  // Milestones

  createMilestone(input: MilestoneInput): Change {
    const milestoneName = name(input.name, "The milestone name");
    const description = text(input.description, "The description");
    const targetDate = date(input.targetDate, "The target date");
    if (!targetDate) throw invalid("A milestone needs a target date.");
    const id = this.newId();
    const t = this.now();
    return this.change(id, () => {
      const project = this.project(input.projectId);
      this.run(
        `INSERT INTO milestones (id, project_id, name, description, target_date, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id, project.id, milestoneName, description, targetDate, input.completed ? t : null, t, t,
      );
      this.touchProject(project.id, t);
    });
  }

  updateMilestone(id: string, patch: MilestonePatch): Change {
    return this.change(id, () => {
      const cur = this.milestone(id);
      const milestoneName = patch.name !== undefined ? name(patch.name, "The milestone name") : cur.name;
      const description = patch.description !== undefined ? text(patch.description, "The description") : cur.description;
      let targetDate = cur.targetDate;
      if (patch.targetDate !== undefined) {
        const d = date(patch.targetDate, "The target date");
        if (!d) throw invalid("A milestone needs a target date.");
        targetDate = d;
      }
      const t = this.now();
      const completedAt = patch.completed === undefined ? cur.completedAt : patch.completed ? (cur.completedAt ?? t) : null;
      this.run(
        "UPDATE milestones SET name = ?, description = ?, target_date = ?, completed_at = ?, updated_at = ? WHERE id = ?",
        milestoneName, description, targetDate, completedAt, t, id,
      );
      this.touchProject(cur.projectId, t);
    });
  }

  deleteMilestone(id: string): Snapshot {
    this.tx(() => {
      const cur = this.milestone(id);
      this.run("DELETE FROM milestones WHERE id = ?", id);
      this.touchProject(cur.projectId, this.now());
    });
    return this.snapshot();
  }

  // Notes

  createNote(input: NoteInput): Change {
    const body = text(input.body, "The note");
    if (!body) throw invalid("A note cannot be empty.");
    if (!!input.projectId === !!input.taskId) throw invalid("A note belongs to a project or to a task.");
    const id = this.newId();
    const t = this.now();
    return this.change(id, () => {
      let projectId: string | null = null;
      let taskId: string | null = null;
      let touch: string | null;
      if (input.projectId) {
        projectId = this.project(input.projectId).id;
        touch = projectId;
      } else {
        const task = this.task(input.taskId as string);
        taskId = task.id;
        touch = task.projectId;
      }
      this.run(
        "INSERT INTO notes (id, project_id, task_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        id, projectId, taskId, body, t, t,
      );
      this.touchProject(touch, t);
    });
  }

  updateNote(id: string, bodyIn: string): Change {
    const body = text(bodyIn, "The note");
    if (!body) throw invalid("A note cannot be empty.");
    return this.change(id, () => {
      const cur = this.note(id);
      const t = this.now();
      this.run("UPDATE notes SET body = ?, updated_at = ? WHERE id = ?", body, t, id);
      this.touchProject(this.noteProject(cur), t);
    });
  }

  deleteNote(id: string): Snapshot {
    this.tx(() => {
      const cur = this.note(id);
      this.run("DELETE FROM notes WHERE id = ?", id);
      this.touchProject(this.noteProject(cur), this.now());
    });
    return this.snapshot();
  }

  // Services

  createService(input: ServiceInput): Change {
    const row = this.cleanService(input);
    const id = this.newId();
    const t = this.now();
    return this.change(id, () => {
      this.run(
        `INSERT INTO services (id, name, plan, kind, provider, amount_cents, billing_day, billing_url, notes, status, last_synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        id, row.name, row.plan, row.kind, row.provider, row.amountCents, row.billingDay, row.billingUrl, row.notes, row.status, t, t,
      );
    });
  }

  updateService(id: string, patch: ServicePatch): Change {
    return this.change(id, () => {
      const cur = this.service(id);
      const row = this.cleanService({
        name: patch.name ?? cur.name,
        plan: patch.plan ?? cur.plan,
        kind: patch.kind ?? cur.kind,
        provider: patch.provider !== undefined ? patch.provider : cur.provider,
        amountCents: patch.amountCents ?? cur.amountCents,
        billingDay: patch.billingDay !== undefined ? patch.billingDay : cur.billingDay,
        billingUrl: patch.billingUrl !== undefined ? patch.billingUrl : cur.billingUrl,
        notes: patch.notes ?? cur.notes,
        status: patch.status ?? cur.status,
      });
      this.run(
        `UPDATE services SET name = ?, plan = ?, kind = ?, provider = ?, amount_cents = ?, billing_day = ?, billing_url = ?,
                notes = ?, status = ?, updated_at = ? WHERE id = ?`,
        row.name, row.plan, row.kind, row.provider, row.amountCents, row.billingDay, row.billingUrl, row.notes, row.status, this.now(), id,
      );
    });
  }

  deleteService(id: string): Snapshot {
    this.tx(() => {
      this.service(id);
      this.run("DELETE FROM services WHERE id = ?", id);   // its charges go with it
    });
    return this.snapshot();
  }

  /** A service as it is now, for the code that reads a provider's bill for it. */
  getService(id: string): Service {
    return this.service(id);
  }

  private cleanService(input: ServiceInput) {
    const plan = text(input.plan, "The plan");
    if (plan.length > NAME_MAX) throw invalid(`The plan is too long (the limit is ${NAME_MAX} characters).`);
    const serviceName = name(input.name, "The service name");
    const provider = input.provider == null ? null : oneOf(input.provider, SERVICE_PROVIDERS, "The automatic source");
    // A provider's usage belongs to the service of that name and no other. Linking Supabase to Vercel would report Vercel's
    // usage as Supabase's, so it is refused here, whatever the window sends.
    if (provider && !serviceName.toLowerCase().includes(SERVICE_PROVIDER_LABEL[provider].toLowerCase())) {
      throw invalid(`Only a service named like ${SERVICE_PROVIDER_LABEL[provider]} can check its usage on ${SERVICE_PROVIDER_LABEL[provider]}. "${serviceName}" would be given ${SERVICE_PROVIDER_LABEL[provider]}'s usage, which is not its own.`);
    }
    return {
      name: serviceName,
      plan,
      kind: oneOf(input.kind ?? "flat", SERVICE_KINDS, "The type"),
      provider,
      amountCents: cents(input.amountCents, "The usual monthly fee"),
      billingDay: billingDay(input.billingDay),
      billingUrl: httpsUrl(input.billingUrl),
      notes: text(input.notes, "The notes"),
      status: oneOf(input.status ?? "active", SERVICE_STATUSES, "The status"),
    };
  }

  /** Type in what a service charged for a month. Replaces the figure already there, whoever put it there.
   *  `paid` (default true) says whether it has been paid; false records a bill that is owed. */
  setCharge(input: ChargeInput): Change {
    const month = monthKey(input.month, "The month");
    const amount = cents(input.amountCents, "The amount");
    if (input.paid !== undefined && typeof input.paid !== "boolean") throw invalid("Paid must be true or false.");
    const paid = input.paid !== false;
    const t = this.now();
    let id = this.newId();
    this.tx(() => {
      const svc = this.service(input.serviceId);
      const existing = this.get("SELECT id FROM service_charges WHERE service_id = ? AND month = ?", svc.id, month);
      if (existing) id = str(existing.id);   // the row that was changed, not a spare id
      this.upsertCharge(svc.id, month, amount, "manual", t, id, paid);
    });
    return { id, snapshot: this.snapshot() };
  }

  deleteCharge(id: string): Snapshot {
    this.tx(() => {
      const r = this.get("SELECT id FROM service_charges WHERE id = ?", id);
      if (!r) throw notFound("That charge");
      this.run("DELETE FROM service_charges WHERE id = ?", id);
    });
    return this.snapshot();
  }

  /** Note that a service's provider was just checked (its usage read). Nothing about its bills changes. */
  markChecked(serviceId: string): Snapshot {
    const t = this.now();
    this.tx(() => {
      const svc = this.service(serviceId);
      this.run("UPDATE services SET last_synced_at = ?, updated_at = ? WHERE id = ?", t, t, svc.id);
    });
    return this.snapshot();
  }

  private upsertCharge(serviceId: string, month: string, amountCents: number, source: ChargeSource, t: number, newId: string, paid: boolean): void {
    this.run(
      `INSERT INTO service_charges (id, service_id, month, amount_cents, source, paid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(service_id, month) DO UPDATE SET amount_cents = excluded.amount_cents, source = excluded.source,
         paid = excluded.paid, updated_at = excluded.updated_at`,
      newId, serviceId, month, amountCents, source, paid ? 1 : 0, t, t,
    );
  }

  // Settings

  setSetting(key: string, valueIn: string): Snapshot {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) throw invalid("That setting name is not allowed.");
    let value = String(valueIn ?? "");
    if (key === "workspaceName") {
      value = value.trim();
      if (!value) throw invalid("The workspace name cannot be empty.");
      if (value.length > 60) throw invalid("The workspace name is too long (the limit is 60 characters).");
    } else if (value.length > 2000) {
      throw invalid("That setting is too long.");
    }
    this.tx(() => {
      this.run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        key, value,
      );
    });
    return this.snapshot();
  }

  // Internals

  private run(sql: string, ...params: (SQLInputValue | undefined)[]): void {
    this.db.prepare(sql).run(...params.map((p) => (p === undefined ? null : p)));
  }

  private get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }

  private tx(fn: () => void): void {
    beginImmediate(this.db, this.beginRetries);
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private change(id: string, fn: () => void): Change {
    this.tx(fn);
    return { id, snapshot: this.snapshot() };
  }

  private project(id: string): Project {
    const r = this.get("SELECT * FROM projects WHERE id = ?", id);
    if (!r) throw notFound("That project");
    return toProject(r);
  }

  private task(id: string): Task {
    const r = this.get("SELECT * FROM tasks WHERE id = ?", id);
    if (!r) throw notFound("That task");
    return toTask(r);
  }

  private milestone(id: string): Milestone {
    const r = this.get("SELECT * FROM milestones WHERE id = ?", id);
    if (!r) throw notFound("That milestone");
    return toMilestone(r);
  }

  private note(id: string): Note {
    const r = this.get("SELECT * FROM notes WHERE id = ?", id);
    if (!r) throw notFound("That note");
    return toNote(r);
  }

  private service(id: string): Service {
    const r = this.get("SELECT * FROM services WHERE id = ?", id);
    if (!r) throw notFound("That service");
    return toService(r);
  }

  private noteProject(n: Note): string | null {
    return n.projectId ?? (n.taskId ? this.task(n.taskId).projectId : null);
  }

  private touchProject(id: string | null, t: number): void {
    if (id) this.run("UPDATE projects SET updated_at = ? WHERE id = ?", t, id);
  }
}

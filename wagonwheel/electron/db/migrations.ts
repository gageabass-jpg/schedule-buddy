// The schema, one migration per version. `PRAGMA user_version` holds the number of
// the last migration applied. To change the schema: append a migration. Never edit
// one that has shipped.

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const HEX_COLOR = "#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]";

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "projects, tasks, milestones, notes, settings",
    sql: `
      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
        description TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('planning', 'active', 'on_hold', 'completed')),
        color       TEXT CHECK (color IS NULL OR color GLOB '${HEX_COLOR}'),
        start_date  TEXT,
        target_date TEXT,
        archived_at INTEGER,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      -- project_id NULL means "unsorted": the task is in the inbox.
      -- parent_id set means "subtask": one level deep, enforced in code.
      CREATE TABLE tasks (
        id           TEXT PRIMARY KEY,
        project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
        parent_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        title        TEXT NOT NULL CHECK (length(trim(title)) > 0),
        description  TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'not_started'
                     CHECK (status IN ('not_started', 'in_progress', 'done')),
        priority     TEXT NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('low', 'medium', 'high')),
        start_date   TEXT,
        due_date     TEXT,
        completed_at INTEGER,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX idx_tasks_project ON tasks(project_id);
      CREATE INDEX idx_tasks_parent  ON tasks(parent_id);
      CREATE INDEX idx_tasks_due     ON tasks(due_date);

      CREATE TABLE milestones (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name         TEXT NOT NULL CHECK (length(trim(name)) > 0),
        description  TEXT NOT NULL DEFAULT '',
        target_date  TEXT NOT NULL,
        completed_at INTEGER,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX idx_milestones_project ON milestones(project_id);

      -- A note belongs to a project or to a task, never both, never neither.
      CREATE TABLE notes (
        id         TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        body       TEXT NOT NULL CHECK (length(trim(body)) > 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK ((project_id IS NULL) <> (task_id IS NULL))
      );
      CREATE INDEX idx_notes_project ON notes(project_id);
      CREATE INDEX idx_notes_task    ON notes(task_id);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "projects.github_repo",
    sql: `
      -- The GitHub repository a project is connected to, as "owner/name", or NULL.
      -- One repository belongs to one project (names are compared without regard to case).
      ALTER TABLE projects ADD COLUMN github_repo TEXT;
      CREATE UNIQUE INDEX idx_projects_github_repo ON projects(lower(github_repo)) WHERE github_repo IS NOT NULL;
    `,
  },
  {
    version: 3,
    name: "services and service_charges",
    sql: `
      -- What the workspace pays for each month: Supabase, Vercel, GitHub, Google Workspace, Firebase…
      -- amount_cents is the usual monthly fee (0 = not set). provider says where the bill can be read
      -- from automatically; NULL means it is typed in by hand.
      CREATE TABLE services (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL CHECK (length(trim(name)) > 0),
        plan           TEXT NOT NULL DEFAULT '',
        kind           TEXT NOT NULL DEFAULT 'flat' CHECK (kind IN ('flat', 'usage')),
        provider       TEXT CHECK (provider IS NULL OR provider IN ('vercel')),
        amount_cents   INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
        billing_day    INTEGER CHECK (billing_day IS NULL OR (billing_day >= 1 AND billing_day <= 31)),
        billing_url    TEXT,
        notes          TEXT NOT NULL DEFAULT '',
        status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
        last_synced_at INTEGER,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      );

      -- What a service actually charged in a month. One row per service per month: typing a
      -- figure in, or reading one from the provider, replaces what was there.
      CREATE TABLE service_charges (
        id           TEXT PRIMARY KEY,
        service_id   TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        month        TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        source       TEXT NOT NULL CHECK (source IN ('manual', 'vercel')),
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        UNIQUE (service_id, month)
      );
      CREATE INDEX idx_service_charges_service ON service_charges(service_id);
    `,
  },
  {
    version: 4,
    name: "service_charges.paid",
    sql: `
      -- 1 = paid (every bill recorded so far was a paid one), 0 = billed but not paid yet. Unpaid bills are what
      -- "what I owe right now" adds up; a figure read from a provider keeps whatever this says.
      ALTER TABLE service_charges ADD COLUMN paid INTEGER NOT NULL DEFAULT 1 CHECK (paid IN (0, 1));
    `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

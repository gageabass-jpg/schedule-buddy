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
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

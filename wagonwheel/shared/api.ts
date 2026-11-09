// What the preload script puts on `window.wagonwheel`. The renderer sees only this.
// Every call can fail; the preload turns a failed Reply into a thrown WagonwheelError.

import type {
  Change, DataInfo, MenuCommand, MilestoneInput, MilestonePatch, NoteInput,
  ProjectInput, ProjectPatch, SavedFile, Snapshot, TaskInput, TaskPatch,
} from "./types.js";

export interface WagonwheelApi {
  /** "darwin", "win32" or "linux". */
  platform: string;
  /** Where the window is told to start from: the whole workspace. */
  getSnapshot(): Promise<Snapshot>;

  createProject(input: ProjectInput): Promise<Change>;
  updateProject(id: string, patch: ProjectPatch): Promise<Change>;
  deleteProject(id: string): Promise<Snapshot>;

  createTask(input: TaskInput): Promise<Change>;
  updateTask(id: string, patch: TaskPatch): Promise<Change>;
  deleteTask(id: string): Promise<Snapshot>;

  createMilestone(input: MilestoneInput): Promise<Change>;
  updateMilestone(id: string, patch: MilestonePatch): Promise<Change>;
  deleteMilestone(id: string): Promise<Snapshot>;

  createNote(input: NoteInput): Promise<Change>;
  updateNote(id: string, body: string): Promise<Change>;
  deleteNote(id: string): Promise<Snapshot>;

  setSetting(key: string, value: string): Promise<Snapshot>;

  /** Copy the database to a file the person picks. Safe while the app runs.
   *  Null when the person closed the dialog. */
  backupDatabase(): Promise<SavedFile | null>;
  /** Everything, as one JSON file. Null when the dialog was closed. */
  exportJson(): Promise<SavedFile | null>;
  /** projects.csv, tasks.csv, milestones.csv and notes.csv in a folder the person picks.
   *  Null when the dialog was closed. */
  exportCsv(): Promise<SavedFile | null>;
  /** Replace the workspace with a backup. The current database is kept beside it first.
   *  Null when the person backed out. */
  restoreBackup(): Promise<Snapshot | null>;
  /** The database file could not be opened: set it aside (it is kept) and start a new one. */
  startFresh(): Promise<Snapshot>;
  dataInfo(): Promise<DataInfo>;
  revealDataFolder(): Promise<void>;

  /** Menu commands (File, View) arrive here. Returns an unsubscribe function. */
  onCommand(cb: (command: MenuCommand) => void): () => void;
}

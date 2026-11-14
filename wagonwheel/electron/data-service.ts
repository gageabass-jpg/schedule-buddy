import { app, dialog, shell, type BrowserWindow } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { DataInfo, SavedFile, Snapshot } from "../shared/types.js";
import { backupDatabase, openDatabase, replaceDatabaseFile, SCHEMA_VERSION, stageRestore } from "./db/database.js";
import { AppError } from "./db/errors.js";
import { buildCsvFiles, buildJsonExport } from "./db/exporters.js";
import { watchForOtherWriters } from "./db/external-changes.js";
import { Workspace } from "./db/repo.js";
import { nextRevision } from "./db/revision.js";

const stamp = (d = new Date()): string => {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** Owns the database handle and everything that touches the disk or a dialog.
 *  The handle can be swapped (restore, start fresh), so nothing else keeps one. */
export class DataService {
  private db: DatabaseSync | null = null;
  private workspace: Workspace | null = null;
  /** Why the database is not open, when it is not. */
  private openError: AppError | null = null;

  constructor(
    readonly file: string,
    private readonly window: () => BrowserWindow | null,
  ) {
    this.tryOpen();
  }

  private tryOpen(): void {
    try {
      this.db = openDatabase(this.file);
      this.workspace = new Workspace(this.db, undefined, undefined, nextRevision);
      this.openError = null;
    } catch (err) {
      this.db = null;
      this.workspace = null;
      this.openError = err instanceof AppError ? err : new AppError("database", String(err));
    }
  }

  /** The workspace, or the reason it is not available. Retries the open each time. */
  ws(): Workspace {
    if (!this.workspace) this.tryOpen();
    if (!this.workspace) throw this.openError ?? new AppError("database", "The database is not open.");
    return this.workspace;
  }

  /** The open handle, for the calls that need SQLite itself rather than the Workspace. */
  private live(): DatabaseSync {
    this.ws();
    return this.db as DatabaseSync;
  }

  /** Calls `onChange` when another process (Claude Code, through the connector) changes the workspace file. */
  watchOtherWriters(onChange: () => void): { stop(): void } {
    return watchForOtherWriters(() => this.db, onChange);
  }

  close(): void {
    try { this.db?.close(); } catch { /* already closed */ }
    this.db = null;
    this.workspace = null;
  }

  // ── Files ────────────────────────────────────────────────────────────────

  dataInfo(): DataInfo {
    const ws = this.ws();
    ws.snapshot();   // proves the database answers
    let size = 0;
    try { size = fs.statSync(this.file).size; } catch { /* not written yet */ }
    return { path: this.file, sizeBytes: size, schemaVersion: SCHEMA_VERSION };
  }

  revealDataFolder(): void {
    shell.showItemInFolder(this.file);
  }

  async backup(): Promise<SavedFile | null> {
    const db = this.live();
    const picked = await this.save("Back up Nucleus Wagonwheel", `Wagonwheel backup ${stamp()}.db`, "Wagonwheel database", ["db"]);
    if (!picked) return null;
    await backupDatabase(db, picked);
    return { path: picked };
  }

  async exportJson(): Promise<SavedFile | null> {
    const snapshot = this.ws().snapshot();
    const picked = await this.save("Export as JSON", `Wagonwheel export ${stamp()}.json`, "JSON", ["json"]);
    if (!picked) return null;
    this.write(picked, buildJsonExport(snapshot, SCHEMA_VERSION, Date.now()));
    return { path: picked };
  }

  async exportCsv(): Promise<SavedFile | null> {
    const snapshot = this.ws().snapshot();
    const win = this.window();
    const options = { title: "Export as CSV: choose where to put the folder", properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    // A new folder each time, so an export never overwrites an earlier one.
    const base = path.join(result.filePaths[0], `Wagonwheel export ${stamp()}`);
    let folder = base;
    for (let i = 2; fs.existsSync(folder); i++) folder = `${base} (${i})`;
    try {
      fs.mkdirSync(folder, { recursive: true });
      for (const [name, text] of Object.entries(buildCsvFiles(snapshot))) fs.writeFileSync(path.join(folder, name), text, "utf8");
    } catch (err) {
      throw new AppError("database", `The CSV files could not be written: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { path: folder };
  }

  /** Replace the workspace with a backup file. Returns null if the person backs out. */
  async restore(): Promise<Snapshot | null> {
    const win = this.window();
    const options = { title: "Choose a Wagonwheel backup", properties: ["openFile"] as "openFile"[], filters: [{ name: "Wagonwheel database", extensions: ["db"] }] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    const source = result.filePaths[0];

    // Only the rows of the backup are used, copied into a new file with this app's own schema, so nothing the
    // backup carries inside itself (a trigger, say) ever runs here. This also finds out, before anything is asked
    // or changed, that a file cannot be used. Nothing live is touched until the person agrees.
    const staged = `${this.file}.restoring`;
    stageRestore(source, staged);
    const discardStaged = (): void => {
      for (const suffix of ["", "-wal", "-shm"]) {
        try { fs.rmSync(staged + suffix, { force: true }); } catch { /* none */ }
      }
    };
    try {
      const safetyCopy = path.join(path.dirname(this.file), `before-restore-${stamp()}.db`);
      const box = {
        type: "warning" as const,
        buttons: ["Replace my workspace", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        message: "Replace your workspace with this backup?",
        detail: `Everything in the app now is replaced by the contents of:\n${source}\n\nYour current workspace is saved first, as:\n${safetyCopy}`,
      };
      const answer = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
      if (answer.response !== 0) return null;

      // Save what is there now, while the database is still open and consistent.
      await backupDatabase(this.live(), safetyCopy);
      this.close();
      try {
        replaceDatabaseFile(this.file, staged);
        this.tryOpen();
        if (!this.workspace) throw this.openError;
      } catch (err) {
        // Put the old workspace back.
        replaceDatabaseFile(this.file, safetyCopy);
        this.tryOpen();
        throw new AppError("database", `The backup could not be used, so your workspace was left as it was. (${err instanceof Error ? err.message : String(err)})`);
      }
      return this.ws().snapshot();
    } finally {
      discardStaged();
    }
  }

  /** The file would not open. Keep it under another name and begin again. */
  startFresh(): Snapshot {
    this.close();
    const aside = `${this.file}.unreadable-${stamp()}`;
    try {
      if (fs.existsSync(this.file)) fs.renameSync(this.file, aside);
      for (const suffix of ["-wal", "-shm"]) fs.rmSync(this.file + suffix, { force: true });
    } catch (err) {
      throw new AppError("database", `The unreadable file could not be moved aside: ${err instanceof Error ? err.message : String(err)}`);
    }
    return this.ws().snapshot();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async save(title: string, name: string, filterName: string, extensions: string[]): Promise<string | null> {
    const win = this.window();
    const options = { title, defaultPath: path.join(app.getPath("documents"), name), filters: [{ name: filterName, extensions }] };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  }

  private write(file: string, text: string): void {
    try {
      fs.writeFileSync(file, text, "utf8");
    } catch (err) {
      throw new AppError("database", `The file could not be written: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}


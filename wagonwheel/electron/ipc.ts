import { ipcMain } from "electron";
import type { Reply } from "../shared/types.js";
import type { WagonwheelApi } from "../shared/api.js";
import { toWagonwheelError } from "./db/errors.js";
import type { DataService } from "./data-service.js";

/** The calls the window may make, by name. The preload sends `ww:<name>`. Anything not
 *  listed here does not exist as far as the renderer is concerned. */
type Calls = Omit<WagonwheelApi, "platform" | "onCommand">;

export function registerIpc(data: DataService): void {
  const calls: { [K in keyof Calls]: (...args: Parameters<Calls[K]>) => Awaited<ReturnType<Calls[K]>> | Promise<Awaited<ReturnType<Calls[K]>>> } = {
    getSnapshot: () => data.ws().snapshot(),

    createProject: (input) => data.ws().createProject(input),
    updateProject: (id, patch) => data.ws().updateProject(id, patch),
    deleteProject: (id) => data.ws().deleteProject(id),

    createTask: (input) => data.ws().createTask(input),
    updateTask: (id, patch) => data.ws().updateTask(id, patch),
    deleteTask: (id) => data.ws().deleteTask(id),

    createMilestone: (input) => data.ws().createMilestone(input),
    updateMilestone: (id, patch) => data.ws().updateMilestone(id, patch),
    deleteMilestone: (id) => data.ws().deleteMilestone(id),

    createNote: (input) => data.ws().createNote(input),
    updateNote: (id, body) => data.ws().updateNote(id, body),
    deleteNote: (id) => data.ws().deleteNote(id),

    setSetting: (key, value) => data.ws().setSetting(key, value),

    backupDatabase: () => data.backup(),
    exportJson: () => data.exportJson(),
    exportCsv: () => data.exportCsv(),
    restoreBackup: () => data.restore(),
    startFresh: () => data.startFresh(),
    dataInfo: () => data.dataInfo(),
    revealDataFolder: () => data.revealDataFolder(),
  };

  for (const [name, fn] of Object.entries(calls)) {
    ipcMain.handle(`ww:${name}`, async (_event, ...args: unknown[]): Promise<Reply<unknown>> => {
      try {
        // The argument types are enforced by the preload's signature and checked again by
        // the validators in db/repo.ts. This is the edge, so it takes unknown.
        return { ok: true, data: await (fn as (...a: unknown[]) => unknown)(...args) };
      } catch (err) {
        console.error(`[ww:${name}]`, err);
        return { ok: false, error: toWagonwheelError(err) };
      }
    });
  }
}

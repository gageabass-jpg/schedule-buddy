import { ipcMain } from "electron";
import type { Reply } from "../shared/types.js";
import type { WagonwheelApi } from "../shared/api.js";
import { toWagonwheelError } from "./db/errors.js";
import type { DataService } from "./data-service.js";
import type { GithubService } from "./github/service.js";
import type { ConnectorsService } from "./connectors/service.js";
import type { ServicesService } from "./services/service.js";

/** The calls the window may make, by name. The preload sends `ww:<name>`. Anything not
 *  listed here does not exist as far as the renderer is concerned. */
type Calls = Omit<WagonwheelApi, "platform" | "onCommand" | "onExternalChange">;

export function registerIpc(data: DataService, github: GithubService, connectors: ConnectorsService, services: ServicesService): void {
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

    createService: (input) => data.ws().createService(input),
    updateService: (id, patch) => data.ws().updateService(id, patch),
    deleteService: (id) => data.ws().deleteService(id),
    setServiceCharge: (input) => data.ws().setCharge(input),
    deleteServiceCharge: (id) => data.ws().deleteCharge(id),

    servicesStatus: () => services.status(),
    servicesSetToken: (provider, token, teamId) => services.setToken(provider, token, teamId),
    servicesClearToken: (provider) => services.clearToken(provider),
    servicesCheckUsage: (serviceId) => services.checkUsage(serviceId),

    setSetting: (key, value) => data.ws().setSetting(key, value),

    backupDatabase: () => data.backup(),
    exportJson: () => data.exportJson(),
    exportCsv: () => data.exportCsv(),
    restoreBackup: () => data.restore(),
    startFresh: () => data.startFresh(),
    dataInfo: () => data.dataInfo(),
    revealDataFolder: () => data.revealDataFolder(),

    githubStatus: () => github.status(),
    githubSetClientId: (clientId) => github.setClientId(clientId),
    githubStartSignIn: (includePrivate) => github.startSignIn(includePrivate === true),
    githubPollSignIn: () => github.pollSignIn(),
    githubSignOut: () => github.signOut(),
    githubListRepos: () => github.listRepos(),
    githubScanRepo: (fullName) => github.scanRepo(fullName),

    connectorsStatus: () => connectors.status(),
    connectorsConnect: (readOnly) => connectors.connect(readOnly === true),
    connectorsDisconnect: () => connectors.disconnect(),
    connectorsCheckIcloud: () => connectors.checkIcloud(),
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

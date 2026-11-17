import { contextBridge, ipcRenderer } from "electron";
import type { WagonwheelApi } from "../shared/api.js";
import type { MenuCommand, Reply } from "../shared/types.js";

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke(`ww:${name}`, ...args)) as Reply<T>;
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.data;
}

const api: WagonwheelApi = {
  platform: process.platform,
  getSnapshot: () => call("getSnapshot"),

  createProject: (input) => call("createProject", input),
  updateProject: (id, patch) => call("updateProject", id, patch),
  deleteProject: (id) => call("deleteProject", id),

  createTask: (input) => call("createTask", input),
  updateTask: (id, patch) => call("updateTask", id, patch),
  deleteTask: (id) => call("deleteTask", id),

  createMilestone: (input) => call("createMilestone", input),
  updateMilestone: (id, patch) => call("updateMilestone", id, patch),
  deleteMilestone: (id) => call("deleteMilestone", id),

  createNote: (input) => call("createNote", input),
  updateNote: (id, body) => call("updateNote", id, body),
  deleteNote: (id) => call("deleteNote", id),

  createService: (input) => call("createService", input),
  updateService: (id, patch) => call("updateService", id, patch),
  deleteService: (id) => call("deleteService", id),
  setServiceCharge: (input) => call("setServiceCharge", input),
  deleteServiceCharge: (id) => call("deleteServiceCharge", id),

  servicesStatus: () => call("servicesStatus"),
  servicesSetToken: (provider, token, teamId) => call("servicesSetToken", provider, token, teamId),
  servicesClearToken: (provider) => call("servicesClearToken", provider),
  servicesCheckUsage: (serviceId) => call("servicesCheckUsage", serviceId),

  setSetting: (key, value) => call("setSetting", key, value),

  backupDatabase: () => call("backupDatabase"),
  exportJson: () => call("exportJson"),
  exportCsv: () => call("exportCsv"),
  restoreBackup: () => call("restoreBackup"),
  startFresh: () => call("startFresh"),
  dataInfo: () => call("dataInfo"),
  revealDataFolder: () => call("revealDataFolder"),

  githubStatus: () => call("githubStatus"),
  githubSetClientId: (clientId) => call("githubSetClientId", clientId),
  githubStartSignIn: (includePrivate) => call("githubStartSignIn", includePrivate),
  githubPollSignIn: () => call("githubPollSignIn"),
  githubSignOut: () => call("githubSignOut"),
  githubListRepos: () => call("githubListRepos"),
  githubScanRepo: (fullName) => call("githubScanRepo", fullName),

  connectorsStatus: () => call("connectorsStatus"),
  connectorsConnect: (readOnly) => call("connectorsConnect", readOnly),
  connectorsDisconnect: () => call("connectorsDisconnect"),
  connectorsCheckIcloud: () => call("connectorsCheckIcloud"),

  onExternalChange: (cb) => {
    const handler = (): void => cb();
    ipcRenderer.on("ww:external-change", handler);
    return () => ipcRenderer.removeListener("ww:external-change", handler);
  },

  onCommand: (cb) => {
    const handler = (_e: unknown, command: MenuCommand): void => cb(command);
    ipcRenderer.on("ww:command", handler);
    return () => ipcRenderer.removeListener("ww:command", handler);
  },
};

contextBridge.exposeInMainWorld("wagonwheel", api);

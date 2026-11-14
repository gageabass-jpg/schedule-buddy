// What the preload script puts on `window.wagonwheel`. The renderer sees only this.
// Every call can fail; the preload turns a failed Reply into a thrown WagonwheelError.

import type {
  Change, ChargeInput, DataInfo, MenuCommand, MilestoneInput, MilestonePatch, NoteInput,
  ProjectInput, ProjectPatch, SavedFile, ServiceInput, ServicePatch, Snapshot, TaskInput, TaskPatch,
} from "./types.js";
import type { GithubDeviceCode, GithubPoll, GithubRepo, GithubScan, GithubStatus } from "./github.js";
import type { ConnectorsStatus, IcloudCheck } from "./connectors.js";
import type { ServicesStatus, UsageOutcome } from "./services.js";

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

  createService(input: ServiceInput): Promise<Change>;
  updateService(id: string, patch: ServicePatch): Promise<Change>;
  deleteService(id: string): Promise<Snapshot>;
  /** Type in what a service charged for a month. Replaces the figure already there. */
  setServiceCharge(input: ChargeInput): Promise<Change>;
  deleteServiceCharge(id: string): Promise<Snapshot>;

  // Reading a service's bill from its provider. These use the network, only when the person asks,
  // and run in the main process; the token stays there and the window never sees it.

  servicesStatus(): Promise<ServicesStatus>;
  /** Save a provider's token (after the provider accepts it). `teamId` may be empty. */
  servicesSetToken(provider: string, token: string, teamId: string): Promise<ServicesStatus>;
  servicesClearToken(provider: string): Promise<ServicesStatus>;
  /** Check the usage a provider has billed beyond the plan, this month and last. Writes no bill; only "last checked" changes. */
  servicesCheckUsage(serviceId: string): Promise<UsageOutcome>;

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

  // GitHub. The only calls that use the network, and only when the person asks. They run in
  // the main process; the token stays there and the window never sees it.

  githubStatus(): Promise<GithubStatus>;
  /** Remember the Client ID of the OAuth app the person registered on GitHub. */
  githubSetClientId(clientId: string): Promise<GithubStatus>;
  /** Begin a device-flow sign-in: opens github.com/login/device and returns the code to type there. */
  githubStartSignIn(includePrivate: boolean): Promise<GithubDeviceCode>;
  /** Ask GitHub once whether the person has finished. Call it every `intervalSeconds`. */
  githubPollSignIn(): Promise<GithubPoll>;
  /** Forget the saved sign-in (the Client ID stays). */
  githubSignOut(): Promise<GithubStatus>;
  githubListRepos(): Promise<GithubRepo[]>;
  /** Read one repository's open issues, pull requests, milestones and roadmap notes, and propose tasks. */
  githubScanRepo(fullName: string): Promise<GithubScan>;

  // Connectors. These look at how Claude Code is set up (it reads Claude Code's own list of connectors and, on
  // request, runs its `claude mcp` command), and never return a secret.

  connectorsStatus(): Promise<ConnectorsStatus>;
  /** Register Wagonwheel's connector with Claude Code (replacing an earlier registration). readOnly leaves out every tool that changes anything. */
  connectorsConnect(readOnly: boolean): Promise<ConnectorsStatus>;
  /** Remove Wagonwheel's connector from Claude Code. */
  connectorsDisconnect(): Promise<ConnectorsStatus>;
  /** Ask the iCloud Mail connector to sign in to iCloud, and say what it printed. */
  connectorsCheckIcloud(): Promise<IcloudCheck>;

  /** Another process (Claude Code, through the connector) changed the workspace file: reload it. Returns an unsubscribe function. */
  onExternalChange(cb: () => void): () => void;

  /** Menu commands (File, View) arrive here. Returns an unsubscribe function. */
  onCommand(cb: (command: MenuCommand) => void): () => void;
}

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useData } from "./store";

// Where the person is (the view, the selected date) and which dialog is open.
// One small context, so any row in any view can open a task without prop drilling.

export type ProjectTab = "tasks" | "milestones" | "notes" | "timeline";

export type View =
  | { name: "dashboard" }
  | { name: "projects" }
  | { name: "project"; id: string; tab?: ProjectTab }
  | { name: "tasks" }
  | { name: "timeline" }
  | { name: "inbox" }
  | { name: "services" }
  | { name: "day"; date: string };

export interface TaskDefaults {
  projectId?: string | null;
  parentId?: string | null;
  dueDate?: string | null;
}
export type TaskDialogState = { id: string; defaults?: undefined } | { id: null; defaults: TaskDefaults };
export type ProjectDialogState = { id: string | null };
export type MilestoneDialogState = { id: string | null; projectId: string };
export type ServiceDialogState = { id: string | null };
/** How the GitHub dialog opens: scan any repositories, connect one to a project, or scan the one a project is connected to. */
export type GithubDialogState =
  | { mode: "scan" }
  | { mode: "connect"; projectId: string }
  | { mode: "scan-project"; projectId: string };

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  /** Styles the button as a destructive one. */
  danger?: boolean;
}

interface UiValue {
  view: View;
  go(view: View): void;
  selectedDate: string;
  /** Pick a day. On the timeline it re-centres; anywhere else it opens that day's agenda. */
  selectDate(iso: string): void;

  taskDialog: TaskDialogState | null;
  newTask(defaults?: TaskDefaults): void;
  editTask(id: string): void;
  closeTask(): void;

  projectDialog: ProjectDialogState | null;
  newProject(): void;
  editProject(id: string): void;
  closeProject(): void;

  milestoneDialog: MilestoneDialogState | null;
  newMilestone(projectId: string): void;
  editMilestone(id: string, projectId: string): void;
  closeMilestone(): void;

  serviceDialog: ServiceDialogState | null;
  newService(): void;
  editService(id: string): void;
  closeService(): void;

  /** The GitHub dialog (scan for tasks, or connect a repository to a project). */
  githubDialog: GithubDialogState | null;
  openGithub(state?: GithubDialogState): void;
  closeGithub(): void;

  /** The Connectors panel (Claude Code, GitHub, iCloud Mail). */
  connectorsDialog: boolean;
  openConnectors(): void;
  closeConnectors(): void;

  confirm(options: ConfirmOptions): Promise<boolean>;
  confirming: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;

  /** Bumps when something asks the sidebar's capture box to take focus. */
  captureTick: number;
  focusCapture(): void;
  /** Whether the sidebar inbox list is open. */
  inboxOpen: boolean;
  setInboxOpen(open: boolean): void;
}

const Ctx = createContext<UiValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const { today } = useData();
  const [view, setView] = useState<View>({ name: "dashboard" });
  const [selectedDate, setSelectedDate] = useState(today);
  const [taskDialog, setTaskDialog] = useState<TaskDialogState | null>(null);
  const [projectDialog, setProjectDialog] = useState<ProjectDialogState | null>(null);
  const [milestoneDialog, setMilestoneDialog] = useState<MilestoneDialogState | null>(null);
  const [serviceDialog, setServiceDialog] = useState<ServiceDialogState | null>(null);
  const [githubDialog, setGithubDialog] = useState<GithubDialogState | null>(null);
  const [connectorsDialog, setConnectorsDialog] = useState(false);
  const [confirming, setConfirming] = useState<UiValue["confirming"]>(null);
  const [captureTick, setCaptureTick] = useState(0);
  const [inboxOpen, setInboxOpen] = useState(false);

  const go = useCallback((v: View) => {
    setView(v);
    if (v.name === "day") setSelectedDate(v.date);
  }, []);

  const selectDate = useCallback((iso: string) => {
    setSelectedDate(iso);
    setView((v) => (v.name === "timeline" ? v : { name: "day", date: iso }));
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirming({ ...options, resolve })),
    [],
  );

  const value = useMemo<UiValue>(() => ({
    view, go, selectedDate, selectDate,
    taskDialog,
    newTask: (defaults = {}) => setTaskDialog({ id: null, defaults }),
    editTask: (id) => setTaskDialog({ id }),
    closeTask: () => setTaskDialog(null),
    projectDialog,
    newProject: () => setProjectDialog({ id: null }),
    editProject: (id) => setProjectDialog({ id }),
    closeProject: () => setProjectDialog(null),
    milestoneDialog,
    newMilestone: (projectId) => setMilestoneDialog({ id: null, projectId }),
    editMilestone: (id, projectId) => setMilestoneDialog({ id, projectId }),
    closeMilestone: () => setMilestoneDialog(null),
    serviceDialog,
    newService: () => setServiceDialog({ id: null }),
    editService: (id) => setServiceDialog({ id }),
    closeService: () => setServiceDialog(null),
    githubDialog,
    openGithub: (state = { mode: "scan" }) => setGithubDialog(state),
    closeGithub: () => setGithubDialog(null),
    connectorsDialog,
    openConnectors: () => setConnectorsDialog(true),
    closeConnectors: () => setConnectorsDialog(false),
    confirm, confirming,
    captureTick,
    focusCapture: () => { setInboxOpen(true); setCaptureTick((n) => n + 1); },
    inboxOpen, setInboxOpen,
  }), [view, go, selectedDate, selectDate, taskDialog, projectDialog, milestoneDialog, serviceDialog, githubDialog, connectorsDialog, confirm, confirming, captureTick, inboxOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi(): UiValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUi needs a UiProvider");
  return v;
}

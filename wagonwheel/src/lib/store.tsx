import { createContext, useCallback, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  DEFAULT_WORKSPACE_NAME, SETTING_WORKSPACE_NAME,
  type Change, type MilestoneInput, type MilestonePatch, type NoteInput, type ProjectInput, type ProjectPatch,
  type Snapshot, type TaskInput, type TaskPatch,
} from "@shared/types";
import { notify } from "@nucleus/ui/lib/toast";
import { bridge, messageOf } from "./bridge";
import { todayIso } from "./dates";

const EMPTY: Snapshot = { projects: [], tasks: [], milestones: [], notes: [], settings: {} };

/** Every change goes to SQLite through the main process, which answers with the whole
 *  workspace. The actions throw on a refused change, so a form can show the reason.
 *  `attempt` runs one and shows the reason as a toast instead. */
export interface Actions {
  createProject(input: ProjectInput): Promise<string>;
  updateProject(id: string, patch: ProjectPatch): Promise<void>;
  deleteProject(id: string): Promise<void>;
  createTask(input: TaskInput): Promise<string>;
  updateTask(id: string, patch: TaskPatch): Promise<void>;
  deleteTask(id: string): Promise<void>;
  createMilestone(input: MilestoneInput): Promise<string>;
  updateMilestone(id: string, patch: MilestonePatch): Promise<void>;
  deleteMilestone(id: string): Promise<void>;
  createNote(input: NoteInput): Promise<string>;
  updateNote(id: string, body: string): Promise<void>;
  deleteNote(id: string): Promise<void>;
  renameWorkspace(name: string): Promise<void>;
}

interface DataValue {
  status: "loading" | "ready" | "error";
  error: string | null;
  snapshot: Snapshot;
  workspaceName: string;
  /** Today's date; it moves on at midnight. */
  today: string;
  /** The time, refreshed every 30 seconds. Views read this instead of calling Date.now() while they draw. */
  now: number;
  act: Actions;
  attempt<T>(fn: () => Promise<T>): Promise<T | undefined>;
  /** Like attempt, for a change that returns nothing: true if it went through, false if it was refused (and a toast said why). */
  attemptOk(fn: () => Promise<unknown>): Promise<boolean>;
  reload(): Promise<void>;
  /** Replace the snapshot, for a restore. */
  adopt(snapshot: Snapshot): void;
  startFresh(): Promise<void>;
}

const Ctx = createContext<DataValue | null>(null);

/** The actions, bound to the store's setter. Each one asks the main process to change SQLite,
 *  then takes the new workspace it sends back. */
function makeActions(setSnapshot: Dispatch<SetStateAction<Snapshot>>): Actions {
  const keepId = async (p: Promise<Change>): Promise<string> => {
    const c = await p;
    setSnapshot(c.snapshot);
    return c.id;
  };
  const keep = async (p: Promise<Change | Snapshot>): Promise<void> => {
    const r = await p;
    setSnapshot("snapshot" in r ? r.snapshot : r);
  };
  return {
    createProject: (i) => keepId(bridge().createProject(i)),
    updateProject: (id, p) => keep(bridge().updateProject(id, p)),
    deleteProject: (id) => keep(bridge().deleteProject(id)),
    createTask: (i) => keepId(bridge().createTask(i)),
    updateTask: (id, p) => keep(bridge().updateTask(id, p)),
    deleteTask: (id) => keep(bridge().deleteTask(id)),
    createMilestone: (i) => keepId(bridge().createMilestone(i)),
    updateMilestone: (id, p) => keep(bridge().updateMilestone(id, p)),
    deleteMilestone: (id) => keep(bridge().deleteMilestone(id)),
    createNote: (i) => keepId(bridge().createNote(i)),
    updateNote: (id, b) => keep(bridge().updateNote(id, b)),
    deleteNote: (id) => keep(bridge().deleteNote(id)),
    renameWorkspace: (name) => keep(bridge().setSetting(SETTING_WORKSPACE_NAME, name)),
  };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [status, setStatus] = useState<DataValue["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => todayIso());
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      setSnapshot(await bridge().getSnapshot());
      setStatus("ready");
      setError(null);
    } catch (err) {
      setStatus("error");
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // The date changes while the app is open overnight.
  useEffect(() => {
    const id = window.setInterval(() => {
      setToday((t) => { const n = todayIso(); return n === t ? t : n; });
      setNow(Date.now());
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // setSnapshot never changes, so the actions are made once.
  const act = useMemo(() => makeActions(setSnapshot), []);

  const attempt = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (err) {
      notify(messageOf(err), { ttl: 8000 });
      return undefined;
    }
  }, []);

  const attemptOk = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch (err) {
      notify(messageOf(err), { ttl: 8000 });
      return false;
    }
  }, []);

  const startFresh = useCallback(async () => {
    try {
      setSnapshot(await bridge().startFresh());
      setStatus("ready");
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  const value = useMemo<DataValue>(() => ({
    status, error, snapshot, today,
    workspaceName: snapshot.settings[SETTING_WORKSPACE_NAME] || DEFAULT_WORKSPACE_NAME,
    act, now,
    attempt, attemptOk, reload, adopt: setSnapshot, startFresh,
  }), [status, error, snapshot, today, now, act, attempt, attemptOk, reload, startFresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData needs a DataProvider");
  return v;
}

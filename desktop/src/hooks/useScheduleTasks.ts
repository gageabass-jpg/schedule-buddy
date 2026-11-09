import { useEffect, useRef, useState } from "react";
import { deleteField, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { TASKS_LINGER_MS, visibleTasks, type ScheduleTasks, type TasksDone } from "../lib/scheduleTasks";

/**
 * What the sidebar's task list shows: the list, or null for its empty state.
 *
 * `tasks` is what lib/scheduleTasks works out for today. A list whose tasks are
 * all done stays on screen for a day, then turns into the empty state, so this
 * remembers when each period's tasks were finished, in meta/cadence (`tasksDone`,
 * beside the schedule reminders' own flags). It records that the first time it
 * sees a period finished, and forgets it if something comes undone again (a new
 * childcare gap). A timer brings the empty state in at the 24-hour mark without
 * waiting for anything else to re-render.
 */
export function useScheduleTasks(householdId: string | null, tasks: ScheduleTasks | null): ScheduleTasks | null {
  // What was read, and for which household, so a switch never shows the last one's.
  const [read, setRead] = useState<{ householdId: string; done: TasksDone | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const written = useRef<string | null>(null);

  useEffect(() => {
    if (!householdId) return;
    return onSnapshot(
      doc(db, "households", householdId, "meta", "cadence"),
      (snap) => {
        const d = snap.data()?.tasksDone as Partial<TasksDone> | undefined;
        const done = d && typeof d.periodEnd === "string" && typeof d.at === "number" ? { periodEnd: d.periodEnd, at: d.at } : null;
        setRead({ householdId, done });
      },
      // Keep what we had: the list just shows without a retire time.
      (err) => console.error("task list subscription error:", err),
    );
  }, [householdId]);

  const loaded = !!householdId && read?.householdId === householdId;
  const done = loaded ? read.done : null;

  // Record when a period's tasks were all finished; forget it if one comes undone.
  useEffect(() => {
    if (!householdId || !loaded || !tasks) return;
    const recorded = done?.periodEnd === tasks.periodEnd;
    const ref = doc(db, "households", householdId, "meta", "cadence");
    if (tasks.allComplete && !recorded) {
      const key = `${householdId}:${tasks.periodEnd}`;
      if (written.current === key) return; // already sent; the snapshot hasn't caught up
      written.current = key;
      setDoc(ref, { tasksDone: { periodEnd: tasks.periodEnd, at: Date.now() } }, { merge: true })
        .catch((e) => { written.current = null; console.error("record finished tasks failed:", e); });
    } else if (!tasks.allComplete && recorded) {
      written.current = null;
      setDoc(ref, { tasksDone: deleteField() }, { merge: true })
        .catch((e) => console.error("clear finished tasks failed:", e));
    }
  }, [householdId, loaded, tasks, done]);

  // Re-evaluate when the day is up.
  const retireAt = tasks?.allComplete && done?.periodEnd === tasks.periodEnd ? done.at + TASKS_LINGER_MS : null;
  useEffect(() => {
    if (retireAt === null) return;
    const wait = retireAt - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), wait + 50);
    return () => clearTimeout(timer);
  }, [retireAt]);

  return visibleTasks(tasks, done, now);
}

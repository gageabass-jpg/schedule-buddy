import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";

/**
 * The 4-week schedule reminder, driven by households/{hid}/meta/cadence.
 *
 * The `checkScheduleCadence` Cloud Function sets `dueCycle` (the last-Friday
 * date that fired) on the last Friday of each 4-week schedule. The desktop
 * shows two cards until each is dismissed for that cycle — dismissal records
 * the cycle in `ackUpdate` / `ackCaregiver`, so a card only reappears when a
 * NEW cycle's dueCycle no longer matches its ack.
 */
interface CadenceDoc {
  dueCycle?: string;
  ackUpdate?: string;
  ackCaregiver?: string;
}

export interface ScheduleReminder {
  /** Show the "update the schedule" card. */
  showUpdate: boolean;
  /** Show the "send caregiver requests" card. */
  showCaregiver: boolean;
  /** Record that a card was dismissed for the current cycle. */
  dismiss: (which: "update" | "caregiver") => void;
}

export function useScheduleReminder(householdId: string | null): ScheduleReminder {
  const [data, setData] = useState<CadenceDoc | null>(null);

  useEffect(() => {
    if (!householdId) { setData(null); return; }
    const ref = doc(db, "households", householdId, "meta", "cadence");
    const unsub = onSnapshot(
      ref,
      (snap) => setData(snap.exists() ? (snap.data() as CadenceDoc) : null),
      (err) => { console.error("cadence subscription error:", err); setData(null); },
    );
    return () => unsub();
  }, [householdId]);

  const due = data?.dueCycle ?? null;
  const showUpdate = !!due && data?.ackUpdate !== due;
  const showCaregiver = !!due && data?.ackCaregiver !== due;

  const dismiss = (which: "update" | "caregiver") => {
    if (!householdId || !due) return;
    const ref = doc(db, "households", householdId, "meta", "cadence");
    const field = which === "update" ? "ackUpdate" : "ackCaregiver";
    setDoc(ref, { [field]: due }, { merge: true })
      .catch((e) => console.error("dismiss reminder failed:", e));
  };

  return { showUpdate, showCaregiver, dismiss };
}

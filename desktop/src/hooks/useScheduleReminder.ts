import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";

/**
 * The two Inspector reminder cards, backed by households/{hid}/meta/cadence.
 *
 * They answer different questions, so they're triggered differently:
 *
 *   "Update the schedule"      — CALENDAR-driven. The checkScheduleCadence
 *      Cloud Function sets `dueCycle` to the most recent cycle-closing Friday;
 *      dismissing stores that date in `ackUpdate`. A missed Friday therefore
 *      keeps nagging (the flag stays on the past cycle) instead of evaporating.
 *
 *   "Send caregiver requests"  — CONDITION-driven. Shows whenever upcoming
 *      both-working days have no coverage lined up, passed in as a signature
 *      of that date-set. Dismissing stores the signature in `ackCoverage`, so
 *      the card returns when a genuinely new day needs coverage — and
 *      disappears on its own once the requests are actually sent.
 */
interface CadenceDoc {
  dueCycle?: string;
  ackUpdate?: string;
  ackCoverage?: string;
}

export interface ScheduleReminder {
  showUpdate: boolean;
  showCaregiver: boolean;
  dismiss: (which: "update" | "caregiver") => void;
}

export function useScheduleReminder(
  householdId: string | null,
  coverageNeedsSig: string,
  today: string,
): ScheduleReminder {
  const [data, setData] = useState<CadenceDoc | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    if (!householdId) { setData(null); return; }
    const ref = doc(db, "households", householdId, "meta", "cadence");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setData(snap.exists() ? (snap.data() as CadenceDoc) : null);
        setLoaded(true);
      },
      (err) => {
        // Keep whatever we already had — clearing it would resurrect cards the
        // user dismissed, permanently, on a transient listener error.
        console.error("cadence subscription error:", err);
        setLoaded(true);
      },
    );
    return () => unsub();
  }, [householdId]);

  // Gate on `loaded` so a dismissed card doesn't flash back on launch while
  // the cadence doc is still in flight (the state listener resolves first).
  const due = data?.dueCycle ?? null;
  const showUpdate = loaded && !!due && data?.ackUpdate !== due;

  // Drop already-past dates from the stored ack before comparing. The need-set
  // slides forward every day, so an un-pruned ack stops matching on its own
  // and the dismissal silently evaporates within a day or two. Pruning leaves
  // exact-set semantics intact, so a genuinely new uncovered day still nags —
  // and so does a day that returns because the caregiver declined it.
  const ackAlive = (data?.ackCoverage ?? "")
    .split(",")
    .filter((d) => d !== "" && d >= today)
    .join(",");
  const showCaregiver = loaded && coverageNeedsSig !== "" && ackAlive !== coverageNeedsSig;

  // Retire the ack once nothing needs coverage. Without this, sending every
  // request (sig → "") and then having them all declined reproduces the exact
  // same signature, which would match the stale ack and hide the card for good.
  useEffect(() => {
    if (!householdId || !loaded) return;
    if (coverageNeedsSig !== "" || !data?.ackCoverage) return;
    setDoc(doc(db, "households", householdId, "meta", "cadence"), { ackCoverage: "" }, { merge: true })
      .catch((e) => console.error("clear coverage ack failed:", e));
  }, [householdId, loaded, coverageNeedsSig, data?.ackCoverage]);

  const dismiss = (which: "update" | "caregiver") => {
    if (!householdId) return;
    const ref = doc(db, "households", householdId, "meta", "cadence");
    const patch =
      which === "update"
        ? (due ? { ackUpdate: due } : null)
        : { ackCoverage: coverageNeedsSig };
    if (!patch) return;
    setDoc(ref, patch, { merge: true })
      .catch((e) => console.error("dismiss reminder failed:", e));
  };

  return { showUpdate, showCaregiver, dismiss };
}

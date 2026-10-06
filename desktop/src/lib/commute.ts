// Commute: the home address and each person's workplace (Google place ids),
// and the "leave by" results the checkCommutes function writes before shifts.
//
// Settings live in households/{hid}/private/commute — admin and partner only,
// and outside state/main, which the phone rewrites whole and which feeds the
// public share. Results are households/{hid}/commute/{date}_{who}, written by
// the function alone.

import {
  collection, doc, onSnapshot, query, setDoc, where, type Unsubscribe,
} from "firebase/firestore";
import { db } from "../firebase";

export interface CommutePlace { placeId: string; label: string }
export interface CommuteConfig {
  home?: CommutePlace | null;
  work?: Partial<Record<"G" | "K", CommutePlace | null>>;
  /** Minutes before a shift the household usually leaves (default 45–60). */
  cushion?: { min: number; max: number };
}

export const DEFAULT_CUSHION = { min: 45, max: 60 };

export interface CommuteResult {
  date: string;
  who: "G" | "K";
  shiftStart: string;
  placeLabel: string;
  durationMin: number;
  typicalMin: number;
  /** A normal day's drive at this hour; absent on results from before the cushion. */
  usualMin?: number;
  /** How far the usual window moved earlier for traffic. */
  earlierMin?: number;
  windowFrom?: string;    // "HH:MM" — the usual window, moved
  windowTo?: string;
  leaveBy: string;        // "HH:MM" — the latest departure
  leaveByMs: number;
  heavy: boolean;
  live: boolean;
  checkedAt: number;
}

const configRef = (hid: string) => doc(db, "households", hid, "private", "commute");

/** The household's commute settings, live. Empty when none (or not allowed). */
export function subscribeCommuteConfig(householdId: string, onChange: (c: CommuteConfig) => void): Unsubscribe {
  return onSnapshot(
    configRef(householdId),
    (snap) => onChange((snap.data() as CommuteConfig | undefined) ?? {}),
    () => onChange({}),
  );
}

export async function setCommuteHome(householdId: string, home: CommutePlace | null): Promise<void> {
  await setDoc(configRef(householdId), { home }, { merge: true });
}

export async function setCommuteCushion(householdId: string, cushion: { min: number; max: number }): Promise<void> {
  await setDoc(configRef(householdId), { cushion }, { merge: true });
}

export async function setCommuteWork(householdId: string, who: "G" | "K", place: CommutePlace | null): Promise<void> {
  await setDoc(configRef(householdId), { work: { [who]: place } }, { merge: true });
}

/** "Leave by" results from today on, live, keyed `${date}_${who}`. */
export function subscribeCommuteResults(
  householdId: string,
  fromDate: string,
  onChange: (m: Map<string, CommuteResult>) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, "households", householdId, "commute"), where("date", ">=", fromDate)),
    (snap) => {
      const m = new Map<string, CommuteResult>();
      snap.forEach((d) => m.set(d.id, d.data() as CommuteResult));
      onChange(m);
    },
    () => onChange(new Map()),
  );
}

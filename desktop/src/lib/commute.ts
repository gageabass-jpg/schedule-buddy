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
import type { DriveExit } from "./driveExit";

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
  /** The fastest route first, then alternatives, as encoded polylines. */
  routes?: Array<{ durationMin: number; polyline: string }>;
  /** The exit to get off on along the fastest route; absent on older results,
   *  and on a drive with no numbered exit. */
  exit?: DriveExit;
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

/**
 * "Leave by 2p to 2:33p": the earliest of the usual window (an hour before the
 * shift, moved earlier for traffic) to the latest that still makes it with the
 * ten-minute cushion. Just "Leave by 2:33p" when there's no window left (a long
 * drive) or the result predates windows.
 */
export function leaveByRange(c: CommuteResult, fmt: (hhmm: string) => string): string {
  const mins = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  if (c.windowFrom) {
    const span = (mins(c.leaveBy) - mins(c.windowFrom) + 1440) % 1440;
    if (span > 0 && span < 720) return `Leave by ${fmt(c.windowFrom)} to ${fmt(c.leaveBy)}`;
  }
  return `Leave by ${fmt(c.leaveBy)}`;
}

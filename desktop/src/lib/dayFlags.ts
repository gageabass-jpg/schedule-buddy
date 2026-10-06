// Day flags: a red flag on a calendar day with the household's remarks.
//
// Stored one doc per day in households/{hid}/dayFlags/{YYYY-MM-DD}, not in
// state/main. The phone app rewrites state/main whole and drops fields it
// doesn't know (BRIDGE.md §5.2), so a top-level field there would vanish on
// its next save. A subcollection never passes through that filter, and a
// flag edit can't race a schedule edit.

import {
  collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc,
  type Timestamp, type Unsubscribe,
} from "firebase/firestore";
import { auth, db } from "../firebase";

export interface DayFlag {
  date: string;              // YYYY-MM-DD, also the doc id
  remarks: string;
  flaggedBy: string;         // uid
  flaggedByName: string;
  /** Server time; null briefly between the local write and the server ack. */
  updatedAt: Timestamp | null;
}

export class DayFlagError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DayFlagError";
  }
}

const MAX_REMARKS = 1000;

/** Every flag in the household, live, keyed by date. */
export function subscribeDayFlags(
  householdId: string,
  onChange: (flags: Map<string, DayFlag>) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, "households", householdId, "dayFlags"),
    (snap) => {
      const flags = new Map<string, DayFlag>();
      snap.forEach((d) => {
        const data = d.data() as Omit<DayFlag, "date">;
        flags.set(d.id, { ...data, date: d.id, remarks: data.remarks ?? "" });
      });
      onChange(flags);
    },
    () => onChange(new Map()),
  );
}

/** Flag a day, or change its remarks. */
export async function saveDayFlag(
  householdId: string,
  date: string,
  remarks: string,
  flaggedByName: string,
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!householdId || !uid) throw new DayFlagError("Not signed in.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DayFlagError("That isn't a date.");
  try {
    await setDoc(doc(db, "households", householdId, "dayFlags", date), {
      remarks: remarks.trim().slice(0, MAX_REMARKS),
      flaggedBy: uid,
      flaggedByName: flaggedByName || "Member",
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    throw new DayFlagError("Couldn't save the flag. Check your connection and try again.", e);
  }
}

/** Take the flag off a day. */
export async function removeDayFlag(householdId: string, date: string): Promise<void> {
  try {
    await deleteDoc(doc(db, "households", householdId, "dayFlags", date));
  } catch (e) {
    throw new DayFlagError("Couldn't remove the flag.", e);
  }
}

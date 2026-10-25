// Reading and saving the household's state: the state/main document, read and
// rewritten whole. Every writer in lib/ goes through these two functions.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { HouseholdState } from "../state";

const stateRef = (hid: string) => doc(db, "households", hid, "state", "main");

/** The household's state, or null when it has none yet. */
export async function readHouseholdState(hid: string): Promise<HouseholdState | null> {
  const snap = await getDoc(stateRef(hid));
  return snap.exists() ? (snap.data() as HouseholdState) : null;
}

/** Save `next`, the household's whole state after an edit. */
export async function writeHouseholdState(hid: string, next: HouseholdState): Promise<void> {
  await setDoc(stateRef(hid), next);
}

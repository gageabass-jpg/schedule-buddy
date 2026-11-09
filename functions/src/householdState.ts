// Reading and editing the household's state from the functions: state/main,
// read directly and edited in a transaction.

import { getFirestore } from "firebase-admin/firestore";
import type { HouseholdState } from "./shared/state";

const hhRef = (hid: string) => getFirestore().collection("households").doc(hid);

/** A document written along with an edit, by path from the database root. */
export type WriteOp =
  | { op: "set" | "merge"; path: string; data: Record<string, unknown> }
  | { op: "delete"; path: string };

/** The household's state, or null when it has none. */
export async function readHouseholdState(hid: string): Promise<HouseholdState | null> {
  const snap = await hhRef(hid).collection("state").doc("main").get();
  return snap.exists ? (snap.data() as HouseholdState) : null;
}

export interface StateEdit<R> {
  /** What to hand back to the caller. */
  result: R;
  /** The state after the edit; absent = nothing to change. */
  next?: HouseholdState;
  /** Other documents written with the edit (an undo record, say). */
  also?: WriteOp[];
}

/**
 * Edit the household's state in a transaction. `edit` gets the current state
 * and returns the result; it may run more than once, as a transaction retries.
 */
export async function editHouseholdState<R>(
  hid: string,
  edit: (fresh: HouseholdState) => StateEdit<R>,
): Promise<R> {
  const db = getFirestore();
  const ref = hhRef(hid).collection("state").doc("main");
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const out = edit((snap.data() ?? {}) as HouseholdState);
    if (out.next) tx.set(ref, out.next);
    for (const o of out.also ?? []) {
      const r = db.doc(o.path);
      if (o.op === "delete") tx.delete(r);
      else if (o.op === "merge") tx.set(r, o.data, { merge: true });
      else tx.set(r, o.data);
    }
    return out.result;
  });
}

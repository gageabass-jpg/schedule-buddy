// Reading and editing a household's legacy-shaped state from the functions,
// whichever way the household is stored (docs/data-model.md, step 3) — the
// server side of desktop/src/lib/householdState.ts.
//
//   Not migrated — state/main, read directly and edited in a transaction
//     that also reads the household doc, so a household that switches to the
//     records partway through makes the transaction run again (and the edit
//     then goes to the records) instead of landing in a state/main nothing
//     reads any more. The Admin SDK skips the read-only rule that stops the
//     apps doing the same.
//   Migrated (schemaVersion ≥ 2) — the state is built from the records
//     (toLegacy), and an edit writes only the records it changed, with an
//     edit-log entry (commitEdit) that onHouseholdEdit turns into
//     notifications.
//
// An edit on a migrated household is not one transaction: the records are
// read, the change is worked out, and it is written merged onto what was
// read. A change to a different record in between survives; two changes to
// the same record in the same moment, the later wins.

import { getFirestore } from "firebase-admin/firestore";
import { SCHEMA_VERSION } from "./shared/model";
import { commitEdit, loadHousehold, type Data, type WriteOp } from "./shared/store";
import { bridgeEdit, toLegacy } from "./shared/toLegacy";
import type { HouseholdMeta, HouseholdState } from "./shared/state";
import { modelStore } from "./modelStore";

const hhRef = (hid: string) => getFirestore().collection("households").doc(hid);

export function isMigrated(root: Record<string, unknown> | undefined): boolean {
  return typeof root?.schemaVersion === "number" && root.schemaVersion >= SCHEMA_VERSION;
}

function metaOf(root: Record<string, unknown>): Omit<HouseholdMeta, "id"> {
  return {
    memberUids: (root.memberUids as string[]) ?? [],
    memberNames: (root.memberNames as Record<string, string>) ?? {},
    roles: (root.roles as HouseholdMeta["roles"]) ?? {},
    inviteCode: (root.inviteCode as string) ?? "",
    createdBy: (root.createdBy as string) ?? "",
  };
}

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The household's state, or null when it has none. */
export async function readLegacyState(hid: string): Promise<HouseholdState | null> {
  const root = (await hhRef(hid).get()).data();
  if (!isMigrated(root)) {
    const snap = await hhRef(hid).collection("state").doc("main").get();
    return snap.exists ? (snap.data() as HouseholdState) : null;
  }
  const model = await loadHousehold(modelStore(), hid);
  return model ? plain(toLegacy(model).state) : null;
}

export interface LegacyEdit<R> {
  /** What to hand back to the caller. */
  result: R;
  /** The state after the edit; absent = nothing to change. */
  next?: HouseholdState;
  /** Other documents written with the edit (an undo record, say): paths
   *  from the database root. */
  also?: WriteOp[];
}

/**
 * Edit the household's state. `edit` gets the current state and returns the
 * result (and may be run more than once on an unmigrated household, as a
 * transaction retries). `by` names who made the change, for the edit log.
 */
export async function editLegacyState<R>(
  hid: string,
  by: string,
  edit: (fresh: HouseholdState) => LegacyEdit<R>,
): Promise<R> {
  const db = getFirestore();
  let root = (await hhRef(hid).get()).data();

  if (!isMigrated(root)) {
    const ref = hhRef(hid).collection("state").doc("main");
    const done = await db.runTransaction(async (tx) => {
      // The household doc is read here, inside the transaction, not before it:
      // the switch to the records writes it, which is what makes a switch
      // between this read and the commit retry the transaction.
      const rootSnap = await tx.get(hhRef(hid));
      if (isMigrated(rootSnap.data())) return { moved: true as const, root: rootSnap.data() };
      const snap = await tx.get(ref);
      const out = edit((snap.data() ?? {}) as HouseholdState);
      if (out.next) tx.set(ref, out.next);
      for (const o of out.also ?? []) {
        const r = db.doc(o.path);
        if (o.op === "delete") tx.delete(r);
        else if (o.op === "merge") tx.set(r, o.data, { merge: true });
        else tx.set(r, o.data);
      }
      return { moved: false as const, result: out.result };
    });
    if (!done.moved) return done.result;
    root = done.root; // switched since the first look: edit the records instead
  }

  const store = modelStore();
  const live = await loadHousehold(store, hid);
  if (!live) throw new Error(`household ${hid} has no records`);
  const base = plain(toLegacy(live).state);
  const out = edit(plain(base));
  const ops: WriteOp[] = out.next ? bridgeEdit(hid, live, metaOf(root!), base, out.next) : [];
  if (ops.length) await commitEdit(store, hid, live, ops, by);
  if (out.also?.length) await store.write(out.also);
  return out.result;
}

export type { Data };

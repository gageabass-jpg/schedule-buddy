// Reading and saving the household's legacy-shaped state, whichever way the
// household is stored (docs/data-model.md, step 3).
//
//   Not migrated  — the state/main document, read and rewritten whole.
//   Migrated (schemaVersion ≥ 2) — the state is built from the model's
//     records (toLegacy), and a save writes only the records the edit changed
//     (bridgeWrites), merged onto what's stored.
//
// Every writer in lib/ goes through these two functions, so the screens work
// unchanged on a migrated household while they move to the model one by one.
// A save takes the state the edit started from as well as the result: the
// difference between them is the edit, and only that is written — with an
// entry in the household's edit log, which drives notifications.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import type { HouseholdMeta, HouseholdState } from "../state";
import { bridgeEdit, toLegacy } from "../../../shared/toLegacy";
import { SCHEMA_VERSION } from "../../../shared/model";
import { commitEdit, loadHousehold } from "../../../shared/store";
import { modelStore } from "./modelStore";

const stateRef = (hid: string) => doc(db, "households", hid, "state", "main");

async function readRoot(hid: string): Promise<Record<string, unknown> | undefined> {
  const snap = await getDoc(doc(db, "households", hid));
  return snap.exists() ? snap.data() : undefined;
}

export const isMigrated = (root: Record<string, unknown> | undefined): boolean =>
  typeof root?.schemaVersion === "number" && root.schemaVersion >= SCHEMA_VERSION;

function metaOf(root: Record<string, unknown>): Omit<HouseholdMeta, "id"> {
  return {
    memberUids: (root.memberUids as string[]) ?? [],
    memberNames: (root.memberNames as Record<string, string>) ?? {},
    roles: (root.roles as HouseholdMeta["roles"]) ?? {},
    inviteCode: (root.inviteCode as string) ?? "",
    createdBy: (root.createdBy as string) ?? "",
  };
}

/** Plain JSON, as a stored document would be. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The household's state, or null when it has none yet. */
export async function readHouseholdState(hid: string): Promise<HouseholdState | null> {
  const root = await readRoot(hid);
  if (!isMigrated(root)) {
    const snap = await getDoc(stateRef(hid));
    return snap.exists() ? (snap.data() as HouseholdState) : null;
  }
  const model = await loadHousehold(modelStore, hid);
  return model ? plain(toLegacy(model).state) : null;
}

/** Save `next`, an edit of `base` (what readHouseholdState returned). */
export async function writeHouseholdState(hid: string, base: HouseholdState, next: HouseholdState): Promise<void> {
  const root = await readRoot(hid);
  if (!root || !isMigrated(root)) {
    await setDoc(stateRef(hid), next);
    return;
  }
  const live = await loadHousehold(modelStore, hid);
  if (!live) throw new Error("The household no longer exists.");
  const ops = bridgeEdit(hid, live, metaOf(root), base, next);
  await commitEdit(modelStore, hid, live, ops, auth.currentUser?.uid ?? "");
}

// The any-household model's data layer, bound to the Admin SDK
// (shared/store.ts, docs/data-model.md). Not used by any function yet.

import { getFirestore } from "firebase-admin/firestore";
import { namespacedStore, type DocStore } from "./shared/store";

let store: DocStore | undefined;

/** Created on first use, after index.ts has initialized the app. */
export function modelStore(): DocStore {
  return (store ??= namespacedStore(getFirestore()));
}

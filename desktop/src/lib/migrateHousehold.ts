// Moving the household to the any-household model and back — the
// migrateHousehold / unmigrateHousehold functions (shared/migrate.ts,
// docs/data-model.md step 4). Admin only; the functions check.

import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { app as firebaseApp, db } from "../firebase";
import type { MigrationReport } from "../../../shared/migrate";

export type { MigrationReport };

const fns = getFunctions(firebaseApp, "us-central1");
const migrateCall = httpsCallable<{ householdId: string }, MigrationReport>(fns, "migrateHousehold", { timeout: 300_000 });
const unmigrateCall = httpsCallable<{ householdId: string }, MigrationReport>(fns, "unmigrateHousehold", { timeout: 300_000 });

export async function migrateToModel(householdId: string): Promise<MigrationReport> {
  return (await migrateCall({ householdId })).data;
}

export async function moveBackFromModel(householdId: string): Promise<MigrationReport> {
  return (await unmigrateCall({ householdId })).data;
}

/** The household's format and the latest migration report, kept live. */
export function watchDataFormat(
  householdId: string,
  onChange: (v: { migrated: boolean; isAdmin: boolean; last: MigrationReport | null }) => void,
  uid: string | undefined,
): () => void {
  let migrated = false;
  let isAdmin = false;
  let last: MigrationReport | null = null;
  const emit = () => onChange({ migrated, isAdmin, last });
  const a = onSnapshot(doc(db, "households", householdId), (s) => {
    const d = s.data() ?? {};
    migrated = typeof d.schemaVersion === "number" && d.schemaVersion >= 2;
    isAdmin = !!uid && d.roles?.[uid] === "admin";
    emit();
  }, () => undefined);
  const b = onSnapshot(
    query(collection(db, "households", householdId, "migrations"), orderBy("at", "desc"), limit(1)),
    (s) => { last = (s.docs[0]?.data() as MigrationReport | undefined) ?? null; emit(); },
    () => undefined,
  );
  return () => { a(); b(); };
}

// Moving one household from state/main to the any-household model, and back
// (docs/data-model.md, step 4). Firebase-free: the migrateHousehold and
// unmigrateHousehold functions run it with the Admin SDK, and
// tests/migrate.test.mjs runs it against the emulator.
//
// Migrating, in order — the household switches only at the very end, and
// only if the check passes:
//   1. copy state/main to legacyBackups/{time}
//   2. clear any records a failed earlier attempt left
//   3. convert (fromLegacy) and write the records (writeModel)
//   4. read them back and check: the records are exactly what the conversion
//      produced, and they draw the same calendar, coverage gaps and caregiver
//      time as state/main over the check window (shared/verify.ts)
//   5. set schemaVersion — from here every app reads and writes the records
// Every attempt leaves a report in migrations/{time}. state/main is kept; the
// rules make it read-only once the household has moved.
//
// Moving back writes the household as it now stands (toLegacy) into
// state/main and clears schemaVersion, so nothing done since is lost.

import { fromLegacy } from "./fromLegacy";
import { SCHEMA_VERSION, type HouseholdModel } from "./model";
import {
  COLLECTIONS, collectionPath, householdPath, loadHousehold, MAX_BATCH, setSchemaVersion,
  writeModel, type Data, type DocStore, type WriteOp,
} from "./store";
import { toLegacy } from "./toLegacy";
import type { HouseholdMeta, HouseholdState } from "./state";
import { compareDrawing, compareRecords } from "./verify";

export interface MigrationReport {
  ok: boolean;
  /** "migrated" | "already" | "refused" (the check failed) | "moved back" */
  outcome: "migrated" | "already" | "refused" | "moved back";
  at: number;
  by: string;
  /** What the check found different. Empty when it passed. */
  problems: string[];
  /** The converter's notes: fields with no place, duplicates dropped, … */
  notes: string[];
  /** Records written, by kind. */
  counts: Record<string, number>;
  backupPath?: string;
  window?: { from: string; to: string };
}

export interface MigrateOptions {
  /** Epoch ms, for ids and the report. */
  now: number;
  /** The dates the drawing check covers. */
  from: string;
  to: string;
}

const statePath = (hid: string) => `${householdPath(hid)}/state/main`;
export const backupPath = (hid: string, at: number) => `${householdPath(hid)}/legacyBackups/${at}`;
export const reportPath = (hid: string, at: number) => `${householdPath(hid)}/migrations/${at}`;

export function isMigratedRoot(root: Data | undefined): boolean {
  return typeof root?.schemaVersion === "number" && root.schemaVersion >= SCHEMA_VERSION;
}

function metaOf(root: Data): Omit<HouseholdMeta, "id"> {
  return {
    memberUids: (root.memberUids as string[]) ?? [],
    memberNames: (root.memberNames as Record<string, string>) ?? {},
    roles: (root.roles as HouseholdMeta["roles"]) ?? {},
    inviteCode: (root.inviteCode as string) ?? "",
    createdBy: (root.createdBy as string) ?? "",
  };
}

async function writeAll(store: DocStore, ops: WriteOp[]): Promise<void> {
  for (let i = 0; i < ops.length; i += MAX_BATCH) await store.write(ops.slice(i, i + MAX_BATCH));
}

/** Delete every model record — only ever for a household not yet switched. */
async function clearRecords(store: DocStore, hid: string): Promise<void> {
  const ops: WriteOp[] = [];
  for (const key of ["people", "personDetails", ...COLLECTIONS] as const) {
    for (const d of await store.list(collectionPath(hid, key))) {
      ops.push({ op: "delete", path: `${collectionPath(hid, key)}/${d.id}` });
    }
  }
  ops.push({ op: "delete", path: `${householdPath(hid)}/settings/main` });
  await writeAll(store, ops);
}

function countsOf(model: HouseholdModel): Record<string, number> {
  const out: Record<string, number> = { people: model.people.length };
  for (const key of COLLECTIONS) out[key] = model[key].length;
  return out;
}

export async function migrateHousehold(store: DocStore, hid: string, by: string,
  opts: MigrateOptions): Promise<MigrationReport> {
  const base = { at: opts.now, by, problems: [] as string[], notes: [] as string[], counts: {} };
  const root = await store.get(householdPath(hid));
  if (!root) throw new Error(`No household ${hid}.`);
  if (isMigratedRoot(root)) return { ...base, ok: true, outcome: "already" };
  const state = await store.get(statePath(hid)) as (HouseholdState & Record<string, unknown>) | undefined;
  if (!state) throw new Error("This household has no schedule to move.");

  // 1. A copy of exactly what was there.
  const backup = backupPath(hid, opts.now);
  await store.write([{ op: "set", path: backup, data: { at: opts.now, by, state } }]);

  // 2–3. Convert and write, over a clean slate.
  await clearRecords(store, hid);
  const converted = fromLegacy(hid, JSON.parse(JSON.stringify(state)), metaOf(root));
  await writeModel(store, hid, converted.model);

  // 4. Check what's actually stored.
  const stored = await loadHousehold(store, hid);
  const problems = stored
    ? [
      ...compareRecords(converted.model, stored),
      ...compareDrawing(state, stored, converted.people, opts.from, opts.to),
    ]
    : ["the records couldn't be read back"];

  const report: MigrationReport = {
    ...base,
    ok: problems.length === 0,
    outcome: problems.length === 0 ? "migrated" : "refused",
    problems,
    notes: converted.notes,
    counts: countsOf(converted.model),
    backupPath: backup,
    window: { from: opts.from, to: opts.to },
  };

  // 5. Switch — only when everything matched.
  if (report.ok) await setSchemaVersion(store, hid, SCHEMA_VERSION);
  await store.write([{ op: "set", path: reportPath(hid, opts.now), data: report as unknown as Data }]);
  return report;
}

/**
 * Move a household back to state/main, as it stands now. Fields state/main
 * had that the model doesn't carry (screen state, anything unmapped) are kept
 * from the copy there.
 */
export async function unmigrateHousehold(store: DocStore, hid: string, by: string,
  now: number): Promise<MigrationReport> {
  const base = { at: now, by, problems: [] as string[], notes: [] as string[], counts: {} };
  const root = await store.get(householdPath(hid));
  if (!root) throw new Error(`No household ${hid}.`);
  if (!isMigratedRoot(root)) return { ...base, ok: true, outcome: "already" };
  const model = await loadHousehold(store, hid);
  if (!model) throw new Error("The household's records couldn't be read.");

  const old = (await store.get(statePath(hid))) ?? {};
  const next = { ...old, ...JSON.parse(JSON.stringify(toLegacy(model).state)) };
  // Screen state belongs to the device that saved it, not the model's defaults.
  for (const k of ["calView", "ui", "activeTab"]) if (k in old) next[k] = old[k];
  // Marks this write for the state/main notification trigger, which skips it:
  // everything in it was announced when it happened.
  next._movedBackAt = now;

  await store.write([{ op: "set", path: statePath(hid), data: next }]);
  await store.write([{ op: "merge", path: householdPath(hid), data: { schemaVersion: 1 } }]);
  const report: MigrationReport = { ...base, ok: true, outcome: "moved back", counts: countsOf(model) };
  await store.write([{ op: "set", path: reportPath(hid, now), data: report as unknown as Data }]);
  return report;
}

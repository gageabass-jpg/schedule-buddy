// editLegacyState (functions/src/householdState.ts) against the emulator: the
// one door the functions edit a household through, whichever way it's stored.
//
// It reads the household doc inside the transaction that edits state/main, so
// a household that switches to the records partway through makes the
// transaction run again and the edit land in the records. That retry is the
// Firestore server's own behaviour (writes to a document a transaction has
// read wait for it), so it isn't simulated here; these tests keep both
// branches honest.
//
// Its own emulator project, so it can run beside the other emulator tests.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { createRequire } from "node:module";
import storeMod from "../functions/lib/shared/store.js";
import migrateMod from "../functions/lib/shared/migrate.js";
import toLegacyMod from "../functions/lib/shared/toLegacy.js";
import hsMod from "../functions/lib/householdState.js";
import caregiverMod from "../functions/lib/caregiver.js";
import { HH, META, fullState } from "./fixtures/household.mjs";

const { namespacedStore, loadHousehold } = storeMod;
const { migrateHousehold } = migrateMod;
const { toLegacy } = toLegacyMod;
const { editLegacyState, readLegacyState } = hsMod;
const { callerPersonIds } = caregiverMod;

// householdState.ts uses the firebase-admin installed under functions/, which
// is a separate copy from the root one: the default app has to be made in it.
const fromFunctions = createRequire(new URL("../functions/", import.meta.url));
const { initializeApp, deleteApp } = fromFunctions("firebase-admin/app");
const { getFirestore } = fromFunctions("firebase-admin/firestore");

const PROJECT = "nucleus-legacyedit-test";
const OPTS = { now: 1790000000000, from: "2026-09-01", to: "2026-11-30" };
let env, app, admin;

before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: "service cloud.firestore { match /{d=**} { allow read, write: if true; } }" } });
  // The default app: householdState.ts and modelStore.ts call getFirestore().
  app = initializeApp({ projectId: PROJECT });
  admin = namespacedStore(getFirestore(app));
});
after(async () => {
  await env?.cleanup();
  if (app) await deleteApp(app);
});

beforeEach(async () => {
  await env.clearFirestore();
  await admin.write([
    { op: "set", path: `households/${HH}`, data: { ...META } },
    { op: "set", path: `households/${HH}/state/main`, data: JSON.parse(JSON.stringify(fullState())) },
  ]);
});

const addOt = (fresh) => {
  const next = JSON.parse(JSON.stringify(fresh));
  next.ot.push({ date: "2026-10-28", shiftTypeId: "n", label: "OT" });
  return { result: "done", next };
};

describe("editLegacyState", () => {
  test("a household still on state/main is edited there", async () => {
    assert.equal(await editLegacyState(HH, "uGage", addOt), "done");
    const state = await admin.get(`households/${HH}/state/main`);
    assert.ok(state.ot.some((o) => o.date === "2026-10-28"));
    assert.ok((await readLegacyState(HH)).ot.some((o) => o.date === "2026-10-28"));
  });

  test("an edit that changes nothing writes nothing", async () => {
    const before = await admin.get(`households/${HH}/state/main`);
    assert.equal(await editLegacyState(HH, "uGage", () => ({ result: "noop" })), "noop");
    assert.deepEqual(await admin.get(`households/${HH}/state/main`), before);
  });

  test("once the household has moved, the edit goes to the records and state/main is left alone", async () => {
    await migrateHousehold(admin, HH, "uGage", OPTS);
    const frozen = await admin.get(`households/${HH}/state/main`);
    assert.equal(await editLegacyState(HH, "uGage", addOt), "done");
    assert.deepEqual(await admin.get(`households/${HH}/state/main`), frozen, "state/main untouched");
    const model = await loadHousehold(admin, HH);
    assert.ok(toLegacy(model).state.ot.some((o) => o.date === "2026-10-28"), "the edit is in the records");
  });
});

// caregiverAction asks callerPersonIds who the caller is before it lets them
// answer a coverage request (caregiverLogic.ts has the check itself).
describe("callerPersonIds", () => {
  test("a household still on state/main has no people to match", async () => {
    const root = await admin.get(`households/${HH}`);
    assert.equal(await callerPersonIds(HH, "uDaisy", root), undefined);
  });

  test("once on the model, it is the person records whose account is the caller", async () => {
    await migrateHousehold(admin, HH, "uGage", OPTS);
    const root = await admin.get(`households/${HH}`);
    const people = await admin.list(`households/${HH}/people`);
    const daisy = people.find((p) => p.data.uid === "uDaisy");
    assert.ok(daisy, "the caregiver has a person record");
    assert.deepEqual(await callerPersonIds(HH, "uDaisy", root), [daisy.id]);
    assert.deepEqual(await callerPersonIds(HH, "nobody", root), [], "an account with no person");
  });
});

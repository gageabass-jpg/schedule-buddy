// Moving a household to the any-household model and back
// (shared/migrate.ts), against the emulator: a legacy household is set up
// exactly as it lives today, migrated through the Admin SDK (as the function
// does), and then read and edited as the apps would, under the real rules.
//
// Its own emulator project, so it can run beside the other emulator tests.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as fs from "firebase/firestore";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import storeMod from "../functions/lib/shared/store.js";
import migrateMod from "../functions/lib/shared/migrate.js";
import toLegacyMod from "../functions/lib/shared/toLegacy.js";
import legacyMod from "../functions/lib/shared/fromLegacy.js";
import { HH, META, fullState } from "./fixtures/household.mjs";

const { namespacedStore, modularStore, loadHousehold, commitEdit } = storeMod;
const { migrateHousehold, unmigrateHousehold, backupPath } = migrateMod;
const { toLegacy, bridgeEdit } = toLegacyMod;
const { fromLegacy } = legacyMod;

const PROJECT = "nucleus-migrate-test";
const OPTS = { now: 1790000000000, from: "2026-09-01", to: "2026-11-30" };
let env, adminApp, admin;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
  adminApp = initializeApp({ projectId: PROJECT }, "migrate-test");
  admin = namespacedStore(getFirestore(adminApp));
});
after(async () => {
  await env?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

const as = (uid) => modularStore(env.authenticatedContext(uid).firestore(), fs);
const stateDoc = (uid) => fs.doc(env.authenticatedContext(uid).firestore(), "households", HH, "state", "main");

/** A household as it lives today: root + state/main. */
async function seedLegacy(state = fullState()) {
  await env.clearFirestore();
  await admin.write([
    { op: "set", path: `households/${HH}`, data: { ...META } },
    { op: "set", path: `households/${HH}/state/main`, data: JSON.parse(JSON.stringify(state)) },
  ]);
}

describe("migrating", () => {
  beforeEach(() => seedLegacy());

  test("moves the household, checks it, and only then switches", async () => {
    const report = await migrateHousehold(admin, HH, "uGage", OPTS);
    assert.equal(report.outcome, "migrated", report.problems.join("\n"));
    assert.deepEqual(report.problems, []);
    assert.equal(report.counts.people, 3);
    assert.ok(report.notes.some((n) => n.includes("mystery")), "unmapped fields are reported");

    const root = await admin.get(`households/${HH}`);
    assert.equal(root.schemaVersion, 2);
    assert.deepEqual(root.memberUids, META.memberUids, "membership untouched");

    // The copy of what was there, and the report.
    const backup = await admin.get(backupPath(HH, OPTS.now));
    assert.deepEqual(backup.state, JSON.parse(JSON.stringify(fullState())));
    assert.equal((await admin.get(`households/${HH}/migrations/${OPTS.now}`)).outcome, "migrated");

    // What the apps now see is the household they had.
    const model = await loadHousehold(as("uKay"), HH);
    assert.equal(toLegacy(model).state.partner.name, "Kaylene");
  });

  test("running it again changes nothing", async () => {
    await migrateHousehold(admin, HH, "uGage", OPTS);
    const again = await migrateHousehold(admin, HH, "uGage", { ...OPTS, now: OPTS.now + 1 });
    assert.equal(again.outcome, "already");
  });

  test("refuses to switch when the new model would draw a different calendar", async () => {
    // A custom time in the old `template` field: the old calendar never drew
    // it, the new one would. The check must catch that and stop.
    const state = fullState();
    delete state.weeklyTemplates.G;
    state.template = ["d", null, { start: "06:00", end: "14:30" }, "d", "d", null, null];
    await seedLegacy(state);
    const report = await migrateHousehold(admin, HH, "uGage", OPTS);
    assert.equal(report.outcome, "refused");
    assert.ok(report.problems.some((p) => p.startsWith("calendar differs")), report.problems.join("\n"));
    assert.equal((await admin.get(`households/${HH}`)).schemaVersion, undefined, "not switched");
    // The household carries on exactly as before.
    await assertSucceeds(fs.setDoc(stateDoc("uKay"), { ...JSON.parse(JSON.stringify(state)), calName: "still works" }));
  });

  test("a retry after a refusal starts from a clean slate", async () => {
    const bad = fullState();
    delete bad.weeklyTemplates.G;
    bad.template = ["d", null, { start: "06:00", end: "14:30" }, "d", "d", null, null];
    await seedLegacy(bad);
    await migrateHousehold(admin, HH, "uGage", OPTS);
    // Fixed at the source (the custom day dropped), then run again: records
    // the first attempt wrote that no longer belong must be gone.
    const fixed = JSON.parse(JSON.stringify(bad));
    fixed.template[2] = null;
    fixed.events = fixed.events.filter((e) => e.id !== "e3");
    await admin.write([{ op: "set", path: `households/${HH}/state/main`, data: fixed }]);
    const report = await migrateHousehold(admin, HH, "uGage", { ...OPTS, now: OPTS.now + 1 });
    assert.equal(report.outcome, "migrated", report.problems.join("\n"));
    const model = await loadHousehold(admin, HH);
    assert.ok(!model.events.some((e) => e.id === "e3"));
  });

  test("afterwards the old record is read-only, so an out-of-date app can't save to it", async () => {
    await migrateHousehold(admin, HH, "uGage", OPTS);
    await assertSucceeds(fs.getDoc(stateDoc("uKay")));
    await assertFails(fs.setDoc(stateDoc("uKay"), { calName: "x" }));
    await assertFails(fs.setDoc(stateDoc("uGage"), { calName: "x" }));
  });

  test("the backup and the reports are for managers' eyes, and nobody writes them", async () => {
    await migrateHousehold(admin, HH, "uGage", OPTS);
    const ctx = (uid) => env.authenticatedContext(uid).firestore();
    await assertSucceeds(fs.getDoc(fs.doc(ctx("uKay"), "households", HH, "legacyBackups", String(OPTS.now))));
    await assertFails(fs.getDoc(fs.doc(ctx("uDaisy"), "households", HH, "legacyBackups", String(OPTS.now))));
    await assertFails(fs.setDoc(fs.doc(ctx("uGage"), "households", HH, "migrations", "x"), { ok: true }));
  });
});

describe("moving back", () => {
  beforeEach(async () => {
    await seedLegacy();
    await migrateHousehold(admin, HH, "uGage", OPTS);
  });

  test("keeps what was done while on the model", async () => {
    // Kaylene adds overtime for Gage through the bridge, as the Mac would.
    const kay = as("uKay");
    const live = await loadHousehold(kay, HH);
    const base = JSON.parse(JSON.stringify(toLegacy(live).state));
    const next = JSON.parse(JSON.stringify(base));
    next.ot.push({ date: "2026-10-28", shiftTypeId: "n", label: "OT" });
    await commitEdit(kay, HH, live, bridgeEdit(HH, live, META, base, next), "uKay");

    const report = await unmigrateHousehold(admin, HH, "uGage", OPTS.now + 5);
    assert.equal(report.outcome, "moved back");
    assert.equal((await admin.get(`households/${HH}`)).schemaVersion, 1);
    const state = await admin.get(`households/${HH}/state/main`);
    assert.ok(state.ot.some((o) => o.date === "2026-10-28"), "the edit made while migrated is kept");
    assert.equal(state.activeTab, "calendar", "screen state from the old copy is kept");
    assert.equal(state._movedBackAt, OPTS.now + 5, "marked so notifications skip it");
    // And the apps can save to it again.
    await assertSucceeds(fs.setDoc(stateDoc("uKay"), { ...state, calName: "back" }));
  });

  test("the household moved back converts to the same model again", async () => {
    const model = await loadHousehold(admin, HH);
    await unmigrateHousehold(admin, HH, "uGage", OPTS.now + 5);
    const state = await admin.get(`households/${HH}/state/main`);
    const again = fromLegacy(HH, state, META).model;
    const ids = (m, k) => m[k].map((r) => r.id).sort();
    for (const k of ["shifts", "events", "coverageRequests", "caregiverOff", "shiftOffers"]) {
      assert.deepEqual(ids(again, k), ids(model, k), `${k} ids survive a round trip`);
    }
  });

  test("a second migration after moving back works", async () => {
    await unmigrateHousehold(admin, HH, "uGage", OPTS.now + 5);
    const report = await migrateHousehold(admin, HH, "uGage", { ...OPTS, now: OPTS.now + 10 });
    assert.equal(report.outcome, "migrated", report.problems.join("\n"));
  });
});

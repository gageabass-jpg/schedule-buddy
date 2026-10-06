// The data layer (shared/store.ts) against the Firestore emulator, under the
// real rules: a converted household is written through the Admin adapter (as
// the functions and the migration will), then read back through the modular
// adapter (as the Mac will) as each kind of member.
//
// Its own emulator project, so it can run beside the rules tests.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as fs from "firebase/firestore";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import storeMod from "../functions/lib/shared/store.js";
import legacyMod from "../functions/lib/shared/fromLegacy.js";
import toLegacyMod from "../functions/lib/shared/toLegacy.js";
import resolveMod from "../functions/lib/shared/resolve.js";
import { HH, META, fullState } from "./fixtures/household.mjs";

const {
  namespacedStore, modularStore, loadHousehold, watchHousehold, watchCaregiver, writeModel,
  setSchemaVersion, putRecord, removeRecord, removePerson, savePerson, ModelInputError,
} = storeMod;
const { fromLegacy } = legacyMod;
const { caregiverLegacyState } = toLegacyMod;
const { resolveShifts } = resolveMod;

const PROJECT = "nucleus-store-test";
let env, adminApp, admin;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
  adminApp = initializeApp({ projectId: PROJECT }, "store-test");
  admin = namespacedStore(getFirestore(adminApp));
});
after(async () => {
  await env?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

const as = (uid) => modularStore(env.authenticatedContext(uid).firestore(), fs);

const converted = () => fromLegacy(HH, fullState(), META);

beforeEach(async () => {
  await env.clearFirestore();
  await admin.write([{ op: "set", path: `households/${HH}`, data: { ...META } }]);
  await writeModel(admin, HH, converted().model);
});

/** Lists in id order and no undefineds, so two models compare by content. */
function norm(m) {
  const out = JSON.parse(JSON.stringify(m));
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) out[k] = v.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return out;
}

/** The next value a watcher delivers that passes `ok`. */
function next(watch, ok = () => true, ms = 5000) {
  return new Promise((resolve, reject) => {
    let stop = () => {};
    const timer = setTimeout(() => { stop(); reject(new Error("watcher timed out")); }, ms);
    stop = watch((v) => {
      if (!ok(v)) return;
      clearTimeout(timer);
      stop();
      resolve(v);
    }, (e) => { clearTimeout(timer); stop(); reject(e); });
  });
}

describe("reading a household", () => {
  test("what was written reads back the same, as admin or partner", async () => {
    const { model } = converted();
    for (const uid of ["uGage", "uKay"]) {
      const loaded = await loadHousehold(as(uid), HH);
      for (const key of Object.keys(model)) {
        if (key === "root") continue;
        assert.deepEqual(norm(loaded)[key], norm(model)[key], `${uid}: ${key} differs`);
      }
      assert.equal(loaded.root.name, "Bass Household");
      assert.equal(loaded.root.childcare, true);
      assert.deepEqual(loaded.root.memberUids, META.memberUids, "membership untouched");
    }
  });

  test("the loaded household draws the same calendar as the converted one", async () => {
    const { model } = converted();
    const loaded = await loadHousehold(as("uKay"), HH);
    assert.deepEqual(norm(resolveShifts(loaded, "2026-09-01", "2026-11-30")), norm(resolveShifts(model, "2026-09-01", "2026-11-30")));
  });

  test("the schema version flips only when asked", async () => {
    assert.equal((await loadHousehold(as("uGage"), HH)).root.schemaVersion, undefined);
    await setSchemaVersion(admin, HH, 2);
    assert.equal((await loadHousehold(as("uGage"), HH)).root.schemaVersion, 2);
  });

  test("a caregiver can't load the whole household", async () => {
    await assert.rejects(loadHousehold(as("uDaisy"), HH));
  });

  test("a live household updates when a record changes", async () => {
    const store = as("uKay");
    const watch = (onModel, onError) => watchHousehold(store, HH, onModel, onError);
    const first = await next(watch);
    assert.equal(first.events.length, 4);
    const later = next(watch, (m) => m.events.length === 5);
    await putRecord(admin, HH, "events", { id: "ev_new", date: "2026-10-20", title: "Parent night" });
    assert.equal((await later).events.find((e) => e.id === "ev_new").title, "Parent night");
  });
});

describe("the caregiver's view", () => {
  test("names, their requests, their own schedule — nothing else", async () => {
    const { people } = converted();
    const view = await next((onModel, onError) => watchCaregiver(as("uDaisy"), HH, people.D, onModel, onError));
    assert.equal(view.me.name, "Daisy");
    assert.equal(view.me.employer, "BVCTC");
    assert.deepEqual(view.people.map((p) => p.name).sort(), ["Daisy", "Gage", "Kaylene"]);
    assert.ok(view.people.every((p) => p.id === people.D || !("employer" in p)), "others' details stay hidden");
    assert.deepEqual(view.coverageRequests.map((r) => r.id).sort(), ["cov1", "cov2"]);
    assert.ok(view.shifts.length > 0 && view.shifts.every((s) => s.personId === people.D));
    assert.equal(view.caregiverOff.length, 1);
    assert.ok(!("events" in view));
  });
});

describe("a household with two caregivers", () => {
  // A second caregiver, with an account, and a request addressed to them.
  beforeEach(async () => {
    await admin.write([
      { op: "merge", path: `households/${HH}`, data: {
        memberUids: [...META.memberUids, "uOther"],
        memberNames: { ...META.memberNames, uOther: "Olive" },
        roles: { ...META.roles, uOther: "supporting" },
      } },
      { op: "set", path: `households/${HH}/people/pOther`, data: { id: "pOther", name: "Olive", role: "caregiver", uid: "uOther", order: 9 } },
      { op: "set", path: `households/${HH}/coverageRequests/cov-olive`, data: {
        id: "cov-olive", date: "2026-10-14", startTime: "07:00", endTime: "19:00", status: "pending",
        caregiverId: "pOther", createdAt: 1, reason: "both-working",
      } },
    ]);
  });

  const mine = (uid, personId) => next((onModel, onError) => watchCaregiver(as(uid), HH, personId, onModel, onError));

  test("each caregiver is shown only the requests addressed to them", async () => {
    const { people } = converted();
    const daisy = await mine("uDaisy", people.D);
    assert.deepEqual(daisy.coverageRequests.map((r) => r.id).sort(), ["cov1", "cov2"]);
    assert.ok(!JSON.stringify(daisy).includes("cov-olive"), "nothing of Olive's request reaches Daisy");
    const olive = await mine("uOther", "pOther");
    assert.deepEqual(olive.coverageRequests.map((r) => r.id), ["cov-olive"]);
  });

  test("the page state built from their records carries the names and only their requests", async () => {
    const { people } = converted();
    const page = caregiverLegacyState(await mine("uDaisy", people.D));
    assert.equal(page.householdName, "Bass Household");
    assert.equal(page.selfName, "Gage");
    assert.deepEqual(page.partner, { name: "Kaylene" });
    assert.deepEqual(page.dependents, { daisy: { name: "Daisy" } });
    assert.deepEqual(page.coverageRequests.map((r) => r.id).sort(), ["cov1", "cov2"]);
    assert.deepEqual(Object.keys(page).sort(), ["coverageRequests", "dependents", "householdName", "partner", "selfName"],
      "the same fields as caregiverView/main, nothing more");
  });
});

describe("writing records", () => {
  test("a day's replacement shift is unique per person and date", async () => {
    const { people } = converted();
    const kay = as("uKay");
    const a = await putRecord(kay, HH, "shifts", { id: "anything", personId: people.K, date: "2026-10-21", mode: "replace", shiftTypeId: "d" });
    const b = await putRecord(kay, HH, "shifts", { id: "else", personId: people.K, date: "2026-10-21", mode: "replace", shiftTypeId: null });
    assert.equal(a.id, b.id);
    const loaded = await loadHousehold(kay, HH);
    const that = loaded.shifts.filter((s) => s.personId === people.K && s.date === "2026-10-21");
    assert.deepEqual(that.map((s) => s.shiftTypeId), [null]);
  });

  test("a malformed record is refused before it's sent", async () => {
    const { people } = converted();
    await assert.rejects(putRecord(as("uKay"), HH, "shifts", { id: "x", personId: people.K, date: "10/21/2026", mode: "add", shiftTypeId: "d" }), ModelInputError);
    await assert.rejects(putRecord(as("uKay"), HH, "events", { id: "x", date: "2026-10-21", title: " " }), ModelInputError);
    await assert.rejects(savePerson(as("uKay"), HH, { id: "pKid", name: "Kid", role: "child", order: 3, weekly: { days: [] } }), ModelInputError);
  });

  test("a caregiver's direct write is refused by the rules", async () => {
    const { people } = converted();
    await assert.rejects(putRecord(as("uDaisy"), HH, "shifts", { id: "x", personId: people.D, date: "2026-10-21", mode: "add", shiftTypeId: "c" }));
  });

  test("removing a person removes their shifts", async () => {
    const { people } = converted();
    const kay = as("uKay");
    await removePerson(kay, HH, people.D);
    const loaded = await loadHousehold(kay, HH);
    assert.ok(!loaded.people.some((p) => p.id === people.D));
    assert.ok(!loaded.shifts.some((s) => s.personId === people.D));
    assert.ok(loaded.shifts.length > 0, "everyone else's shifts stay");
  });

  test("records are removed one at a time", async () => {
    await removeRecord(as("uGage"), HH, "events", "e1");
    const loaded = await loadHousehold(as("uGage"), HH);
    assert.deepEqual(loaded.events.map((e) => e.id).sort(), ["e2", "e3", "e4"]);
  });
});

describe("editing through the legacy bridge", () => {
  const { toLegacy, bridgeEdit } = toLegacyMod;

  /** What a Mac writer does on a migrated household: load, edit the legacy
   *  view, write only what changed — as `uid`, under the rules. */
  async function editAs(uid, edit) {
    const store = as(uid);
    const live = await loadHousehold(store, HH);
    const base = JSON.parse(JSON.stringify(toLegacy(live).state));
    const next = JSON.parse(JSON.stringify(base));
    edit(next);
    const ops = bridgeEdit(HH, live, META, base, next);
    await store.write(ops);
    return { ops, after: await loadHousehold(store, HH) };
  }

  test("a partner's everyday edits land as the right records", async () => {
    const { people } = converted();
    const { ops, after } = await editAs("uKay", (s) => {
      s.ot.push({ date: "2026-10-28", shiftTypeId: "n", label: "OT" });
      s.partner.name = "Kay";
      s.events = s.events.filter((e) => e.id !== "e2");
      s.occasions.push({ id: "o2", date: "2026-12-25", label: "Christmas", type: "holiday", annual: true });
    });
    assert.equal(ops.length, 5); // shift, Kaylene ×2, event delete, occasion
    assert.ok(after.shifts.some((s) => s.personId === people.G && s.date === "2026-10-28" && s.overtime));
    const kay = after.people.find((p) => p.id === people.K);
    assert.deepEqual([kay.name, kay.uid, kay.employer], ["Kay", "uKay", "CAMC"]);
    assert.ok(!after.events.some((e) => e.id === "e2"));
    assert.ok(after.occasions.some((o) => o.id === "o2"));
  });

  test("the edited legacy view is what the screens then see", async () => {
    const { after } = await editAs("uKay", (s) => { s.overrides.push({ date: "2026-11-11", shiftTypeId: null, label: "off" }); });
    const view = toLegacy(after).state;
    assert.deepEqual(view.overrides.find((o) => o.date === "2026-11-11").shiftTypeId, null);
  });

  test("the household's name goes to the household record", async () => {
    const { after } = await editAs("uKay", (s) => { s.householdName = "The Basses"; });
    assert.equal(after.root.name, "The Basses");
  });

  test("a caregiver can't edit through the bridge", async () => {
    // They can't even load the household to edit it.
    await assert.rejects(editAs("uDaisy", (s) => { s.calName = "x"; }));
  });
});

describe("the edit log", () => {
  const { toLegacy, bridgeEdit } = toLegacyMod;
  const { commitEdit, revertChanges } = storeMod;

  /** A save through the bridge with its edit-log entry, as `uid`. */
  async function saveAs(uid, edit) {
    const store = as(uid);
    const live = await loadHousehold(store, HH);
    const base = JSON.parse(JSON.stringify(toLegacy(live).state));
    const next = JSON.parse(JSON.stringify(base));
    edit(next);
    await commitEdit(store, HH, live, bridgeEdit(HH, live, META, base, next), uid);
    return { live, base };
  }
  const entries = async () => (await admin.list(`households/${HH}/edits`)).map((d) => d.data);

  test("one save writes one entry, naming who made it and what changed", async () => {
    const { people } = converted();
    await saveAs("uKay", (s) => {
      s.ot.push({ date: "2026-10-28", shiftTypeId: "n", label: "OT" });
      s.events = s.events.filter((e) => e.id !== "e2");
    });
    const [entry, ...more] = await entries();
    assert.equal(more.length, 0);
    assert.equal(entry.by, "uKay");
    const summary = entry.changes.map((c) => `${c.col}/${c.id}:${c.before ? "b" : "-"}${c.after ? "a" : "-"}`).sort();
    assert.deepEqual(summary, [`events/e2:b-`, `shifts/2026-10-28_${people.G}_add_000:-a`]);
  });

  test("an edit that changes nothing writes no entry", async () => {
    await saveAs("uKay", () => {});
    assert.deepEqual(await entries(), []);
  });

  test("rewinding the entry gives back the state the save started from", async () => {
    const { live } = await saveAs("uKay", (s) => {
      s.partner.name = "Kay";
      s.coverageRequests[0].status = "declined";
      s.overrides.push({ date: "2026-11-11", shiftTypeId: null, label: "off" });
    });
    const [entry] = await entries();
    const after = await loadHousehold(admin, HH);
    const rewound = revertChanges(after, entry.changes);
    // What the notification trigger compares: the legacy view before and after.
    assert.deepEqual(JSON.parse(JSON.stringify(toLegacy(rewound).state)), JSON.parse(JSON.stringify(toLegacy(live).state)));
    assert.equal(toLegacy(after).state.coverageRequests[0].status, "declined");
  });

  test("only a manager writes an entry, and only in their own name", async () => {
    const entry = (by) => [{ op: "set", path: `households/${HH}/edits/x_${by}`, data: { by, at: 1, changes: [] } }];
    await as("uKay").write(entry("uKay"));
    await assert.rejects(as("uKay").write(entry("uGage")));
    await assert.rejects(as("uDaisy").write(entry("uDaisy")));
    await assert.rejects(as("uKay").write([{ op: "delete", path: `households/${HH}/edits/x_uKay` }]));
  });
});

// functions/scripts/moveShareIds.js: takes householdId and ownerUid out of the
// world-readable share docs and into shareOwners. Runs against the Firestore
// emulator (npm run test:rules).

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, test } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

const require = createRequire(new URL("../functions/scripts/", import.meta.url));
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { moveShareIds } = require("./moveShareIds.js");

let env;
let db;
before(async () => {
  env = await initializeTestEnvironment({ projectId: "nucleus-rules-test" });
  db = getFirestore(initializeApp({ projectId: "nucleus-rules-test" }, "move-share-ids-test"));
});
after(async () => { await env?.cleanup(); });

const day = { date: "2026-10-09", shifts: [], events: [] };
const calendar = { v: 1, householdName: "Home", days: [day], updatedAt: 1 };

beforeEach(async () => {
  await env.clearFirestore();
  await db.collection("households").doc("hh1").set({
    memberUids: ["gage", "kaylene"], roles: { gage: "admin", kaylene: "partner" }, createdBy: "gage",
  });
  await db.collection("households").doc("hh2").set({
    memberUids: ["other", "both"], roles: { other: "admin", both: "partner" }, createdBy: "other",
  });
  await db.collection("households").doc("hh3").set({
    memberUids: ["both"], roles: { both: "admin" }, createdBy: "both",
  });
});

const share = (token) => db.collection("publicShares").doc(token);
const owner = (token) => db.collection("shareOwners").doc(token);

test("a dry run reports and changes nothing", async () => {
  await share("t1").set({ ...calendar, ownerUid: "gage", householdId: "hh1" });
  const r = await moveShareIds(db, { apply: false });
  assert.deepEqual(r.moved, ["t1"]);
  assert.equal((await owner("t1").get()).exists, false);
  assert.equal((await share("t1").get()).data().householdId, "hh1");
});

test("--apply writes the owner doc and strips the ids, keeping the calendar", async () => {
  await share("t1").set({ ...calendar, ownerUid: "kaylene", householdId: "hh1" });
  const r = await moveShareIds(db, { apply: true });
  assert.deepEqual(r.moved, ["t1"]);
  assert.deepEqual((await owner("t1").get()).data(), { ownerUid: "kaylene", householdId: "hh1" });
  assert.deepEqual((await share("t1").get()).data(), calendar);
});

test("a share with no ids left is skipped, and a second run does nothing", async () => {
  await share("t1").set({ ...calendar, ownerUid: "gage", householdId: "hh1" });
  await share("t2").set(calendar);
  await moveShareIds(db, { apply: true });
  const again = await moveShareIds(db, { apply: true });
  assert.deepEqual(again.moved, []);
  assert.deepEqual(again.clean.sort(), ["t1", "t2"]);
});

test("an owner doc that exists is kept as it is", async () => {
  await owner("t1").set({ ownerUid: "kaylene", householdId: "hh1" });
  await share("t1").set({ ...calendar, ownerUid: "gage", householdId: "hh1" });
  await moveShareIds(db, { apply: true });
  assert.deepEqual((await owner("t1").get()).data(), { ownerUid: "kaylene", householdId: "hh1" });
  assert.equal("ownerUid" in (await share("t1").get()).data(), false);
});

test("a share that names no household is matched to its owner's only household", async () => {
  await share("t1").set({ ...calendar, ownerUid: "gage" });
  await moveShareIds(db, { apply: true });
  assert.deepEqual((await owner("t1").get()).data(), { ownerUid: "gage", householdId: "hh1" });
  assert.deepEqual((await share("t1").get()).data(), calendar);
});

test("no household and an owner in several: left alone, untouched", async () => {
  await share("t1").set({ ...calendar, ownerUid: "both" });
  await share("t2").set({ ...calendar, ownerUid: "nobody" });
  const r = await moveShareIds(db, { apply: true });
  assert.deepEqual(r.moved, []);
  assert.deepEqual(r.skipped.map((s) => s.token).sort(), ["t1", "t2"]);
  assert.equal((await share("t1").get()).data().ownerUid, "both");
  assert.equal((await owner("t1").get()).exists, false);
});

test("a share naming a household that no longer exists is left alone", async () => {
  await share("t1").set({ ...calendar, ownerUid: "gage", householdId: "gone" });
  const r = await moveShareIds(db, { apply: true });
  assert.equal(r.skipped.length, 1);
  assert.equal((await share("t1").get()).data().householdId, "gone");
});

test("a missing ownerUid falls back to the household's creator", async () => {
  await share("t1").set({ ...calendar, householdId: "hh1" });
  await moveShareIds(db, { apply: true });
  assert.deepEqual((await owner("t1").get()).data(), { ownerUid: "gage", householdId: "hh1" });
});

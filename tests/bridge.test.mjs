// The legacy bridge (shared/toLegacy.ts, bridgeWrites in shared/store.ts):
// screens written for state/main running on a household already on the new
// model. Two things must hold:
//   - model → legacy → model is exact: same records, same ids;
//   - an edit made to the legacy view writes only the records it changed,
//     merged onto what's stored, so nothing else is disturbed.

import assert from "node:assert/strict";
import { test } from "node:test";
import legacyMod from "../functions/lib/shared/fromLegacy.js";
import toLegacyMod from "../functions/lib/shared/toLegacy.js";
import storeMod from "../functions/lib/shared/store.js";
import { HH, META, fullState } from "./fixtures/household.mjs";
import { randomState } from "./fixtures/random.mjs";

const { fromLegacy } = legacyMod;
const { toLegacy } = toLegacyMod;
const { bridgeWrites } = storeMod;

const PERSON_KEYS = ["id", "name", "employer", "payday", "weekly", "altWeekend", "blackouts"];

/** A model's content, lists in id order, people as the legacy view sees them. */
function content(m) {
  const out = JSON.parse(JSON.stringify(m));
  delete out.root;
  out.people = out.people.map((p) => Object.fromEntries(PERSON_KEYS.filter((k) => k in p).map((k) => [k, p[k]])));
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) out[k] = v.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return out;
}

const roundTrip = (model) => {
  const view = toLegacy(model);
  return fromLegacy(HH, JSON.parse(JSON.stringify(view.state)), META, { people: view.people }).model;
};

test("model → legacy → model is exact for the full household", () => {
  const { model } = fromLegacy(HH, fullState(), META);
  assert.deepEqual(content(roundTrip(model)), content(model));
});

test("model → legacy → model is exact for 300 random households", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const { model } = fromLegacy(HH, randomState(seed), META);
    assert.deepEqual(content(roundTrip(model)), content(model), `seed ${seed}`);
  }
});

test("ids made by the new model survive the round trip", () => {
  const { model, people } = fromLegacy(HH, fullState(), META);
  model.shifts.push({ id: "s_native1", personId: people.K, date: "2026-10-22", mode: "add", shiftTypeId: "d", createdAt: 5 });
  model.shifts.push({ id: "s_native2", personId: people.G, date: "2026-10-23", mode: "add", shiftTypeId: "e" }); // not overtime
  model.caregiverOff.push({ id: "off_native", personId: people.D, date: "2026-10-24" });
  model.shiftOffers.push({ id: "offer_native", personId: people.G, date: "2026-10-25", shiftTypeId: "n", coworkers: "" });
  const back = roundTrip(model);
  for (const id of ["s_native1", "s_native2"]) assert.ok(back.shifts.some((s) => s.id === id), id);
  assert.equal(back.shifts.find((s) => s.id === "s_native2").overtime, undefined);
  assert.ok(back.caregiverOff.some((c) => c.id === "off_native"));
  assert.ok(back.shiftOffers.some((o) => o.id === "offer_native"));
});

// ── Edits through the bridge ───────────────────────────────────────────────

/** Apply `edit` to the legacy view of `live` and return the writes. */
function bridge(live, edit) {
  const view = toLegacy(live);
  const before = fromLegacy(HH, JSON.parse(JSON.stringify(view.state)), META, { people: view.people }).model;
  const next = JSON.parse(JSON.stringify(view.state));
  edit(next);
  const after = fromLegacy(HH, next, META, { people: view.people }).model;
  return bridgeWrites(HH, live, before, after);
}

const liveModel = () => fromLegacy(HH, fullState(), META);
const paths = (ops) => ops.map((o) => `${o.op} ${o.path.replace(`households/${HH}/`, "")}`).sort();

test("an edit that changes nothing writes nothing", () => {
  assert.deepEqual(bridge(liveModel().model, () => {}), []);
});

test("adding overtime writes one shift", () => {
  const { model, people } = liveModel();
  const ops = bridge(model, (s) => s.ot.push({ date: "2026-10-28", shiftTypeId: "n", label: "OT" }));
  assert.deepEqual(paths(ops), [`set shifts/2026-10-28_${people.G}_add_000`]);
  assert.equal(ops[0].data.overtime, true);
});

test("deleting an event deletes one record", () => {
  const ops = bridge(liveModel().model, (s) => { s.events = s.events.filter((e) => e.id !== "e2"); });
  assert.deepEqual(paths(ops), ["delete events/e2"]);
});

test("renaming the partner keeps everything the legacy view doesn't show", () => {
  const { model, people } = liveModel();
  model.people.find((p) => p.id === people.K).photoPath = "households/hh1/people/k.jpg";
  const ops = bridge(model, (s) => { s.partner.name = "Kay"; });
  assert.deepEqual(paths(ops), [`set people/${people.K}`, `set personDetails/${people.K}`]);
  const identity = ops.find((o) => o.path.includes("/people/")).data;
  assert.deepEqual([identity.name, identity.uid, identity.color, identity.photoPath],
    ["Kay", "uKay", "clay", "households/hh1/people/k.jpg"]);
  assert.equal(ops.find((o) => o.path.includes("personDetails")).data.employer, "CAMC");
});

test("editing a record keeps its fields the legacy view doesn't carry", () => {
  const { model, people } = liveModel();
  const ot = model.shifts.find((s) => s.personId === people.G && s.overtime);
  ot.createdAt = 12345;
  const ops = bridge(model, (s) => { s.ot[0].coworkers = "Pat"; });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].data.coworkers, "Pat");
  assert.equal(ops[0].data.createdAt, 12345);
});

test("someone else's change to another record survives", () => {
  const { model } = liveModel();
  const view = toLegacy(model); // what this screen loaded
  const before = fromLegacy(HH, JSON.parse(JSON.stringify(view.state)), META, { people: view.people }).model;
  // Meanwhile another device retitles e3 …
  const live = JSON.parse(JSON.stringify(model));
  live.events.find((e) => e.id === "e3").title = "Lunch with Mom";
  // … and this screen adds an occasion from its older copy.
  const next = JSON.parse(JSON.stringify(view.state));
  next.occasions.push({ id: "o2", date: "2026-12-25", label: "Christmas", type: "holiday", annual: true });
  const after = fromLegacy(HH, next, META, { people: view.people }).model;
  assert.deepEqual(paths(bridgeWrites(HH, live, before, after)), ["set occasions/o2"]);
});

test("people and records outside the legacy view are never touched", () => {
  const { model } = liveModel();
  model.people.push({ id: "pKid", name: "Kid", role: "child", order: 3 });
  model.people.push({ id: "pThird", name: "Sam", role: "adult", order: 4 });
  model.shifts.push({ id: "s_third", personId: "pThird", date: "2026-10-26", mode: "add", shiftTypeId: "d" });
  model.events.push({ id: "e_kid", date: "2026-10-27", title: "Soccer", personId: "pKid" });
  const ops = bridge(model, (s) => {
    s.ot.push({ date: "2026-10-28", shiftTypeId: "n", label: "OT" });
    s.selfName = "Gage B";
  });
  assert.ok(ops.every((o) => !/pKid|pThird|s_third|e_kid/.test(o.path)), paths(ops).join("\n"));
  assert.equal(ops.length, 3); // the OT shift, and Gage's two documents
});

test("household name and settings changes go where they belong", () => {
  const ops = bridge(liveModel().model, (s) => { s.householdName = "The Basses"; s.calName = "Ours"; });
  assert.deepEqual(paths(ops), [`merge households/${HH}`, "set settings/main"]);
});

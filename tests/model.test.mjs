// The any-household model (shared/model.ts, fromLegacy.ts, resolve.ts).
//
// The migration is only safe if a converted household draws exactly what it
// drew before. These tests run the legacy engine and the new one side by side
// — on a household that uses every field, and on hundreds of random ones —
// and require identical calendars, coverage gaps and caregiver time.
//
// Runs against the built functions (npm run test:rules builds them first).

import assert from "node:assert/strict";
import { test } from "node:test";
import stateMod from "../functions/lib/shared/state.js";
import overlapMod from "../functions/lib/shared/computeOverlap.js";
import legacyMod from "../functions/lib/shared/fromLegacy.js";
import resolveMod from "../functions/lib/shared/resolve.js";
import verifyMod from "../functions/lib/shared/verify.js";

const { buildShiftMap, expandCustomTemplateTypes } = stateMod;
const { computeOverlapCandidates, daisyDayRanges } = overlapMod;
const { fromLegacy, PER_DEVICE } = legacyMod;
const { resolveShifts, coverageGaps, caregiverDayRanges } = resolveMod;
const { compareDrawing, compareRecords } = verifyMod;

import { HH, META, SHIFT_TYPES, fullState } from "./fixtures/household.mjs";
import { FROM, TO, addDays, randomState } from "./fixtures/random.mjs";

// ── Side-by-side comparison ────────────────────────────────────────────────


const SOURCE = { template: "template", "alt-weekend": "alt-weekend", override: "replace", ot: "add", partner: "add" };

/** The legacy calendar, in the new model's terms. */
function legacyCalendar(state, people) {
  const whoToId = { G: people.G, K: people.K, D: people.D };
  const map = buildShiftMap(expandCustomTemplateTypes(state), FROM, TO);
  const out = {};
  for (const [date, shifts] of Object.entries(map)) {
    if (date < FROM || date > TO) continue; // legacy also lists extras outside the window
    out[date] = shifts.map((s) => ({
      personId: whoToId[s.who], label: s.label, shiftTypeId: s.shiftTypeId,
      // Legacy caregiver shifts carry no source (they were display-only).
      source: s.who === "D" ? undefined : SOURCE[s.source.kind], note: s.note, where: s.where,
    }));
  }
  return out;
}

function newCalendar(model) {
  const caregiver = model.people.find((p) => p.role === "caregiver")?.id;
  const map = resolveShifts(model, FROM, TO);
  const out = {};
  for (const [date, shifts] of Object.entries(map)) {
    out[date] = shifts.map((s) => ({
      personId: s.personId, label: s.label, shiftTypeId: s.shiftTypeId,
      source: s.personId === caregiver ? undefined : s.source.kind,
      note: s.note, where: s.where,
    }));
  }
  return out;
}

/** Drop undefined so deepEqual compares only real values. */
const norm = (v) => JSON.parse(JSON.stringify(v));

function assertSameHousehold(state, label = "") {
  const { model, people } = fromLegacy(HH, structuredClone(state), META);

  assert.deepEqual(norm(newCalendar(model)), norm(legacyCalendar(state, people)), `${label} calendar differs`);

  // Coverage gaps: compare away from the window's edges, where the legacy map
  // can hold extras from outside the window.
  const inner = (c) => c.date > FROM && c.date < addDays(TO, -1);
  const expanded = expandCustomTemplateTypes(state);
  const legacyGaps = computeOverlapCandidates(buildShiftMap(expanded, FROM, TO), expanded).filter(inner);
  const newGaps = coverageGaps(model, resolveShifts(model, FROM, TO)).filter(inner);
  assert.deepEqual(norm(newGaps), norm(legacyGaps), `${label} coverage gaps differ`);

  if (people.D) {
    const shifts = resolveShifts(model, FROM, TO);
    for (let d = FROM; d <= TO; d = addDays(d, 1)) {
      assert.deepEqual(caregiverDayRanges(model, shifts, people.D, d), daisyDayRanges(expanded, d), `${label} caregiver time differs on ${d}`);
    }
  }
  // The check the migration runs must agree.
  assert.deepEqual(compareDrawing(state, model, people, FROM, TO), [], `${label} the migration's check disagrees`);
  return { model, legacyGaps };
}

// ── The full household ─────────────────────────────────────────────────────

test("every field of state/main lands somewhere, or is reported", () => {
  const { model, notes, people } = fromLegacy(HH, fullState(), META);
  assert.deepEqual(notes.sort(), [
    "duplicate override for 2026-09-17 ignored (the first one always won)",
    "legacy template/templateEndDate superseded by weeklyTemplates.G and not copied",
    "schedule block 2026-10-08–2026-10-08 had no id; given " + model.scheduleBlocks[1].id,
    'state/main field "mystery" has no place in the new model and was not copied',
  ].sort());
  assert.deepEqual([...PER_DEVICE].sort(), ["activeTab", "calView", "ui"]);

  const [g, k, d] = model.people;
  assert.deepEqual([g.name, g.role, g.uid, g.color], ["Gage", "adult", "uGage", "teal"]);
  assert.deepEqual([k.name, k.role, k.uid, k.color], ["Kaylene", "adult", "uKay", "clay"]);
  assert.deepEqual([d.name, d.role, d.uid, d.color], ["Daisy", "caregiver", "uDaisy", "ink"]);
  assert.equal(g.employer, "Thomas Hospital");
  assert.equal(k.payday.freq, "weekly");
  assert.equal(d.blackouts.length, 1);
  assert.equal(g.altWeekend.refSat, "2026-09-05");

  assert.equal(model.root.name, "Bass Household");
  assert.equal(model.root.childcare, true);
  assert.equal(model.settings.shareToken, "tok");
  assert.deepEqual(model.settings.migrations, ["kayleneSeed"]);

  assert.deepEqual(model.events.map((e) => e.personId), [people.G, undefined, people.K, people.D]);
  assert.ok(model.events.every((e) => !("who" in e)));
  assert.deepEqual(model.coverageRequests.map((r) => r.caregiverId), [people.D, people.D]);
  assert.deepEqual(model.caregiverOff, [{ id: `2026-09-25_${people.D}`, personId: people.D, date: "2026-09-25", label: "Daisy – Scheduled Off" }]);
  assert.equal(model.shiftOffers[0].personId, people.G);

  // An import keeps its photo: it has a document to itself now.
  assert.equal(model.imports[0].photo, "data:image/jpeg;base64,AAAA");

  // 2 overrides (one duplicate dropped) + 2 OT + 2 partner + 2 caregiver.
  assert.equal(model.shifts.length, 8);
});

test("the full household draws the same calendar, gaps and caregiver time", () => {
  const { legacyGaps } = assertSameHousehold(fullState(), "full household:");
  assert.ok(legacyGaps.length > 5, "fixture should produce real coverage gaps");
});

test("converting twice gives the same ids", () => {
  assert.deepEqual(fromLegacy(HH, fullState(), META), fromLegacy(HH, fullState(), META));
});

test("a household with only the legacy template still converts", () => {
  const s = fullState();
  delete s.weeklyTemplates;
  assertSameHousehold(s, "legacy template:");
});

// ── Random households ──────────────────────────────────────────────────────

test("300 random households convert without changing what they draw", () => {
  let gaps = 0;
  for (let seed = 1; seed <= 300; seed++) {
    gaps += assertSameHousehold(randomState(seed), `seed ${seed}:`).legacyGaps.length;
  }
  assert.ok(gaps > 300, "random households should exercise the coverage engine");
});

// ── Any household ──────────────────────────────────────────────────────────

function household(people, shifts) {
  return {
    root: { schemaVersion: 2, childcare: true, memberUids: [], memberNames: {}, roles: {}, createdBy: "u" },
    settings: {}, people, shiftTypes: SHIFT_TYPES, shifts, events: [], coverageRequests: [],
    caregiverRequests: [], scheduleBlocks: [], caregiverOff: [], occasions: [], shiftOffers: [], imports: [],
  };
}
const adult = (id, order, days) => ({ id, name: id, role: "adult", order, weekly: { days } });
const OFF = [null, null, null, null, null, null, null];
const DAYS = ["d", "d", "d", "d", "d", "d", "d"];
const on = (date, dayShift) => ({ id: `${date}_${dayShift}`, personId: "a", date, mode: "replace", shiftTypeId: dayShift });

test("one parent: the kids need covering whenever they're away", () => {
  const m = household([adult("a", 0, OFF)], [on("2026-09-15", "d")]);
  const gaps = coverageGaps(m, resolveShifts(m, FROM, TO));
  assert.deepEqual(gaps.map((g) => [g.date, g.startTime, g.endTime]), [["2026-09-15", "05:00", "19:30"]]);
});

test("three adults: a gap only when all three are away", () => {
  const two = household([adult("a", 0, DAYS), adult("b", 1, DAYS)], []);
  assert.ok(coverageGaps(two, resolveShifts(two, FROM, TO)).length > 0);
  const three = household([adult("a", 0, DAYS), adult("b", 1, DAYS), adult("c", 2, OFF)], []);
  assert.deepEqual(coverageGaps(three, resolveShifts(three, FROM, TO)), []);
});

test("a household without kids has no coverage gaps", () => {
  const m = household([adult("a", 0, DAYS), adult("b", 1, DAYS)], []);
  m.root.childcare = false;
  assert.deepEqual(coverageGaps(m, resolveShifts(m, FROM, TO)), []);
});

test("children own no shifts", () => {
  const m = household([adult("a", 0, OFF), { id: "kid", name: "Kid", role: "child", order: 1, weekly: { days: DAYS } }], []);
  assert.deepEqual(resolveShifts(m, FROM, TO), {});
});

// ── The migration's own check ──────────────────────────────────────────────

test("the migration's check catches a calendar that differs", () => {
  const state = fullState();
  const { model, people } = fromLegacy(HH, fullState(), META);
  model.shifts.find((x) => x.mode === "replace" && x.shiftTypeId === "n").shiftTypeId = "d";
  const problems = compareDrawing(state, model, people, FROM, TO);
  assert.ok(problems.some((p) => p === "calendar differs on 2026-09-17"), problems.join("\n"));
  assert.ok(problems.some((p) => p.startsWith("coverage gaps differ")), problems.join("\n"));
});

test("the migration's check catches caregiver time that differs", () => {
  const state = fullState();
  const { model, people } = fromLegacy(HH, fullState(), META);
  model.people.find((p) => p.id === people.D).weekly = undefined;
  assert.ok(compareDrawing(state, model, people, FROM, TO).some((p) => p.startsWith("caregiver time differs")));
});

test("the record check catches missing, extra and changed records", () => {
  const { model } = fromLegacy(HH, fullState(), META);
  assert.deepEqual(compareRecords(model, structuredClone(model)), []);
  const read = structuredClone(model);
  read.events = read.events.filter((e) => e.id !== "e1");
  read.occasions.push({ id: "stray", date: "2026-01-01", label: "x", type: "holiday" });
  read.coverageRequests[0].status = "declined";
  assert.deepEqual(compareRecords(model, read).sort(), [
    "coverageRequests/cov1 differs", "events/e1 is missing", "occasions/stray shouldn't be there",
  ]);
});

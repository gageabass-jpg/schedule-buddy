// What a caregiver sees and may change (functions/src/caregiverLogic.ts).
// Runs against the built functions: `npm --prefix functions run build` first
// (npm run test:rules does both).

import assert from "node:assert/strict";
import { test } from "node:test";
import logic from "../functions/lib/caregiverLogic.js";

const { applyCaregiverAction, buildCaregiverView, CaregiverInputError, CaregiverForbiddenError } = logic;

const ctx = { uid: "daisy", nowIso: "2026-09-29T12:00:00.000Z", nowMs: 1790683200000, newId: "ev_test" };

const state = () => ({
  householdName: "Bass Household",
  selfName: "Gage",
  partner: { name: "Kaylene", shifts: [{ date: "2026-10-01", shiftTypeId: "n" }] },
  dependents: { daisy: { name: "Daisy", shifts: [{ date: "2026-10-02" }] } },
  events: [{ id: "e1", date: "2026-10-03", title: "Cardiology", who: "G", healthId: "h1" }],
  paydays: { G: { anchor: "2026-09-30", freq: "biweekly" } },
  employers: { G: "Thomas Hospital" },
  ot: [{ date: "2026-10-04" }],
  imports: [{ photo: "data:image/jpeg;base64,AAAA" }],
  scheduleBlocks: [],
  coverageRequests: [
    { id: "r1", date: "2026-10-05", startTime: "06:00", endTime: "18:00", status: "pending" },
    { id: "r2", date: "2026-10-06", startTime: "06:00", endTime: "18:00", status: "confirmed",
      proposedChange: { startTime: "07:00", endTime: "19:00", reason: "shift moved" } },
  ],
});

test("the view holds only requests and names", () => {
  const view = buildCaregiverView(state());
  assert.deepEqual(Object.keys(view).sort(),
    ["coverageRequests", "dependents", "householdName", "partner", "selfName"]);
  assert.deepEqual(view.partner, { name: "Kaylene" });            // no shifts
  assert.deepEqual(view.dependents, { daisy: { name: "Daisy" } }); // no class days
  assert.equal(view.coverageRequests.length, 2);
  const json = JSON.stringify(view);
  for (const secret of ["Cardiology", "Thomas Hospital", "biweekly", "base64"]) {
    assert.ok(!json.includes(secret), `view leaks ${secret}`);
  }
});

test("an empty or missing state gives an empty view", () => {
  assert.deepEqual(buildCaregiverView(undefined), { coverageRequests: [] });
});

test("accepting a request changes only that request", () => {
  const s = state();
  const patch = applyCaregiverAction(s, { action: "respond", id: "r1", status: "confirmed" }, ctx);
  assert.deepEqual(Object.keys(patch), ["coverageRequests"]);
  assert.equal(patch.coverageRequests[0].status, "confirmed");
  assert.equal(patch.coverageRequests[0].caregiverUid, "daisy");
  assert.deepEqual(patch.coverageRequests[1], s.coverageRequests[1]);
});

test("a decline needs a reason", () => {
  assert.throws(() => applyCaregiverAction(state(), { action: "respond", id: "r1", status: "declined" }, ctx),
    CaregiverInputError);
  assert.throws(() => applyCaregiverAction(state(), { action: "respond", id: "r1", status: "declined", note: "   " }, ctx),
    CaregiverInputError);
  const patch = applyCaregiverAction(state(), { action: "respond", id: "r1", status: "declined", note: " class " }, ctx);
  assert.equal(patch.coverageRequests[0].caregiverNote, "class");
});

test("no other status can be set", () => {
  for (const status of ["pending", "deleted", "admin", undefined]) {
    assert.throws(() => applyCaregiverAction(state(), { action: "respond", id: "r1", status }, ctx), CaregiverInputError);
  }
});

test("an unknown request is refused", () => {
  assert.throws(() => applyCaregiverAction(state(), { action: "respond", id: "nope", status: "confirmed" }, ctx),
    CaregiverInputError);
});

test("approving a proposed change moves the times and clears it", () => {
  const patch = applyCaregiverAction(state(), { action: "resolveChange", id: "r2", approve: true }, ctx);
  const r = patch.coverageRequests[1];
  assert.equal(r.startTime, "07:00");
  assert.equal(r.endTime, "19:00");
  assert.equal(r.proposedChange, undefined);
  assert.equal(r.changeAppliedAt, ctx.nowMs);
});

test("rejecting a proposed change keeps the agreed times", () => {
  const patch = applyCaregiverAction(state(), { action: "resolveChange", id: "r2", approve: false }, ctx);
  const r = patch.coverageRequests[1];
  assert.equal(r.startTime, "06:00");
  assert.equal(r.proposedChange, undefined);
});

test("a change with nothing proposed is refused", () => {
  assert.throws(() => applyCaregiverAction(state(), { action: "resolveChange", id: "r1", approve: true }, ctx),
    CaregiverInputError);
});

test("adding an event appends it and changes nothing else", () => {
  const s = state();
  const patch = applyCaregiverAction(s,
    { action: "addEvent", date: "2026-10-07", title: "Dentist", who: "family", startTime: "09:30" }, ctx);
  assert.deepEqual(Object.keys(patch), ["events"]);
  assert.equal(patch.events.length, 2);
  assert.deepEqual(patch.events[0], s.events[0]);
  assert.deepEqual(patch.events[1], { id: "ev_test", date: "2026-10-07", title: "Dentist", who: "family", startTime: "09:30" });
});

test("an event must be well formed", () => {
  const bad = [
    { date: "10/07/2026", title: "x", who: "G" },
    { date: "2026-10-07", title: "", who: "G" },
    { date: "2026-10-07", title: "x", who: "stranger" },
    { date: "2026-10-07", title: "x", who: "G", startTime: "9:30am" },
    { date: "2026-10-07", title: "x".repeat(201), who: "G" },
  ];
  for (const b of bad) {
    assert.throws(() => applyCaregiverAction(state(), { action: "addEvent", ...b }, ctx), CaregiverInputError);
  }
});

test("adding a block appends a one-day block", () => {
  const patch = applyCaregiverAction(state(), { action: "addBlock", date: "2026-10-08", label: "Daisy: exam" }, ctx);
  assert.deepEqual(patch, { scheduleBlocks: [{ startDate: "2026-10-08", endDate: "2026-10-08", label: "Daisy: exam" }] });
});

test("anything else is refused", () => {
  for (const input of [null, {}, { action: "setPaydays" }, { action: "deleteEvent", id: "e1" }]) {
    assert.throws(() => applyCaregiverAction(state(), input, ctx), CaregiverInputError);
  }
});

// ── Whose request is it ─────────────────────────────────────────────────────

const addressed = (extra) => {
  const s = state();
  s.coverageRequests[0] = { ...s.coverageRequests[0], ...extra };
  s.coverageRequests[1] = { ...s.coverageRequests[1], ...extra };
  return s;
};

test("a request that names nobody is still the household's single caregiver's to answer", () => {
  const s = state();
  assert.doesNotThrow(() => applyCaregiverAction(s, { action: "respond", id: "r1", status: "confirmed" }, ctx));
  assert.doesNotThrow(() => applyCaregiverAction(s, { action: "resolveChange", id: "r2", approve: true }, ctx));
});

test("a caregiver can't answer or resolve a request another caregiver already took", () => {
  const s = addressed({ caregiverUid: "someoneElse" });
  assert.throws(() => applyCaregiverAction(s, { action: "respond", id: "r1", status: "declined", note: "no" }, ctx), CaregiverForbiddenError);
  assert.throws(() => applyCaregiverAction(s, { action: "resolveChange", id: "r2", approve: true }, ctx), CaregiverForbiddenError);
});

test("the caregiver whose request it is can change their own answer", () => {
  const s = addressed({ caregiverUid: "daisy" });
  assert.doesNotThrow(() => applyCaregiverAction(s, { action: "respond", id: "r1", status: "declined", note: "sick" }, ctx));
});

test("on the any-household model, a request names a person, and only that person's account answers", () => {
  const s = addressed({ caregiverId: "pDaisy" });
  assert.doesNotThrow(() => applyCaregiverAction(s, { action: "respond", id: "r1", status: "confirmed" }, { ...ctx, callerPersonIds: ["pDaisy"] }));
  assert.throws(() => applyCaregiverAction(s, { action: "respond", id: "r1", status: "confirmed" }, { ...ctx, callerPersonIds: ["pOtherCaregiver"] }), CaregiverForbiddenError);
  assert.throws(() => applyCaregiverAction(s, { action: "respond", id: "r1", status: "confirmed" }, { ...ctx, callerPersonIds: [] }), CaregiverForbiddenError,
    "an account with no person record answers nothing");
  assert.throws(() => applyCaregiverAction(s, { action: "resolveChange", id: "r2", approve: false }, { ...ctx, callerPersonIds: ["pOtherCaregiver"] }), CaregiverForbiddenError);
});

test("a household still on state/main has no people to match, so a person id alone doesn't block", () => {
  const s = addressed({ caregiverId: "pDaisy" });
  assert.doesNotThrow(() => applyCaregiverAction(s, { action: "respond", id: "r1", status: "confirmed" }, ctx));
});

test("adding an event or a block isn't tied to a request", () => {
  const s = addressed({ caregiverUid: "someoneElse" });
  assert.doesNotThrow(() => applyCaregiverAction(s, { action: "addEvent", date: "2026-10-09", title: "Dentist", who: "Daisy" }, ctx));
  assert.doesNotThrow(() => applyCaregiverAction(s, { action: "addBlock", date: "2026-10-10", label: "Away" }, ctx));
});

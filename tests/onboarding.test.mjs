// Setting up a new household (shared/onboarding.ts): the wizard's answers,
// checked, built into a household on the any-household model with nothing
// but what was entered, and created under the real rules by a brand-new user.
//
// Its own emulator project, so it can run beside the other emulator tests.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as fs from "firebase/firestore";
import onboardingMod from "../functions/lib/shared/onboarding.js";
import storeMod from "../functions/lib/shared/store.js";
import resolveMod from "../functions/lib/shared/resolve.js";
import toLegacyMod from "../functions/lib/shared/toLegacy.js";

const {
  checkAnswers, buildHousehold, createHousehold, SHIFT_PRESETS, SetupError, randomInviteCode,
  timeZoneLabel, timeZoneChoices,
} = onboardingMod;
const { modularStore, loadHousehold } = storeMod;
const { resolveShifts, coverageGaps } = resolveMod;
const { toLegacy } = toLegacyMod;

const types = (...ids) => SHIFT_PRESETS.filter((t) => ids.includes(t.id)).map((t) => ({ ...t }));

/** Two parents, a roommate, a caregiver and two kids. */
function answers() {
  return {
    householdName: "  The  Rivera household ",
    timeZone: "America/Chicago",
    me: {
      name: "Ana",
      describes: "head",
      employer: "St. Luke's",
      workplace: { placeId: "ChIJwork", label: "St. Luke's, Houston, TX" },
      payday: { anchor: "2026-10-02", freq: "biweekly" },
      week: {
        days: [null, "day12", "day12", null, null, "night12", null],
        altWeekend: { refSat: "2026-10-03", sat: "day12", sun: null },
      },
    },
    others: [
      { kind: "roommate", name: "Jo" },
      { kind: "partner", name: "Luis", week: { days: [null, "office", "office", "office", "office", "office", null] } },
      { kind: "caregiver", name: "Marta" },
    ],
    kids: 2,
    shiftTypes: types("day12", "night12", "office"),
    integrations: { commuteHome: { placeId: "ChIJ123", label: "12 Elm St" } },
  };
}

let seq = 0;
const ctx = (over = {}) => ({
  householdId: "hhNew", uid: "uAna", accountName: "Ana R", now: 1790000000000,
  personId: (i) => `p${i}`, inviteCode: () => ["AAAAAA", "BBBBBB", "CCCCCC"][seq++ % 3],
  ...over,
});

describe("the answers", () => {
  test("are tidied", () => {
    const a = checkAnswers(answers());
    assert.equal(a.householdName, "The Rivera household");
    assert.equal(a.shiftTypes.find((t) => t.id === "night12").crossesMidnight, true);
  });

  test("anything missing or malformed is refused with what to fix", () => {
    const bad = [
      [(a) => { a.householdName = "  "; }, /household name/],
      [(a) => { a.timeZone = "Mars/Olympus"; }, /time zone/],
      [(a) => { a.me.name = ""; }, /Your name/],
      [(a) => { a.me.describes = "boss"; }, /describes you/],
      [(a) => { a.others[0].kind = "pet"; }, /who each person is/],
      [(a) => { a.others[1].name = " "; }, /person's name/],
      [(a) => { a.kids = -1; }, /kids/],
      [(a) => { a.me.workplace = { placeId: "", label: "" }; }, /workplace/],
      [(a) => { a.me.week.days = ["day12"]; }, /seven days/],
      [(a) => { a.me.week.days[1] = "nope"; }, /isn't in the list/],
      [(a) => { a.me.week.altWeekend.refSat = "2026-10-02"; }, /Saturday/],
      [(a) => { a.me.payday.freq = "monthly"; }, /payday/],
      [(a) => { a.shiftTypes.push({ ...a.shiftTypes[0] }); }, /its own id/],
      [(a) => { a.shiftTypes[0].end = a.shiftTypes[0].start; }, /same time/],
      [(a) => { a.integrations.commuteHome = { placeId: "", label: "" }; }, /home address/],
    ];
    for (const [edit, msg] of bad) {
      const a = answers();
      edit(a);
      assert.throws(() => checkAnswers(a), (e) => e instanceof SetupError && msg.test(e.message), String(msg));
    }
  });

  test("a single parent with no caregiver, no kids and a changing schedule is fine", () => {
    const a = { householdName: "Solo", timeZone: "Europe/London", me: { name: "Sam", describes: "other" }, others: [], kids: 0, shiftTypes: [], integrations: {} };
    const h = buildHousehold(a, ctx());
    assert.deepEqual(h.model.people.map((p) => p.role), ["adult"]);
    assert.equal(h.root.childcare, false);
    assert.equal(h.codes.caregiver, undefined);
  });
});

describe("time zones", () => {
  test("read as a place and a zone, never an id", () => {
    assert.match(timeZoneLabel("America/New_York"), /^New York · Eastern/);
    assert.equal(timeZoneLabel("America/Los_Angeles").includes("_"), false);
  });
  test("the detected zone comes first, then the US, and no label has underscores", () => {
    const choices = timeZoneChoices("Europe/Berlin");
    assert.equal(choices[0].value, "Europe/Berlin");
    assert.equal(choices[1].value, "America/New_York");
    assert.ok(choices.every((c) => !c.label.includes("_") && !c.label.includes("/")));
  });
});

describe("the household built from them", () => {
  test("holds exactly what was entered, and nothing else", () => {
    seq = 0;
    const h = buildHousehold(answers(), ctx());
    assert.deepEqual(
      h.model.people.map((p) => [p.id, p.name, p.role, p.relation, p.color, p.order, p.uid, p.watchesKids]),
      [
        ["p0", "Ana", "adult", "self", "teal", 0, "uAna", undefined],
        ["p1", "Jo", "adult", "roommate", undefined, 1, undefined, false],
        ["p2", "Luis", "adult", "partner", "clay", 2, undefined, undefined],
        ["p3", "Marta", "caregiver", "caregiver", "ink", 3, undefined, undefined],
      ],
    );
    assert.equal(h.model.people[0].describes, "head");
    // Kids are a number, not records.
    assert.equal(h.root.childCount, 2);
    assert.ok(!h.model.people.some((p) => p.role === "child"));
    const ana = h.model.people[0];
    assert.equal(ana.employer, "St. Luke's");
    assert.deepEqual(ana.altWeekend, { enabled: true, refSat: "2026-10-03", sat: "day12", sun: null });
    assert.equal(h.root.schemaVersion, 2);
    assert.equal(h.root.childcare, true);
    assert.deepEqual(h.root.roles, { uAna: "admin" });
    assert.deepEqual(h.codes, { partner: "AAAAAA", caregiver: "BBBBBB" });
    assert.deepEqual(h.model.settings, {});
    for (const k of ["shifts", "events", "coverageRequests", "occasions", "imports"]) assert.deepEqual(h.model[k], [], k);
    // No trace of any other family, and none of its WVU game days.
    assert.equal(h.root.wvuFootball, false);
    assert.equal(h.root.familyPhotos, false);
    assert.deepEqual(h.commute, {
      home: { placeId: "ChIJ123", label: "12 Elm St" },
      work: { G: { placeId: "ChIJwork", label: "St. Luke's, Houston, TX" } },
    });
    assert.ok(!/Gage|Kaylene|Daisy|Bass|WVU/i.test(JSON.stringify(h).replace(/"wvuFootball":false,?/g, "")));
  });

  test("the caregiver's code is never the partner's", () => {
    const h = buildHousehold(answers(), ctx({ inviteCode: (() => { const c = ["SAME22", "SAME22", "DIFF22"]; let i = 0; return () => c[i++]; })() }));
    assert.deepEqual(h.codes, { partner: "SAME22", caregiver: "DIFF22" });
  });

  test("invite codes avoid look-alike characters", () => {
    for (let i = 0; i < 200; i++) assert.match(randomInviteCode(), /^[A-HJ-NP-Z2-9]{6}$/);
  });

  test("the calendar draws the week that was entered", () => {
    seq = 0;
    const { model } = buildHousehold(answers(), ctx());
    const cal = resolveShifts(model, "2026-10-04", "2026-10-10"); // Sun..Sat, an off weekend
    const chips = (d) => (cal[d] ?? []).map((s) => `${s.personId}:${s.label}`);
    assert.deepEqual(chips("2026-10-05"), ["p0:7a", "p2:9a"]); // Monday
    assert.deepEqual(chips("2026-10-09"), ["p0:7p", "p2:9a"]); // Friday night
    assert.deepEqual(chips("2026-10-10"), []);                  // Saturday, off weekend
    assert.deepEqual(resolveShifts(model, "2026-10-03", "2026-10-03")["2026-10-03"].map((s) => s.label), ["7a"]); // working Saturday
  });

  test("a roommate doesn't count as someone who can watch the kids", () => {
    seq = 0;
    const { model } = buildHousehold(answers(), ctx());
    // Monday: Ana and Luis both at work, only Jo home — still a gap.
    const gaps = coverageGaps(model, resolveShifts(model, "2026-10-04", "2026-10-10"));
    assert.ok(gaps.some((g) => g.date === "2026-10-05"));
  });

  test("the legacy screens see these people, not the built-in family", () => {
    seq = 0;
    const { state } = toLegacy(buildHousehold(answers(), ctx()).model);
    assert.equal(state.selfName, "Ana");
    assert.equal(state.partner.name, "Luis"); // the partner, not the roommate added first
    assert.equal(state.dependents.daisy.name, "Marta");
    assert.equal(state.householdName, "The Rivera household");
    assert.deepEqual(state._migrations, []);
  });
});

// ── Created by a brand-new user, under the rules ────────────────────────────

const PROJECT = "nucleus-onboarding-test";
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await env?.cleanup(); });

describe("creating it", () => {
  beforeEach(async () => { await env.clearFirestore(); });
  const db = (uid) => env.authenticatedContext(uid).firestore();
  const as = (uid) => modularStore(db(uid), fs);

  async function create() {
    seq = 0;
    const h = buildHousehold(answers(), ctx({ inviteCode: () => ["PART22", "CARE22"][seq++] }));
    await createHousehold(as("uAna"), "hhNew", h, 1790000000000);
    return h;
  }

  test("a new user creates the whole household themselves", async () => {
    const h = await create();
    const model = await loadHousehold(as("uAna"), "hhNew");
    assert.equal(model.root.schemaVersion, 2);
    assert.equal(model.root.name, "The Rivera household");
    assert.deepEqual(model.people.map((p) => p.name).sort(), ["Ana", "Jo", "Luis", "Marta"]);
    assert.equal(model.people.find((p) => p.name === "Jo").relation, "roommate");
    assert.equal(model.shiftTypes.length, 3);
    const commute = await fs.getDoc(fs.doc(db("uAna"), "households", "hhNew", "private", "commute"));
    assert.deepEqual(commute.data(), h.commute);
  });

  test("the partner joins with their code, the caregiver with theirs", async () => {
    await create();
    const join = (uid, code, role) => fs.updateDoc(fs.doc(db(uid), "households", "hhNew"), {
      memberUids: fs.arrayUnion(uid), [`memberNames.${uid}`]: uid, [`roles.${uid}`]: role, joinCode: code,
    });
    await assertSucceeds(join("uLuis", "PART22", "partner"));
    await assertSucceeds(join("uMarta", "CARE22", "supporting"));
    const root = (await fs.getDoc(fs.doc(db("uAna"), "households", "hhNew"))).data();
    assert.deepEqual(root.roles, { uAna: "admin", uLuis: "partner", uMarta: "supporting" });
  });

  test("nobody can create a household for someone else", async () => {
    seq = 0;
    const h = buildHousehold(answers(), ctx({ inviteCode: () => ["PART22", "CARE22"][seq++] }));
    await assert.rejects(createHousehold(as("uMallory"), "hhNew", h, 1));
  });
});

// Security rules tests for firestore.rules, run against the Firestore emulator:
//
//   npm run test:rules
//
// (which is `firebase emulators:exec --only firestore "node --test tests/"`).
// Each test starts from an empty database with one household: Gage (admin),
// Kaylene (partner) and Daisy (supporting), a partner invite code and a
// caregiver invite code.

import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, setDoc, updateDoc,
} from "firebase/firestore";

const HH = "hh1";
const OTHER_HH = "hh2";
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "nucleus-rules-test",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "households", HH), {
      memberUids: ["gage", "kaylene", "daisy"],
      memberNames: { gage: "Gage", kaylene: "Kaylene", daisy: "Daisy" },
      roles: { gage: "admin", kaylene: "partner", daisy: "supporting" },
      inviteCode: "PART22",
      createdBy: "gage",
    });
    await setDoc(doc(db, "households", OTHER_HH), {
      memberUids: ["other"], memberNames: { other: "Other" }, roles: { other: "admin" },
      inviteCode: "OTHR22", createdBy: "other",
    });
    await setDoc(doc(db, "households", HH, "state", "main"), { selfName: "Gage" });
    await setDoc(doc(db, "inviteCodes", "PART22"), { householdId: HH });
    await setDoc(doc(db, "inviteCodes", "CARE22"), { householdId: HH, role: "supporting" });
    await setDoc(doc(db, "inviteCodes", "OTHR22"), { householdId: OTHER_HH });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const join = (uid, fields) => updateDoc(doc(as(uid), "households", HH), {
  memberUids: arrayUnion(uid),
  [`memberNames.${uid}`]: uid,
  ...fields,
});

describe("invite codes", () => {
  test("anyone signed in can look one up by its code", async () => {
    await assertSucceeds(getDoc(doc(as("stranger"), "inviteCodes", "PART22")));
  });
  test("nobody can list them", async () => {
    await assertFails(getDocs(collection(as("stranger"), "inviteCodes")));
    await assertFails(getDocs(collection(as("gage"), "inviteCodes")));
  });
  test("an admin or partner can mint a code for their household", async () => {
    await assertSucceeds(setDoc(doc(as("gage"), "inviteCodes", "NEW222"), { householdId: HH, role: "supporting" }));
    await assertSucceeds(setDoc(doc(as("kaylene"), "inviteCodes", "NEW223"), { householdId: HH, role: "contributing" }));
  });
  test("a stranger can't mint a code for someone else's household", async () => {
    await assertFails(setDoc(doc(as("stranger"), "inviteCodes", "NEW224"), { householdId: HH }));
  });
  test("no code grants admin", async () => {
    await assertFails(setDoc(doc(as("gage"), "inviteCodes", "NEW225"), { householdId: HH, role: "admin" }));
  });
});

describe("joining a household", () => {
  test("a valid partner code joins as partner", async () => {
    await assertSucceeds(join("newbie", { "roles.newbie": "partner", joinCode: "PART22" }));
  });
  test("a caregiver code joins as supporting", async () => {
    await assertSucceeds(join("carer", { "roles.carer": "supporting", joinCode: "CARE22" }));
  });
  test("no code, no entry", async () => {
    await assertFails(join("stranger", { "roles.stranger": "partner" }));
  });
  test("a made-up code is refused", async () => {
    await assertFails(join("stranger", { "roles.stranger": "partner", joinCode: "FAKE22" }));
  });
  test("a code for another household is refused", async () => {
    await assertFails(join("stranger", { "roles.stranger": "partner", joinCode: "OTHR22" }));
  });
  test("a joiner can't make themselves admin", async () => {
    await assertFails(join("stranger", { "roles.stranger": "admin", joinCode: "PART22" }));
  });
  test("a caregiver code can't be used to join as partner", async () => {
    await assertFails(join("carer", { "roles.carer": "partner", joinCode: "CARE22" }));
  });
  test("a joiner can't change anyone else's role", async () => {
    await assertFails(join("stranger", {
      "roles.stranger": "partner", "roles.kaylene": "supporting", joinCode: "PART22",
    }));
  });
  test("a joiner can't change other fields", async () => {
    await assertFails(join("stranger", {
      "roles.stranger": "partner", joinCode: "PART22", createdBy: "stranger",
    }));
  });
  test("a stranger still can't read the household or its schedule", async () => {
    await assertFails(getDoc(doc(as("stranger"), "households", HH)));
    await assertFails(getDoc(doc(as("stranger"), "households", HH, "state", "main")));
  });
});

describe("leaving and removing", () => {
  const leave = (who, target) => updateDoc(doc(as(who), "households", HH), {
    memberUids: arrayRemove(target),
    [`memberNames.${target}`]: deleteField(),
    [`roles.${target}`]: deleteField(),
  });
  test("a partner can leave", async () => {
    await assertSucceeds(leave("kaylene", "kaylene"));
  });
  test("a partner can't remove someone else", async () => {
    await assertFails(leave("kaylene", "gage"));
  });
  test("an admin can remove a member", async () => {
    await assertSucceeds(leave("gage", "kaylene"));
  });
  test("a partner can't promote themselves", async () => {
    await assertFails(updateDoc(doc(as("kaylene"), "households", HH), { "roles.kaylene": "admin" }));
  });
  test("a partner may change the household's name or time zone, nothing else", async () => {
    await assertSucceeds(updateDoc(doc(as("kaylene"), "households", HH), { name: "The Basses", timeZone: "America/Chicago" }));
    await assertFails(updateDoc(doc(as("kaylene"), "households", HH), { name: "x", inviteCode: "ZZZ999" }));
    await assertFails(updateDoc(doc(as("daisy"), "households", HH), { name: "x" }));
  });
  test("nobody deletes a household", async () => {
    const { deleteDoc } = await import("firebase/firestore");
    await assertFails(deleteDoc(doc(as("gage"), "households", HH)));
  });
});

describe("creating a household", () => {
  test("you can create one with yourself as admin", async () => {
    await assertSucceeds(setDoc(doc(as("newbie"), "households", "hh3"), {
      memberUids: ["newbie"], memberNames: { newbie: "Newbie" }, roles: { newbie: "admin" },
      inviteCode: "ABCD22", createdBy: "newbie",
    }));
  });
  test("you can't create one that includes someone else", async () => {
    await assertFails(setDoc(doc(as("newbie"), "households", "hh4"), {
      memberUids: ["newbie", "gage"], memberNames: {}, roles: { newbie: "admin", gage: "partner" },
      inviteCode: "ABCD23", createdBy: "newbie",
    }));
  });
});

describe("the schedule record", () => {
  test("admin and partner read and write it", async () => {
    await assertSucceeds(getDoc(doc(as("kaylene"), "households", HH, "state", "main")));
    await assertSucceeds(setDoc(doc(as("gage"), "households", HH, "state", "main"), { selfName: "Gage" }));
  });
  test("a caregiver can neither read nor write it", async () => {
    await assertFails(getDoc(doc(as("daisy"), "households", HH, "state", "main")));
    await assertFails(setDoc(doc(as("daisy"), "households", HH, "state", "main"), { selfName: "x" }));
    await assertFails(updateDoc(doc(as("daisy"), "households", HH, "state", "main"), { coverageRequests: [] }));
  });
  test("a caregiver can't see overtime approvals", async () => {
    await assertFails(getDoc(doc(as("daisy"), "households", HH, "otApprovals", "0")));
    await assertSucceeds(getDoc(doc(as("gage"), "households", HH, "otApprovals", "0")));
  });
});

describe("the caregiver view", () => {
  test("every member can read it", async () => {
    await assertSucceeds(getDoc(doc(as("daisy"), "households", HH, "caregiverView", "main")));
    await assertSucceeds(getDoc(doc(as("gage"), "households", HH, "caregiverView", "main")));
  });
  test("nobody writes it but the functions", async () => {
    await assertFails(setDoc(doc(as("daisy"), "households", HH, "caregiverView", "main"), { coverageRequests: [] }));
    await assertFails(setDoc(doc(as("gage"), "households", HH, "caregiverView", "main"), { coverageRequests: [] }));
  });
  test("a stranger can't read it", async () => {
    await assertFails(getDoc(doc(as("stranger"), "households", HH, "caregiverView", "main")));
  });
});

// ── The any-household model ────────────────────────────────────────────────
// Gage and Kaylene are people with accounts; Daisy is the caregiver.

const P = { gage: "pG", kaylene: "pK", daisy: "pD" };
const path = (...p) => [HH, ...p].join("/");

async function seedModel() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (p, data) => setDoc(doc(db, "households", ...p.split("/")), data);
    for (const [uid, pid] of Object.entries(P)) {
      await put(path("people", pid), { name: uid, role: uid === "daisy" ? "caregiver" : "adult", uid, order: 0 });
      await put(path("personDetails", pid), { employer: `${uid}'s work`, payday: { anchor: "2026-09-04", freq: "weekly" } });
      await put(path("shifts", `2026-10-01_${pid}_replace`), { personId: pid, date: "2026-10-01", mode: "replace", shiftTypeId: "d" });
    }
    await put(path("shiftTypes", "d"), { name: "Day", start: "07:00", end: "19:00", crossesMidnight: false });
    await put(path("coverageRequests", "cov1"), { caregiverId: P.daisy, date: "2026-10-02", startTime: "06:00", endTime: "18:00", status: "pending", createdAt: 1 });
    await put(path("coverageRequests", "cov2"), { caregiverId: "pSomeoneElse", date: "2026-10-03", startTime: "06:00", endTime: "18:00", status: "pending", createdAt: 2 });
    await put(path("caregiverOff", `2026-10-04_${P.daisy}`), { personId: P.daisy, date: "2026-10-04" });
    await put(path("caregiverRequests", "cr1"), { createdBy: "daisy", type: "other", date: "2026-10-05", status: "new", createdAt: 3 });
    await put(path("caregiverRequests", "cr2"), { createdBy: "gage", type: "other", date: "2026-10-05", status: "new", createdAt: 4 });
    await put(path("events", "e1"), { date: "2026-10-06", title: "Cardiology", personId: P.gage, healthId: "h1" });
    await put(path("settings", "main"), { shareToken: "secret" });
  });
}

const colOf = (uid, name) => collection(as(uid), "households", HH, name);

describe("the new model: who reads what", () => {
  beforeEach(seedModel);

  test("every member sees who's who and the shift types; a stranger doesn't", async () => {
    await assertSucceeds(getDocs(colOf("daisy", "people")));
    await assertSucceeds(getDocs(colOf("daisy", "shiftTypes")));
    await assertFails(getDocs(colOf("stranger", "people")));
  });

  test("a person's details: managers, and the person themself", async () => {
    await assertSucceeds(getDocs(colOf("kaylene", "personDetails")));
    await assertSucceeds(getDoc(doc(as("daisy"), "households", HH, "personDetails", P.daisy)));
    await assertFails(getDoc(doc(as("daisy"), "households", HH, "personDetails", P.gage)));
    await assertFails(getDocs(colOf("daisy", "personDetails")));
  });

  test("a caregiver lists their own shifts, never everyone's", async () => {
    const { query, where } = await import("firebase/firestore");
    await assertSucceeds(getDocs(query(colOf("daisy", "shifts"), where("personId", "==", P.daisy))));
    await assertFails(getDocs(colOf("daisy", "shifts")));
    await assertFails(getDocs(query(colOf("daisy", "shifts"), where("personId", "==", P.gage))));
    await assertFails(getDoc(doc(as("daisy"), "households", HH, "shifts", `2026-10-01_${P.gage}_replace`)));
    await assertSucceeds(getDocs(colOf("kaylene", "shifts")));
  });

  test("a caregiver sees only the coverage requests addressed to them", async () => {
    const { query, where } = await import("firebase/firestore");
    await assertSucceeds(getDocs(query(colOf("daisy", "coverageRequests"), where("caregiverId", "==", P.daisy))));
    await assertFails(getDocs(colOf("daisy", "coverageRequests")));
    await assertFails(getDoc(doc(as("daisy"), "households", HH, "coverageRequests", "cov2")));
  });

  test("a caregiver sees their own days off and the requests they sent", async () => {
    const { query, where } = await import("firebase/firestore");
    await assertSucceeds(getDocs(query(colOf("daisy", "caregiverOff"), where("personId", "==", P.daisy))));
    await assertSucceeds(getDocs(query(colOf("daisy", "caregiverRequests"), where("createdBy", "==", "daisy"))));
    await assertFails(getDocs(colOf("daisy", "caregiverRequests")));
  });

  test("a caregiver can't see events, settings, blocks, offers or imports", async () => {
    for (const name of ["events", "scheduleBlocks", "shiftOffers", "imports", "occasions"]) {
      await assertFails(getDocs(colOf("daisy", name)));
    }
    await assertFails(getDoc(doc(as("daisy"), "households", HH, "events", "e1")));
    await assertFails(getDoc(doc(as("daisy"), "households", HH, "settings", "main")));
    await assertSucceeds(getDoc(doc(as("kaylene"), "households", HH, "settings", "main")));
  });
});

describe("the new model: who writes what", () => {
  beforeEach(seedModel);

  test("admin and partner write records", async () => {
    await assertSucceeds(setDoc(doc(as("kaylene"), "households", HH, "shifts", "x"), { personId: P.kaylene, date: "2026-10-09", mode: "add", shiftTypeId: "d" }));
    await assertSucceeds(setDoc(doc(as("gage"), "households", HH, "people", "pNew"), { name: "Kid", role: "child", order: 3 }));
  });

  test("a caregiver writes nothing directly", async () => {
    await assertFails(setDoc(doc(as("daisy"), "households", HH, "shifts", "x"), { personId: P.daisy, date: "2026-10-09", mode: "add", shiftTypeId: "d" }));
    await assertFails(updateDoc(doc(as("daisy"), "households", HH, "coverageRequests", "cov1"), { status: "confirmed" }));
    await assertFails(updateDoc(doc(as("daisy"), "households", HH, "personDetails", P.daisy), { employer: "x" }));
    await assertFails(updateDoc(doc(as("daisy"), "households", HH, "people", P.daisy), { name: "x" }));
  });

  test("a caregiver can't make themself someone else", async () => {
    await assertFails(updateDoc(doc(as("daisy"), "households", HH, "people", P.gage), { uid: "daisy" }));
  });

  test("a stranger writes nothing", async () => {
    await assertFails(setDoc(doc(as("stranger"), "households", HH, "events", "x"), { date: "2026-10-09", title: "x" }));
  });
});

describe("public shares", () => {
  const TOKEN = "tok1";
  const share = (ownerUid, extra = {}) => ({ v: 1, ownerUid, householdId: HH, householdName: "Home", days: [], ...extra });
  const seedShare = (data) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "publicShares", TOKEN), data));
  const ref = (uid) => doc(as(uid), "publicShares", TOKEN);

  test("anyone can read a share by its token, signed in or not", async () => {
    await seedShare(share("gage"));
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "publicShares", TOKEN)));
  });

  test("an admin or partner publishes their household's share", async () => {
    await assertSucceeds(setDoc(ref("gage"), share("gage")));
    await assertSucceeds(setDoc(doc(as("kaylene"), "publicShares", "tok2"), share("kaylene")));
  });

  test("a caregiver, a stranger, or a wrong uid can't create one", async () => {
    await assertFails(setDoc(ref("daisy"), share("daisy")));                         // supporting
    await assertFails(setDoc(ref("stranger"), share("stranger")));                   // not a member
    await assertFails(setDoc(ref("kaylene"), share("gage")));                        // someone else's uid
    await assertFails(setDoc(ref("gage"), share("gage", { householdId: OTHER_HH }))); // not theirs
    await assertFails(setDoc(ref("gage"), { v: 1, ownerUid: "gage" }));              // names no household
  });

  test("a stranger can't overwrite or delete someone else's share", async () => {
    await seedShare(share("gage"));
    await assertFails(setDoc(ref("stranger"), share("stranger", { householdName: "Fake schedule" })));
    await assertFails(setDoc(ref("stranger"), share("stranger", { householdId: OTHER_HH })));
    await assertFails(setDoc(ref("other"), share("other", { householdId: OTHER_HH })));  // another household's admin
    await assertFails(deleteDoc(ref("stranger")));
    await assertFails(deleteDoc(ref("other")));
  });

  test("a caregiver can't overwrite or delete the share either", async () => {
    await seedShare(share("gage"));
    await assertFails(setDoc(ref("daisy"), share("daisy")));
    await assertFails(deleteDoc(ref("daisy")));
  });

  test("the partner republishes over the admin's share, and the admin over the partner's", async () => {
    await seedShare(share("gage"));
    await assertSucceeds(setDoc(ref("kaylene"), share("kaylene", { days: [{ date: "2026-10-09" }] })));
    await assertSucceeds(setDoc(ref("gage"), share("gage")));
  });

  test("the owner can update and delete; so can the household's admin and partner", async () => {
    await seedShare(share("kaylene"));
    await assertSucceeds(setDoc(ref("kaylene"), share("kaylene", { householdName: "Edited" })));
    await assertSucceeds(deleteDoc(ref("gage")));          // admin removes a partner-owned share
    await seedShare(share("gage"));
    await assertSucceeds(deleteDoc(ref("kaylene")));       // partner removes an admin-owned share
  });

  test("a share can't be moved to another household", async () => {
    await seedShare(share("gage"));
    await assertFails(setDoc(ref("gage"), share("gage", { householdId: OTHER_HH })));
  });

  test("the old owner keeps control after leaving the household", async () => {
    await seedShare(share("former", { householdId: HH }));
    await assertSucceeds(setDoc(ref("former"), share("former", { householdName: "Edited" })));
    await assertSucceeds(deleteDoc(ref("former")));
  });

  test("a share from before householdId was stamped can be republished by its owner", async () => {
    await seedShare({ v: 1, ownerUid: "gage", householdName: "Old" });
    await assertSucceeds(setDoc(ref("gage"), share("gage")));
  });
});

describe("household meta docs", () => {
  const meta = (uid, id) => doc(as(uid), "households", HH, "meta", id);
  beforeEach(() => env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "households", HH, "meta", "cadence"), { dueCycle: "2026-10-30" });
    await setDoc(doc(db, "households", HH, "meta", "piCommand"), { nonce: "n1", command: "scene" });
  }));

  test("admin and partner read and write the cadence flags", async () => {
    for (const uid of ["gage", "kaylene"]) {
      await assertSucceeds(getDoc(meta(uid, "cadence")));
      await assertSucceeds(setDoc(meta(uid, "cadence"), { ackCoverage: "2026-10-12" }, { merge: true }));
    }
  });

  test("a caregiver can't write any of them, the wall remote included", async () => {
    await assertFails(setDoc(meta("daisy", "cadence"), { ackCoverage: "x" }, { merge: true }));
    await assertFails(setDoc(meta("daisy", "piCommand"), { nonce: "n2", command: "reboot" }));
    await assertFails(setDoc(meta("daisy", "nowPlaying"), { title: "x" }));
    await assertFails(deleteDoc(meta("daisy", "piCommand")));
  });

  test("a caregiver doesn't read them either", async () => {
    await assertFails(getDoc(meta("daisy", "cadence")));
    await assertFails(getDoc(meta("daisy", "piCommand")));
  });

  test("the wall remote and now-playing are the functions' alone: no client writes them", async () => {
    for (const uid of ["gage", "kaylene"]) {
      await assertFails(setDoc(meta(uid, "piCommand"), { nonce: "n2", command: "reboot" }));
      await assertFails(setDoc(meta(uid, "nowPlaying"), { title: "x" }));
      await assertFails(setDoc(meta(uid, "anythingElse"), { x: 1 }));
    }
  });

  test("a stranger reads and writes nothing", async () => {
    await assertFails(getDoc(meta("stranger", "cadence")));
    await assertFails(setDoc(meta("stranger", "cadence"), { ackCoverage: "x" }, { merge: true }));
    await assertFails(setDoc(meta("other", "cadence"), { ackCoverage: "x" }, { merge: true }));  // another household's admin
  });
});

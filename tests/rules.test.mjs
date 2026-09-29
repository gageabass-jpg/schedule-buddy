// Security rules tests for firestore.rules, run against the Firestore emulator:
//
//   npm run test:rules
//
// (which is `firebase emulators:exec --only firestore "node --test tests/"`).
// Each test starts from an empty database with one household: Gage (admin)
// and Kaylene (partner), a partner invite code and a caregiver invite code.

import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  arrayRemove, arrayUnion, collection, deleteField, doc, getDoc, getDocs, setDoc, updateDoc,
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
      memberUids: ["gage", "kaylene"],
      memberNames: { gage: "Gage", kaylene: "Kaylene" },
      roles: { gage: "admin", kaylene: "partner" },
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
    await assertSucceeds(join("daisy", { "roles.daisy": "supporting", joinCode: "CARE22" }));
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
    await assertFails(join("daisy", { "roles.daisy": "partner", joinCode: "CARE22" }));
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

describe("unchanged: members and their schedule", () => {
  test("members read and write the schedule", async () => {
    await assertSucceeds(getDoc(doc(as("kaylene"), "households", HH, "state", "main")));
    await assertSucceeds(setDoc(doc(as("gage"), "households", HH, "state", "main"), { selfName: "Gage" }));
  });
});

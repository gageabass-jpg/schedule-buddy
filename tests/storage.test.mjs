// Security rules tests for storage.rules, run against the Storage and
// Firestore emulators (the membership check reads the household from
// Firestore, so both are needed):
//
//   npm run test:rules
//
// One household: Gage (admin), Kaylene (partner), Daisy (supporting). Another
// household has its own admin.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, getMetadata, listAll, ref, uploadBytes } from "firebase/storage";

const HH = "hh1";
const OTHER_HH = "hh2";
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "nucleus-rules-test",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../storage.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "households", HH), {
      memberUids: ["gage", "kaylene", "daisy"],
      roles: { gage: "admin", kaylene: "partner", daisy: "supporting" },
      createdBy: "gage",
    });
    await setDoc(doc(db, "households", OTHER_HH), {
      memberUids: ["other"], roles: { other: "admin" }, createdBy: "other",
    });
    await uploadBytes(ref(ctx.storage(), `wallPhotos/${HH}/seeded0000000000`), new Uint8Array([1, 2, 3]), { contentType: "image/jpeg" });
  });
});

const store = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const photo = (uid, hh = HH, id = "newphoto00000000") => ref(store(uid), `wallPhotos/${hh}/${id}`);
const jpeg = { contentType: "image/jpeg" };
const bytes = new Uint8Array([255, 216, 255]);

describe("wall photos: members", () => {
  test("every member uploads a photo and gets its download URL", async () => {
    for (const uid of ["gage", "kaylene", "daisy"]) {
      const r = photo(uid, HH, `by-${uid}`.padEnd(16, "0"));
      await assertSucceeds(uploadBytes(r, bytes, jpeg));
      await assertSucceeds(getDownloadURL(r));
    }
  });

  test("a member replaces and deletes a photo in their household", async () => {
    await assertSucceeds(uploadBytes(photo("gage", HH, "seeded0000000000"), bytes, jpeg));
    await assertSucceeds(deleteObject(photo("kaylene", HH, "seeded0000000000")));
  });

  test("only an image, and under 10 MB", async () => {
    await assertFails(uploadBytes(photo("gage"), bytes, { contentType: "text/html" }));
    await assertFails(uploadBytes(photo("gage"), bytes, { contentType: "application/octet-stream" }));
    await assertFails(uploadBytes(photo("gage"), new Uint8Array(10 * 1024 * 1024), jpeg));
    await assertSucceeds(uploadBytes(photo("gage"), new Uint8Array(1024 * 1024), jpeg));
  });
});

describe("wall photos: everyone else", () => {
  test("a stranger can't upload, replace, fetch or delete in someone's household", async () => {
    await assertFails(uploadBytes(photo("stranger"), bytes, jpeg));
    await assertFails(uploadBytes(photo("stranger", HH, "seeded0000000000"), bytes, jpeg));
    await assertFails(getDownloadURL(photo("stranger", HH, "seeded0000000000")));
    await assertFails(getMetadata(photo("stranger", HH, "seeded0000000000")));
    await assertFails(deleteObject(photo("stranger", HH, "seeded0000000000")));
  });

  test("another household's admin can't either", async () => {
    await assertFails(uploadBytes(photo("other"), bytes, jpeg));
    await assertFails(getDownloadURL(photo("other", HH, "seeded0000000000")));
    await assertFails(deleteObject(photo("other", HH, "seeded0000000000")));
  });

  test("signed out: nothing", async () => {
    await assertFails(uploadBytes(photo(null), bytes, jpeg));
    await assertFails(getDownloadURL(photo(null, HH, "seeded0000000000")));
    await assertFails(deleteObject(photo(null, HH, "seeded0000000000")));
  });

  test("a member of one household can't write into another's folder", async () => {
    await assertFails(uploadBytes(photo("gage", OTHER_HH), bytes, jpeg));
    await assertFails(uploadBytes(photo("other", HH), bytes, jpeg));
  });

  test("a folder whose household doesn't exist is closed to everyone", async () => {
    await assertFails(uploadBytes(photo("gage", "no-such-household"), bytes, jpeg));
  });
});

describe("wall photos: listing", () => {
  test("nobody lists a household's folder: not a member, a stranger, or signed out", async () => {
    for (const uid of ["gage", "daisy", "stranger", "other", null]) {
      await assertFails(listAll(ref(store(uid), `wallPhotos/${HH}`)));
    }
  });
});

describe("wall photos: the download URL", () => {
  test("still works with no sign-in, which is how the wall page loads a photo", async () => {
    const r = photo("gage", HH, "viewable00000000");
    await assertSucceeds(uploadBytes(r, bytes, jpeg));
    const url = await getDownloadURL(r);
    assert.match(url, /[?&]token=/);
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...bytes]);
  });
});

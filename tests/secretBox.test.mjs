// How a saved mailbox password is sealed (functions/src/secretBox.ts).
// Runs against the built functions: `npm --prefix functions run build` first
// (npm run test:rules does both).

import assert from "node:assert/strict";
import { test } from "node:test";
import box from "../functions/lib/secretBox.js";

const { seal, open } = box;
const SECRET = "the-oauth-client-secret";
const PASSWORD = "abcd-efgh-ijkl-mnop";

test("what is sealed opens again under the same secret", () => {
  assert.equal(open(seal(PASSWORD, SECRET), SECRET), PASSWORD);
});

test("the sealed text doesn't contain the password", () => {
  const sealed = seal(PASSWORD, SECRET);
  assert.ok(!sealed.includes(PASSWORD));
  assert.ok(!sealed.includes("abcd"));
  assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
});

test("sealing the same thing twice gives different text each time", () => {
  assert.notEqual(seal(PASSWORD, SECRET), seal(PASSWORD, SECRET));
});

test("another secret can't open it", () => {
  assert.throws(() => open(seal(PASSWORD, SECRET), "a-different-secret"));
});

test("a changed ciphertext, tag or iv is refused rather than read", () => {
  const [v, iv, tag, data] = seal(PASSWORD, SECRET).split(".");
  const flip = (s) => (s[0] === "A" ? "B" : "A") + s.slice(1);
  assert.throws(() => open([v, iv, tag, flip(data)].join("."), SECRET));
  assert.throws(() => open([v, iv, flip(tag), data].join("."), SECRET));
  assert.throws(() => open([v, flip(iv), tag, data].join("."), SECRET));
});

test("something that isn't sealed text is refused", () => {
  assert.throws(() => open("abcd-efgh-ijkl-mnop", SECRET), /Not a sealed value/);
  assert.throws(() => open("v2.a.b.c", SECRET), /Not a sealed value/);
  assert.throws(() => open("", SECRET), /Not a sealed value/);
});

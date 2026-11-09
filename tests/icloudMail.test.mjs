// How a search written in Gmail's shorthand becomes an IMAP search for iCloud
// (functions/src/icloudMail.ts). Runs against the built functions.

import assert from "node:assert/strict";
import { test } from "node:test";
import mail from "../functions/lib/icloudMail.js";
import query from "../functions/lib/shared/mailQuery.js";

const { imapSearch } = mail;
const { parseMailQuery } = query;
const NOW = new Date("2026-11-08T12:00:00Z");
const day = 86_400_000;

test("a date floor and several words become since + or", () => {
  const s = imapSearch(parseMailQuery("newer_than:30d appointment OR reservation OR confirmed"), NOW);
  assert.equal(s.since.getTime(), NOW.getTime() - 30 * day);
  assert.deepEqual(s.or, [{ text: "appointment" }, { text: "reservation" }, { text: "confirmed" }]);
  assert.equal(s.text, undefined);
  assert.equal(s.all, undefined);
});

test("one word is a plain text search", () => {
  const s = imapSearch(parseMailQuery("newer_than:7d dentist"), NOW);
  assert.equal(s.text, "dentist");
  assert.equal(s.or, undefined);
});

test("weeks and months count in days", () => {
  assert.equal(imapSearch(parseMailQuery("newer_than:2w x"), NOW).since.getTime(), NOW.getTime() - 14 * day);
  assert.equal(imapSearch(parseMailQuery("newer_than:1m x"), NOW).since.getTime(), NOW.getTime() - 30 * day);
});

test("a search with only a date floor looks at everything since then", () => {
  const s = imapSearch(parseMailQuery("newer_than:7d"), NOW);
  assert.ok(s.since);
  assert.equal(s.all, undefined);
  assert.equal(s.text, undefined);
});

test("a search with nothing in it is not an empty search", () => {
  const s = imapSearch(parseMailQuery("in:inbox -label:spam"), NOW);
  assert.equal(s.all, true);
});

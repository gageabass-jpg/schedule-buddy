// Run: node --test scripts/compare-nucleus-css.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { collectCss, compareCss, logicalName, normaliseCss } from "./lib/nucleus-css.mjs";

const dist = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "css-"));
  for (const [name, text] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return dir;
};
const cmp = (a, b) => compareCss(collectCss(dist(a)), collectCss(dist(b)));

test("hashes in file names are not a difference", () => {
  assert.equal(logicalName("assets/index-uvDJg52e.css"), "index.css");
  assert.equal(logicalName("assets/index-a-_Bc9Zz.css"), "index.css");
  assert.equal(logicalName("assets/vendor.css"), "vendor.css");
  assert.ok(cmp({ "assets/index-AAAAAAAA.css": ".a{color:red}" }, { "assets/index-BBBBBBBB.css": ".a{color:red}" }).same);
});

test("a source-map comment, CRLF and trailing space are not a difference", () => {
  assert.ok(cmp(
    { "assets/i-AAAAAAAA.css": ".a{color:red}\n.b{top:0}\n" },
    { "assets/i-BBBBBBBB.css": ".a{color:red}  \r\n.b{top:0}\r\n/*# sourceMappingURL=i.css.map */" },
  ).same);
});

test("a hashed asset in url() is not a difference, a different asset name is", () => {
  assert.ok(cmp({ "a-AAAAAAAA.css": ".x{background:url(./assets/logo-AAAAAAAA.png)}" }, { "a-BBBBBBBB.css": ".x{background:url(./assets/logo-BBBBBBBB.png)}" }).same);
  assert.ok(!cmp({ "a-AAAAAAAA.css": ".x{background:url(./assets/logo-AAAAAAAA.png)}" }, { "a-BBBBBBBB.css": ".x{background:url(./assets/other-BBBBBBBB.png)}" }).same);
});

test("a changed declaration is a difference, and the report names the rule", () => {
  const r = cmp({ "i-AAAAAAAA.css": ".btn{color:red}.card{top:0}" }, { "i-BBBBBBBB.css": ".btn{color:blue}.card{top:0}" });
  assert.equal(r.same, false);
  assert.match(r.problems[0], /1 rule\(s\) only in base, 1 only in candidate/);
  assert.match(r.problems[0], /- \.btn\{color:red\}/);
  assert.match(r.problems[0], /\+ \.btn\{color:blue\}/);
});

test("an added or removed rule is a difference", () => {
  assert.equal(cmp({ "i-AAAAAAAA.css": ".a{x:1}" }, { "i-BBBBBBBB.css": ".a{x:1}.b{y:2}" }).same, false);
  assert.equal(cmp({ "i-AAAAAAAA.css": ".a{x:1}.b{y:2}" }, { "i-BBBBBBBB.css": ".a{x:1}" }).same, false);
});

test("the same rules in a different order are a difference (the cascade depends on order)", () => {
  const r = cmp({ "i-AAAAAAAA.css": ".a{color:red}.a{color:blue}" }, { "i-BBBBBBBB.css": ".a{color:blue}.a{color:red}" });
  assert.equal(r.same, false);
  assert.match(r.problems[0], /different order/);
});

test("a CSS file that appears or disappears is a difference", () => {
  assert.equal(cmp({ "i-AAAAAAAA.css": ".a{x:1}" }, { "i-BBBBBBBB.css": ".a{x:1}", "extra-CCCCCCCC.css": ".z{}" }).same, false);
  assert.equal(cmp({ "i-AAAAAAAA.css": ".a{x:1}", "extra-CCCCCCCC.css": ".z{}" }, { "i-BBBBBBBB.css": ".a{x:1}" }).same, false);
});

test("an empty or missing build is an error, never a pass", () => {
  assert.throws(() => collectCss(dist({ "index.html": "<html>" })), /no CSS files/);
  assert.throws(() => collectCss("/definitely/not/here"), /no build output/);
});

test("normalising is idempotent", () => {
  const once = normaliseCss(".a{x:url(a-AAAAAAAA.png)}  \r\n");
  assert.equal(normaliseCss(once), once);
});

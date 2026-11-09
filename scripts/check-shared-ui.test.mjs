// Run: node --test scripts/check-shared-ui.test.mjs   (needs `npm ci` in desktop/)
// Each case plants one fault in a scratch copy of shared-ui/ and expects the right check to fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { packageOf, specifiersOf } from "./lib/imports.mjs";

const REAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function scratch(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sui-"));
  for (const d of ["shared-ui", "ci", "scripts"]) fs.cpSync(path.join(REAL, d), path.join(dir, d), { recursive: true });
  fs.symlinkSync(path.join(REAL, "desktop"), path.join(dir, "desktop"));   // the toolchain; read only
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, "shared-ui", "src", f), text);
  return dir;
}

function check(files, only) {
  const dir = scratch(files);
  try {
    const r = spawnSync("node", [path.join(dir, "scripts", "check-shared-ui.mjs"), "--root", dir, "--only", only], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { code: r.status, text: r.stdout + r.stderr };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("the real shared-ui passes every check", () => {
  const r = check({}, "types,lint,imports");
  assert.equal(r.code, 0, r.text);
});

test("types: a type error fails", () => {
  const r = check({ "lib/bad.ts": 'export const n: number = "text";\n' }, "types");
  assert.equal(r.code, 1);
  assert.match(r.text, /bad\.ts/);
});

test("types: an unresolvable package fails", () => {
  const r = check({ "lib/bad.ts": 'import dayjs from "dayjs";\nexport const d = dayjs;\n' }, "types");
  assert.equal(r.code, 1);
});

test("lint: an unused variable (an error in Nucleus's rules) fails", () => {
  const r = check({ "lib/bad.ts": "export function f() { const unused = 1; return 2; }\n" }, "lint");
  assert.equal(r.code, 1);
  assert.match(r.text, /no-unused-vars/);
});

test("lint: an explicit any fails", () => {
  const r = check({ "lib/bad.ts": "export const a: any = 1;\n" }, "lint");
  assert.equal(r.code, 1);
  assert.match(r.text, /no-explicit-any/);
});

test("lint: one more warning than today fails (the limit is a ratchet)", () => {
  const r = check({ "ui/extra.tsx": "export function A() { return null; }\nexport function helper() { return 1; }\n" }, "lint");
  assert.equal(r.code, 1);
  assert.match(r.text, /Maximum number of warnings|warning/i);
});

test("lint: the app alias is refused", () => {
  const r = check({ "lib/bad.ts": 'import { cn } from "@/lib/utils";\nexport const x = cn;\n' }, "lint");
  assert.equal(r.code, 1);
  assert.match(r.text, /no-restricted-imports/);
});

test("imports: the app alias, Node built-ins and undeclared packages are refused", () => {
  for (const [code, pattern] of [
    ['import { cn } from "@/lib/utils";\nexport const x = cn;\n', /@\/lib\/utils/],
    ['import fs from "node:fs";\nexport const x = fs;\n', /node:fs/],
    ['import dayjs from "dayjs";\nexport const x = dayjs;\n', /does not declare "dayjs"/],
  ]) {
    const r = check({ "lib/bad.ts": code }, "imports");
    assert.equal(r.code, 1, code);
    assert.match(r.text, pattern);
  }
});

test("imports: a relative import that leaves shared-ui/src, or hits nothing, is refused", () => {
  let r = check({ "lib/bad.ts": 'import { t } from "../../../desktop/src/theme";\nexport const x = t;\n' }, "imports");
  assert.equal(r.code, 1);
  assert.match(r.text, /leaves shared-ui\/src/);
  r = check({ "lib/bad.ts": 'import { n } from "./nope";\nexport const x = n;\n' }, "imports");
  assert.equal(r.code, 1);
  assert.match(r.text, /does not resolve/);
});

test("imports: a declared package, a sub-path and a relative import are fine", () => {
  const r = check({ "lib/ok.ts": 'import { motion } from "motion/react";\nimport { cn } from "./utils";\nexport const x = [motion, cn];\n' }, "imports");
  assert.equal(r.code, 0, r.text);
});

test("the import reader handles every form, and ignores comments", () => {
  const src = `
    import a from "a";
    import { b,
      c } from "b/sub";
    export * from "./d";
    export { e } from "../e";
    import "side-effect";
    const f = await import("lazy");
    // import nope from "in-a-line-comment";
    /* import nope2 from "in-a-block-comment"; */
    import type { T } from "@scope/pkg/deep";
  `;
  assert.deepEqual(specifiersOf(src), ["a", "b/sub", "./d", "../e", "side-effect", "lazy", "@scope/pkg/deep"]);
  assert.equal(packageOf("@scope/pkg/deep"), "@scope/pkg");
  assert.equal(packageOf("motion/react"), "motion");
});

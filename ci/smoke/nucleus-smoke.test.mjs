// Proves the smoke test can fail. Plants one fault at a time in a scratch copy of the built
// app and expects nucleus-smoke.mjs to exit 1 and name the problem.
// Run under a display: xvfb-run -a node --test ci/smoke/nucleus-smoke.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.resolve(here, "..", "..", "desktop");

function scratchApp(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-app-"));
  fs.copyFileSync(path.join(REAL, "package.json"), path.join(dir, "package.json"));
  fs.cpSync(path.join(REAL, "dist"), path.join(dir, "dist"), { recursive: true });
  fs.cpSync(path.join(REAL, "dist-electron"), path.join(dir, "dist-electron"), { recursive: true });
  fs.symlinkSync(path.join(REAL, "node_modules"), path.join(dir, "node_modules"));   // Electron itself; read only
  mutate(dir);
  return dir;
}

function smoke(mutate) {
  const dir = scratchApp(mutate);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-out-"));
  try {
    const r = spawnSync("node", [path.join(here, "nucleus-smoke.mjs"), "--desktop", dir, "--out", out], { encoding: "utf8", timeout: 150_000 });
    return { code: r.status, text: r.stdout + r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
}

const edit = (dir, file, fn) => {
  const p = path.join(dir, file);
  fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8")));
};

test("the real build passes", () => {
  const r = smoke(() => {});
  assert.equal(r.code, 0, r.text);
});

test("an uncaught page error fails", () => {
  const r = smoke((d) => edit(d, "dist/index.html", (h) => h.replace("</head>", "<script>setTimeout(() => { throw new Error('planted page error'); }, 300)</script></head>")));
  assert.equal(r.code, 1);
  assert.match(r.text, /uncaught page error: .*planted page error/);
});

test("a page that never renders fails", () => {
  const r = smoke((d) => edit(d, "dist/index.html", (h) => h.replace(/<script type="module"[^>]*><\/script>/, "")));
  assert.equal(r.code, 1);
  assert.match(r.text, /#root stayed empty/);
  assert.match(r.text, /primary UI is not visible/);
});

test("a missing preload bridge fails", () => {
  const r = smoke((d) => fs.writeFileSync(path.join(d, "dist-electron/preload.mjs"), "// planted: empty preload\n"));
  assert.equal(r.code, 1);
  assert.match(r.text, /window\.sbm is missing/);
});

test("a fatal error in the main process fails", () => {
  const r = smoke((d) => edit(d, "dist-electron/main.js", (m) => m + "\nsetTimeout(() => Promise.reject(new Error('planted main failure')), 700);\n"));
  assert.equal(r.code, 1);
  assert.match(r.text, /main process: .*unhandledRejection/);
});

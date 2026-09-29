#!/usr/bin/env node
/**
 * predeploy-gate.mjs — the tests every `firebase deploy` must pass first.
 * firebase.json runs it as the predeploy hook of hosting, functions and
 * firestore, so a failing test stops the deploy before anything is uploaded,
 * on staging and live alike.
 *
 *   1. contract check      — scripts/contract-check.mjs (phone ↔ Mac state shape)
 *   2. page syntax         — every inline <script> in public/*.html parses
 *   3. rules + caregiver   — tests/*.test.mjs against the Firestore emulator
 *
 * A deploy of several targets runs every hook, so a pass is remembered in
 * .firebase/deploy-gate.json against a hash of everything the tests read, and
 * the next hook skips if nothing changed.
 *
 *   node scripts/predeploy-gate.mjs          (exit 1 on failure)
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAMP = join(ROOT, ".firebase/deploy-gate.json");

// Everything the tests read. functions/src/shared is left out: it's copied
// from shared/ by the build the tests run, so hashing it would never settle.
const INPUTS = [
  "firestore.rules", "package.json", "desktop/src/state.ts",
  "functions/package.json", "functions/tsconfig.json", "functions/src",
  "shared", "tests", "scripts/contract-check.mjs", "scripts/predeploy-gate.mjs",
  "public",
];
const SKIP = new Set([join(ROOT, "functions/src/shared")]);

function files(p) {
  if (SKIP.has(p) || !existsSync(p)) return [];
  if (!statSync(p).isDirectory()) return [p];
  return readdirSync(p).sort().flatMap((n) => (n.startsWith(".") ? [] : files(join(p, n))));
}

function inputHash() {
  const h = createHash("sha256");
  for (const f of INPUTS.flatMap((i) => files(join(ROOT, i)))) {
    h.update(relative(ROOT, f)).update("\0").update(readFileSync(f)).update("\0");
  }
  return h.digest("hex");
}

const hash = inputHash();
try {
  if (JSON.parse(readFileSync(STAMP, "utf8")).hash === hash) {
    console.log("deploy gate: tests already passed for this code, skipping");
    process.exit(0);
  }
} catch { /* no stamp yet */ }

const run = (label, cmd) => {
  console.log(`\ndeploy gate: ${label}`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: "inherit" });
  } catch {
    console.error(`\ndeploy gate: ${label} FAILED — deploy stopped. Nothing was uploaded.`);
    process.exit(1);
  }
};

run("contract check", "node scripts/contract-check.mjs");

console.log("\ndeploy gate: page syntax");
let bad = 0;
for (const f of files(join(ROOT, "public")).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(f, "utf8");
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1] || "";
    if (/\bsrc=/.test(attrs) || /type=["'](?!text\/javascript)/.test(attrs)) continue;
    n++;
    const line = html.slice(0, m.index).split("\n").length;
    try {
      new vm.Script(m[2], { filename: `${relative(ROOT, f)} (script at line ${line})` });
    } catch (e) {
      bad++;
      console.error(`  ✗ ${relative(ROOT, f)}:${line} — ${e.message}`);
    }
  }
  if (n) console.log(`  ✓ ${relative(ROOT, f)} (${n} script${n > 1 ? "s" : ""})`);
}
if (bad) {
  console.error("\ndeploy gate: page syntax FAILED — deploy stopped. Nothing was uploaded.");
  process.exit(1);
}

run("rules and caregiver tests", "npm run test:rules");

mkdirSync(dirname(STAMP), { recursive: true });
writeFileSync(STAMP, JSON.stringify({ hash, passedAt: new Date().toISOString() }) + "\n");
console.log("\ndeploy gate: all passed");

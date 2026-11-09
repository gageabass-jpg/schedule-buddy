#!/usr/bin/env node
// Checks for shared-ui/, the protected library both Nucleus apps compile.
//
//   types    tsc, as strict as desktop/ (ci/shared-ui/tsconfig.json)
//   lint     Nucleus Manager's ESLint rules, reused (ci/shared-ui/eslint.config.mjs)
//   imports  every import resolves inside shared-ui/src, or is a package that
//            shared-ui/package.json declares. No app code, no app alias, no Node built-ins.
//
// The toolchain comes from desktop/node_modules, so run `npm ci` in desktop/ first.
// Usage: check-shared-ui.mjs [--root <dir>] [--only types,lint,imports]
// Exit: 0 all passed, 1 a check failed.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { packageOf, specifiersOf } from "./lib/imports.mjs";

/** Lint warnings allowed today. A new warning fails the check. Lower this number when warnings
 *  are fixed. Do not raise it to make a change pass. */
const MAX_WARNINGS = 11;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const root = path.resolve(arg("root") ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const only = new Set((arg("only") ?? "types,lint,imports").split(","));
const bin = (pkg, file) => path.join(root, "desktop", "node_modules", pkg, file);

function step(title, fn) {
  console.log(`\n── ${title}`);
  const problems = fn();
  if (problems.length === 0) { console.log("   passed"); return true; }
  for (const p of problems) console.error(`   ✗ ${p}`);
  console.error(`::error title=shared-ui ${title}::${problems[0]}`);
  return false;
}

function exec(args, label) {
  const r = spawnSync("node", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.stdout.trim()) console.log(r.stdout.trim().split("\n").map((l) => `   ${l}`).join("\n"));
  if (r.stderr.trim()) console.error(r.stderr.trim().split("\n").map((l) => `   ${l}`).join("\n"));
  return r.status === 0 ? [] : [`${label} failed (exit ${r.status})`];
}

// ── imports ─────────────────────────────────────────────────────────────────

const SRC = path.join(root, "shared-ui", "src");
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function* sourceFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx)$/.test(e.name)) yield full;
  }
}

function checkImports() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "shared-ui", "package.json"), "utf8"));
  const declared = new Set(Object.keys(pkg.peerDependencies ?? {}));
  const problems = [];
  let files = 0;
  for (const file of sourceFiles(SRC)) {
    files++;
    const rel = path.relative(root, file);
    for (const spec of specifiersOf(fs.readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) {
        const target = path.resolve(path.dirname(file), spec);
        if (target !== SRC && !target.startsWith(SRC + path.sep)) problems.push(`${rel}: "${spec}" leaves shared-ui/src`);
        else if (!EXTENSIONS.some((x) => fs.existsSync(target + x) && fs.statSync(target + x).isFile())) problems.push(`${rel}: "${spec}" does not resolve to a file`);
      } else if (spec.startsWith("node:") || spec.startsWith("@/") || spec.startsWith("~")) {
        problems.push(`${rel}: "${spec}" is not allowed in shared-ui (no Node built-ins, no app alias)`);
      } else if (!declared.has(packageOf(spec))) {
        problems.push(`${rel}: imports "${spec}", but shared-ui/package.json does not declare "${packageOf(spec)}" in peerDependencies`);
      }
    }
  }
  console.log(`   ${files} file(s) scanned`);
  return problems;
}

// ── run ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(bin("typescript", "bin/tsc"))) {
  console.error("desktop/node_modules is missing. Run `npm ci` in desktop/ first.");
  process.exit(1);
}

const results = [];
if (only.has("types")) results.push(step("types", () => exec([bin("typescript", "bin/tsc"), "-p", "ci/shared-ui/tsconfig.json"], "tsc")));
if (only.has("lint")) results.push(step("lint", () => exec([bin("eslint", "bin/eslint.js"), "-c", "ci/shared-ui/eslint.config.mjs", "--max-warnings", String(MAX_WARNINGS), "shared-ui/src"], `eslint (limit ${MAX_WARNINGS} warnings)`)));
if (only.has("imports")) results.push(step("imports", checkImports));

if (results.every(Boolean)) { console.log("\nshared-ui checks passed."); process.exit(0); }
console.error("\nshared-ui checks FAILED.");
process.exit(1);

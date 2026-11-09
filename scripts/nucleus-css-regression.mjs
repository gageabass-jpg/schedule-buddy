#!/usr/bin/env node
// Nucleus CSS regression check.
//
// Builds Nucleus Manager's renderer from a base revision (main) and from the candidate,
// the same way, in the same environment, and fails if the compiled CSS differs.
// Used when shared-ui/ changes: a shared component must not alter Nucleus's styling.
//
// The comparison is only worth trusting if the build is deterministic, so the candidate is
// built TWICE first. If those two disagree the check stops with exit 3 and compares nothing.
// A nondeterministic build is fixed, never ignored.
//
// Usage: nucleus-css-regression.mjs --base <rev> [--head <rev>] [--keep]
//   --head  defaults to the working tree (what is checked out now).
// Exit: 0 identical, 1 CSS differs, 2 a build or git step failed, 3 build is nondeterministic.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { collectCss, compareCss } from "./lib/nucleus-css.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const baseRev = arg("base");
const headRev = arg("head");
const keep = process.argv.includes("--keep");
if (!baseRev) {
  console.error("usage: nucleus-css-regression.mjs --base <rev> [--head <rev>] [--keep]");
  process.exit(2);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nucleus-css-"));
const worktrees = [];

function run(cmd, args, cwd, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) {
    console.error(`\nFAILED: ${cmd} ${args.join(" ")}  (in ${cwd})`);
    cleanup();
    process.exit(2);
  }
}

function cleanup() {
  if (keep) { console.log(`\nKept build folders in ${scratch}`); return; }
  for (const wt of worktrees) spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: root, stdio: "ignore" });
  spawnSync("git", ["worktree", "prune"], { cwd: root, stdio: "ignore" });
  fs.rmSync(scratch, { recursive: true, force: true });
}

function checkout(rev, label) {
  const dir = path.join(scratch, label);
  run("git", ["worktree", "add", "--detach", "--quiet", dir, rev], root);
  worktrees.push(dir);
  return dir;
}

/** Same command, same environment, every time. The one dependency of the build is the revision's own lockfile. */
function build(tree, outDir, install) {
  const desktop = path.join(tree, "desktop");
  if (install) run("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], desktop, { ELECTRON_SKIP_BINARY_DOWNLOAD: "1" });
  run("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], desktop, { TZ: "UTC", LC_ALL: "C" });
}

const headTree = headRev ? checkout(headRev, "head") : root;
const headNeedsInstall = headRev ? true : !fs.existsSync(path.join(root, "desktop", "node_modules"));
const baseTree = checkout(baseRev, "base");

console.log(`\n== Building the base (${baseRev})`);
build(baseTree, path.join(scratch, "out-base"), true);
console.log(`\n== Building the candidate (${headRev ?? "working tree"}), first build`);
build(headTree, path.join(scratch, "out-cand-1"), headNeedsInstall);
console.log("\n== Building the candidate again, to prove the build is deterministic");
build(headTree, path.join(scratch, "out-cand-2"), false);

const base = collectCss(path.join(scratch, "out-base"));
const cand1 = collectCss(path.join(scratch, "out-cand-1"));
const cand2 = collectCss(path.join(scratch, "out-cand-2"));

const again = compareCss(cand1, cand2);
if (!again.same) {
  console.error("\nThe Nucleus build is NOT deterministic: two builds of the same revision produced different CSS.");
  console.error("The regression check cannot be trusted until that is fixed.\n");
  console.error(again.problems.join("\n"));
  cleanup();
  process.exit(3);
}

const result = compareCss(base, cand1);
const bytes = [...cand1.values()].reduce((n, t) => n + t.length, 0);
if (result.same) {
  console.log(`\nOK: the Nucleus CSS is identical to ${baseRev} (${cand1.size} file(s), ${bytes} bytes; the candidate build is deterministic).`);
  cleanup();
  process.exit(0);
}

console.error("\nNucleus CSS regression check FAILED.\n");
console.error(`The CSS built from this change differs from the CSS built from ${baseRev}.`);
console.error("A change to shared-ui/ must not change how Nucleus Manager looks.\n");
console.error(result.problems.join("\n\n"));
console.error("\n::error title=Nucleus CSS changed::The built Nucleus CSS differs from the base. See the log for the differing rules.");
cleanup();
process.exit(1);

#!/usr/bin/env node
// Wagonwheel isolation guard.
//
// Rule: work on Nucleus Wagonwheel must not change anything under desktop/ (Nucleus
// Manager) or shared-ui/ (the protected shared library). A change to either needs its
// own pull request, with its own review and the Nucleus protection checks.
//
// A commit that changes desktop/ or shared-ui/ is "attributable to Wagonwheel" when
// ANY of these is true:
//   1. the same commit also changes wagonwheel/;
//   2. its message mentions Wagonwheel;
//   3. the pull request changes wagonwheel/ anywhere;
//   4. the pull request's title, branch or labels name Wagonwheel.
// An attributable commit fails the check. A change to desktop/ or shared-ui/ that has
// no link to Wagonwheel (a Nucleus fix, say) passes this guard; the other Nucleus
// protection checks still apply to it.
//
// There are NO exceptions. If shared-ui/ or desktop/ must change (the extraction of the shared
// primitives was one such change), do it in its own pull request that does not touch
// wagonwheel/ and does not name Wagonwheel: that passes this guard without any bypass.
//
// This guard prevents accidents. It does not stop a determined author from editing the
// guard: put branch protection and CODEOWNERS on .github/ and scripts/ for that.
//
// Usage: guard-wagonwheel-isolation.mjs --base <rev> --head <rev> [--repo <dir>]
// Environment: PR_TITLE, PR_BRANCH, PR_LABELS (comma separated).
// Exit: 0 pass, 1 violation, 2 bad usage or git failure.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const PROTECTED = ["desktop/", "shared-ui/"];
const WAGONWHEEL = "wagonwheel/";
const NAMED = /wagonwheel/i;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const repo = path.resolve(arg("repo") ?? process.cwd());
const baseRev = arg("base");
const headRev = arg("head");
if (!baseRev || !headRev) {
  console.error("usage: guard-wagonwheel-isolation.mjs --base <rev> --head <rev> [--repo <dir>]");
  process.exit(2);
}

const git = (args, input) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });

const inProtected = (file) => PROTECTED.some((p) => file.startsWith(p));
const inWagonwheel = (file) => file.startsWith(WAGONWHEEL);

/** Files a commit changed. No rename detection: a file moved OUT of desktop/ lists both paths. */
const filesOf = (sha) => git(["diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", "--root", "-z", sha]).split("\0").filter(Boolean);

let mergeBase;
let commits;
let prFiles;
try {
  mergeBase = git(["merge-base", baseRev, headRev]).trim();
  commits = git(["rev-list", "--reverse", "--no-merges", `${mergeBase}..${headRev}`]).split("\n").filter(Boolean);
  prFiles = git(["diff", "--name-only", "--no-renames", "-z", mergeBase, headRev]).split("\0").filter(Boolean);
} catch (err) {
  console.error(`git failed: ${err.message}`);
  process.exit(2);
}

const title = process.env.PR_TITLE ?? "";
const branch = process.env.PR_BRANCH ?? "";
const labels = (process.env.PR_LABELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const prTouchesWagonwheel = prFiles.some(inWagonwheel);
const prNamesWagonwheel = NAMED.test(title) || NAMED.test(branch) || labels.some((l) => NAMED.test(l));

const violations = [];

for (const sha of commits) {
  const files = filesOf(sha);
  const touched = files.filter(inProtected);
  if (touched.length === 0) continue;

  const subject = git(["log", "-1", "--format=%s", sha]).trim();

  const message = git(["log", "-1", "--format=%B", sha]);
  const reasons = [];
  if (files.some(inWagonwheel)) reasons.push("the same commit also changes wagonwheel/");
  if (NAMED.test(message)) reasons.push("its message mentions Wagonwheel");
  if (prTouchesWagonwheel) reasons.push("this pull request changes wagonwheel/");
  else if (prNamesWagonwheel) reasons.push("this pull request is named or labelled for Wagonwheel");
  if (reasons.length) violations.push({ sha, subject, touched, reasons });
}

if (violations.length === 0) {
  const scope = prTouchesWagonwheel || prNamesWagonwheel ? "Wagonwheel pull request" : "pull request";
  console.log(`OK: this ${scope} makes no Wagonwheel-attributable change under desktop/ or shared-ui/ (${commits.length} commit(s) checked).`);
  process.exit(0);
}

console.error("\nWagonwheel isolation check FAILED.\n");
console.error("Wagonwheel work must never change desktop/ or shared-ui/. These commits do:\n");
for (const v of violations) {
  console.error(`  ${v.sha.slice(0, 9)}  ${v.subject}`);
  for (const r of v.reasons) console.error(`      because ${r}`);
  for (const f of v.touched.slice(0, 12)) console.error(`      - ${f}`);
  if (v.touched.length > 12) console.error(`      … and ${v.touched.length - 12} more`);
  console.error(`::error title=Wagonwheel touched a protected folder::${v.sha.slice(0, 9)} changes ${v.touched[0]}${v.touched.length > 1 ? ` and ${v.touched.length - 1} more` : ""} (${v.reasons[0]})`);
}
console.error("\nHow to fix it:");
console.error("  - If Wagonwheel needs something a shared component does not give, write a wrapper or a new component inside wagonwheel/.");
console.error("  - If the shared library or Nucleus really must change, do it in a separate pull request that does not touch wagonwheel/ and does not mention Wagonwheel.");
process.exit(1);

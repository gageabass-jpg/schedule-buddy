// Collect, normalise and compare the CSS a Vite build produced.
//
// Normalising removes only what a build adds that is not styling: the content hash in a
// file name, a source-map comment, line endings, trailing space. It never sorts or merges
// rules, because order is part of the cascade: the same rules in another order is a
// different stylesheet and must be reported.

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

/** "index-uvDJg52e.css" -> "index.css". Vite hashes are 8 chars of base64url. */
export const logicalName = (file) => path.basename(file).replace(/-[A-Za-z0-9_-]{8}(?=\.[A-Za-z0-9]+$)/, "");

export function normaliseCss(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*#\s*sourceMappingURL=[^*]*\*\//g, "")
    // Hashed asset names inside url(): the hash is a function of the asset, not of the CSS.
    .replace(/url\(\s*(["']?)([^)"']*?)-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)\1\s*\)/g, "url($1$2$3$1)")
    .replace(/[ \t]+$/gm, "")
    .trim() + "\n";
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Every .css file under a build folder, as { logical name -> normalised text }. */
export function collectCss(distDir) {
  if (!fs.existsSync(distDir)) throw new Error(`no build output at ${distDir}`);
  const out = new Map();
  for (const file of walk(distDir)) {
    if (!file.endsWith(".css")) continue;
    const name = logicalName(file);
    if (out.has(name)) throw new Error(`two CSS files normalise to the same name "${name}" in ${distDir}`);
    out.set(name, normaliseCss(fs.readFileSync(file, "utf8")));
  }
  if (out.size === 0) throw new Error(`no CSS files found in ${distDir}`);
  return out;
}

export const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);

/** Rules in order, for a readable diff. Minified CSS has no newlines, so split on braces. */
const rulesOf = (css) => css.split(/(?<=})/).map((r) => r.trim()).filter(Boolean);

/** Compare two collections. Returns { same, problems[] } where problems are readable. */
export function compareCss(baseMap, candMap) {
  const problems = [];
  for (const name of [...baseMap.keys()].filter((n) => !candMap.has(n))) problems.push(`CSS file "${name}" is in the base build but not in the candidate.`);
  for (const name of [...candMap.keys()].filter((n) => !baseMap.has(n))) problems.push(`CSS file "${name}" is in the candidate build but not in the base.`);

  for (const [name, base] of baseMap) {
    const cand = candMap.get(name);
    if (cand === undefined || cand === base) continue;
    const a = rulesOf(base);
    const b = rulesOf(cand);
    const inB = new Set(b);
    const inA = new Set(a);
    const removed = a.filter((r) => !inB.has(r));
    const added = b.filter((r) => !inA.has(r));
    const lines = [`"${name}" differs: base ${base.length} bytes (${digest(base)}), candidate ${cand.length} bytes (${digest(cand)}).`];
    lines.push(`  ${removed.length} rule(s) only in base, ${added.length} only in candidate.`);
    if (removed.length === 0 && added.length === 0) {
      const i = a.findIndex((r, k) => r !== b[k]);
      lines.push(`  Same rules, different order or count: first difference at rule ${i + 1} of ${a.length}.`);
      lines.push(`    base:      ${(a[i] ?? "(none)").slice(0, 160)}`);
      lines.push(`    candidate: ${(b[i] ?? "(none)").slice(0, 160)}`);
    }
    for (const r of removed.slice(0, 5)) lines.push(`  - ${r.slice(0, 200)}`);
    for (const r of added.slice(0, 5)) lines.push(`  + ${r.slice(0, 200)}`);
    if (removed.length > 5 || added.length > 5) lines.push("  … more");
    problems.push(lines.join("\n"));
  }
  return { same: problems.length === 0, problems };
}

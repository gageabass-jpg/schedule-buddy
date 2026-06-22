#!/usr/bin/env node
/**
 * contract-check.mjs — guards the contract between the two clients that share
 * households/{id}/state/main:
 *   • the Mac manager  →  desktop/src/state.ts  (HouseholdState interface)
 *   • the iOS web app  →  public/index.html      (mergeStateFromFirestore, generateEvents)
 *
 * It catches the two cross-client bug classes we actually hit:
 *   1. DROPPED FIELD  — a desktop top-level field that iOS's read-allowlist
 *      doesn't preserve. iOS does a full set() on save, so an unhandled field
 *      is silently DELETED from Firestore. (This is the `childcareOff` bug.)
 *   2. OVERRIDE SHAPE — the Mac writes overrides as { date, shiftTypeId, label }
 *      (shiftTypeId null = off, no `action`). iOS must render those. (This is
 *      the Jun 18/19/23 + Jul 1 "shows on Mac, not iOS" bug.)
 *
 * No dependencies. Run:  node scripts/contract-check.mjs   (exit 1 on failure)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "public/index.html"), "utf8");
const ts = readFileSync(join(ROOT, "desktop/src/state.ts"), "utf8");

let failures = 0;
const fail = (m) => { failures++; console.error("  ✗ " + m); };
const pass = (m) => console.log("  ✓ " + m);

// Extract a top-level `function NAME(...) { ... }` by brace-matching.
function extractFn(src, name) {
  const m = new RegExp("function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) throw new Error("function not found: " + name);
  const open = src.indexOf("{", m.index);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(m.index, j + 1);
  }
  throw new Error("unbalanced braces: " + name);
}

// ───────────── CHECK 1 — allowlist completeness (no dropped fields) ─────────────
console.log("CHECK 1: iOS preserves every desktop top-level field");
const ifStart = ts.indexOf("export interface HouseholdState");
const ifBody = ts.slice(ts.indexOf("{", ifStart) + 1);
const iface = ifBody.slice(0, ifBody.indexOf("\n}"));                 // up to the col-0 closing brace
const desktopFields = [...iface.matchAll(/^ {2}(\w+)\??\s*:/gm)].map((m) => m[1]);

const mergeStart = html.indexOf("const merged = {");
const mergeBody = html.slice(mergeStart, html.indexOf("\n  };", mergeStart));
const iosFields = new Set([...mergeBody.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]));

const dropped = desktopFields.filter((f) => !iosFields.has(f));
if (dropped.length) fail("iOS merge would DROP these desktop fields (deleted on next iOS save): " + dropped.join(", "));
else pass(`all ${desktopFields.length} desktop fields are in the iOS allowlist`);

// ───────────── CHECK 2 — override shape renders via real generateEvents ─────────────
console.log("CHECK 2: Mac-shape overrides render through iOS generateEvents()");
const fns = ["parseISODate", "toISODate", "eachDay", "addDays", "isOnWeekend", "findShift", "makeEvent", "generateEvents"];
let code = fns.map((f) => extractFn(html, f)).join("\n") + "\n";
const tp = /const\s+TEMPLATE_PAUSED\s*=\s*(true|false)/.exec(html);
code += "const TEMPLATE_PAUSED = " + (tp ? tp[1] : "false") + ";\n";

const ctx = { state: null, console };
vm.createContext(ctx);
try { vm.runInContext(code, ctx); } catch (e) { fail("could not load iOS functions into sandbox: " + e.message); }

const run = (stateObj) => { ctx.state = stateObj; return vm.runInContext("generateEvents()", ctx); };
const SHIFTS = [{ id: "st_w7c861", name: "Evening", start: "11:00", end: "23:30", crossesMidnight: false }];
const base = {
  shiftTypes: SHIFTS, template: [null, null, null, null, null, null, null],
  alt: { enabled: false, refSat: "", sat: null, sun: null }, ot: [],
  range: { from: "2026-06-01", to: "2026-07-10" }, templateEndDate: "2026-06-06",
};

if (failures === 0) {
  // (a) work override with no `action`, dated AFTER templateEndDate, must render
  let evs = run({ ...base, overrides: [{ date: "2026-06-18", label: "Evening", shiftTypeId: "st_w7c861" }] });
  if (evs.some((e) => e.startDate === "2026-06-18" && e.kind === "shift"))
    pass("work override { shiftTypeId, no action } renders (past templateEndDate)");
  else fail("work override did NOT render — the Jun-18/19/23/Jul-1 bug has regressed");

  // (b) off override (shiftTypeId null) on a template work-day must suppress it
  evs = run({ ...base, template: [null, null, null, "st_w7c861", null, null, null], templateEndDate: "2026-12-31",
    overrides: [{ date: "2026-06-17", label: "off", shiftTypeId: null }] }); // 2026-06-17 = Wed
  if (!evs.some((e) => e.startDate === "2026-06-17"))
    pass("off override { shiftTypeId: null } suppresses the day");
  else fail("off override did NOT suppress the day");
}

console.log(failures ? `\nFAILED — ${failures} contract check(s) broke.` : "\nAll contract checks passed.");
process.exit(failures ? 1 : 0);

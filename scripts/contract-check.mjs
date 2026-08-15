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
const fns = ["parseISODate", "toISODate", "eachDay", "addDays", "isOnWeekend", "findShift", "parseHM", "compactTime", "templateSlotShift", "personTemplate", "makeEvent", "generationWindow", "generateEvents", "partnerEvents"];
let code = fns.map((f) => extractFn(html, f)).join("\n") + "\n";
const tp = /const\s+TEMPLATE_PAUSED\s*=\s*(true|false)/.exec(html);
code += "const TEMPLATE_PAUSED = " + (tp ? tp[1] : "false") + ";\n";
for (const name of ["GENERATION_BACK_DAYS", "GENERATION_FWD_DAYS", "GENERATION_MAX_DAYS"]) {
  const m = new RegExp("const\\s+" + name + "\\s*=\\s*(\\d+)").exec(html);
  if (!m) throw new Error("constant not found: " + name);
  code += `const ${name} = ${m[1]};\n`;
}
const isoRe = /const\s+ISO_DATE_RE\s*=\s*(\/.*?\/);/.exec(html);
code += "const ISO_DATE_RE = " + (isoRe ? isoRe[1] : "/^\\d{4}-\\d{2}-\\d{2}$/") + ";\n";

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

// ───────────── CHECK 3 — data outside the stale state.range still renders ─────────────
// state.range is an 84-day window stamped at household creation that no client
// ever updates, while the Mac manager writes shifts with no regard for it.
// Gating generation on range alone silently hides them. (This is the
// "Kaylene's Jul 26/29/30/31 show on Mac, not iOS" bug.)
console.log("CHECK 3: shifts dated outside state.range still render");
if (failures === 0) {
  const runPartner = (stateObj) => { ctx.state = stateObj; return vm.runInContext("partnerEvents()", ctx); };
  const outside = {
    ...base,
    overrides: [],
    partner: { name: "Kaylene", shifts: [
      { date: "2026-07-29", shiftTypeId: "st_w7c861", label: "" },   // past range.to (2026-07-10)
      { date: "2026-05-20", shiftTypeId: "st_w7c861", label: "" },   // before range.from
    ] },
  };
  const pe = runPartner(outside);
  if (pe.some((e) => e.startDate === "2026-07-29") && pe.some((e) => e.startDate === "2026-05-20"))
    pass("partner shifts beyond both ends of state.range render");
  else fail("partner shift outside state.range did NOT render — the stale-range bug has regressed");

  // A self override past range.to must render too (same root cause).
  const ovOutside = run({ ...base, overrides: [{ date: "2026-07-29", label: "Evening", shiftTypeId: "st_w7c861" }] });
  if (ovOutside.some((e) => e.startDate === "2026-07-29"))
    pass("self override beyond state.range renders");
  else fail("self override outside state.range did NOT render");
}

// ───────────── CHECK 4 — per-person weekly templates + inline custom times ─────────────
// The redesigned template tool stores weeklyTemplates { G, K, daisy } where a
// day is null | shiftTypeId | { start, end }. iOS must render G via
// generateEvents and K via partnerEvents, honoring each person's start/end
// window and resolving inline custom times.
console.log("CHECK 4: per-person weekly templates + inline custom render on iOS");
if (failures === 0) {
  const wtBase = {
    shiftTypes: SHIFTS, template: [null, null, null, null, null, null, null],
    alt: { enabled: false, refSat: "", sat: null, sun: null }, ot: [],
    overrides: [], partner: { name: "Kaylene", shifts: [] },
    range: { from: "2026-08-01", to: "2026-08-31" },
    weeklyTemplates: {
      G: { days: [null, null, null, { start: "13:00", end: "21:00" }, null, null, null] }, // Wed custom
      K: { days: [null, null, null, null, "st_w7c861", null, null], startDate: "2026-08-10" }, // Thu preset from Aug 10
    },
  };
  ctx.state = wtBase;
  const g4 = vm.runInContext("generateEvents()", ctx);            // 2026-08-12 = Wed
  const gCustom = g4.find((e) => e.startDate === "2026-08-12");
  if (gCustom && gCustom.startTime === "13:00" && gCustom.endTime === "21:00")
    pass("Gage custom template slot renders with its inline times");
  else fail("Gage custom slot did NOT render correctly: " + JSON.stringify(gCustom));

  const k4 = vm.runInContext("partnerEvents()", ctx);
  if (k4.some((e) => e.startDate === "2026-08-13" && e.kind === "partner"))  // Thu, in window
    pass("Kaylene weekly template renders inside its window");
  else fail("Kaylene template did NOT render: " + JSON.stringify(k4));
  if (!k4.some((e) => e.startDate === "2026-08-06"))                          // Thu, before startDate
    pass("Kaylene template respects its startDate");
  else fail("Kaylene template ignored startDate (rendered 2026-08-06)");
}

console.log(failures ? `\nFAILED — ${failures} contract check(s) broke.` : "\nAll contract checks passed.");
process.exit(failures ? 1 : 0);

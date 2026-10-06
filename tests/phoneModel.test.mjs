// The phone's bundle of the model code (public/js/nucleus-model.js, built by
// `npm run build:phone-model`), loaded the way the phone loads it: a plain
// script defining a global. It must give the same answers as the compiled
// shared/ the functions run.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import legacyMod from "../functions/lib/shared/fromLegacy.js";
import resolveMod from "../functions/lib/shared/resolve.js";
import { HH, META, fullState } from "./fixtures/household.mjs";

function loadBundle() {
  const code = readFileSync(new URL("../public/js/nucleus-model.js", import.meta.url), "utf8");
  const context = vm.createContext({ setTimeout, clearTimeout, console });
  vm.runInContext(`${code}\n;globalThis.NucleusModel = NucleusModel;`, context, { filename: "nucleus-model.js" });
  return context.NucleusModel;
}

test("the bundle defines the model API", () => {
  const M = loadBundle();
  for (const name of [
    "fromLegacy", "resolveShifts", "coverageGaps", "caregiverDayRanges", "namespacedStore",
    "loadHousehold", "watchHousehold", "watchCaregiver", "caregiverLegacyState", "putRecord", "removeRecord",
    "savePerson", "removePerson", "saveSettings", "saveHouseholdInfo", "replaceShiftId",
  ]) {
    assert.equal(typeof M[name], "function", `NucleusModel.${name}`);
  }
});

test("the bundle converts and resolves exactly as the functions do", () => {
  const M = loadBundle();
  const json = (v) => JSON.parse(JSON.stringify(v));
  const phone = M.fromLegacy(HH, fullState(), META);
  const server = legacyMod.fromLegacy(HH, fullState(), META);
  assert.deepEqual(json(phone), json(server));
  assert.deepEqual(
    json(M.resolveShifts(phone.model, "2026-09-01", "2026-11-30")),
    json(resolveMod.resolveShifts(server.model, "2026-09-01", "2026-11-30")),
  );
  assert.deepEqual(
    json(M.coverageGaps(phone.model, M.resolveShifts(phone.model, "2026-09-01", "2026-11-30"))),
    json(resolveMod.coverageGaps(server.model, resolveMod.resolveShifts(server.model, "2026-09-01", "2026-11-30"))),
  );
});

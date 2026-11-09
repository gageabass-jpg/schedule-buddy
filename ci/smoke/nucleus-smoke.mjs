#!/usr/bin/env node
// Nucleus Manager smoke launch.
//
// Starts the BUILT app (desktop/dist + desktop/dist-electron) in Electron under Playwright
// and checks that its UI comes up. With no account signed in, a cold start shows the sign-in
// screen, so that is the "primary UI" this test looks for.
//
// It checks, in this order:
//   - the app launches and a window opens;
//   - the preload script loaded (window.sbm exists), so the bridge to the main process works;
//   - the page renders: the "nucleus manager" wordmark and the sign-in buttons are visible;
//   - nothing fatal: no uncaught page error, no renderer crash, no main-process
//     uncaughtException, and the app is still running at the end.
//
// Linux needs a display: run under `xvfb-run -a`.
// Usage: nucleus-smoke.mjs [--desktop <dir>] [--out <dir>] [--build]
// Exit: 0 passed, 1 failed.

import { _electron } from "playwright-core";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const desktop = path.resolve(arg("desktop") ?? path.join(here, "..", "..", "desktop"));
const outDir = path.resolve(arg("out") ?? path.join(here, "artifacts"));
fs.mkdirSync(outDir, { recursive: true });

if (process.argv.includes("--build")) {
  for (const [cmd, args] of [["npx", ["tsc", "-p", "tsconfig.electron.json"]], ["npx", ["vite", "build", "--logLevel", "warn"]]]) {
    const r = spawnSync(cmd, args, { cwd: desktop, stdio: "inherit" });
    if (r.status !== 0) { console.error(`build step failed: ${cmd} ${args.join(" ")}`); process.exit(1); }
  }
}

const failures = [];
const fail = (msg) => { failures.push(msg); console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

if (process.platform === "linux" && !process.env.DISPLAY) {
  console.error("No display. Run this under xvfb-run -a.");
  process.exit(1);
}
for (const f of ["dist/index.html", "dist-electron/main.js", "dist-electron/preload.mjs"]) {
  if (!fs.existsSync(path.join(desktop, f))) { console.error(`${f} is missing in ${desktop}. Build first (--build).`); process.exit(1); }
}

let electronPath;
try { electronPath = createRequire(path.join(desktop, "package.json"))("electron"); }
catch (err) { console.error(`Electron is not installed in ${desktop}: ${err.message}`); process.exit(1); }

// A fresh profile, so a leftover sign-in or window state cannot hide a startup bug.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nucleus-smoke-"));
console.log(`Launching ${desktop}`);

let app;
try {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [desktop, "--no-sandbox", "--disable-gpu", `--user-data-dir=${profile}`],
    env: { ...process.env, NODE_ENV: "production" },
    timeout: 60_000,
  });
} catch (err) {
  console.error(`The app did not launch: ${err.message}`);
  process.exit(1);
}

let mainLog = "";
app.process().stdout?.on("data", (d) => { mainLog += d; });
app.process().stderr?.on("data", (d) => { mainLog += d; });
let exited = null;
app.process().on("exit", (code, signal) => { exited = { code, signal }; });

const pageErrors = [];
const consoleErrors = [];
let crashed = false;

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("crash", () => { crashed = true; });
  ok("the app launched and a window opened");

  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  const title = await page.title();
  title === "Nucleus Manager" ? ok(`window title is "${title}"`) : fail(`window title is "${title}", expected "Nucleus Manager"`);

  const bridge = await page.evaluate(() => typeof window.sbm?.hasApiKey === "function" && typeof window.sbm?.platform === "string");
  bridge ? ok("the preload script loaded (window.sbm is there)") : fail("the preload bridge window.sbm is missing");

  try {
    await page.waitForFunction(() => (document.getElementById("root")?.children.length ?? 0) > 0, null, { timeout: 30_000 });
    ok("React rendered into #root");
  } catch { fail("#root stayed empty: the UI did not render"); }

  try {
    await page.getByText("nucleus", { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
    await page.getByRole("button", { name: /continue with google/i }).waitFor({ state: "visible", timeout: 20_000 });
    await page.getByRole("button", { name: /continue with apple/i }).waitFor({ state: "visible", timeout: 20_000 });
    ok("the primary UI is visible: wordmark and the sign-in buttons");
  } catch { fail("the primary UI is not visible: expected the wordmark and the Apple and Google sign-in buttons"); }

  // Give a late failure a moment to show itself.
  await page.waitForTimeout(1500);

  const shot = await page.screenshot({ path: path.join(outDir, "nucleus-startup.png") });
  shot.length > 15_000 ? ok(`screenshot is not blank (${Math.round(shot.length / 1024)} kB)`) : fail(`screenshot is ${shot.length} bytes: the window looks blank`);
} catch (err) {
  fail(`the window did not come up: ${err.message}`);
}

if (pageErrors.length) for (const e of pageErrors) fail(`uncaught page error: ${e}`); else ok("no uncaught page errors");
if (crashed) fail("the renderer process crashed"); else ok("the renderer did not crash");
const mainFatal = mainLog.split("\n").filter((l) => /uncaughtException|unhandledRejection|A JavaScript error occurred in the main process/.test(l));
if (mainFatal.length) for (const l of mainFatal) fail(`main process: ${l.trim().slice(0, 200)}`); else ok("no fatal error in the main process");
if (exited) fail(`the app exited early (code ${exited.code}, signal ${exited.signal})`); else ok("the app is still running");
if (consoleErrors.length) console.log(`  note: ${consoleErrors.length} console error(s), not counted as failures:\n    ${consoleErrors.slice(0, 5).join("\n    ")}`);

try { await app.close(); } catch { /* already gone */ }
fs.rmSync(profile, { recursive: true, force: true });

if (failures.length) {
  console.error(`\nNucleus smoke test FAILED (${failures.length} problem(s)).`);
  console.error(`::error title=Nucleus did not start cleanly::${failures[0]}`);
  fs.writeFileSync(path.join(outDir, "main-process.log"), mainLog);
  process.exit(1);
}
console.log("\nNucleus smoke test passed.");

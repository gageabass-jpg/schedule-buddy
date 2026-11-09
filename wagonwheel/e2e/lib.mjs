// Helpers for driving the real, built Nucleus Wagonwheel in Electron under Playwright.
// It needs a display: run under `xvfb-run -a` on Linux.

import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The day the screenshots and seeded data are set on: a Monday, well before any real run,
 *  so "updated 3 hours ago" never depends on when the test ran. */
export const FIXED_NOW = "2026-06-01T10:00:00";
export const FIXED_TODAY = "2026-06-01";

export const tempDir = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `ww-${label}-`));

/** Start the built app against a data folder. The clock is held at FIXED_NOW unless `realClock`. */
export async function launch({ dataDir, realClock = false, extraEnv = {} } = {}) {
  const executablePath = createRequire(path.join(appDir, "package.json"))("electron");
  const app = await _electron.launch({
    executablePath,
    // The rendering flags make text draw the same on every machine (no hinting, no LCD
    // anti-aliasing, a fixed locale), so a screenshot made here matches one made in CI.
    args: [appDir, "--no-sandbox", "--disable-gpu", "--font-render-hinting=none", "--disable-lcd-text", "--disable-font-subpixel-positioning", "--lang=en-US", "--force-device-scale-factor=1"],
    env: { ...process.env, NODE_ENV: "production", WAGONWHEEL_DATA_DIR: dataDir, TZ: "UTC", ...extraEnv },
    timeout: 60_000,
  });
  const errors = [];
  let log = "";
  app.process().stdout?.on("data", (d) => { log += d; });
  app.process().stderr?.on("data", (d) => { log += d; });
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  if (!realClock) {
    await page.clock.setFixedTime(new Date(FIXED_NOW));
    await page.reload();
  }
  await page.waitForSelector('[aria-label="Sidebar"]', { timeout: 30_000 });
  // The workspace has loaded when the loading orbit is gone.
  await page.waitForSelector('[aria-label="Opening your workspace"]', { state: "detached", timeout: 30_000 }).catch(() => {});
  return { app, page, errors, mainLog: () => log };
}

export async function closeApp(app) {
  try { await app.close(); } catch { /* already gone */ }
}

/** Fix the window size, switch off motion, park the pointer: so a screenshot is the same every time. */
export async function steady(app, page, { width = 1440, height = 900 } = {}) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setContentSize(size.width, size.height);
  }, { width, height });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(width - 2, height - 2);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.waitForTimeout(500);
}

const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** A believable personal workspace, made through the app's own API (window.wagonwheel). */
export async function seedSample(page, today = FIXED_TODAY) {
  const d = (n) => addDays(today, n);
  return page.evaluate(async (dates) => {
    const api = window.wagonwheel;
    const D = (n) => dates[String(n)];
    // Every write gets its own millisecond, so "recently updated" has one right answer.
    const tick = () => new Promise((r) => setTimeout(r, 4));
    const proj = async (input) => { const id = (await api.createProject(input)).id; await tick(); return id; };
    const task = async (input) => { const id = (await api.createTask(input)).id; await tick(); return id; };
    const milestone = async (input) => { await api.createMilestone(input); await tick(); };

    const wagon = await proj({ name: "Nucleus Wagonwheel", description: "Personal project manager for the Mac. Local SQLite, red glass.", status: "active", color: "#C62845", startDate: D(-24), targetDate: D(34) });
    const widget = await proj({ name: "Nucleus iOS widget", description: "Home-screen widget for today's shifts.", status: "planning", color: "#7C93C9", startDate: D(6), targetDate: D(52) });
    const site = await proj({ name: "Personal site refresh", description: "New portfolio, faster build.", status: "on_hold", color: "#E0A458", startDate: D(-40), targetDate: D(-3) });
    const lab = await proj({ name: "Home lab backups", description: "Nightly snapshots to the NAS.", status: "completed", color: "#7FB69E", startDate: D(-70), targetDate: D(-30) });
    await proj({ name: "Old prototype", status: "completed", color: "#9A8A90" }).then((id) => api.updateProject(id, { archived: true })); await tick();

    // Wagonwheel
    await task({ title: "Sketch the data model", projectId: wagon, status: "done", priority: "high", startDate: D(-24), dueDate: D(-18) });
    await task({ title: "SQLite layer and migrations", projectId: wagon, status: "done", priority: "high", startDate: D(-18), dueDate: D(-9) });
    const glass = await task({ title: "Red glass theme", projectId: wagon, status: "in_progress", priority: "high", startDate: D(-8), dueDate: D(3) });
    await task({ title: "Pick the project colours", parentId: glass, status: "done" });
    await task({ title: "Contrast check on every surface", parentId: glass });
    await task({ title: "Timeline view with drag to move", projectId: wagon, status: "in_progress", priority: "medium", startDate: D(-2), dueDate: D(12) });
    await task({ title: "Back up and restore", projectId: wagon, priority: "medium", startDate: D(10), dueDate: D(18) });
    await task({ title: "Package a .dmg for the MacBook", projectId: wagon, priority: "low", startDate: D(24), dueDate: D(30) });
    await task({ title: "Reply to the code signing question", projectId: wagon, priority: "high", dueDate: D(-2) });
    await milestone({ projectId: wagon, name: "First working build", targetDate: D(5) });
    await milestone({ projectId: wagon, name: "Daily-driver ready", targetDate: D(30) });

    // Widget
    await task({ title: "Decide WidgetKit vs a Live Activity", projectId: widget, priority: "medium", startDate: D(6), dueDate: D(9) });
    await task({ title: "Share the schedule through the app group", projectId: widget, priority: "medium", startDate: D(10), dueDate: D(24) });
    await milestone({ projectId: widget, name: "TestFlight build", targetDate: D(45) });

    // Site, lab
    await task({ title: "Port the blog to the new theme", projectId: site, status: "in_progress", priority: "low", dueDate: D(-6) });
    await task({ title: "Write the case studies", projectId: site, priority: "low", dueDate: D(2) });
    await task({ title: "Restic to the NAS", projectId: lab, status: "done", dueDate: D(-40) });

    // Inbox
    await task({ title: "Look into SQLite WAL checkpoints" });
    await task({ title: "Renew the developer certificate", dueDate: D(4) });
    await task({ title: "Sketch an icon for the app" });
    await tick();
    await api.createNote({ projectId: wagon, body: "Decision: node:sqlite, not better-sqlite3. No native rebuild per Electron version." });
    return true;
  }, Object.fromEntries([-70, -40, -30, -24, -18, -9, -8, -6, -3, -2, 2, 3, 4, 5, 6, 9, 10, 12, 18, 24, 30, 34, 45, 52].map((n) => [String(n), d(n)])));
}

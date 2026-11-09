// End-to-end tests of the real, built Nucleus Wagonwheel, driven through its own window
// by Playwright. They need a display: `npm run test:e2e` starts one on Linux.
//
// Every test gets its own data folder, so nothing leaks between them or into your real
// workspace. The clock is held at 2026-06-01 (see lib.mjs), so dates are the same every run.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { closeApp, FIXED_TODAY, launch, seedSample, steady, tempDir } from "./lib.mjs";
import { expectScreenshot } from "./screenshot.mjs";

// ── helpers ─────────────────────────────────────────────────────────────────

async function withApp(fn, opts = {}) {
  const dataDir = opts.dataDir ?? tempDir("e2e");
  const ctx = await launch({ dataDir, ...opts });
  try {
    await ctx.page.emulateMedia({ reducedMotion: "reduce" });
    await fn({ ...ctx, dataDir });
    assert.deepEqual(ctx.errors, [], "the page threw no uncaught errors");
  } finally {
    await closeApp(ctx.app);
  }
}

const snap = (page) => page.evaluate(() => window.wagonwheel.getSnapshot());
const nav = (page, label) => page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: new RegExp(`^${label}`) }).click();
const dialog = (page, name) => page.getByRole("dialog", { name });
const main = (page) => page.locator("main");
const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const projectByName = async (page, name) => (await snap(page)).projects.find((p) => p.name === name);
const taskByTitle = async (page, title) => (await snap(page)).tasks.find((t) => t.title === title);

async function createProjectViaUi(page, { name, description = "", start = "", target = "" }) {
  await nav(page, "All Projects");
  await main(page).getByRole("button", { name: "New project" }).first().click();
  const d = dialog(page, "New project");
  await d.getByLabel("Name").fill(name);
  if (description) await d.getByLabel("Description").fill(description);
  if (start) await d.getByLabel("Start date").fill(start);
  if (target) await d.getByLabel("Target date").fill(target);
  await d.getByRole("button", { name: "Create project" }).click();
}

// ── identity ────────────────────────────────────────────────────────────────

test("opens as Nucleus Wagonwheel, with a personal workspace and no household words", () => withApp(async ({ page }) => {
  assert.equal(await page.title(), "Nucleus Wagonwheel");
  const bar = await page.locator(".ww-drag").first().innerText();
  assert.match(bar, /nucleus\s+wagonwheel/i);
  const side = page.getByRole("complementary", { name: "Sidebar" });
  await side.getByText("Gage's Workspace").first().waitFor();
  const everything = await page.evaluate(() => document.body.innerText);
  assert.doesNotMatch(everything, /manager|household|family|kaylene|daisy/i, "no Nucleus Manager, household or family wording");
  // The dashboard's empty state invites the first project.
  await page.getByText("Start with a project").waitFor();
}));

test("the workspace name can be renamed, and the new name is kept", () => withApp(async ({ page }) => {
  await page.getByRole("button", { name: /workspace menu/ }).click();
  const input = page.getByLabel("Workspace name");
  await input.fill("Studio Bass");
  await input.press("Enter");
  await page.getByRole("button", { name: "Studio Bass: workspace menu" }).waitFor();
  assert.equal((await snap(page)).settings.workspaceName, "Studio Bass");
  // An empty name is refused, and the old one stays.
  await page.getByRole("button", { name: "Studio Bass: workspace menu" }).click().catch(() => {});
  const again = page.getByLabel("Workspace name");
  if (!(await again.isVisible())) await page.getByRole("button", { name: "Studio Bass: workspace menu" }).click();
  await again.fill("   ");
  await again.press("Enter");
  assert.equal((await snap(page)).settings.workspaceName, "Studio Bass");
}));

// ── projects ────────────────────────────────────────────────────────────────

test("projects: create, edit, archive, unarchive and delete", () => withApp(async ({ page }) => {
  await createProjectViaUi(page, { name: "Cabin plans", description: "Floor plan and permits", start: "2026-06-10", target: "2026-09-30" });
  await main(page).getByRole("heading", { name: "Cabin plans" }).waitFor();
  let p = await projectByName(page, "Cabin plans");
  assert.deepEqual([p.description, p.startDate, p.targetDate, p.status], ["Floor plan and permits", "2026-06-10", "2026-09-30", "active"]);

  // edit
  await main(page).getByRole("button", { name: "Edit" }).click();
  let d = dialog(page, "Edit project");
  await d.getByLabel("Name").fill("Cabin plans v2");
  await d.getByLabel("Status").selectOption({ label: "On hold" });
  await d.getByRole("radio", { name: "Sage" }).click();
  await d.getByRole("button", { name: "Save" }).click();
  await main(page).getByRole("heading", { name: "Cabin plans v2" }).waitFor();
  p = await projectByName(page, "Cabin plans v2");
  assert.deepEqual([p.status, p.color], ["on_hold", "#7FB69E"]);

  // archive: it leaves the Active tab and waits under Archived
  await main(page).getByRole("button", { name: "Edit" }).click();
  await dialog(page, "Edit project").getByRole("button", { name: "Archive" }).click();
  assert.ok((await projectByName(page, "Cabin plans v2")).archivedAt, "archived in the database");
  await nav(page, "All Projects");
  await main(page).getByText("Cabin plans v2").waitFor({ state: "detached" }).catch(() => {});
  await main(page).getByRole("tab", { name: /Archived/ }).click();
  await main(page).getByText("Cabin plans v2").waitFor();

  // unarchive
  await main(page).getByRole("button", { name: /Cabin plans v2/ }).click();
  await main(page).getByRole("button", { name: "Edit" }).click();
  await dialog(page, "Edit project").getByRole("button", { name: "Unarchive" }).click();
  assert.equal((await projectByName(page, "Cabin plans v2")).archivedAt, null);

  // delete, after a confirmation that says what goes with it
  await main(page).getByRole("button", { name: "New task" }).click();
  d = dialog(page, "New task");
  await d.getByLabel("Title").fill("Order the survey");
  await d.getByRole("button", { name: "Add task" }).click();
  await main(page).getByRole("button", { name: "Edit" }).click();
  await dialog(page, "Edit project").getByRole("button", { name: "Delete" }).click();
  const confirm = dialog(page, "Delete this project?");
  assert.match(await confirm.innerText(), /1 task, 0 milestones/);
  await confirm.getByRole("button", { name: "Delete project" }).click();
  await main(page).getByRole("heading", { name: "All Projects" }).waitFor();
  const s = await snap(page);
  assert.equal(s.projects.length, 0);
  assert.equal(s.tasks.length, 0, "its task went with it");
}));

test("a project whose target date is before its start date is refused, in words, and nothing is saved", () => withApp(async ({ page }) => {
  await createProjectViaUi(page, { name: "Backwards", start: "2026-09-01", target: "2026-06-01" });
  await dialog(page, "New project").getByRole("alert").filter({ hasText: "The start date is after the target date." }).waitFor();
  assert.equal((await snap(page)).projects.length, 0);
}));

// ── tasks ───────────────────────────────────────────────────────────────────

test("tasks: create with a project, a date and a priority, edit, complete and delete", () => withApp(async ({ page }) => {
  const api = (fn, ...a) => page.evaluate(([f, args]) => window.wagonwheel[f](...args), [fn, a]);
  const { id: projectId } = await api("createProject", { name: "Garden" });
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  await nav(page, "All Tasks");
  await main(page).getByRole("button", { name: "New task" }).first().click();
  let d = dialog(page, "New task");
  await d.getByLabel("Title").fill("Buy seed potatoes");
  await d.getByLabel("Project").selectOption({ label: "Garden" });
  await d.getByLabel("Priority").selectOption({ label: "High" });
  await d.getByLabel("Due date").fill("2026-06-12");
  await d.getByRole("button", { name: "Add task" }).click();
  await main(page).getByText("Buy seed potatoes").waitFor();
  let t = await taskByTitle(page, "Buy seed potatoes");
  assert.deepEqual([t.projectId, t.priority, t.dueDate, t.status], [projectId, "high", "2026-06-12", "not_started"]);

  // edit: open it from the list
  await main(page).getByText("Buy seed potatoes").click();
  d = dialog(page, "Task");
  await d.getByLabel("Title").fill("Buy seed potatoes (Maris Piper)");
  await d.getByLabel("Status").selectOption({ label: "In progress" });
  await d.getByLabel("Description").fill("From the market on Saturday");
  await d.getByRole("button", { name: "Save" }).click();
  await main(page).getByText("In progress").first().waitFor();
  t = await taskByTitle(page, "Buy seed potatoes (Maris Piper)");
  assert.deepEqual([t.status, t.description], ["in_progress", "From the market on Saturday"]);

  // complete it with its checkbox
  await main(page).getByRole("checkbox", { name: /Mark "Buy seed potatoes \(Maris Piper\)" done/ }).click();
  await page.waitForFunction(async () => (await window.wagonwheel.getSnapshot()).tasks[0].status === "done");
  t = await taskByTitle(page, "Buy seed potatoes (Maris Piper)");
  assert.ok(t.completedAt, "completion time is recorded");

  // and reopen it
  await main(page).getByRole("tab", { name: "All" }).click();
  await main(page).getByRole("checkbox", { name: /not done/ }).click();
  await page.waitForFunction(async () => (await window.wagonwheel.getSnapshot()).tasks[0].status === "not_started");

  // delete, after a confirmation
  await main(page).getByText("Buy seed potatoes (Maris Piper)").click();
  await dialog(page, "Task").getByRole("button", { name: "Delete" }).click();
  await dialog(page, "Delete this task?").getByRole("button", { name: "Delete task" }).click();
  await page.waitForFunction(async () => (await window.wagonwheel.getSnapshot()).tasks.length === 0);
}));

test("subtasks: add, tick off, and the parent shows how many are done", () => withApp(async ({ page }) => {
  await page.evaluate(() => window.wagonwheel.createTask({ title: "Move house" }));
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  await nav(page, "All Tasks");
  await main(page).getByText("Move house").click();
  const d = dialog(page, "Task");
  const add = d.getByLabel("Add a subtask");
  for (const title of ["Book the van", "Pack the kitchen"]) { await add.fill(title); await add.press("Enter"); await d.getByText(title).waitFor(); }
  await d.getByRole("checkbox", { name: /Mark "Book the van" done/ }).click();
  await page.waitForFunction(async () => (await window.wagonwheel.getSnapshot()).tasks.filter((t) => t.parentId && t.status === "done").length === 1);
  await d.getByRole("button", { name: "Cancel" }).click();
  await main(page).getByText("1/2 subtasks").waitFor();
  const s = await snap(page);
  assert.equal(s.tasks.filter((t) => t.parentId).length, 2);
}));

// ── milestones and notes ────────────────────────────────────────────────────

test("milestones: add, complete, see it on the timeline, delete", () => withApp(async ({ page }) => {
  const { id } = await page.evaluate(() => window.wagonwheel.createProject({ name: "Launch", startDate: "2026-06-01", targetDate: "2026-08-01" }));
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  await nav(page, "All Projects");
  await main(page).getByRole("button", { name: /Launch/ }).click();
  await main(page).getByRole("tab", { name: /Milestones/ }).click();
  await main(page).getByRole("button", { name: "Add milestone" }).first().click();
  const d = dialog(page, "New milestone");
  await d.getByLabel("Name").fill("Beta to ten friends");
  await d.getByLabel("Target date").fill("2026-07-04");
  await d.getByRole("button", { name: "Add milestone" }).click();
  await main(page).getByText("Beta to ten friends").waitFor();
  const m = (await snap(page)).milestones[0];
  assert.deepEqual([m.projectId, m.targetDate, m.completedAt], [id, "2026-07-04", null]);

  await main(page).getByRole("checkbox", { name: /Complete milestone "Beta to ten friends"/ }).click();
  await page.waitForFunction(async () => !!(await window.wagonwheel.getSnapshot()).milestones[0].completedAt);

  await nav(page, "Timeline");
  await page.getByRole("button", { name: /Milestone Beta to ten friends, Jul 4, done/ }).waitFor();

  await page.getByRole("button", { name: /Milestone Beta to ten friends/ }).click();
  await dialog(page, "Edit milestone").getByRole("button", { name: "Delete" }).click();
  await dialog(page, "Delete this milestone?").getByRole("button", { name: "Delete milestone" }).click();
  await page.waitForFunction(async () => (await window.wagonwheel.getSnapshot()).milestones.length === 0);
}));

test("notes: add, edit and delete on a project", () => withApp(async ({ page }) => {
  await page.evaluate(() => window.wagonwheel.createProject({ name: "Research" }));
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  await nav(page, "All Projects");
  await main(page).getByRole("button", { name: /Research/ }).click();
  await main(page).getByRole("tab", { name: /Notes/ }).click();
  await main(page).getByLabel("New note").fill("Read the SQLite WAL docs");
  await main(page).getByRole("button", { name: "Add note" }).click();
  await main(page).getByText("Read the SQLite WAL docs").waitFor();
  assert.equal((await snap(page)).notes[0].body, "Read the SQLite WAL docs");

  await main(page).getByRole("button", { name: "Edit note" }).click();
  await main(page).getByLabel("Edit note").fill("Read the SQLite WAL docs (done)");
  await main(page).getByRole("button", { name: "Save" }).click();
  await main(page).getByText("Read the SQLite WAL docs (done)").waitFor();
  await main(page).getByText("edited").waitFor();

  await main(page).getByRole("button", { name: "Delete note" }).click();
  await page.waitForFunction(async () => (await window.wagonwheel.getSnapshot()).notes.length === 0);
}));

// ── inbox ───────────────────────────────────────────────────────────────────

test("inbox: capture from the sidebar, file it into a project, and the empty state returns", () => withApp(async ({ page }) => {
  await page.evaluate(() => window.wagonwheel.createProject({ name: "Garage" }));
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  const side = page.getByRole("complementary", { name: "Sidebar" });
  await side.getByText("You're all caught up").waitFor();

  await side.getByRole("button", { name: /Unsorted tasks/ }).click();
  const capture = side.getByLabel("Capture a task to the inbox");
  await capture.fill("Find the torque wrench");
  await capture.press("Enter");
  await side.getByText("Find the torque wrench").waitFor();
  assert.equal((await snap(page)).tasks[0].projectId, null, "it is unsorted");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Inbox/ }).getByText("1").waitFor();

  // File it from the sidebar row.
  await side.getByLabel('Move "Find the torque wrench" to a project').selectOption({ label: "Garage" });
  await side.getByText("You're all caught up").waitFor();
  const t = (await snap(page)).tasks[0];
  assert.equal(t.projectId, (await projectByName(page, "Garage")).id);

  // The Inbox view does the same, with a date.
  await page.evaluate(() => window.wagonwheel.createTask({ title: "Call the plumber" }));
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  await nav(page, "Inbox");
  await main(page).getByLabel('Due date for "Call the plumber"').fill("2026-06-03");
  await main(page).getByLabel('Move "Call the plumber" to a project').selectOption({ label: "Garage" });
  await main(page).getByText("You're all caught up").waitFor();
  const plumber = await taskByTitle(page, "Call the plumber");
  assert.deepEqual([plumber.dueDate, plumber.projectId], ["2026-06-03", t.projectId]);
}));

// ── calendar ────────────────────────────────────────────────────────────────

test("calendar: change month, mark days, and open a day", () => withApp(async ({ page }) => {
  await seedSample(page);
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  const side = page.getByRole("complementary", { name: "Sidebar" });
  await side.getByRole("button", { name: "June 2026" }).waitFor();
  await side.getByRole("button", { name: "Next month" }).click();
  await side.getByRole("button", { name: "July 2026" }).waitFor();
  await side.getByRole("button", { name: "Previous month" }).click();
  await side.getByRole("button", { name: "Previous month" }).click();
  await side.getByRole("button", { name: "May 2026" }).waitFor();
  await side.getByRole("button", { name: "Next month" }).click();

  // A day with a task due says so, and opening it lists the task.
  const jun4 = side.getByRole("button", { name: /^Thursday, June 4: 1 task due/ });
  await jun4.waitFor();
  await jun4.click();
  await main(page).getByRole("heading", { name: "Thursday, June 4" }).waitFor();
  await main(page).getByText("Red glass theme").waitFor();

  // A day with a milestone says so.
  await side.getByRole("button", { name: /^Saturday, June 6: .*milestone/ }).waitFor();
  // An empty day offers to add a task for it.
  await side.getByRole("button", { name: /^Tuesday, June 2$/ }).click();
  await main(page).getByText("Nothing scheduled").waitFor();
  await main(page).getByRole("button", { name: "Add a task for this day" }).click();
  const d = dialog(page, "New task");
  assert.equal(await d.getByLabel("Due date").inputValue(), "2026-06-02");
  await d.getByLabel("Title").fill("Water the tomatoes");
  await d.getByRole("button", { name: "Add task" }).click();
  await main(page).getByText("Water the tomatoes").waitFor();
  assert.equal((await taskByTitle(page, "Water the tomatoes")).dueDate, "2026-06-02");
}));

// ── dashboard ───────────────────────────────────────────────────────────────

test("dashboard: overdue, due soon, milestones and progress, and no task listed twice", () => withApp(async ({ page }) => {
  await seedSample(page);
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  const m = main(page);
  await m.getByRole("heading", { name: "Dashboard" }).waitFor();
  await m.getByText("2 overdue").waitFor();
  // Inside has:, a locator is read relative to the section, so it starts from `page`, not from `main`.
  const section = (name) => m.locator("section").filter({ has: page.getByRole("heading", { name }) });
  await section(/^Overdue/).getByText("Reply to the code signing question").waitFor();
  await section(/^Due soon/).getByText("Red glass theme").waitFor();
  await m.getByText("First working build").waitFor();   // an upcoming milestone
  await m.getByText("2 of 7 tasks").waitFor();            // progress on a project card
  // A task shows once across the three task lists.
  const titles = await m.locator("section").filter({ has: page.getByRole("heading", { name: /^(Overdue|Due soon|Needs attention)/ }) })
    .locator('[role="button"]').evaluateAll((rows) => rows.map((r) => r.querySelector(".truncate")?.textContent ?? ""));
  assert.ok(titles.length >= 5, `the lists have tasks in them: ${titles.join(" | ")}`);
  assert.equal(new Set(titles).size, titles.length, `a task is listed twice: ${titles.join(" | ")}`);
}));

// ── timeline ────────────────────────────────────────────────────────────────

test("timeline: bars, milestones, zoom, drag to move, keyboard nudge", () => withApp(async ({ page, app }) => {
  await seedSample(page);
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  await steady(app, page);
  await nav(page, "Timeline");
  const bar = page.getByRole("button", { name: /^Task Red glass theme, / });
  await bar.waitFor();
  await page.getByRole("button", { name: /^Project Nucleus Wagonwheel, / }).waitFor();
  await page.getByRole("button", { name: /Milestone First working build/ }).waitFor();

  // zoom presets
  await page.getByRole("button", { name: "Month", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Month", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Quarter", exact: true }).click();
  await page.waitForTimeout(400);   // the zoom re-centres on the next frame; measure after it

  // drag the bar three days to the right (a day is 9px at the Quarter zoom)
  const before = await taskByTitle(page, "Red glass theme");
  const box = await bar.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 14, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 27, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(async ([id, was]) => (await window.wagonwheel.getSnapshot()).tasks.find((t) => t.id === id).dueDate !== was, [before.id, before.dueDate]);
  const moved = await taskByTitle(page, "Red glass theme");
  const trace = [`before ${before.startDate}..${before.dueDate}`, `moved ${moved.startDate}..${moved.dueDate}`];
  assert.equal(moved.startDate, addDays(before.startDate, 3), trace.join(" | "));
  assert.equal(moved.dueDate, addDays(before.dueDate, 3), trace.join(" | "));

  // drag the right end to make it longer by two days
  const bar2 = page.getByRole("button", { name: /^Task Red glass theme, / });
  const b2 = await bar2.boundingBox();
  await page.mouse.move(b2.x + b2.width - 3, b2.y + b2.height / 2);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width + 8, b2.y + b2.height / 2, { steps: 4 });
  await page.mouse.move(b2.x + b2.width + 15, b2.y + b2.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(async ([id, was]) => (await window.wagonwheel.getSnapshot()).tasks.find((t) => t.id === id).dueDate !== was, [before.id, moved.dueDate]);
  const longer = await taskByTitle(page, "Red glass theme");
  trace.push(`longer ${longer.startDate}..${longer.dueDate}`);
  assert.equal(longer.startDate, moved.startDate, `the start did not move | ${trace.join(" | ")}`);
  assert.equal(longer.dueDate, addDays(moved.dueDate, 2), trace.join(" | "));

  // the keyboard: Alt + arrow nudges a focused bar by a day
  await page.getByRole("button", { name: /^Task Red glass theme, / }).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await page.waitForFunction(async ([id, was]) => (await window.wagonwheel.getSnapshot()).tasks.find((t) => t.id === id).dueDate !== was, [before.id, longer.dueDate]);
  const nudged = await taskByTitle(page, "Red glass theme");
  trace.push(`nudged ${nudged.startDate}..${nudged.dueDate}`);
  assert.equal(nudged.dueDate, addDays(longer.dueDate, 1), trace.join(" | "));

  // Three quick nudges in a row all count: each save reads the dates as they are, not as they were drawn.
  const beforeRapid = await taskByTitle(page, "Red glass theme");
  await page.getByRole("button", { name: /^Task Red glass theme, / }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForFunction(async ([id, was]) => (await window.wagonwheel.getSnapshot()).tasks.find((t) => t.id === id).dueDate === was, [before.id, addDays(beforeRapid.dueDate, -3)]);
  const afterRapid = await taskByTitle(page, "Red glass theme");
  assert.equal(afterRapid.startDate, addDays(beforeRapid.startDate, -3), "start moved three days");
  assert.equal(afterRapid.dueDate, addDays(beforeRapid.dueDate, -3), "due moved three days");

  // a click (no drag) opens the task
  await page.getByRole("button", { name: /^Task Timeline view with drag to move, / }).click();
  await dialog(page, "Task").getByLabel("Title").waitFor();
}));

test("timeline: a project with no dates says so, and an empty workspace explains itself", () => withApp(async ({ page }) => {
  await nav(page, "Timeline");
  await page.getByText("Nothing to plot yet").waitFor();
  await page.evaluate(() => window.wagonwheel.createProject({ name: "Undated", startDate: "2026-06-05", targetDate: "2026-06-20" }));
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  await nav(page, "Timeline");
  await page.getByRole("button", { name: /^Project Undated, / }).waitFor();
}));

// ── persistence ─────────────────────────────────────────────────────────────

test("data survives closing and reopening the app", async () => {
  const dataDir = tempDir("persist");
  await withApp(async ({ page }) => {
    await seedSample(page);
    await page.evaluate(() => window.wagonwheel.setSetting("workspaceName", "Persistent Workspace"));
  }, { dataDir });

  assert.ok(fs.existsSync(path.join(dataDir, "wagonwheel.db")), "the database file is in the data folder");
  await withApp(async ({ page }) => {
    await page.getByRole("button", { name: "Persistent Workspace: workspace menu" }).waitFor();
    const s = await snap(page);
    assert.equal(s.projects.length, 5);
    assert.equal(s.tasks.length, 17);
    assert.equal(s.milestones.length, 3);
    assert.equal(s.notes.length, 1);
    await nav(page, "All Projects");
    await main(page).getByText("Nucleus Wagonwheel").first().waitFor();
  }, { dataDir });
});

// ── backup, export, restore ─────────────────────────────────────────────────

test("backup, export as JSON and CSV, then restore from the backup", async () => {
  const out = tempDir("files");
  const dataDir = tempDir("backup");
  await withApp(async ({ page, app }) => {
    await seedSample(page);
    await page.reload();
    await page.waitForSelector('[aria-label="Sidebar"]');
    const before = await snap(page);

    // The file dialogs are native. Answer them from the test.
    const answer = (spec) => app.evaluate(({ dialog }, s) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: s.save });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [s.open] });
      dialog.showMessageBox = async () => ({ response: 0 });
    }, spec);
    const menu = async (item) => { await page.getByRole("button", { name: /workspace menu/ }).click(); await page.getByRole("button", { name: item }).click(); };

    // Backup: a real SQLite file with the same rows.
    const backupPath = path.join(out, "my-backup.db");
    await answer({ save: backupPath, open: out });
    await menu("Back up database…");
    await page.getByText(/Backup saved to/).waitFor();
    const db = new DatabaseSync(backupPath, { readOnly: true });
    const count = (t) => Number(db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n);
    assert.deepEqual([count("projects"), count("tasks"), count("milestones"), count("notes")], [before.projects.length, before.tasks.length, before.milestones.length, before.notes.length]);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    db.close();

    // JSON
    const jsonPath = path.join(out, "export.json");
    await answer({ save: jsonPath, open: out });
    await menu("Export as JSON…");
    await page.getByText(/Exported to/).waitFor();
    const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    assert.equal(json.app, "Nucleus Wagonwheel");
    assert.equal(json.tasks.length, before.tasks.length);

    // CSV: four files in a new folder
    await answer({ save: jsonPath, open: out });
    await menu("Export as CSV…");
    await page.getByText(/Four CSV files saved in/).waitFor();
    const folder = fs.readdirSync(out).find((f) => f.startsWith("Wagonwheel export"));
    assert.ok(folder, "an export folder was made");
    assert.deepEqual(fs.readdirSync(path.join(out, folder)).sort(), ["milestones.csv", "notes.csv", "projects.csv", "tasks.csv"]);
    const tasksCsv = fs.readFileSync(path.join(out, folder, "tasks.csv"), "utf8");
    assert.ok(tasksCsv.startsWith("﻿"), "UTF-8 byte order mark, for Excel");
    assert.match(tasksCsv, /Red glass theme/);
    assert.match(tasksCsv, /\(inbox\)/);

    // Restore: change the workspace, then bring the backup back.
    await page.evaluate(async () => { for (const p of (await window.wagonwheel.getSnapshot()).projects) await window.wagonwheel.deleteProject(p.id); });
    assert.equal((await snap(page)).projects.length, 0);
    await answer({ save: jsonPath, open: backupPath });
    await menu("Restore from backup…");
    await page.getByText(/Backup restored/).waitFor();
    const after = await snap(page);
    assert.deepEqual([after.projects.length, after.tasks.length, after.milestones.length], [before.projects.length, before.tasks.length, before.milestones.length]);
    assert.ok(fs.readdirSync(dataDir).some((f) => f.startsWith("before-restore-")), "the workspace as it was before the restore is kept");
    await main(page).getByText("Nucleus Wagonwheel").first().waitFor();
  }, { dataDir });
});

test("restoring a file that is not a Wagonwheel database is refused and changes nothing", async () => {
  const out = tempDir("junk");
  const junk = path.join(out, "not-a-database.db");
  fs.writeFileSync(junk, "this is not a database");
  await withApp(async ({ page, app }) => {
    await seedSample(page);
    const before = await snap(page);
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
      dialog.showMessageBox = async () => ({ response: 0 });
    }, junk);
    await page.getByRole("button", { name: /workspace menu/ }).click();
    await page.getByRole("button", { name: "Restore from backup…" }).click();
    await page.getByText(/That file cannot be restored/).waitFor();
    assert.deepEqual(await snap(page), before);
  });
});

// ── offline ─────────────────────────────────────────────────────────────────

test("works offline: no request leaves the machine, and every font and style is local", () => withApp(async ({ page }) => {
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await seedSample(page);
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  for (const label of ["All Projects", "All Tasks", "Timeline", "Inbox", "Dashboard"]) await nav(page, label);
  await page.waitForTimeout(500);
  const remote = requests.filter((u) => /^(https?|wss?|ftp):/i.test(u));
  assert.deepEqual(remote, [], `requests left the machine: ${remote.join(", ")}`);
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"));
  assert.match(csp ?? "", /connect-src 'none'/, "the built page forbids network connections");
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
  assert.ok(fonts.some((f) => /Sora/.test(f)) && fonts.some((f) => /Source Sans/.test(f)), `bundled fonts loaded: ${fonts.join(", ")}`);
}));

// ── when the database cannot be opened ──────────────────────────────────────

test("an unreadable database file shows a recovery screen; starting fresh keeps the old file", async () => {
  const dataDir = tempDir("corrupt");
  fs.writeFileSync(path.join(dataDir, "wagonwheel.db"), "SQLite format 3 is not what this is. ".repeat(200));
  await withApp(async ({ page }) => {
    await page.getByText("Your workspace could not be opened").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /could not be opened/);
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByText("Your workspace could not be opened").waitFor();
    await page.getByRole("button", { name: /Start a new workspace/ }).click();
    await dialog(page, "Start a new workspace?").getByRole("button", { name: "Start new workspace" }).click();
    await page.getByText("Start with a project").waitFor();
    assert.ok(fs.readdirSync(dataDir).some((f) => f.startsWith("wagonwheel.db.unreadable-")), "the unreadable file was kept");
    // and the new workspace works
    await page.evaluate(() => window.wagonwheel.createProject({ name: "Fresh start" }));
    assert.equal((await snap(page)).projects.length, 1);
  }, { dataDir });
});

// ── the primary screen, as a picture ────────────────────────────────────────

test("the dashboard looks as it did (screenshot regression)", () => withApp(async ({ page, app }) => {
  await seedSample(page);
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await steady(app, page, { width: 1440, height: 900 });
  const shot = await page.screenshot();
  expectScreenshot(shot, "dashboard");
  assert.equal(FIXED_TODAY, "2026-06-01");
}));

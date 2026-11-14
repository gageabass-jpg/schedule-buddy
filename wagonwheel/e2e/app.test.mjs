// End-to-end tests of the real, built Nucleus Wagonwheel, driven through its own window
// by Playwright. They need a display: `npm run test:e2e` starts one on Linux.
//
// Every test gets its own data folder, so nothing leaks between them or into your real
// workspace. The clock is held at 2026-06-01 (see lib.mjs), so dates are the same every run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { appDir, closeApp, FIXED_TODAY, launch, seedSample, steady, tempDir } from "./lib.mjs";
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

// A snapshot's `revision` counts reads, so it is different every time. It is left out, so two snapshots of an
// unchanged workspace compare equal.
const snap = (page) => page.evaluate(async () => {
  const { revision, ...workspace } = await window.wagonwheel.getSnapshot();
  return workspace;
});
const nav = (page, label) => page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: new RegExp(`^${label}`) }).click();
const dialog = (page, name) => page.getByRole("dialog", { name });
// The inbox and the GitHub scan live in the page header (the sidebar no longer has either row).
const inboxButton = (page) => page.getByRole("button", { name: /^Inbox/ });
const openInbox = (page) => inboxButton(page).click();
const scanGithub = (page) => page.getByRole("button", { name: "Scan GitHub", exact: true }).click();
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
  assert.match(bar, /nucleus\s+workspace/i);
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
  await page.getByRole("button", { name: "Inbox, 1 unsorted" }).waitFor();

  // File it from the sidebar row.
  await side.getByLabel('Move "Find the torque wrench" to a project').selectOption({ label: "Garage" });
  await side.getByText("You're all caught up").waitFor();
  const t = (await snap(page)).tasks[0];
  assert.equal(t.projectId, (await projectByName(page, "Garage")).id);

  // The Inbox view does the same, with a date.
  await page.evaluate(() => window.wagonwheel.createTask({ title: "Call the plumber" }));
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  await openInbox(page);
  await main(page).getByLabel('Due date for "Call the plumber"').fill("2026-06-03");
  await main(page).getByLabel('Move "Call the plumber" to a project').selectOption({ label: "Garage" });
  await main(page).getByText("You're all caught up").waitFor();
  const plumber = await taskByTitle(page, "Call the plumber");
  assert.deepEqual([plumber.dueDate, plumber.projectId], ["2026-06-03", t.projectId]);
}));

// ── calendar ────────────────────────────────────────────────────────────────

test("page header: Scan GitHub sits with New task and New project, the inbox button is in every header, and the sidebar has neither row", () => withApp(async ({ page }) => {
  await page.evaluate(async () => {
    await window.wagonwheel.createProject({ name: "Garage" });
    await window.wagonwheel.createTask({ title: "Find the torque wrench" });
    await window.wagonwheel.createTask({ title: "Call the plumber" });
  });
  await page.reload();
  await page.waitForSelector('[aria-label="Sidebar"]');
  const side = page.getByRole("complementary", { name: "Sidebar" });
  const header = main(page).locator("header");
  const x = async (locator) => (await locator.boundingBox()).x;

  // the sidebar's Main list is places only now
  const places = await side.getByRole("navigation", { name: "Main" }).getByRole("button").allInnerTexts();
  assert.deepEqual(places.map((t) => t.replace(/\s*\d+$/, "").trim()), ["Dashboard", "All Projects", "All Tasks", "Timeline", "Services"]);
  assert.equal(await side.getByRole("button", { name: /Scan GitHub/ }).count(), 0, "no Scan GitHub in the sidebar");

  // where something can be created, Scan GitHub is beside it, and the inbox is to the right of all of them
  for (const [view, create] of [["Dashboard", "New task"], ["Dashboard", "New project"], ["All Tasks", "New task"], ["All Projects", "New project"]]) {
    await nav(page, view);
    const scan = header.getByRole("button", { name: "Scan GitHub", exact: true });
    const made = header.getByRole("button", { name: create, exact: true });
    const inbox = header.getByRole("button", { name: /^Inbox/ });
    await scan.waitFor();
    assert.ok((await x(scan)) < (await x(made)) && (await x(made)) < (await x(inbox)), `${view}: Scan GitHub, ${create}, then the inbox, left to right`);
  }

  // where nothing is created from, there is no Scan GitHub, but the inbox is still in the corner
  for (const view of ["Timeline", "Services"]) {
    await nav(page, view);
    await inboxButton(page).waitFor();
    assert.equal(await header.getByRole("button", { name: "Scan GitHub", exact: true }).count(), 0, `${view}: no Scan GitHub`);
  }
  await nav(page, "All Projects");
  await main(page).getByRole("button", { name: /Garage/ }).click();
  await main(page).getByRole("button", { name: "Edit" }).waitFor();
  await inboxButton(page).waitFor();
  assert.equal(await header.getByRole("button", { name: "Scan GitHub", exact: true }).count(), 0, "a project page has its own scan, so not this one");

  // the inbox button says how many are unsorted, opens the inbox, and shows as the current page there
  const inbox = page.getByRole("button", { name: "Inbox, 2 unsorted" });
  await inbox.waitFor();
  assert.equal(await inbox.getAttribute("aria-current"), null);
  await inbox.click();
  await main(page).getByRole("heading", { name: "Inbox" }).waitFor();
  assert.equal(await inbox.getAttribute("aria-current"), "page");

  // filing the tasks empties it, and the count goes with it
  for (const title of ["Find the torque wrench", "Call the plumber"]) await main(page).getByLabel(`Move "${title}" to a project`).selectOption({ label: "Garage" });
  await page.getByRole("button", { name: "Inbox", exact: true }).waitFor();

  // Scan GitHub from the header opens the same dialog as the menu
  await nav(page, "Dashboard");
  await scanGithub(page);
  await dialog(page, "Scan GitHub for tasks").waitFor();
}));
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
    assert.deepEqual(fs.readdirSync(path.join(out, folder)).sort(), ["milestones.csv", "notes.csv", "projects.csv", "service_charges.csv", "services.csv", "tasks.csv"]);
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
  for (const label of ["All Projects", "All Tasks", "Timeline"]) await nav(page, label);
  await openInbox(page);
  await nav(page, "Dashboard");
  await page.waitForTimeout(500);
  const remote = requests.filter((u) => /^(https?|wss?|ftp):/i.test(u));
  assert.deepEqual(remote, [], `requests left the machine: ${remote.join(", ")}`);
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"));
  assert.match(csp ?? "", /connect-src 'none'/, "the built page forbids network connections");
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
  assert.ok(fonts.some((f) => /Sora/.test(f)) && fonts.some((f) => /Source Sans/.test(f)), `bundled fonts loaded: ${fonts.join(", ")}`);
}));

// ── scan GitHub ─────────────────────────────────────────────────────────────

test("Scan GitHub opens from the page header and walks through setup, without the page touching the network", () => withApp(async ({ page, dataDir }) => {
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await scanGithub(page);
  const d = dialog(page, "Scan GitHub for tasks");
  await d.getByText("Connect your GitHub account, once.").waitFor();
  assert.equal(await d.getByRole("link", { name: "New OAuth App" }).getAttribute("href"), "https://github.com/settings/applications/new");

  // a Client ID that cannot be one is turned back, in words, and nothing is saved
  await d.getByLabel("Client ID").fill("not valid!");
  await d.getByRole("button", { name: "Save Client ID" }).click();
  await d.getByRole("alert").getByText(/does not look like a GitHub Client ID/).waitFor();
  assert.equal((await page.evaluate(() => window.wagonwheel.githubStatus())).clientId, null);

  // a good one is kept, and the dialog moves on to the sign-in step
  await d.getByLabel("Client ID").fill("Ov23liExample123");
  await d.getByRole("button", { name: "Save Client ID" }).click();
  await d.getByRole("button", { name: "Sign in with GitHub" }).waitFor();
  const status = await page.evaluate(() => window.wagonwheel.githubStatus());
  assert.equal(status.clientId, "Ov23liExample123");
  assert.equal(status.signedIn, false);
  assert.equal(status.login, null);

  // it is kept beside the database, never in it, and holds no token
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "github.json"), "utf8"));
  assert.deepEqual(saved, { clientId: "Ov23liExample123" });
  const everything = JSON.stringify(await snap(page));
  assert.ok(!everything.includes("Ov23liExample123"), "the workspace data does not hold the GitHub settings");

  // closing it changes nothing in the workspace, and the page itself made no remote request
  await d.getByRole("button", { name: "Cancel" }).click();
  await d.waitFor({ state: "detached" });
  assert.deepEqual(requests.filter((u) => /^(https?|wss?|ftp):/i.test(u)), []);
  // signing in without a sign-in in progress is refused, not guessed at
  await assert.rejects(page.evaluate(() => window.wagonwheel.githubPollSignIn()), /No sign-in is waiting/);
  // and a scan needs a sign-in, and a real repository name
  await assert.rejects(page.evaluate(() => window.wagonwheel.githubListRepos()), /Sign in to GitHub first/);
  await assert.rejects(page.evaluate(() => window.wagonwheel.githubScanRepo("../../etc/passwd")), /not a repository name/);
}));

// ── connecting a repository to a project ────────────────────────────────────

const REPO = "gageabass-jpg/schedule-buddy";
const REPOS = [
  { fullName: REPO, description: "Shift schedule", private: true, archived: false, fork: false, pushedAt: null, openIssues: 2, url: `https://github.com/${REPO}` },
  { fullName: "gageabass-jpg/other-thing", description: "", private: false, archived: false, fork: false, pushedAt: null, openIssues: 0, url: "https://github.com/gageabass-jpg/other-thing" },
];
const SCAN = {
  repo: { fullName: REPO, url: `https://github.com/${REPO}`, description: "Shift schedule" },
  notes: [],
  proposals: [
    { id: `${REPO}#7`, kind: "issue", title: "Fix the wall display", priority: "high", dueDate: "2026-06-10", asMilestone: false,
      url: `https://github.com/${REPO}/issues/7`, description: `It freezes\n\nFrom GitHub: https://github.com/${REPO}/issues/7` },
    { id: `${REPO}@milestone:1`, kind: "milestone", title: "v1.0", priority: "medium", dueDate: "2026-12-31", asMilestone: true,
      url: `https://github.com/${REPO}/milestone/1`, description: `5 of 8 issues closed.\n\nFrom GitHub: https://github.com/${REPO}/milestone/1` },
    { id: `${REPO}:README.md:dark-mode`, kind: "roadmap", title: "Add a dark mode", priority: "medium", dueDate: null, asMilestone: false,
      url: `https://github.com/${REPO}/blob/main/README.md`, description: `In README.md, under "Roadmap".\n\nFrom GitHub: https://github.com/${REPO}/blob/main/README.md` },
  ],
};

/** Stand in for GitHub in the main process: signed in, with a few repositories and one scan result. */
async function stubGithub(app) {
  await app.evaluate(({ ipcMain }, { repos, scan }) => {
    for (const n of ["githubStatus", "githubListRepos", "githubScanRepo"]) ipcMain.removeHandler(`ww:${n}`);
    const ok = (data) => ({ ok: true, data });
    ipcMain.handle("ww:githubStatus", () => ok({ clientId: "Ov23liExample123", signedIn: true, login: "gageabass-jpg", canKeepSignIn: true }));
    ipcMain.handle("ww:githubListRepos", () => ok(repos));
    ipcMain.handle("ww:githubScanRepo", () => ok(scan));
  }, { repos: REPOS, scan: SCAN });
}

test("a project connects to a GitHub repository, scans it for tasks, refuses a second claim, and disconnects", () => withApp(async ({ page, app }) => {
  await stubGithub(app);
  await createProjectViaUi(page, { name: "schedule-buddy" });
  const github = page.getByRole("group", { name: "GitHub" });
  await github.getByRole("button", { name: "Connect GitHub repo" }).click();

  // connect: the repository named like the project is offered, and the pick is remembered
  const connect = dialog(page, "Connect a repository");
  await connect.getByText(/Choose the repository that belongs to/).waitFor();
  assert.equal(await connect.getByRole("radio", { name: REPO }).isChecked(), true, "the repository named like the project is chosen for you");
  await connect.getByRole("button", { name: "Connect only" }).click();
  await connect.waitFor({ state: "detached" });
  await github.getByRole("link", { name: new RegExp(REPO) }).waitFor();
  assert.equal((await projectByName(page, "schedule-buddy")).githubRepo, REPO);

  // scan it: everything is new, so everything starts ticked, and it lands in this project
  await github.getByRole("button", { name: "Scan for tasks" }).click();
  const scan = dialog(page, "Scan GitHub for tasks");
  await scan.getByText("Adds to “schedule-buddy”").waitFor();
  await scan.getByRole("button", { name: "Add 3 to workspace" }).click();
  await scan.waitFor({ state: "detached" });
  const proj = await projectByName(page, "schedule-buddy");
  const after = await snap(page);
  assert.deepEqual(after.tasks.filter((t) => t.projectId === proj.id).map((t) => t.title).sort(), ["Add a dark mode", "Fix the wall display"]);
  assert.deepEqual(after.milestones.filter((m) => m.projectId === proj.id).map((m) => [m.name, m.targetDate]), [["v1.0", "2026-12-31"]]);
  assert.equal(after.projects.length, 1, "no second project was made");
  assert.match((await taskByTitle(page, "Fix the wall display")).description, /From GitHub: https:\/\/github\.com\/gageabass-jpg\/schedule-buddy\/issues\/7$/);

  // scanning again adds nothing: all three are already there
  await github.getByRole("button", { name: "Scan for tasks" }).click();
  await scan.getByText("Adds to “schedule-buddy”").waitFor();
  assert.equal(await scan.getByText("Already added").count(), 3);
  assert.equal(await scan.getByRole("button", { name: "Add to workspace" }).isDisabled(), true);
  await scan.getByRole("button", { name: "Cancel" }).click();
  assert.equal((await snap(page)).tasks.length, 2);

  // a second project cannot take the same repository, in the list or by typing it
  await createProjectViaUi(page, { name: "Something else" });
  await github.getByRole("button", { name: "Connect GitHub repo" }).click();
  await connect.getByText(/Choose the repository that belongs to/).waitFor();
  assert.equal(await connect.getByRole("radio", { name: REPO }).isDisabled(), true);
  await connect.getByText("Connected to “schedule-buddy”").waitFor();
  await connect.getByLabel("Repository as owner/name or a GitHub address").fill(`https://github.com/${REPO}/issues/7`);
  await connect.getByRole("alert").getByText(/already connected to “schedule-buddy”/).waitFor();
  assert.equal(await connect.getByRole("button", { name: "Connect only" }).isDisabled(), true);
  // the database enforces it too, whatever the window shows
  const other = await projectByName(page, "Something else");
  await assert.rejects(page.evaluate(([id, r]) => window.wagonwheel.updateProject(id, { githubRepo: r }), [other.id, REPO]), /already connected to the project "schedule-buddy"/);
  await connect.getByRole("button", { name: "Cancel" }).click();
  await connect.waitFor({ state: "detached" });

  // back on the first project, disconnecting keeps its tasks
  await nav(page, "All Projects");
  await main(page).getByRole("button", { name: /schedule-buddy/ }).click();
  await github.getByRole("button", { name: "Disconnect repository" }).click();
  await github.getByRole("button", { name: "Connect GitHub repo" }).waitFor();
  const last = await snap(page);
  assert.equal((await projectByName(page, "schedule-buddy")).githubRepo, null);
  assert.equal(last.tasks.length, 2, "the tasks stay");
  assert.equal(last.milestones.length, 1);
}));

test("scanning from the page header adds to a project named like the repository, and connects it", () => withApp(async ({ page, app }) => {
  await stubGithub(app);
  await createProjectViaUi(page, { name: "schedule-buddy" });   // not connected to anything yet
  assert.equal((await projectByName(page, "schedule-buddy")).githubRepo, null);
  await nav(page, "Dashboard");   // creating the project left us on its page, which has its own scan
  await scanGithub(page);
  const d = dialog(page, "Scan GitHub for tasks");
  await d.getByRole("checkbox", { name: REPO }).check();
  await d.getByRole("button", { name: "Scan 1 repository" }).click();
  await d.getByText("Adds to “schedule-buddy”").waitFor();
  await d.getByRole("button", { name: "Add 3 to workspace" }).click();
  await d.waitFor({ state: "detached" });
  const s = await snap(page);
  assert.equal(s.projects.length, 1, "it went into the existing project, not a new one");
  assert.equal(s.projects[0].githubRepo, REPO, "and the project is now connected to the repository");
  assert.equal(s.tasks.length, 2);
  // the project's page says so, and the card on the projects list does too
  await page.getByRole("group", { name: "GitHub" }).getByRole("link", { name: new RegExp(REPO) }).waitFor();
  await nav(page, "All Projects");
  await main(page).getByText(REPO).waitFor();
}));

test("scanning a repository with no project makes one, already connected", () => withApp(async ({ page, app }) => {
  await stubGithub(app);
  await scanGithub(page);
  const d = dialog(page, "Scan GitHub for tasks");
  await d.getByRole("checkbox", { name: REPO }).check();
  await d.getByRole("button", { name: "Scan 1 repository" }).click();
  await d.getByText("New project “schedule-buddy”").waitFor();
  await d.getByRole("button", { name: "Add 3 to workspace" }).click();
  await d.waitFor({ state: "detached" });
  const s = await snap(page);
  assert.equal(s.projects.length, 1);
  assert.equal(s.projects[0].name, "schedule-buddy");
  assert.equal(s.projects[0].githubRepo, REPO);
  assert.equal(s.tasks.length, 2);
  await page.getByRole("group", { name: "GitHub" }).getByRole("button", { name: "Scan for tasks" }).waitFor();
}));

// ── the Claude Code connector ───────────────────────────────────────────────

/** Start the connector the way Claude Code does (a child process speaking MCP on stdin and stdout), pointed at the app's data. */
function startConnector(dataDir, args = []) {
  const child = spawn(process.execPath, [path.join(appDir, "dist-electron", "electron", "mcp", "server.js"), ...args], {
    env: { ...process.env, WAGONWHEEL_DATA_DIR: dataDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const stray = [];
  let nextId = 1;
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { stray.push(line); continue; }   // stdout carries protocol and nothing else
      pending.get(message.id)?.(message);
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 15_000);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const call = async (name, args = {}) => {
    const r = await request("tools/call", { name, arguments: args });
    assert.ok(r.result, `tools/call ${name} answered with a result: ${JSON.stringify(r)}`);
    const text = r.result.content[0].text;
    let json = null;
    try { json = JSON.parse(text); } catch { /* a refusal is plain text */ }
    return { isError: r.result.isError, text, json };
  };
  const handshake = async () => {
    const r = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    return r.result;
  };
  const stop = () => { child.stdin.end(); child.kill(); };
  return { request, call, handshake, stop, stray, child };
}

test("Claude Code's connector reads and changes the workspace while the app is open, and the window follows", () => withApp(async ({ page, dataDir }) => {
  await createProjectViaUi(page, { name: "Wagonwheel" });
  await page.getByLabel("Add a task to this project").fill("Made in the window");
  await page.getByLabel("Add a task to this project").press("Enter");
  await page.getByText("Made in the window").waitFor();

  const mcp = startConnector(dataDir);
  try {
    const init = await mcp.handshake();
    assert.equal(init.serverInfo.name, "wagonwheel");
    assert.equal(init.protocolVersion, "2025-06-18");
    assert.match(init.instructions, /no delete tools/);
    const names = (await mcp.request("tools/list")).result.tools.map((t) => t.name);
    for (const n of ["get_overview", "list_tasks", "create_task", "update_task", "complete_task", "add_note"]) assert.ok(names.includes(n), `lists ${n}`);
    assert.ok(!names.some((n) => /delete|remove/.test(n)), "no delete tool");

    // what the person did in the window is visible to Claude Code
    const seen = await mcp.call("list_tasks", { project: "Wagonwheel" });
    assert.deepEqual(seen.json.tasks.map((t) => t.title), ["Made in the window"]);
    assert.equal((await mcp.call("get_overview")).json.counts.open_tasks, 1);

    // what the person typed on the Services screen is what Claude Code reports, to the cent
    await page.evaluate(async () => {
      const { id } = await window.wagonwheel.createService({ name: "Vercel", kind: "usage", amountCents: 2000, billingDay: 5 });
      await window.wagonwheel.setServiceCharge({ serviceId: id, month: "2026-06", amountCents: 5500 });
    });
    // (the connector keeps real time while the window's clock is held at June, so it is asked about June)
    const paid = (await mcp.call("list_services", { month: "2026-06" })).json;
    assert.equal(paid.total_usd, 55);
    assert.deepEqual(paid.higher_than_usual, [{ service: "Vercel", by_usd: 35 }]);
    assert.deepEqual(paid.services.map((v) => [v.name, v.amount_usd, v.amount_basis]), [["Vercel", 55, "recorded"]]);

    // what Claude Code does shows up in the open window by itself
    const made = await mcp.call("create_task", { title: "Added by Claude Code", project: "Wagonwheel", priority: "high", due_date: "2026-06-03", description: "From the connector" });
    assert.equal(made.isError, false);
    await page.getByText("Added by Claude Code").waitFor({ timeout: 15_000 });
    await mcp.call("complete_task", { task: made.json.created.id });
    await page.getByRole("checkbox", { name: 'Mark "Added by Claude Code" not done' }).waitFor({ timeout: 15_000 });   // it ticked itself
    await mcp.call("add_note", { project: "Wagonwheel", body: "Written by Claude Code" });
    const s = await snap(page);
    assert.equal(s.tasks.find((t) => t.title === "Added by Claude Code").status, "done");
    assert.deepEqual(s.notes.map((n) => n.body), ["Written by Claude Code"]);

    // the same rules as the app: a bad request is refused in words and changes nothing
    const refused = await mcp.call("create_task", { title: "x", due_date: "2026-02-30" });
    assert.equal(refused.isError, true);
    assert.equal(refused.text, "The due date is not a valid date.");
    assert.equal((await snap(page)).tasks.length, 2);
    assert.deepEqual(mcp.stray, [], "nothing but protocol on stdout");
  } finally {
    mcp.stop();
  }
}));

test("the connector can be made read-only, and refuses to start without a workspace", async () => {
  await withApp(async ({ page, dataDir }) => {
    await createProjectViaUi(page, { name: "Wagonwheel" });
    const mcp = startConnector(dataDir, ["--read-only"]);
    try {
      const init = await mcp.handshake();
      assert.match(init.instructions, /read-only/);
      const names = (await mcp.request("tools/list")).result.tools.map((t) => t.name).sort();
      assert.deepEqual(names, ["get_overview", "get_project", "get_task", "list_projects", "list_services", "list_tasks"]);
      assert.equal((await mcp.call("list_projects")).json.count, 1);
    } finally {
      mcp.stop();
    }
  });
  // no database yet: it says what to do, on stderr, and exits (it never creates one)
  const empty = tempDir("mcp-empty");
  const child = spawn(process.execPath, [path.join(appDir, "dist-electron", "electron", "mcp", "server.js")], { env: { ...process.env, WAGONWHEEL_DATA_DIR: empty }, stdio: ["pipe", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => { err += d; });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 1);
  assert.match(err, /Open the app once/);
  assert.equal(fs.existsSync(path.join(empty, "wagonwheel.db")), false, "it did not create a workspace");
});

// ── the Connectors panel ────────────────────────────────────────────────────

/** Stand-ins for Claude Code's tool, the Keychain and the iCloud connector, so the panel is driven
 *  for real without ever touching the real ones. */
function connectorFixtures({ claudeMissing = false } = {}) {
  const dir = tempDir("connectors");
  const config = path.join(dir, "claude.json");
  const keychainFlag = path.join(dir, "password-is-stored");
  const claude = path.join(dir, "fake-claude");
  fs.writeFileSync(claude, `#!${process.execPath}
const fs = require("fs");
const cfg = process.env.WAGONWHEEL_CLAUDE_CONFIG;
const a = process.argv.slice(2);
let d = {}; try { d = JSON.parse(fs.readFileSync(cfg, "utf8")); } catch {}
d.mcpServers ||= {};
if (a[0] === "mcp" && a[1] === "remove") {
  if (!d.mcpServers[a[2]]) { console.error("No MCP server found with name: " + a[2]); process.exit(1); }
  delete d.mcpServers[a[2]]; fs.writeFileSync(cfg, JSON.stringify(d));
} else if (a[0] === "mcp" && a[1] === "add") {
  const sep = a.indexOf("--"); const env = {};
  for (let i = 3; i < sep; i++) if (a[i] === "-e") { const [k, v] = a[++i].split("="); env[k] = v; }
  d.mcpServers[a[2]] = { type: "stdio", command: a[sep + 1], args: a.slice(sep + 2), env };
  fs.writeFileSync(cfg, JSON.stringify(d));
} else process.exit(2);
`, { mode: 0o755 });
  const security = path.join(dir, "fake-security");
  fs.writeFileSync(security, `#!/bin/sh\n[ -f "${keychainFlag}" ] && exit 0\nexit 44\n`, { mode: 0o755 });
  const icloud = path.join(dir, "icloud-mail");
  fs.mkdirSync(icloud);
  fs.writeFileSync(path.join(icloud, "server.mjs"), "");
  fs.writeFileSync(path.join(icloud, "run.sh"), '#!/bin/bash\necho "Signed in to iCloud Mail as $ICLOUD_MAIL_ADDRESS."\necho "  INBOX    12 messages,    3 unread"\n', { mode: 0o755 });
  fs.writeFileSync(config, JSON.stringify({
    mcpServers: {
      "icloud-mail": { type: "stdio", command: "bash", args: ["/x/run.sh"], env: { ICLOUD_MAIL_ADDRESS: "me@icloud.com" } },
      other: { type: "stdio", command: "npx", args: ["thing"], env: { API_KEY: "SECRET-E2E-KEY" } },
    },
  }));
  const env = {
    WAGONWHEEL_CLAUDE_CONFIG: config, WAGONWHEEL_ICLOUD_DIR: icloud, WAGONWHEEL_SECURITY_BIN: security,
    WAGONWHEEL_CLAUDE_BIN: claudeMissing ? path.join(dir, "no-such-claude") : claude,
  };
  return { env, keychainFlag, servers: () => JSON.parse(fs.readFileSync(config, "utf8")).mcpServers };
}

const openConnectors = async (page) => {
  await page.getByRole("button", { name: /workspace menu/ }).click();
  await page.getByRole("button", { name: "Connectors…" }).click();
  const d = dialog(page, "Connectors");
  await d.waitFor();
  return d;
};

test("Connectors: connect, switch to read-only and disconnect Claude Code, see GitHub, and set up iCloud Mail, without touching the real setup", async () => {
  const fx = connectorFixtures();
  await withApp(async ({ page }) => {
    const requests = [];
    page.on("request", (r) => requests.push(r.url()));
    const d = await openConnectors(page);
    const claude = d.getByRole("region", { name: "Claude Code", exact: true });
    const github = d.getByRole("region", { name: "GitHub", exact: true });
    const icloud = d.getByRole("region", { name: "iCloud Mail, for Claude Code", exact: true });

    // Claude Code: not connected, with the command to copy
    await claude.getByText("Not connected").waitFor();
    assert.match(await claude.locator("code").innerText(), /^claude mcp add wagonwheel --scope user -e ELECTRON_RUN_AS_NODE=1 -- .+ .+server\.js$/);
    assert.equal(fx.servers().wagonwheel, undefined);

    // connect: Claude Code's own command registers it, pointing at this app's server, with read and update
    await claude.getByRole("button", { name: "Connect to Claude Code" }).click();
    await claude.getByText("Connected · read and update").waitFor();
    const entry = fx.servers().wagonwheel;
    assert.match(entry.args[0], /dist-electron[\\/]electron[\\/]mcp[\\/]server\.js$/);
    assert.deepEqual(entry.env, { ELECTRON_RUN_AS_NODE: "1" });
    assert.ok(!entry.args.includes("--read-only"));
    assert.equal(await claude.getByRole("button", { name: "Connect to Claude Code" }).count(), 0, "nothing left to connect");

    // untick "make changes": the connection is replaced by a read-only one at once
    await claude.getByLabel("Let Claude Code make changes").uncheck();
    await claude.getByText("Connected · read-only").waitFor();
    assert.equal(fx.servers().wagonwheel.args.at(-1), "--read-only");
    await claude.getByLabel("Let Claude Code make changes").check();
    await claude.getByText("Connected · read and update").waitFor();
    assert.ok(!fx.servers().wagonwheel.args.includes("--read-only"));

    // disconnect, leaving every other connector as it was
    await claude.getByRole("button", { name: "Disconnect" }).click();
    await claude.getByText("Not connected").waitFor();
    assert.equal(fx.servers().wagonwheel, undefined);
    assert.deepEqual(Object.keys(fx.servers()).sort(), ["icloud-mail", "other"]);
    assert.equal(fx.servers().other.env.API_KEY, "SECRET-E2E-KEY", "untouched");

    // GitHub: not set up yet
    await github.getByText("Not set up").waitFor();

    // iCloud Mail: installed and registered, but no app password yet: it says what to do
    await icloud.getByText("Needs an app password").waitFor();
    await icloud.getByText("me@icloud.com").first().waitFor();
    assert.match(await icloud.locator("code").last().innerText(), /^security add-generic-password -a "me@icloud\.com" -s "claude-icloud-mail" -w$/);
    assert.equal(await icloud.getByRole("button", { name: "Check sign-in" }).count(), 0);
    assert.equal(await icloud.getByRole("link", { name: /account\.apple\.com/ }).getAttribute("href"), "https://account.apple.com");

    // the person stores the password, presses Refresh, and can check the sign-in
    fs.writeFileSync(fx.keychainFlag, "");
    await d.getByRole("button", { name: "Refresh" }).click();
    await icloud.getByText("Ready", { exact: true }).waitFor();
    await icloud.getByRole("button", { name: "Check sign-in" }).click();
    await icloud.getByRole("status", { name: "Sign-in check" }).getByText(/Signed in to iCloud Mail as me@icloud\.com\./).waitFor();

    // nothing secret ever reached the window, and the window made no remote request
    const everything = await page.evaluate(() => document.body.innerText);
    assert.ok(!everything.includes("SECRET-E2E-KEY"), "another connector's secret stayed out of the window");
    assert.deepEqual(requests.filter((u) => /^(https?|wss?|ftp):/i.test(u)), []);

    // GitHub's button closes the panel and opens the GitHub dialog
    await github.getByRole("button", { name: "Set up GitHub…" }).click();
    await d.waitFor({ state: "detached" });
    await dialog(page, "Scan GitHub for tasks").waitFor();
  }, { extraEnv: fx.env });
});

test("Connectors: when Claude Code's tool cannot be found, it says so and offers the command to copy", async () => {
  const fx = connectorFixtures({ claudeMissing: true });
  await withApp(async ({ page }) => {
    const d = await openConnectors(page);
    const claude = d.getByRole("region", { name: "Claude Code", exact: true });
    await claude.getByText(/command-line tool was not found/).waitFor();
    assert.equal(await claude.getByRole("button", { name: "Connect to Claude Code" }).count(), 0);
    await claude.getByRole("button", { name: "Copy command" }).waitFor();
    assert.match(await claude.locator("code").innerText(), /^claude mcp add wagonwheel /);
    // asking the main process anyway is refused in words, and changes nothing
    await assert.rejects(page.evaluate(() => window.wagonwheel.connectorsConnect(false)), /command-line tool was not found/);
    assert.equal(fx.servers().wagonwheel, undefined);
  }, { extraEnv: fx.env });
});

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

// ── services: what the workspace pays each month ────────────────────────────

/** Open Add a service from the Services screen and fill it in. Returns the dialog. */
async function addServiceViaUi(page, { preset, fee = "", day = "" }) {
  await main(page).getByRole("button", { name: /Add (your first )?service/ }).first().click();
  const d = dialog(page, "Add a service");
  if (preset) await d.getByRole("button", { name: preset, exact: true }).click();
  if (fee) await d.getByLabel("Usual monthly fee ($)", { exact: true }).fill(fee);
  if (day) await d.getByLabel("Billing day", { exact: true }).fill(day);
  return d;
}

test("services: add from a preset, record a bill, and a bill far above usual is flagged", () => withApp(async ({ page }) => {
  await nav(page, "Services");
  await page.getByText("No services yet").waitFor();

  const d = await addServiceViaUi(page, { preset: "Vercel", fee: "20", day: "5" });
  await d.getByRole("button", { name: "Add service" }).click();
  await page.getByText("$20 expected in June").waitFor();
  let s = (await snap(page)).services;
  assert.equal(s.length, 1);
  assert.deepEqual(
    { name: s[0].name, kind: s[0].kind, provider: s[0].provider, amountCents: s[0].amountCents, billingDay: s[0].billingDay, billingUrl: s[0].billingUrl },
    { name: "Vercel", kind: "usage", provider: "vercel", amountCents: 2000, billingDay: 5, billingUrl: "https://vercel.com/account/billing" },
  );
  // Nothing is recorded yet, so the usual fee stands in and says so. 5 June is four days after the fixed "today".
  await page.getByText("~$20").waitFor();
  await page.getByText("usual fee, not yet billed").waitFor();
  await page.getByText(/bills on the 5th · in 4 days/).waitFor();

  const second = await addServiceViaUi(page, { preset: "GitHub", fee: "4" });
  await second.getByRole("button", { name: "Add service" }).click();
  await page.getByText("$24 expected in June").waitFor();

  // A bill well above usual: the screen says so first, the row says by how much, and the sidebar count turns red.
  const box = page.getByLabel("Record Vercel's bill for June 2026");
  await box.fill("55");
  await box.press("Enter");
  await page.getByText("A bill is higher than usual in June 2026").waitFor();
  await page.getByText("+$35 over usual").waitFor();
  await page.getByText("$59 expected in June").waitFor();
  assert.deepEqual((await snap(page)).serviceCharges.map((c) => [c.month, c.amountCents, c.source]), [["2026-06", 5500, "manual"]]);
  const pill = page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Services/ }).locator("span").last();
  assert.match(await pill.getAttribute("class"), /bg-crimson/, "the Services count is red while a bill is flagged");

  // Typing a different figure replaces it, and the warning goes.
  await box.fill("21");
  await box.press("Enter");
  await page.getByText("A bill is higher than usual in June 2026").waitFor({ state: "detached" });
  const charges = (await snap(page)).serviceCharges;
  assert.equal(charges.length, 1);
  assert.equal(charges[0].amountCents, 2100);

  // A bad amount is refused in words, and nothing changes.
  await box.fill("lots");
  await box.press("Enter");
  await page.getByText("That is not an amount. Type it like 25 or 12.50.").waitFor();
  assert.equal((await snap(page)).serviceCharges[0].amountCents, 2100);
}));

test("services: bad input is refused in words and nothing is saved", () => withApp(async ({ page }) => {
  await nav(page, "Services");
  const d = await addServiceViaUi(page, { preset: "Supabase", fee: "abc" });
  await d.getByRole("button", { name: "Add service" }).click();
  await d.getByText("The usual monthly fee must be an amount, like 25 or 12.50.").waitFor();

  await d.getByLabel("Usual monthly fee ($)", { exact: true }).fill("25");
  await d.getByLabel("Billing page").fill("javascript:alert(1)");
  await d.getByRole("button", { name: "Add service" }).click();
  await d.getByText(/The billing page must be a web address/).waitFor();
  assert.equal((await snap(page)).services.length, 0, "nothing was saved");

  // A web address that is not https is refused too; a good one saves.
  await d.getByLabel("Billing page").fill("http://insecure.example.com");
  await d.getByRole("button", { name: "Add service" }).click();
  await d.getByText(/must start with https|starts with https/).first().waitFor();
  await d.getByLabel("Billing page").fill("https://supabase.com/dashboard");
  await d.getByRole("button", { name: "Add service" }).click();
  await d.waitFor({ state: "detached" });
  assert.equal((await snap(page)).services.length, 1);
}));

test("services: a cancelled service keeps its history, and stops counting in a month it was not billed", () => withApp(async ({ page }) => {
  await nav(page, "Services");
  const firebase = await addServiceViaUi(page, { preset: "Firebase / Google Cloud", fee: "10" });
  await firebase.getByRole("button", { name: "Add service" }).click();
  const github = await addServiceViaUi(page, { preset: "GitHub", fee: "4" });
  await github.getByRole("button", { name: "Add service" }).click();
  await page.getByText("$14 expected in June").waitFor();
  const box = page.getByLabel("Record Firebase / Google Cloud's bill for June 2026");
  await box.fill("12.50");
  await box.press("Enter");
  await page.getByText("$16.50 expected in June").waitFor();

  // GitHub was never billed this month: cancelling it takes its usual fee out of the total.
  await page.getByRole("button", { name: "GitHub", exact: true }).click();
  const edit = dialog(page, "Edit service");
  await edit.getByLabel(/I have cancelled this service/).check();
  await edit.getByRole("button", { name: "Save" }).click();
  await edit.waitFor({ state: "detached" });
  await page.getByText("$12.50 expected in June").waitFor();
  await page.getByRole("heading", { name: /^Cancelled/ }).waitFor();
  await page.getByText("never charged").waitFor();

  // Firebase was billed $12.50: it is cancelled, shown as history, and the money it already cost stays in June.
  await page.getByRole("button", { name: "Firebase / Google Cloud", exact: true }).click();
  const again = dialog(page, "Edit service");
  await again.getByText("Recorded bills").waitFor();
  await again.getByText("$12.50").waitFor();
  await again.getByLabel(/I have cancelled this service/).check();
  await again.getByRole("button", { name: "Save" }).click();
  await again.waitFor({ state: "detached" });
  await page.getByText("last charged $12.50 in June 2026").waitFor();
  await page.getByText("$12.50 expected in June · 0 services").waitFor();
  assert.equal((await snap(page)).serviceCharges.length, 1);

  // Deleting a service asks first, and takes its bills with it.
  await page.getByRole("button", { name: "Firebase / Google Cloud", exact: true }).click();
  await dialog(page, "Edit service").getByRole("button", { name: "Delete", exact: true }).click();
  await dialog(page, "Delete this service?").getByRole("button", { name: "Delete service" }).click();
  await page.getByText("last charged $12.50 in June 2026").waitFor({ state: "detached" });
  const after = await snap(page);
  assert.equal(after.services.length, 1);   // GitHub remains, cancelled
  assert.equal(after.serviceCharges.length, 0);
}));

test("services: the token box connects without submitting the form, checks the token before sending it, and never shows one back", () => withApp(async ({ page }) => {
  await nav(page, "Services");
  const d = await addServiceViaUi(page, { preset: "Vercel" });
  await d.getByText(/Wagonwheel needs a Vercel token/).waitFor();

  // A token that cannot be one is refused on this Mac, before anything is sent anywhere. Enter must not save the service.
  const token = d.getByLabel("Vercel token");
  await token.fill("short");
  await token.press("Enter");
  await d.getByText(/does not look like a Vercel token/).waitFor();
  assert.equal(await dialog(page, "Add a service").count(), 1, "the form is still open");
  assert.equal((await snap(page)).services.length, 0, "Enter in the token box did not save the service");

  // The window has no way to read a token back: the API offers a status, nothing more.
  const api = await page.evaluate(() => Object.keys(window.wagonwheel).filter((k) => /token|secret|credential/i.test(k)));
  assert.deepEqual(api.sort(), ["servicesClearToken", "servicesSetToken"]);
  const status = await page.evaluate(() => window.wagonwheel.servicesStatus());
  assert.deepEqual(Object.keys(status).sort(), ["canKeepToken", "providers"]);
  assert.deepEqual(Object.keys(status.providers[0]).sort(), ["connected", "provider", "teamId"]);

  // Reading bills for a service with no source, or with Vercel not connected, says so.
  await d.getByRole("button", { name: "Add service" }).click();
  await d.waitFor({ state: "detached" });
  const id = (await snap(page)).services[0].id;
  const said = await page.evaluate((sid) => window.wagonwheel.servicesCheckUsage(sid).catch((e) => e.message), id);
  assert.match(said, /Connect Vercel first/);
}));

test("services: the new screen's data survives a restart and reaches the exports", () => {
  const dataDir = tempDir("services");
  return withApp(async ({ page }) => {
    await page.evaluate(async () => {
      const { id } = await window.wagonwheel.createService({ name: "Vercel", kind: "usage", provider: "vercel", amountCents: 2000, billingDay: 5, billingUrl: "https://vercel.com/account/billing" });
      await window.wagonwheel.setServiceCharge({ serviceId: id, month: "2026-05", amountCents: 1975 });
    });
  }, { dataDir }).then(() => withApp(async ({ page }) => {
    const s = await snap(page);
    assert.equal(s.services[0].name, "Vercel");
    assert.deepEqual(s.serviceCharges.map((c) => [c.month, c.amountCents]), [["2026-05", 1975]]);
    await nav(page, "Services");
    await page.getByText("$20 expected in June").waitFor();
    // The database itself holds both tables, at version 4 (where the paid flag arrived) or later.
    const db = new DatabaseSync(path.join(dataDir, "wagonwheel.db"), { readOnly: true });
    assert.ok(Number(db.prepare("PRAGMA user_version").get().user_version) >= 4);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM service_charges").get().n), 1);
    db.close();
  }, { dataDir }));
});

test("services: Claude Code records a bill through the connector, the open window follows, and a different figure is not replaced by accident", () => withApp(async ({ page, dataDir }) => {
  await page.evaluate(async () => {
    const { id } = await window.wagonwheel.createService({ name: "Vercel", kind: "usage", amountCents: 2000 });
    await window.wagonwheel.setServiceCharge({ serviceId: id, month: "2026-06", amountCents: 5500 });
    await window.wagonwheel.createService({ name: "GitHub", kind: "flat", amountCents: 424 });
  });
  await page.reload();   // made through the raw API, behind the window's back: let the window read it
  await page.waitForSelector('[aria-label="Sidebar"]');
  await nav(page, "Services");
  await page.getByText("A bill is higher than usual in June 2026").waitFor();

  const mcp = startConnector(dataDir);
  try {
    await mcp.handshake();
    // A different figure than the one already there is refused, in words, and the window is untouched.
    const refused = await mcp.call("record_service_bill", { service: "Vercel", month: "2026-06", amount_usd: 21.2 });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /already has \$55\.00 recorded for 2026-06 \(typed in\)/);
    assert.equal((await snap(page)).serviceCharges[0].amountCents, 5500);

    // Told to replace, it lands, and the open window follows by itself: the warning goes and the new figure shows.
    const done = await mcp.call("record_service_bill", { service: "Vercel", month: "2026-06", amount_usd: 21.2, replace: true });
    assert.equal(done.isError, false);
    assert.deepEqual(done.json.recorded.replaced, { amount_usd: 55, source: "typed in" });
    await page.getByText("A bill is higher than usual in June 2026").waitFor({ state: "detached", timeout: 15_000 });
    await page.getByText("$21.20").first().waitFor({ timeout: 15_000 });
    assert.equal((await snap(page)).serviceCharges[0].amountCents, 2120);

    // An invoice that is owed is recorded as unpaid: the open window shows it as owed, and recording it paid clears it.
    await mcp.call("record_service_bill", { service: "GitHub", month: "2026-06", amount_usd: 4.24, paid: false });
    await page.getByText("1 unpaid bill, listed below").waitFor({ timeout: 15_000 });
    assert.deepEqual((await snap(page)).serviceCharges.filter((c) => !c.paid).map((c) => [c.month, c.amountCents]), [["2026-06", 424]]);
    const paidNow = await mcp.call("record_service_bill", { service: "GitHub", month: "2026-06", amount_usd: 4.24 });
    assert.equal(paidNow.json.recorded.marked_paid, true);
    await page.getByText("nothing unpaid").waitFor({ timeout: 15_000 });

    // A bill for a month that has not started, or a service that does not exist, is refused.
    assert.match((await mcp.call("record_service_bill", { service: "Vercel", month: "2999-01", amount_usd: 1 })).text, /has not started yet/);
    assert.match((await mcp.call("record_service_bill", { service: "Nope", month: "2026-06", amount_usd: 1 })).text, /No service matches/);
    assert.equal((await snap(page)).serviceCharges.length, 2);   // Vercel's and GitHub's, nothing from the refused calls
  } finally {
    mcp.stop();
  }
}));

test("services: an unpaid bill is owed and not spent, can be marked paid, and a year is estimated from the usual fees", () => withApp(async ({ page }) => {
  await nav(page, "Services");
  const vercel = await addServiceViaUi(page, { preset: "Vercel", fee: "20" });
  await vercel.getByRole("button", { name: "Add service" }).click();
  const github = await addServiceViaUi(page, { preset: "GitHub", fee: "4" });
  await github.getByRole("button", { name: "Add service" }).click();

  // Nothing recorded yet: nothing owed, nothing spent, and a year from the two usual fees ($24 a month).
  await page.getByText("nothing unpaid").waitFor();
  await page.getByText("no paid bills recorded yet").waitFor();
  await page.getByText("~$288").waitFor();
  await page.getByText("about $24 a month").waitFor();

  // A bill that is billed but not paid: owed, listed, counted in the month, and not spent.
  await page.getByLabel("Is Vercel's June 2026 bill paid?").selectOption("unpaid");
  const box = page.getByLabel("Record Vercel's bill for June 2026");
  await box.fill("21.20");
  await box.press("Enter");
  await page.getByText("1 unpaid bill, listed below").waitFor();
  await page.getByRole("heading", { name: /^Owed/ }).waitFor();
  await page.getByText("billed, not paid").waitFor();
  await page.getByText("no paid bills recorded yet").waitFor();   // still nothing spent
  assert.deepEqual((await snap(page)).serviceCharges.map((c) => [c.amountCents, c.paid]), [[2120, false]]);
  const pill = page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Services/ }).locator("span").last();
  assert.match(await pill.getAttribute("class"), /bg-crimson/, "the sidebar count is red while a bill is owed");

  // A paid bill is spent, with its own total on its row.
  await page.getByLabel("Record GitHub's bill for June 2026").fill("4.24");
  await page.getByLabel("Record GitHub's bill for June 2026").press("Enter");
  await page.getByText("1 paid bill since June 2026").waitFor();
  await page.getByText("$4.24 paid so far · 1 bill").waitFor();

  // Marking the owed bill paid moves it from owed to spent.
  await page.getByRole("button", { name: "Mark paid" }).first().click();
  await page.getByText("nothing unpaid").waitFor();
  await page.getByText("2 paid bills since June 2026").waitFor();
  await page.getByText("$21.20 paid so far · 1 bill").waitFor();
  await page.getByRole("heading", { name: /^Owed/ }).waitFor({ state: "detached" });
  assert.deepEqual((await snap(page)).serviceCharges.map((c) => c.paid), [true, true]);
}));

test("services: only a service named like Vercel can be linked to Vercel, in the dialog and through the API", () => withApp(async ({ page }) => {
  await nav(page, "Services");
  const d = await addServiceViaUi(page, { preset: "Supabase" });
  const choose = d.getByLabel("Check usage automatically");
  assert.equal(await choose.locator('option[value="vercel"]').isDisabled(), true, "Supabase cannot pick Vercel");
  await d.getByText(/Only a service named like Vercel can check its usage on Vercel/).first().waitFor();

  // Forcing it past the dialog is refused by the data layer, and nothing is saved.
  const refused = await page.evaluate(() => window.wagonwheel.createService({ name: "Supabase", provider: "vercel" }).then(() => "saved", (e) => e.message));
  assert.match(refused, /Only a service named like Vercel can check its usage on Vercel/);
  assert.equal((await snap(page)).services.length, 0);

  // The Vercel preset can pick it.
  await d.getByRole("button", { name: "Vercel", exact: true }).click();
  assert.equal(await choose.locator('option[value="vercel"]').isDisabled(), false, "a service named Vercel can");
  assert.equal(await choose.inputValue(), "vercel");
}));

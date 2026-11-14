import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/database.js";
import { Workspace } from "../db/repo.js";
import { createMcpServer } from "./protocol.js";
import { buildTools } from "./tools.js";

// Every tool, driven the way Claude Code drives them: a tools/call message in, a result out,
// against a real (in-memory) workspace.

let ws: Workspace;
let db: DatabaseSync;
let clock: number;
let n: number;
let server: ReturnType<typeof createMcpServer>;

const NOW = new Date(2026, 5, 1, 10, 0, 0);   // 2026-06-01, local

const start = (readOnly = false) => {
  db = openDatabase(":memory:");
  ws = new Workspace(db, () => (clock += 1000), () => `id-${++n}`);
  server = createMcpServer({ name: "t", version: "1", tools: buildTools(ws, { readOnly, now: () => NOW }), log: () => {} });
};
beforeEach(() => { clock = 1_000_000; n = 0; start(); });

interface Reply { isError: boolean; text: string; json: any }   // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown> = {}): Promise<Reply> {
  const r = (await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as { result?: { content: { text: string }[]; isError: boolean }; error?: { message: string } };
  if (!r.result) throw new Error(r.error?.message ?? "no result");
  const text = r.result.content[0].text;
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* an error message is plain text */ }
  return { isError: r.result.isError, text, json };
}

/** A believable workspace, dated around 2026-06-01. */
function seed() {
  const wagon = ws.createProject({ name: "Wagonwheel", description: "The project manager", startDate: "2026-05-01", targetDate: "2026-07-01", githubRepo: "gageabass-jpg/wagonwheel" }).id;
  const house = ws.createProject({ name: "House", status: "planning" }).id;
  const old = ws.createProject({ name: "Old thing" }).id;
  ws.updateProject(old, { archived: true });
  const t = (title: string, over: Record<string, unknown> = {}) => ws.createTask({ title, ...over }).id;
  const overdue = t("Ship the beta", { projectId: wagon, dueDate: "2026-05-28", priority: "high" });
  const soon = t("Write the README", { projectId: wagon, dueDate: "2026-06-04", priority: "low" });
  const later = t("Plan the launch", { projectId: wagon, dueDate: "2026-07-15" });
  const doing = t("Build the dialog", { projectId: wagon, status: "in_progress", dueDate: "2026-06-03", description: "Needs a spinner and a code box" });
  const done = t("Pick a name", { projectId: wagon, status: "done", dueDate: "2026-05-02" });
  const sub = t("Draft the intro", { parentId: soon, dueDate: "2026-06-02" });
  const paint = t("Paint the hall", { projectId: house });
  const loose = t("Call the plumber", { priority: "high" });
  const archivedTask = t("Archived work", { projectId: old, dueDate: "2026-05-01" });
  ws.createMilestone({ projectId: wagon, name: "Beta", targetDate: "2026-06-10", description: "First build for friends" });
  ws.createMilestone({ projectId: wagon, name: "Launch", targetDate: "2026-09-01" });
  ws.createMilestone({ projectId: wagon, name: "Kick-off", targetDate: "2026-05-01", completed: true });
  ws.createMilestone({ projectId: old, name: "Archived milestone", targetDate: "2026-06-05" });
  ws.createNote({ projectId: wagon, body: "Keep it local-first." });
  ws.createNote({ taskId: doing, body: "Use the orbit loader." });
  return { wagon, house, old, overdue, soon, later, doing, done, sub, paint, loose, archivedTask };
}

describe("the tool list", () => {
  it("has the read tools and the write tools, and no delete tool", async () => {
    const r = (await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] } };
    const names = r.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_overview", "list_projects", "get_project", "list_tasks", "list_services", "get_task", "create_task", "update_task", "complete_task", "create_project", "update_project", "create_milestone", "update_milestone", "add_note", "record_service_bill"]));
    expect(names.filter((x) => /delete|remove|destroy/i.test(x))).toEqual([]);
    for (const t of r.result.tools) expect(t.annotations?.readOnlyHint).toBe(/^(get|list)_/.test(t.name));
  });

  it("leaves out every write tool when read-only, and refuses a call to one", async () => {
    start(true);
    const r = (await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string }[] } };
    expect(r.result.tools.map((t) => t.name).sort()).toEqual(["get_overview", "get_project", "get_task", "list_projects", "list_services", "list_tasks"]);
    const refused = (await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_task", arguments: { title: "x" } } })) as { error: { code: number } };
    expect(refused.error.code).toBe(-32602);
    expect(ws.snapshot().tasks).toHaveLength(0);
  });
});

describe("list_services", () => {
  /** Services and bills around 2026-06 (the fixed "today" is 2026-06-01). */
  function seedServices() {
    const mk = (s: Record<string, unknown>, bills: Record<string, number> = {}) => {
      const id = ws.createService({ name: "x", ...s } as never).id;
      for (const [month, cents] of Object.entries(bills)) ws.setCharge({ serviceId: id, month, amountCents: cents });
      return id;
    };
    mk({ name: "Supabase", plan: "Pro", kind: "usage", amountCents: 2500, billingDay: 12, billingUrl: "https://supabase.com/dashboard" }, { "2026-05": 2500, "2026-06": 2740 });
    mk({ name: "Vercel", kind: "usage", provider: "vercel", amountCents: 2000 }, { "2026-05": 2000 });
    mk({ name: "GitHub", kind: "flat", amountCents: 400, billingDay: 20 });
    mk({ name: "Firebase / Google Cloud", kind: "usage", amountCents: 1000 }, { "2026-05": 1200, "2026-06": 15000 });
    mk({ name: "Old hosting", amountCents: 900, status: "cancelled" }, { "2026-05": 900 });
  }
  const names = (json: { services: { name: string }[] }): string[] => json.services.map((s) => s.name);

  it("adds up the month, compares it with last month, and says which figures are estimates", async () => {
    seedServices();
    const { json } = await call("list_services");
    expect(json).toMatchObject({ month: "2026-06", previous_month: "2026-05", total_usd: 201.4, previous_month_total_usd: 70, change_usd: 131.4, estimated_count: 2 });
    // biggest first; the cancelled service was not billed this month, so it is left out
    expect(names(json)).toEqual(["Firebase / Google Cloud", "Supabase", "Vercel", "GitHub"]);
    const by = Object.fromEntries(json.services.map((s: { name: string }) => [s.name, s]));
    expect(by["Supabase"]).toMatchObject({ plan: "Pro", type: "usage-based", usual_monthly_usd: 25, amount_usd: 27.4, amount_basis: "recorded", bills_on_day: 12, next_bill_date: "2026-06-12", billing_page: "https://supabase.com/dashboard" });
    expect(by["Vercel"]).toMatchObject({ amount_usd: 20, amount_basis: "estimate: the usual fee, not billed yet", checks_usage_on: "Vercel", usage_last_checked: null });
    expect(by["GitHub"]).toMatchObject({ type: "flat fee", amount_usd: 4, next_bill_date: "2026-06-20" });
  });

  it("flags a bill that is notably higher than usual, and only that one", async () => {
    seedServices();
    const { json } = await call("list_services");
    expect(json.higher_than_usual).toEqual([{ service: "Firebase / Google Cloud", by_usd: 140 }]);   // +$2.40 on Supabase is not an alarm
    const fire = json.services.find((s: { name: string }) => s.name === "Firebase / Google Cloud");
    expect(fire.higher_than_usual_by_usd).toBe(140);
    expect(json.services.find((s: { name: string }) => s.name === "Supabase").higher_than_usual_by_usd).toBeUndefined();
  });

  it("answers for another month, and lists a cancelled service in a month it was billed", async () => {
    seedServices();
    const { json } = await call("list_services", { month: "2026-05" });
    expect(json).toMatchObject({ month: "2026-05", previous_month: "2026-04", total_usd: 70, estimated_count: 1 });   // GitHub was never recorded: the usual fee stands in
    expect(names(json)).toContain("Old hosting");
    expect(json.services.find((s: { name: string }) => s.name === "Old hosting")).toMatchObject({ status: "cancelled", amount_usd: 9, amount_basis: "recorded", next_bill_date: null });
  });

  it("lists cancelled services on request", async () => {
    seedServices();
    expect(names((await call("list_services", { include_cancelled: true })).json)).toContain("Old hosting");
  });

  it("reports what is owed, what has been spent (paid only, per service), and a yearly estimate", async () => {
    seedServices();
    const sb = ws.snapshot().services.find((s) => s.name === "Supabase")!.id;
    ws.setCharge({ serviceId: sb, month: "2026-06", amountCents: 3465, paid: false });   // an invoice that is owed, in place of the typed $27.40
    const { json } = await call("list_services");

    expect(json.owed_now_usd).toBe(34.65);
    expect(json.unpaid_bills).toEqual([{ service: "Supabase", month: "2026-06", amount_usd: 34.65 }]);
    expect(json.services.find((s: { name: string }) => s.name === "Supabase")).toMatchObject({ amount_usd: 34.65, amount_basis: "recorded, unpaid", paid: false });
    expect(json.total_usd).toBe(208.65);   // the unpaid bill counts toward the month: 34.65 + 20 + 4 + 150

    // paid bills only: Supabase 25 (May), Vercel 20, Firebase 12 + 150, Old hosting 9. The unpaid $34.65 is owed, not spent.
    expect(json.spent_so_far).toEqual({ total_usd: 216, paid_bills: 5, since: "2026-05" });
    expect(json.services.find((s: { name: string }) => s.name === "Supabase").spent_so_far_usd).toBe(25);
    expect(json.services.find((s: { name: string }) => s.name === "Firebase / Google Cloud").spent_so_far_usd).toBe(162);

    // 25 + 20 + 4 + 10 of usual fees a month; the cancelled service is not part of a future year
    expect(json.yearly_estimate).toMatchObject({ monthly_usd: 59, yearly_usd: 708 });
    expect(json.yearly_estimate.based_on.map((r: { service: string; basis: string }) => [r.service, r.basis])).toEqual([["Supabase", "usual fee"], ["Vercel", "usual fee"], ["Firebase / Google Cloud", "usual fee"], ["GitHub", "usual fee"]]);
    expect(json.yearly_estimate.not_included).toBeUndefined();
  });

  it("owes nothing when every bill is paid, and says which services a yearly estimate could not include", async () => {
    ws.createService({ name: "Google Workspace" });
    const vc = ws.createService({ name: "Vercel", amountCents: 2120 }).id;
    ws.setCharge({ serviceId: vc, month: "2026-05", amountCents: 2120 });
    const { json } = await call("list_services");
    expect(json.owed_now_usd).toBe(0);
    expect(json.unpaid_bills).toEqual([]);
    expect(json.yearly_estimate).toMatchObject({ monthly_usd: 21.2, yearly_usd: 254.4, not_included: ["Google Workspace"] });
  });

  it("says plainly when fees are not set yet, instead of inventing a total", async () => {
    ws.createService({ name: "Supabase", kind: "usage" });
    ws.createService({ name: "GitHub" });
    const { json } = await call("list_services");
    expect(json.total_usd).toBe(0);
    expect(json.services.map((s: { amount_usd: number | null }) => s.amount_usd)).toEqual([null, null]);
    expect(json.services[0].amount_basis).toBe("no fee set and nothing recorded");
    expect(json.note).toContain("GitHub, Supabase have no usual fee set");
    expect(json.previous_month_total_usd).toBeNull();
  });

  it("is empty, not an error, with no services; and refuses a bad month", async () => {
    expect((await call("list_services")).json).toMatchObject({ total_usd: 0, count: 0, services: [], higher_than_usual: [] });
    const bad = await call("list_services", { month: "June 2026" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('"month" must look like 2026-11');
  });

  it("is a read-only tool, and is offered in read-only mode", async () => {
    start(true);
    seedServices();
    const r = await call("list_services");
    expect(r.isError).toBe(false);
    expect(r.json.count).toBe(4);
    expect(ws.snapshot().services).toHaveLength(5);   // nothing changed
  });
});

describe("record_service_bill", () => {
  let gh: string;
  let sb: string;
  beforeEach(() => {
    gh = ws.createService({ name: "GitHub", kind: "flat", amountCents: 400 }).id;
    sb = ws.createService({ name: "Supabase", kind: "usage", amountCents: 2500 }).id;
  });
  const charges = () => ws.snapshot().serviceCharges.map((c) => [c.month, c.amountCents, c.source]);

  it("records a bill by service name, and answers with the month as it now stands", async () => {
    const r = await call("record_service_bill", { service: "github", month: "2026-05", amount_usd: 4 });   // the name is matched without regard to case
    expect(r.isError).toBe(false);
    expect(r.json.recorded).toEqual({ service: "GitHub", month: "2026-05", amount_usd: 4 });
    expect(r.json.service).toMatchObject({ name: "GitHub", amount_usd: 4, amount_basis: "recorded" });
    expect(r.json.month_total_usd).toBe(29);   // GitHub's $4 recorded + Supabase's $25 usual fee standing in
    expect(charges()).toEqual([["2026-05", 400, "manual"]]);
  });

  it("finds a service by id as well, and takes cents", async () => {
    await call("record_service_bill", { service: sb, month: "2026-06", amount_usd: 27.4 });
    expect(charges()).toEqual([["2026-06", 2740, "manual"]]);
    await call("record_service_bill", { service: sb, month: "2026-05", amount_usd: 4.35 });   // 4.35 * 100 is 434.99999999999994 in floating point
    expect(charges()).toContainEqual(["2026-05", 435, "manual"]);
  });

  it("flags the bill it just recorded when it is far above usual", async () => {
    const r = await call("record_service_bill", { service: "Supabase", month: "2026-06", amount_usd: 60 });
    expect(r.json.service.higher_than_usual_by_usd).toBe(35);
  });

  it("changes nothing when the same figure is recorded again, and says so", async () => {
    await call("record_service_bill", { service: "GitHub", month: "2026-05", amount_usd: 4 });
    const again = await call("record_service_bill", { service: "GitHub", month: "2026-05", amount_usd: 4 });
    expect(again.isError).toBe(false);
    expect(again.json.recorded).toEqual({ service: "GitHub", month: "2026-05", amount_usd: 4, already_recorded: true });
    expect(charges()).toHaveLength(1);
  });

  it("will not replace a different figure unless told to, and says what was there", async () => {
    await call("record_service_bill", { service: "GitHub", month: "2026-05", amount_usd: 4 });
    const refused = await call("record_service_bill", { service: "GitHub", month: "2026-05", amount_usd: 9 });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("GitHub already has $4.00 recorded for 2026-05 (typed in), which differs from $9.00");
    expect(refused.text).toContain("replace: true");
    expect(charges()).toEqual([["2026-05", 400, "manual"]]);

    const replaced = await call("record_service_bill", { service: "GitHub", month: "2026-05", amount_usd: 9, replace: true });
    expect(replaced.json.recorded).toEqual({ service: "GitHub", month: "2026-05", amount_usd: 9, replaced: { amount_usd: 4, source: "typed in" } });
    expect(charges()).toEqual([["2026-05", 900, "manual"]]);
  });

  it("also protects a figure that was read from the provider", async () => {
    // a bill an older version read from the provider (no code writes one now, but old workspaces can hold one)
    db.exec(`INSERT INTO service_charges (id, service_id, month, amount_cents, source, paid, created_at, updated_at) VALUES ('old', '${gh}', '2026-05', 2000, 'vercel', 1, 1, 1)`);
    const refused = await call("record_service_bill", { service: "GitHub", month: "2026-05", amount_usd: 3 });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("read from Vercel");
    expect(charges()).toEqual([["2026-05", 2000, "vercel"]]);
  });

  it("refuses a bad amount in words, and records nothing", async () => {
    const msg = async (amount_usd: unknown) => { const r = await call("record_service_bill", { service: "GitHub", month: "2026-05", amount_usd }); return r.isError ? r.text : "recorded"; };
    expect(await msg(-4)).toContain("cannot be negative");
    expect(await msg(4.005)).toContain("at most two decimal places");
    expect(await msg("4.00")).toContain("must be a number of US dollars");
    expect(await msg(null)).toContain("must be a number of US dollars");
    expect(await msg(Number.NaN)).toContain("must be a number of US dollars");
    expect(await msg(2_000_000)).toContain("too large");
    expect(charges()).toEqual([]);
  });

  it("refuses an unknown service, with a suggestion", async () => {
    const r = await call("record_service_bill", { service: "Vercell", month: "2026-05", amount_usd: 20 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No service matches "Vercell"');
    const near = await call("record_service_bill", { service: "Hub", month: "2026-05", amount_usd: 20 });
    expect(near.text).toContain("Did you mean: GitHub");
    expect(charges()).toEqual([]);
  });

  it("refuses a bad month and a month that has not started", async () => {
    const bad = await call("record_service_bill", { service: "GitHub", month: "May 2026", amount_usd: 4 });
    expect(bad.text).toContain('"month" must look like 2026-11');
    const future = await call("record_service_bill", { service: "GitHub", month: "2026-07", amount_usd: 4 });   // the fixed "today" is 2026-06-01
    expect(future.isError).toBe(true);
    expect(future.text).toContain("2026-07 has not started yet (this month is 2026-06)");
    expect((await call("record_service_bill", { service: "GitHub", month: "2026-06", amount_usd: 4 })).isError).toBe(false);   // this month is fine
    expect(charges()).toEqual([["2026-06", 400, "manual"]]);
  });

  it("records a bill for a cancelled service, so its history is complete", async () => {
    ws.updateService(gh, { status: "cancelled" });
    const r = await call("record_service_bill", { service: "GitHub", month: "2026-05", amount_usd: 4 });
    expect(r.isError).toBe(false);
    expect(r.json.service.status).toBe("cancelled");
  });

  it("records an invoice that is owed as unpaid, and it counts toward what is owed until it is paid", async () => {
    const r = await call("record_service_bill", { service: "Supabase", month: "2026-06", amount_usd: 34.65, paid: false });
    expect(r.isError).toBe(false);
    expect(r.json.recorded).toEqual({ service: "Supabase", month: "2026-06", amount_usd: 34.65, paid: false });
    expect(r.json.service).toMatchObject({ amount_basis: "recorded, unpaid", paid: false });
    expect(ws.snapshot().serviceCharges.map((c) => [c.month, c.amountCents, c.paid])).toEqual([["2026-06", 3465, false]]);
    expect((await call("list_services")).json.owed_now_usd).toBe(34.65);
  });

  it("marks an unpaid bill paid when the same amount is recorded as paid, with no replace needed", async () => {
    await call("record_service_bill", { service: "Supabase", month: "2026-06", amount_usd: 34.65, paid: false });
    const r = await call("record_service_bill", { service: "Supabase", month: "2026-06", amount_usd: 34.65 });
    expect(r.isError).toBe(false);
    expect(r.json.recorded).toEqual({ service: "Supabase", month: "2026-06", amount_usd: 34.65, marked_paid: true });
    expect(ws.snapshot().serviceCharges.map((c) => c.paid)).toEqual([true]);
    expect((await call("list_services")).json.owed_now_usd).toBe(0);
  });

  it("will not mark a paid bill unpaid, or change an unpaid bill's amount, without replace", async () => {
    await call("record_service_bill", { service: "GitHub", month: "2026-05", amount_usd: 4.24 });
    const unpay = await call("record_service_bill", { service: "GitHub", month: "2026-05", amount_usd: 4.24, paid: false });
    expect(unpay.isError).toBe(true);
    expect(unpay.text).toContain("is recorded as paid");
    expect(ws.snapshot().serviceCharges[0].paid).toBe(true);
    expect((await call("record_service_bill", { service: "GitHub", month: "2026-05", amount_usd: 4.24, paid: false, replace: true })).json.recorded).toEqual({ service: "GitHub", month: "2026-05", amount_usd: 4.24, paid: false, marked_unpaid: true });

    await call("record_service_bill", { service: "Supabase", month: "2026-05", amount_usd: 25, paid: false });
    const diff = await call("record_service_bill", { service: "Supabase", month: "2026-05", amount_usd: 34.65 });
    expect(diff.isError).toBe(true);
    expect(diff.text).toContain("(typed in, unpaid)");
  });

  it("recording the same unpaid bill twice changes nothing", async () => {
    await call("record_service_bill", { service: "Supabase", month: "2026-06", amount_usd: 34.65, paid: false });
    const again = await call("record_service_bill", { service: "Supabase", month: "2026-06", amount_usd: 34.65, paid: false });
    expect(again.json.recorded).toEqual({ service: "Supabase", month: "2026-06", amount_usd: 34.65, paid: false, already_recorded: true });
    expect(charges()).toHaveLength(1);
  });

  it("is a write tool: marked as such, and left out when the connector is read-only", async () => {
    const list = (await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[] } };
    expect(list.result.tools.find((t) => t.name === "record_service_bill")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    start(true);
    const refused = (await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "record_service_bill", arguments: { service: "x", month: "2026-05", amount_usd: 1 } } })) as { error: { code: number } };
    expect(refused.error.code).toBe(-32602);
    expect(ws.snapshot().serviceCharges).toHaveLength(0);
  });
});

describe("get_overview", () => {
  it("says what needs attention, soonest first, leaving out done work and archived projects", async () => {
    seed();
    const { json } = await call("get_overview");
    expect(json.today).toBe("2026-06-01");
    expect(json.counts).toEqual({ active_projects: 1, projects: 2, open_tasks: 7, overdue: 1, due_in_next_7_days: 3, in_progress: 1, inbox: 1 });
    expect(json.overdue.map((t: { title: string }) => t.title)).toEqual(["Ship the beta"]);
    expect(json.overdue[0]).toMatchObject({ overdue: true, priority: "high", project: "Wagonwheel" });
    expect(json.due_in_next_7_days.map((t: { title: string }) => t.title)).toEqual(["Draft the intro", "Build the dialog", "Write the README"]);
    expect(json.in_progress.map((t: { title: string }) => t.title)).toEqual(["Build the dialog"]);
    expect(json.milestones_within_30_days.map((m: { name: string }) => m.name)).toEqual(["Beta"]);
    expect(json.milestones_within_30_days[0]).toMatchObject({ project: "Wagonwheel", target_date: "2026-06-10", days_left: 9 });
    expect(JSON.stringify(json)).not.toContain("Archived");
  });

  it("works on an empty workspace", async () => {
    const { json } = await call("get_overview");
    expect(json.counts).toEqual({ active_projects: 0, projects: 0, open_tasks: 0, overdue: 0, due_in_next_7_days: 0, in_progress: 0, inbox: 0 });
  });
});

describe("list_projects and get_project", () => {
  it("lists live projects with their progress, the repository, and filters", async () => {
    seed();
    const all = (await call("list_projects")).json;
    expect(all.projects.map((p: { name: string }) => p.name)).toEqual(["Wagonwheel", "House"]);
    expect(all.projects[0]).toMatchObject({ status: "active", github_repo: "gageabass-jpg/wagonwheel", tasks: { total: 5, done: 1, open: 4 } });
    expect((await call("list_projects", { include_archived: true })).json.count).toBe(3);
    expect((await call("list_projects", { status: "planning" })).json.projects.map((p: { name: string }) => p.name)).toEqual(["House"]);
    expect((await call("list_projects", { status: "nope" })).text).toContain('"status" must be one of');
  });

  it("opens a project by name (any case) or id, with tasks, milestones and notes", async () => {
    const ids = seed();
    for (const ref of ["wagonwheel", "WAGONWHEEL", ids.wagon]) {
      const { json } = await call("get_project", { project: ref });
      expect(json.name).toBe("Wagonwheel");
      expect(json.tasks.map((t: { title: string }) => t.title)).toEqual(["Ship the beta", "Build the dialog", "Write the README", "Plan the launch", "Pick a name"]);   // open first, soonest first, done last
      expect(json.tasks.find((t: { title: string }) => t.title === "Write the README").subtasks).toBe(1);
      expect(json.milestones.map((m: { name: string }) => m.name)).toEqual(["Kick-off", "Beta", "Launch"]);   // by target date
      expect(json.notes.map((x: { body: string }) => x.body)).toEqual(["Keep it local-first."]);
    }
  });

  it("explains a project it cannot find, and one that is ambiguous", async () => {
    seed();
    expect((await call("get_project", { project: "Wagon" })).text).toBe('No project matches "Wagon". Did you mean: Wagonwheel (id-1)?');
    expect((await call("get_project", { project: "Nothing" })).text).toBe('No project matches "Nothing".');
    ws.createProject({ name: "house" });
    const r = await call("get_project", { project: "HOUSE" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('More than one project is named "HOUSE"');
    expect((await call("get_project", {})).text).toBe('"project" is required.');
  });
});

describe("list_tasks", () => {
  const titles = async (args: Record<string, unknown> = {}) => (await call("list_tasks", args)).json.tasks.map((t: { title: string }) => t.title);

  it("by default lists open top-level tasks in visible projects, soonest due first", async () => {
    seed();
    // dated ones by day, then the undated by priority (the plumber is high, the hall medium)
    expect(await titles()).toEqual(["Ship the beta", "Build the dialog", "Write the README", "Plan the launch", "Call the plumber", "Paint the hall"]);
  });

  it("filters by project, inbox, status, priority, overdue, dates, text and subtasks", async () => {
    seed();
    expect(await titles({ project: "House" })).toEqual(["Paint the hall"]);
    expect(await titles({ inbox: true })).toEqual(["Call the plumber"]);
    expect(await titles({ status: "done" })).toEqual(["Pick a name"]);
    expect(await titles({ status: "in_progress" })).toEqual(["Build the dialog"]);
    expect(await titles({ status: "all", project: "Wagonwheel" })).toHaveLength(5);
    expect(await titles({ priority: "high" })).toEqual(["Ship the beta", "Call the plumber"]);
    expect(await titles({ overdue: true })).toEqual(["Ship the beta"]);
    expect(await titles({ due_before: "2026-06-04" })).toEqual(["Ship the beta", "Build the dialog", "Write the README"]);
    expect(await titles({ due_after: "2026-06-04" })).toEqual(["Write the README", "Plan the launch"]);
    expect(await titles({ query: "SPINNER" })).toEqual(["Build the dialog"]);
    expect(await titles({ include_subtasks: true, due_before: "2026-06-02" })).toEqual(["Ship the beta", "Draft the intro"]);
  });

  it("caps the list and says how many matched", async () => {
    seed();
    const { json } = await call("list_tasks", { limit: 2 });
    expect(json).toMatchObject({ total: 6, shown: 2 });
    expect(json.tasks).toHaveLength(2);
  });

  it("shows a short preview of a description, and refuses a bad filter", async () => {
    seed();
    const dialog = (await call("list_tasks", { query: "dialog" })).json.tasks[0];
    expect(dialog.description_preview).toBe("Needs a spinner and a code box");
    expect("description" in dialog).toBe(false);
    expect((await call("list_tasks", { status: "bogus" })).isError).toBe(true);
    expect((await call("list_tasks", { limit: "ten" })).text).toBe('"limit" must be a whole number.');
    expect((await call("list_tasks", { overdue: "yes" })).text).toBe('"overdue" must be true or false.');
  });
});

describe("get_task", () => {
  it("returns the whole task with its subtasks and notes, found by id or by title", async () => {
    const ids = seed();
    for (const ref of [ids.doing, "build the dialog"]) {
      const { json } = await call("get_task", { task: ref });
      expect(json).toMatchObject({ id: ids.doing, title: "Build the dialog", status: "in_progress", description: "Needs a spinner and a code box" });
      expect(json.notes.map((x: { body: string }) => x.body)).toEqual(["Use the orbit loader."]);
    }
    expect((await call("get_task", { task: ids.soon })).json.subtasks.map((s: { title: string }) => s.title)).toEqual(["Draft the intro"]);
  });

  it("explains a task it cannot find, and one that is ambiguous", async () => {
    seed();
    expect((await call("get_task", { task: "nonsense" })).text).toBe('No task matches "nonsense". Use list_tasks to find its id.');
    ws.createTask({ title: "Twin" }); ws.createTask({ title: "twin" });
    expect((await call("get_task", { task: "TWIN" })).text).toContain('More than one task is titled "TWIN"');
  });
});

describe("create_task", () => {
  it("adds to the inbox, to a project (by name), or under another task", async () => {
    const ids = seed();
    const inbox = (await call("create_task", { title: "Water the plants" })).json.created;
    expect(inbox).toMatchObject({ title: "Water the plants", project: null, status: "not_started", priority: "medium" });
    const inProject = (await call("create_task", { title: "Review PR", project: "wagonwheel", priority: "high", due_date: "2026-06-09", description: "Look at the dialog" })).json.created;
    expect(inProject).toMatchObject({ project: "Wagonwheel", project_id: ids.wagon, priority: "high", due_date: "2026-06-09", description: "Look at the dialog" });
    const sub = (await call("create_task", { title: "Check tests", parent: inProject.id })).json.created;
    expect(sub).toMatchObject({ parent_id: inProject.id, project_id: ids.wagon });
    expect(ws.snapshot().tasks.filter((t) => t.title === "Review PR")).toHaveLength(1);
  });

  it("refuses what the app would refuse, in the app's words, and changes nothing", async () => {
    seed();
    const before = ws.snapshot().tasks.length;
    expect((await call("create_task", { title: "   " })).text).toBe("The task title cannot be empty.");
    expect((await call("create_task", { title: "x", due_date: "2026-02-30" })).text).toBe("The due date is not a valid date.");
    expect((await call("create_task", { title: "x", start_date: "2026-06-10", due_date: "2026-06-01" })).text).toBe("The start date is after the due date.");
    expect((await call("create_task", { title: "x", project: "No such project" })).isError).toBe(true);
    expect((await call("create_task", { title: "x", priority: "urgent" })).text).toContain('"priority" must be one of');
    expect((await call("create_task", {})).text).toBe('"title" is required.');
    expect((await call("create_task", { title: 12 })).text).toBe('"title" must be text.');
    expect(ws.snapshot().tasks).toHaveLength(before);
  });
});

describe("update_task and complete_task", () => {
  it("changes only what is given, clears a date with null, and moves between a project and the inbox", async () => {
    const ids = seed();
    const r = (await call("update_task", { task: ids.later, priority: "high", due_date: null, project: "House" })).json.updated;
    expect(r).toMatchObject({ title: "Plan the launch", priority: "high", due_date: null, project: "House" });
    expect((await call("update_task", { task: ids.later, project: null })).json.updated).toMatchObject({ project: null, project_id: null });
    expect((await call("update_task", { task: ids.later, title: "Plan it" })).json.updated.title).toBe("Plan it");
    expect(ws.snapshot().tasks.find((t) => t.id === ids.later)).toMatchObject({ priority: "high", projectId: null });   // the title change kept the rest
  });

  it("marks done with a completion time, and reopens", async () => {
    const ids = seed();
    const done = (await call("complete_task", { task: ids.paint })).json.updated;
    expect(done.status).toBe("done");
    expect(done.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const open = (await call("complete_task", { task: "Paint the hall", done: false })).json.updated;
    expect(open.status).toBe("not_started");
    expect("completed_at" in open).toBe(false);
  });

  it("explains a missing task or a bad value", async () => {
    seed();
    expect((await call("update_task", { task: "ghost", title: "x" })).isError).toBe(true);
    expect((await call("update_task", { task: "Paint the hall", status: "finished" })).text).toContain('"status" must be one of');
    expect((await call("update_task", { task: "Paint the hall", due_date: 5 })).text).toBe('"due_date" must be text, or null to clear it.');
  });
});

describe("projects", () => {
  it("creates a project and connects a repository", async () => {
    const { json } = await call("create_project", { name: "Garden", description: "Spring", status: "planning", target_date: "2026-09-01", github_repo: "gage/garden" });
    expect(json.created).toMatchObject({ name: "Garden", status: "planning", target_date: "2026-09-01", github_repo: "gage/garden", tasks: { total: 0, done: 0, open: 0 } });
  });

  it("updates, archives, and disconnects, and applies the one-repository-per-project rule", async () => {
    seed();
    expect((await call("update_project", { project: "House", description: "Renovation", target_date: "2026-12-01" })).json.updated).toMatchObject({ description: "Renovation", target_date: "2026-12-01", name: "House" });
    expect((await call("update_project", { project: "House", github_repo: "gageabass-jpg/wagonwheel" })).text).toContain('is already connected to the project "Wagonwheel"');
    expect((await call("update_project", { project: "Wagonwheel", github_repo: null })).json.updated.github_repo).toBeNull();
    expect((await call("update_project", { project: "House", github_repo: "gageabass-jpg/wagonwheel" })).json.updated.github_repo).toBe("gageabass-jpg/wagonwheel");
    expect((await call("update_project", { project: "House", archived: true })).json.updated.archived).toBe(true);
    expect((await call("list_projects")).json.projects.map((p: { name: string }) => p.name)).toEqual(["Wagonwheel"]);
    expect((await call("update_project", { project: "House", github_repo: "not a repo" })).text).toBe("The GitHub repository must look like owner/name.");
  });
});

describe("milestones and notes", () => {
  it("adds and completes a milestone, finding it by name and project", async () => {
    seed();
    const made = (await call("create_milestone", { project: "House", name: "Primer coat", target_date: "2026-06-20", description: "Hall first" })).json.created;
    expect(made).toMatchObject({ name: "Primer coat", project: "House", target_date: "2026-06-20", completed: false, days_left: 19 });
    const done = (await call("update_milestone", { milestone: "Primer coat", project: "House", completed: true })).json.updated;
    expect(done).toMatchObject({ completed: true });
    expect("days_left" in done).toBe(false);
    expect((await call("update_milestone", { milestone: made.id, target_date: "2026-07-01" })).json.updated.target_date).toBe("2026-07-01");
  });

  it("refuses a milestone with no valid date, and one it cannot find", async () => {
    seed();
    expect((await call("create_milestone", { project: "House", name: "x", target_date: "tomorrow" })).text).toBe("The target date is not a valid date.");
    expect((await call("create_milestone", { project: "House", name: "x" })).text).toBe('"target_date" is required.');
    expect((await call("update_milestone", { milestone: "Ghost" })).text).toBe('No milestone matches "Ghost".');
  });

  it("adds a note to a project or a task, and insists on one or the other", async () => {
    const ids = seed();
    expect((await call("add_note", { project: "House", body: "Pick colours" })).json.created).toMatchObject({ on: "project", body: "Pick colours" });
    expect((await call("add_note", { task: ids.paint, body: "Two coats" })).json.created.on).toBe("task");
    expect((await call("add_note", { body: "orphan" })).text).toBe('Give either "project" or "task", not both and not neither.');
    expect((await call("add_note", { project: "House", task: ids.paint, body: "both" })).isError).toBe(true);
    expect((await call("add_note", { project: "House", body: "  " })).text).toBe("A note cannot be empty.");
    expect(ws.snapshot().notes.map((x) => x.body).sort()).toEqual(["Keep it local-first.", "Pick colours", "Two coats", "Use the orbit loader."]);
  });
});

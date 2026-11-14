import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./database.js";
import { Workspace } from "./repo.js";
import { AppError } from "./errors.js";

let db: DatabaseSync;
let clock: number;
let n: number;
let ws: Workspace;

beforeEach(() => {
  db = openDatabase(":memory:");
  clock = 1_000_000;
  n = 0;
  ws = new Workspace(db, () => (clock += 1000), () => `id-${++n}`);
});

const code = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (e) { return e instanceof AppError ? `${e.code}: ${e.message}` : `other: ${String(e)}`; }
  return undefined;
};

describe("projects", () => {
  it("starts empty", () => {
    expect(ws.snapshot()).toEqual({ projects: [], tasks: [], milestones: [], notes: [], services: [], serviceCharges: [], settings: {} });
  });

  it("creates a project and cleans the input", () => {
    const { id, snapshot } = ws.createProject({ name: "  Wagonwheel  ", color: "#c62845", startDate: "2026-11-01", targetDate: "2026-12-31" });
    const p = snapshot.projects.find((x) => x.id === id)!;
    expect(p).toMatchObject({ name: "Wagonwheel", status: "active", color: "#C62845", startDate: "2026-11-01", targetDate: "2026-12-31", archivedAt: null });
  });

  it("refuses bad input with a message a person can act on", () => {
    expect(code(() => ws.createProject({ name: "   " }))).toBe("validation: The project name cannot be empty.");
    expect(code(() => ws.createProject({ name: "x", startDate: "2026-02-30" }))).toBe("validation: The start date is not a valid date.");
    expect(code(() => ws.createProject({ name: "x", startDate: "2026-12-01", targetDate: "2026-11-01" }))).toBe("validation: The start date is after the target date.");
    expect(code(() => ws.createProject({ name: "x", color: "red" }))).toBe("validation: The colour must look like #C62845.");
    expect(code(() => ws.createProject({ name: "x", status: "nope" as never }))).toContain("The status is not one of");
    expect(ws.snapshot().projects).toHaveLength(0);
  });

  it("updates only what the patch names; null clears a date", () => {
    const { id } = ws.createProject({ name: "A", description: "d", startDate: "2026-11-01", targetDate: "2026-12-01" });
    const { snapshot } = ws.updateProject(id, { name: "B", targetDate: null });
    expect(snapshot.projects[0]).toMatchObject({ name: "B", description: "d", startDate: "2026-11-01", targetDate: null });
  });

  describe("a connected GitHub repository", () => {
    it("starts unconnected, is set on create or update, and null disconnects", () => {
      const { id } = ws.createProject({ name: "A" });
      expect(ws.snapshot().projects[0].githubRepo).toBeNull();
      expect(ws.updateProject(id, { githubRepo: " gageabass-jpg/schedule-buddy " }).snapshot.projects[0].githubRepo).toBe("gageabass-jpg/schedule-buddy");
      expect(ws.updateProject(id, { name: "A2" }).snapshot.projects[0].githubRepo).toBe("gageabass-jpg/schedule-buddy");   // other edits leave it alone
      expect(ws.updateProject(id, { githubRepo: null }).snapshot.projects[0].githubRepo).toBeNull();
      const made = ws.createProject({ name: "B", githubRepo: "o/r" }).snapshot.projects.find((p) => p.name === "B");
      expect(made?.githubRepo).toBe("o/r");
    });

    it("refuses something that is not owner/name", () => {
      const { id } = ws.createProject({ name: "A" });
      for (const bad of ["just-a-name", "a/b/c", "https://github.com/o/r", "o/r?x=1", "o /r", "/r", "o/"]) {
        expect(code(() => ws.updateProject(id, { githubRepo: bad }))).toBe("validation: The GitHub repository must look like owner/name.");
      }
      expect(ws.snapshot().projects[0].githubRepo).toBeNull();
    });

    it("lets a repository belong to one project only, and says which has it", () => {
      const { id: a } = ws.createProject({ name: "First", githubRepo: "Gage/Repo" });
      const { id: b } = ws.createProject({ name: "Second" });
      expect(code(() => ws.updateProject(b, { githubRepo: "gage/repo" }))).toBe('validation: gage/repo is already connected to the project "First". A repository can belong to one project.');
      expect(code(() => ws.createProject({ name: "Third", githubRepo: "GAGE/REPO" }))).toContain('already connected to the project "First"');
      expect(ws.snapshot().projects.map((p) => p.githubRepo)).toEqual(["Gage/Repo", null]);
      // the same project can be saved again with its own repository, and a freed repository can move
      expect(ws.updateProject(a, { githubRepo: "Gage/Repo", name: "First!" }).snapshot.projects[0].name).toBe("First!");
      ws.updateProject(a, { githubRepo: null });
      expect(ws.updateProject(b, { githubRepo: "gage/repo" }).snapshot.projects[1].githubRepo).toBe("gage/repo");
    });

    it("is kept when the project is archived and goes when it is deleted", () => {
      const { id } = ws.createProject({ name: "A", githubRepo: "o/r" });
      expect(ws.updateProject(id, { archived: true }).snapshot.projects[0].githubRepo).toBe("o/r");
      ws.deleteProject(id);
      expect(ws.createProject({ name: "Again", githubRepo: "o/r" }).snapshot.projects[0].githubRepo).toBe("o/r");
    });
  });

  it("archives and unarchives, keeping the first archive time", () => {
    const { id } = ws.createProject({ name: "A" });
    const first = ws.updateProject(id, { archived: true }).snapshot.projects[0].archivedAt;
    expect(first).not.toBeNull();
    expect(ws.updateProject(id, { archived: true }).snapshot.projects[0].archivedAt).toBe(first);
    expect(ws.updateProject(id, { archived: false }).snapshot.projects[0].archivedAt).toBeNull();
  });

  it("reports a missing project", () => {
    expect(code(() => ws.updateProject("nope", { name: "x" }))).toBe("not_found: That project no longer exists.");
    expect(code(() => ws.deleteProject("nope"))).toBe("not_found: That project no longer exists.");
  });

  it("deletes a project with its tasks, subtasks, milestones and notes", () => {
    const { id: p } = ws.createProject({ name: "A" });
    const { id: t } = ws.createTask({ title: "t", projectId: p });
    ws.createTask({ title: "sub", parentId: t });
    ws.createMilestone({ projectId: p, name: "m", targetDate: "2026-12-01" });
    ws.createNote({ projectId: p, body: "n" });
    ws.createNote({ taskId: t, body: "n2" });
    const { id: other } = ws.createProject({ name: "B" });
    ws.createTask({ title: "keep", projectId: other });
    const s = ws.deleteProject(p);
    expect(s.projects.map((x) => x.id)).toEqual([other]);
    expect(s.tasks.map((x) => x.title)).toEqual(["keep"]);
    expect(s.milestones).toHaveLength(0);
    expect(s.notes).toHaveLength(0);
  });
});

describe("tasks", () => {
  it("a task with no project is in the inbox", () => {
    const { snapshot } = ws.createTask({ title: "Idea" });
    expect(snapshot.tasks[0]).toMatchObject({ projectId: null, parentId: null, status: "not_started", priority: "medium" });
  });

  it("assigns a task to a project and moves it between projects", () => {
    const a = ws.createProject({ name: "A" }).id;
    const b = ws.createProject({ name: "B" }).id;
    const t = ws.createTask({ title: "t" }).id;
    expect(ws.updateTask(t, { projectId: a }).snapshot.tasks[0].projectId).toBe(a);
    expect(ws.updateTask(t, { projectId: b }).snapshot.tasks[0].projectId).toBe(b);
    expect(ws.updateTask(t, { projectId: null }).snapshot.tasks[0].projectId).toBeNull();
  });

  it("refuses a project that does not exist, and writes nothing", () => {
    expect(code(() => ws.createTask({ title: "t", projectId: "nope" }))).toBe("not_found: That project no longer exists.");
    expect(ws.snapshot().tasks).toHaveLength(0);
  });

  it("checks the dates", () => {
    expect(code(() => ws.createTask({ title: "t", startDate: "2026-11-10", dueDate: "2026-11-01" }))).toBe("validation: The start date is after the due date.");
    const t = ws.createTask({ title: "t", dueDate: "2026-11-01" }).id;
    expect(code(() => ws.updateTask(t, { startDate: "2026-11-05" }))).toBe("validation: The start date is after the due date.");
    expect(ws.updateTask(t, { dueDate: null }).snapshot.tasks[0].dueDate).toBeNull();
  });

  it("sets completedAt when a task is done and clears it when it is reopened", () => {
    const t = ws.createTask({ title: "t" }).id;
    const done = ws.updateTask(t, { status: "done" }).snapshot.tasks[0];
    expect(done.status).toBe("done");
    expect(done.completedAt).not.toBeNull();
    // A second save of a done task keeps the first completion time.
    expect(ws.updateTask(t, { title: "t2" }).snapshot.tasks[0].completedAt).toBe(done.completedAt);
    const open = ws.updateTask(t, { status: "in_progress" }).snapshot.tasks[0];
    expect(open.completedAt).toBeNull();
  });

  it("creates a task that is already done", () => {
    expect(ws.createTask({ title: "t", status: "done" }).snapshot.tasks[0].completedAt).not.toBeNull();
  });
});

describe("subtasks", () => {
  it("share the parent's project and follow it when it moves", () => {
    const a = ws.createProject({ name: "A" }).id;
    const b = ws.createProject({ name: "B" }).id;
    const parent = ws.createTask({ title: "parent", projectId: a }).id;
    const sub = ws.createTask({ title: "sub", parentId: parent }).id;
    expect(ws.snapshot().tasks.find((t) => t.id === sub)).toMatchObject({ parentId: parent, projectId: a });
    ws.updateTask(parent, { projectId: b });
    expect(ws.snapshot().tasks.find((t) => t.id === sub)!.projectId).toBe(b);
  });

  it("ignores a project change on a subtask", () => {
    const a = ws.createProject({ name: "A" }).id;
    const b = ws.createProject({ name: "B" }).id;
    const parent = ws.createTask({ title: "parent", projectId: a }).id;
    const sub = ws.createTask({ title: "sub", parentId: parent }).id;
    ws.updateTask(sub, { projectId: b });
    expect(ws.snapshot().tasks.find((t) => t.id === sub)!.projectId).toBe(a);
  });

  it("go one level deep only", () => {
    const parent = ws.createTask({ title: "parent" }).id;
    const sub = ws.createTask({ title: "sub", parentId: parent }).id;
    expect(code(() => ws.createTask({ title: "deep", parentId: sub }))).toBe("validation: A subtask cannot have subtasks of its own.");
  });

  it("are deleted with their parent", () => {
    const parent = ws.createTask({ title: "parent" }).id;
    ws.createTask({ title: "sub", parentId: parent });
    expect(ws.deleteTask(parent).tasks).toHaveLength(0);
  });
});

describe("milestones", () => {
  it("need a project, a name and a date", () => {
    const p = ws.createProject({ name: "A" }).id;
    expect(code(() => ws.createMilestone({ projectId: p, name: "", targetDate: "2026-12-01" }))).toBe("validation: The milestone name cannot be empty.");
    expect(code(() => ws.createMilestone({ projectId: p, name: "m", targetDate: "" }))).toBe("validation: A milestone needs a target date.");
    expect(code(() => ws.createMilestone({ projectId: "nope", name: "m", targetDate: "2026-12-01" }))).toBe("not_found: That project no longer exists.");
  });

  it("complete and reopen", () => {
    const p = ws.createProject({ name: "A" }).id;
    const m = ws.createMilestone({ projectId: p, name: "Ship", targetDate: "2026-12-01" }).id;
    expect(ws.updateMilestone(m, { completed: true }).snapshot.milestones[0].completedAt).not.toBeNull();
    expect(ws.updateMilestone(m, { completed: false, targetDate: "2026-12-15" }).snapshot.milestones[0]).toMatchObject({ completedAt: null, targetDate: "2026-12-15" });
    expect(ws.deleteMilestone(m).milestones).toHaveLength(0);
  });
});

describe("notes", () => {
  it("belong to a project or a task, not both and not neither", () => {
    const p = ws.createProject({ name: "A" }).id;
    const t = ws.createTask({ title: "t", projectId: p }).id;
    expect(code(() => ws.createNote({ body: "x" }))).toBe("validation: A note belongs to a project or to a task.");
    expect(code(() => ws.createNote({ projectId: p, taskId: t, body: "x" }))).toBe("validation: A note belongs to a project or to a task.");
    expect(code(() => ws.createNote({ projectId: p, body: "   " }))).toBe("validation: A note cannot be empty.");
    expect(code(() => ws.createNote({ taskId: "nope", body: "x" }))).toBe("not_found: That task no longer exists.");
    expect(ws.snapshot().notes).toHaveLength(0);
  });

  it("can be edited and deleted", () => {
    const p = ws.createProject({ name: "A" }).id;
    const note = ws.createNote({ projectId: p, body: "first" }).id;
    expect(ws.updateNote(note, "second").snapshot.notes[0].body).toBe("second");
    expect(ws.deleteNote(note).notes).toHaveLength(0);
  });
});

describe("a project's updatedAt", () => {
  it("moves when anything inside it changes", () => {
    const p = ws.createProject({ name: "A" }).id;
    const at = () => ws.snapshot().projects[0].updatedAt;
    let last = at();
    const step = (label: string, fn: () => void) => {
      fn();
      expect(at(), label).toBeGreaterThan(last);
      last = at();
    };
    let t = "";
    step("task created", () => { t = ws.createTask({ title: "t", projectId: p }).id; });
    step("task updated", () => ws.updateTask(t, { status: "done" }));
    step("task note", () => ws.createNote({ taskId: t, body: "n" }));
    step("milestone", () => ws.createMilestone({ projectId: p, name: "m", targetDate: "2026-12-01" }));
    step("task deleted", () => ws.deleteTask(t));
  });
});

describe("settings", () => {
  it("stores the workspace name", () => {
    expect(ws.setSetting("workspaceName", "  Studio  ").settings.workspaceName).toBe("Studio");
    expect(ws.setSetting("workspaceName", "Lab").settings.workspaceName).toBe("Lab");
  });

  it("refuses an empty or very long workspace name, and odd keys", () => {
    expect(code(() => ws.setSetting("workspaceName", "  "))).toBe("validation: The workspace name cannot be empty.");
    expect(code(() => ws.setSetting("workspaceName", "x".repeat(61)))).toContain("too long");
    expect(code(() => ws.setSetting("bad key!", "x"))).toBe("validation: That setting name is not allowed.");
  });
});

describe("services", () => {
  it("creates a service and cleans the input", () => {
    const { id, snapshot } = ws.createService({ name: "  Vercel ", plan: " Pro ", kind: "usage", provider: "vercel", amountCents: 2000, billingDay: 5, billingUrl: " https://vercel.com/account/billing ", notes: " n " });
    expect(snapshot.services.find((s) => s.id === id)).toMatchObject({
      name: "Vercel", plan: "Pro", kind: "usage", provider: "vercel", amountCents: 2000, billingDay: 5,
      billingUrl: "https://vercel.com/account/billing", notes: "n", status: "active", lastSyncedAt: null,
    });
  });

  it("has sensible defaults", () => {
    const s = ws.createService({ name: "GitHub" }).snapshot.services[0];
    expect(s).toMatchObject({ plan: "", kind: "flat", provider: null, amountCents: 0, billingDay: null, billingUrl: null, status: "active" });
  });

  it("refuses bad input with a message a person can act on", () => {
    expect(code(() => ws.createService({ name: "  " }))).toBe("validation: The service name cannot be empty.");
    expect(code(() => ws.createService({ name: "x", amountCents: -1 }))).toContain("not less than zero");
    expect(code(() => ws.createService({ name: "x", amountCents: 12.5 }))).toContain("not less than zero");
    expect(code(() => ws.createService({ name: "x", amountCents: 100_000_001 }))).toContain("too large");
    expect(code(() => ws.createService({ name: "x", billingDay: 0 }))).toContain("1 to 31");
    expect(code(() => ws.createService({ name: "x", billingDay: 32 }))).toContain("1 to 31");
    expect(code(() => ws.createService({ name: "x", kind: "free" as never }))).toContain("The type is not one of");
    expect(code(() => ws.createService({ name: "x", provider: "stripe" as never }))).toContain("The automatic source is not one of");
    expect(code(() => ws.createService({ name: "x", plan: "p".repeat(121) }))).toContain("The plan is too long");
    expect(ws.snapshot().services).toHaveLength(0);
  });

  it("keeps only https billing pages, so a link can never run a script or open a file", () => {
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "http://insecure.example.com", "not a url", "data:text/html,x"]) {
      expect(code(() => ws.createService({ name: "x", billingUrl: bad }))).toMatch(/^validation: The billing page must be/);
    }
    expect(ws.createService({ name: "x", billingUrl: "" }).snapshot.services[0].billingUrl).toBeNull();
  });

  it("updates only what the patch names; null clears a field", () => {
    const { id } = ws.createService({ name: "A", plan: "Pro", amountCents: 2500, billingDay: 3, billingUrl: "https://a.example.com/" });
    const s = ws.updateService(id, { amountCents: 3000, billingDay: null, billingUrl: null }).snapshot.services[0];
    expect(s).toMatchObject({ name: "A", plan: "Pro", amountCents: 3000, billingDay: null, billingUrl: null });
    expect(ws.updateService(id, { status: "cancelled" }).snapshot.services[0].status).toBe("cancelled");
    expect(code(() => ws.updateService(id, { name: "" }))).toContain("cannot be empty");
    expect(code(() => ws.updateService("nope", { name: "x" }))).toBe("not_found: That service no longer exists.");
  });

  it("records one charge per service per month, and a new figure replaces the old", () => {
    const sid = ws.createService({ name: "A" }).id;
    const first = ws.setCharge({ serviceId: sid, month: "2026-11", amountCents: 2500 });
    expect(first.snapshot.serviceCharges).toHaveLength(1);
    const again = ws.setCharge({ serviceId: sid, month: "2026-11", amountCents: 3100 });
    expect(again.snapshot.serviceCharges).toHaveLength(1);
    expect(again.snapshot.serviceCharges[0]).toMatchObject({ id: first.id, month: "2026-11", amountCents: 3100, source: "manual" });
    expect(again.id).toBe(first.id);   // the row that changed
    ws.setCharge({ serviceId: sid, month: "2026-10", amountCents: 100 });
    expect(ws.snapshot().serviceCharges.map((c) => c.month)).toEqual(["2026-10", "2026-11"]);   // oldest first
  });

  it("refuses a bad month, a bad amount, and a service that is gone", () => {
    const sid = ws.createService({ name: "A" }).id;
    expect(code(() => ws.setCharge({ serviceId: sid, month: "2026-13", amountCents: 1 }))).toContain("must look like 2026-11");
    expect(code(() => ws.setCharge({ serviceId: sid, month: "Nov 2026", amountCents: 1 }))).toContain("must look like 2026-11");
    expect(code(() => ws.setCharge({ serviceId: sid, month: "2026-11", amountCents: -5 }))).toContain("not less than zero");
    expect(code(() => ws.setCharge({ serviceId: "nope", month: "2026-11", amountCents: 1 }))).toBe("not_found: That service no longer exists.");
    expect(ws.snapshot().serviceCharges).toHaveLength(0);
  });

  it("records a bill as paid by default, and as unpaid when told; typing again sets it afresh", () => {
    const sid = ws.createService({ name: "A" }).id;
    expect(ws.setCharge({ serviceId: sid, month: "2026-10", amountCents: 2500 }).snapshot.serviceCharges[0].paid).toBe(true);
    const unpaid = ws.setCharge({ serviceId: sid, month: "2026-11", amountCents: 3465, paid: false });
    expect(unpaid.snapshot.serviceCharges.find((c) => c.month === "2026-11")).toMatchObject({ amountCents: 3465, paid: false });
    // marking it paid later is the same call with paid true (the amount is unchanged)
    const paid = ws.setCharge({ serviceId: sid, month: "2026-11", amountCents: 3465, paid: true });
    expect(paid.id).toBe(unpaid.id);
    expect(paid.snapshot.serviceCharges.find((c) => c.month === "2026-11")?.paid).toBe(true);
    // a new figure typed with no word on it is paid: typing a bill in means it happened
    ws.setCharge({ serviceId: sid, month: "2026-11", amountCents: 100, paid: false });
    expect(ws.setCharge({ serviceId: sid, month: "2026-11", amountCents: 200 }).snapshot.serviceCharges.find((c) => c.month === "2026-11")).toMatchObject({ amountCents: 200, paid: true });
  });

  it("refuses a paid value that is not true or false", () => {
    const sid = ws.createService({ name: "A" }).id;
    expect(code(() => ws.setCharge({ serviceId: sid, month: "2026-11", amountCents: 100, paid: "no" as never }))).toBe("validation: Paid must be true or false.");
    expect(ws.snapshot().serviceCharges).toHaveLength(0);
  });

  it("deletes a charge, and a service takes its charges with it", () => {
    const sid = ws.createService({ name: "A" }).id;
    const cid = ws.setCharge({ serviceId: sid, month: "2026-11", amountCents: 100 }).id;
    expect(ws.deleteCharge(cid).serviceCharges).toHaveLength(0);
    expect(code(() => ws.deleteCharge(cid))).toBe("not_found: That charge no longer exists.");
    ws.setCharge({ serviceId: sid, month: "2026-11", amountCents: 100 });
    const after = ws.deleteService(sid);
    expect(after.services).toHaveLength(0);
    expect(after.serviceCharges).toHaveLength(0);
  });

  it("refuses to link a service to a provider it is not named for, so one service cannot be given another's usage", () => {
    expect(code(() => ws.createService({ name: "Supabase", provider: "vercel" }))).toBe(
      'validation: Only a service named like Vercel can check its usage on Vercel. "Supabase" would be given Vercel\'s usage, which is not its own.',
    );
    expect(ws.snapshot().services).toHaveLength(0);
    // a name that contains the provider's name is fine, in any case
    expect(ws.createService({ name: "My VERCEL hosting", provider: "vercel" }).snapshot.services[0].provider).toBe("vercel");
    // the same rule on an edit: linking an existing service, or renaming a linked one away from its provider's name
    const sb = ws.createService({ name: "Supabase" }).id;
    expect(code(() => ws.updateService(sb, { provider: "vercel" }))).toContain("Only a service named like Vercel can check its usage");
    const vc = ws.snapshot().services.find((s) => s.provider === "vercel")!.id;
    expect(code(() => ws.updateService(vc, { name: "Hosting" }))).toContain("Only a service named like Vercel can check its usage");
    expect(ws.updateService(vc, { name: "Vercel Pro" }).snapshot.services.find((s) => s.id === vc)?.name).toBe("Vercel Pro");
    expect(ws.updateService(vc, { provider: null }).snapshot.services.find((s) => s.id === vc)?.provider).toBeNull();
  });

  it("notes that a provider was checked without touching a single bill", () => {
    const sid = ws.createService({ name: "Vercel", provider: "vercel" }).id;
    ws.setCharge({ serviceId: sid, month: "2026-10", amountCents: 2120 });
    ws.setCharge({ serviceId: sid, month: "2026-11", amountCents: 2120, paid: false });
    const before = ws.snapshot().serviceCharges;
    expect(ws.snapshot().services[0].lastSyncedAt).toBeNull();
    const snap = ws.markChecked(sid);
    expect(snap.services[0].lastSyncedAt).toBeGreaterThan(0);
    expect(snap.serviceCharges).toEqual(before);   // every bill, its amount, who wrote it and whether it is paid: exactly as it was
    expect(code(() => ws.markChecked("nope"))).toBe("not_found: That service no longer exists.");
  });

  it("reads a service back by id", () => {
    const sid = ws.createService({ name: "Vercel", provider: "vercel" }).id;
    expect(ws.getService(sid).provider).toBe("vercel");
    expect(code(() => ws.getService("nope"))).toContain("not_found");
  });
});

describe("transactions", () => {
  it("roll back a change that fails part way", () => {
    const p = ws.createProject({ name: "A" }).id;
    // The task insert succeeds, then the project update that follows it is refused.
    // Nothing from the change may stay behind.
    db.exec("CREATE TRIGGER boom BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'boom'); END");
    expect(code(() => ws.createTask({ title: "t", projectId: p }))).toMatch(/^other: .*boom/);
    expect(ws.snapshot().tasks).toHaveLength(0);
    // The connection is still usable afterwards.
    db.exec("DROP TRIGGER boom");
    expect(ws.createTask({ title: "t", projectId: p }).snapshot.tasks).toHaveLength(1);
  });
});

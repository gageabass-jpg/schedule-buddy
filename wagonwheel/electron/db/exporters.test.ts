import { describe, expect, it } from "vitest";
import { buildCsvFiles, buildJsonExport, csvCell } from "./exporters.js";
import type { Snapshot } from "../../shared/types.js";

const snap: Snapshot = {
  settings: { workspaceName: "Gage's Workspace" },
  projects: [{ id: "p1", name: "Wagon, wheel", description: 'He said "go"', status: "active", color: "#C62845", startDate: "2026-11-01", targetDate: "2026-12-01", githubRepo: "gageabass-jpg/wagonwheel", archivedAt: null, createdAt: 0, updatedAt: 0 }],
  tasks: [
    { id: "t1", projectId: "p1", parentId: null, title: "Top", description: "", status: "done", priority: "high", startDate: null, dueDate: "2026-11-20", completedAt: 5000, createdAt: 0, updatedAt: 0 },
    { id: "t2", projectId: "p1", parentId: "t1", title: "Sub", description: "", status: "not_started", priority: "low", startDate: null, dueDate: null, completedAt: null, createdAt: 0, updatedAt: 0 },
    { id: "t3", projectId: null, parentId: null, title: "=HYPERLINK(\"x\")", description: "", status: "not_started", priority: "medium", startDate: null, dueDate: null, completedAt: null, createdAt: 0, updatedAt: 0 },
  ],
  milestones: [{ id: "m1", projectId: "p1", name: "Ship", description: "", targetDate: "2026-12-01", completedAt: null, createdAt: 0, updatedAt: 0 }],
  notes: [{ id: "n1", projectId: null, taskId: "t1", body: "line one\nline two", createdAt: 0, updatedAt: 0 }],
  services: [{ id: "v1", name: "Vercel", plan: "Pro", kind: "usage", provider: "vercel", amountCents: 2050, billingDay: 5, billingUrl: "https://vercel.com/account/billing", notes: "", status: "active", lastSyncedAt: 5000, createdAt: 0, updatedAt: 0 }],
  serviceCharges: [
    { id: "c1", serviceId: "v1", month: "2026-11", amountCents: 2431, source: "vercel", paid: true, createdAt: 0, updatedAt: 0 },
    { id: "c2", serviceId: "v1", month: "2026-12", amountCents: 2120, source: "manual", paid: false, createdAt: 0, updatedAt: 0 },
  ],
};

describe("csvCell", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
  });

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("2026-11-01")).toBe("2026-11-01");
  });
});

describe("buildCsvFiles", () => {
  const files = buildCsvFiles(snap);

  it("writes six files, each with a BOM and CRLF rows", () => {
    expect(Object.keys(files).sort()).toEqual(["milestones.csv", "notes.csv", "projects.csv", "service_charges.csv", "services.csv", "tasks.csv"]);
    for (const text of Object.values(files)) {
      expect(text.startsWith("﻿")).toBe(true);
      expect(text.endsWith("\r\n")).toBe(true);
    }
  });

  it("writes the connected GitHub repository in its own column", () => {
    const [header, row] = files["projects.csv"].replace("﻿", "").split("\r\n");
    const at = header.split(",").indexOf("github_repo");
    expect(at).toBeGreaterThan(-1);
    expect(row).toContain(",2026-12-01,gageabass-jpg/wagonwheel,");
  });

  it("counts top-level tasks only in project progress", () => {
    const row = files["projects.csv"].split("\r\n")[1];
    expect(row).toContain(",1,1,");   // tasks_done = 1, tasks_total = 1 (the subtask is not counted)
    expect(row).toContain('"Wagon, wheel"');
    expect(row).toContain('"He said ""go"""');
  });

  it("names the project and the parent, and marks inbox tasks", () => {
    const lines = files["tasks.csv"].split("\r\n");
    expect(lines[2]).toContain("Wagon");        // t2 sits in the project
    expect(lines[2]).toContain(",Top,Sub,");   // parent_task = Top, title = Sub
    expect(lines[3]).toContain("(inbox)");
    expect(lines[3]).toContain("'=HYPERLINK");
  });

  it("writes services with dollars, and each charge under its service's name", () => {
    const [sHead, sRow] = files["services.csv"].replace("﻿", "").split("\r\n");
    expect(sHead).toContain("usual_monthly_usd");
    expect(sRow).toContain("Vercel,Pro,usage,active,20.50,5,https://vercel.com/account/billing,vercel,");
    const [cHead, cRow, unpaidRow] = files["service_charges.csv"].replace("﻿", "").split("\r\n");
    expect(cHead).toBe("id,service,month,amount_usd,paid,source,created_at,updated_at");
    expect(cRow).toBe("c1,Vercel,2026-11,24.31,yes,vercel,1970-01-01T00:00:00.000Z,1970-01-01T00:00:00.000Z");
    expect(unpaidRow).toContain("c2,Vercel,2026-12,21.20,no,manual,");   // an unpaid bill says so, so a spreadsheet can total what is owed
  });
});

describe("buildJsonExport", () => {
  it("is the whole workspace, parseable, with the app and schema named", () => {
    const parsed = JSON.parse(buildJsonExport(snap, 1, Date.UTC(2026, 10, 9)));
    expect(parsed).toMatchObject({ app: "Nucleus Wagonwheel", format: 1, schemaVersion: 1, exportedAt: "2026-11-09T00:00:00.000Z" });
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.tasks).toHaveLength(3);
    expect(parsed.services).toHaveLength(1);
    expect(parsed.serviceCharges).toHaveLength(2);
    expect(parsed.serviceCharges.map((c: { paid: boolean }) => c.paid)).toEqual([true, false]);
    expect(parsed.settings.workspaceName).toBe("Gage's Workspace");
  });
});

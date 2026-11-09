import { describe, expect, it } from "vitest";
import { buildCsvFiles, buildJsonExport, csvCell } from "./exporters.js";
import type { Snapshot } from "../../shared/types.js";

const snap: Snapshot = {
  settings: { workspaceName: "Gage's Workspace" },
  projects: [{ id: "p1", name: "Wagon, wheel", description: 'He said "go"', status: "active", color: "#C62845", startDate: "2026-11-01", targetDate: "2026-12-01", archivedAt: null, createdAt: 0, updatedAt: 0 }],
  tasks: [
    { id: "t1", projectId: "p1", parentId: null, title: "Top", description: "", status: "done", priority: "high", startDate: null, dueDate: "2026-11-20", completedAt: 5000, createdAt: 0, updatedAt: 0 },
    { id: "t2", projectId: "p1", parentId: "t1", title: "Sub", description: "", status: "not_started", priority: "low", startDate: null, dueDate: null, completedAt: null, createdAt: 0, updatedAt: 0 },
    { id: "t3", projectId: null, parentId: null, title: "=HYPERLINK(\"x\")", description: "", status: "not_started", priority: "medium", startDate: null, dueDate: null, completedAt: null, createdAt: 0, updatedAt: 0 },
  ],
  milestones: [{ id: "m1", projectId: "p1", name: "Ship", description: "", targetDate: "2026-12-01", completedAt: null, createdAt: 0, updatedAt: 0 }],
  notes: [{ id: "n1", projectId: null, taskId: "t1", body: "line one\nline two", createdAt: 0, updatedAt: 0 }],
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

  it("writes four files, each with a BOM and CRLF rows", () => {
    expect(Object.keys(files).sort()).toEqual(["milestones.csv", "notes.csv", "projects.csv", "tasks.csv"]);
    for (const text of Object.values(files)) {
      expect(text.startsWith("﻿")).toBe(true);
      expect(text.endsWith("\r\n")).toBe(true);
    }
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
});

describe("buildJsonExport", () => {
  it("is the whole workspace, parseable, with the app and schema named", () => {
    const parsed = JSON.parse(buildJsonExport(snap, 1, Date.UTC(2026, 10, 9)));
    expect(parsed).toMatchObject({ app: "Nucleus Wagonwheel", format: 1, schemaVersion: 1, exportedAt: "2026-11-09T00:00:00.000Z" });
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.tasks).toHaveLength(3);
    expect(parsed.settings.workspaceName).toBe("Gage's Workspace");
  });
});

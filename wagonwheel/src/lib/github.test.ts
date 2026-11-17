import { describe, expect, it } from "vitest";
import type { Milestone, Project, Task } from "@shared/types";
import type { GithubProposal } from "@shared/github";
import { isImported, milestoneInputFor, newProjectFor, parseRepoRef, projectForRepo, repoShortName, summary, taskInputFor } from "./github";

const repo = { fullName: "gageabass-jpg/schedule-buddy", url: "https://github.com/gageabass-jpg/schedule-buddy", description: "Shift schedule" };

const project = (over: Partial<Project>): Project => ({
  id: "p", name: "Something", description: "", status: "active", color: null, startDate: null, targetDate: null,
  githubRepo: null, archivedAt: null, createdAt: 0, updatedAt: 0, ...over,
});
const task = (over: Partial<Task>): Task => ({
  id: "t", projectId: "p", parentId: null, title: "T", description: "", status: "not_started", priority: "medium",
  startDate: null, dueDate: null, completedAt: null, githubRef: null, createdAt: 0, updatedAt: 0, ...over,
});
const milestone = (over: Partial<Milestone>): Milestone => ({
  id: "m", projectId: "p", name: "M", description: "", targetDate: "2026-12-01", completedAt: null, githubRef: null, createdAt: 0, updatedAt: 0, ...over,
});
const proposal = (over: Partial<GithubProposal>): GithubProposal => ({
  id: "x", kind: "issue", title: "Fix it", description: "Body\n\nFrom GitHub: https://github.com/o/r/issues/1",
  priority: "high", dueDate: "2026-12-05", url: "https://github.com/o/r/issues/1", asMilestone: false, ...over,
});

describe("projectForRepo", () => {
  it("names the repo's short name", () => {
    expect(repoShortName("gageabass-jpg/schedule-buddy")).toBe("schedule-buddy");
  });

  it("finds a project made by an earlier scan, by the address in its description", () => {
    const made = project({ id: "a", name: "Renamed since", description: `Shifts\n\n${repo.url}` });
    expect(projectForRepo(repo, [project({ id: "b" }), made])?.id).toBe("a");
  });

  it("finds a project named like the repository, ignoring case", () => {
    expect(projectForRepo(repo, [project({ id: "n", name: "Schedule-Buddy" })])?.id).toBe("n");
  });

  it("prefers a live project to an archived one", () => {
    const archived = project({ id: "old", name: "schedule-buddy", archivedAt: 5 });
    const live = project({ id: "new", name: "schedule-buddy" });
    expect(projectForRepo(repo, [archived, live])?.id).toBe("new");
    expect(projectForRepo(repo, [archived])?.id).toBe("old");
  });

  it("returns nothing when no project fits", () => {
    expect(projectForRepo(repo, [project({ name: "Other" })])).toBeUndefined();
  });

  it("goes to the project connected to the repository, whatever it is called", () => {
    const other = project({ id: "n", name: "schedule-buddy" });                                   // named like it, not connected
    const connected = project({ id: "c", name: "Shifts app", githubRepo: "GageAbass-JPG/Schedule-Buddy" });
    expect(projectForRepo(repo, [other, connected])?.id).toBe("c");
  });

  it("is not fooled by a project connected to a different repository", () => {
    const elsewhere = project({ id: "e", name: "schedule-buddy", githubRepo: "someone/else", description: repo.url });
    expect(projectForRepo(repo, [elsewhere])).toBeUndefined();
  });

  it("makes a new project that the next scan will find again", () => {
    const input = newProjectFor(repo);
    expect(input).toMatchObject({ name: "schedule-buddy", status: "active", githubRepo: "gageabass-jpg/schedule-buddy" });
    expect(projectForRepo(repo, [project({ name: "anything", githubRepo: input.githubRepo })])).toBeDefined();
    expect(input.description).toBe(`Shift schedule\n\n${repo.url}`);
    expect(projectForRepo(repo, [project({ name: "x", description: input.description })])).toBeDefined();
    expect(newProjectFor({ ...repo, description: "" }).description).toBe(repo.url);
  });
});

describe("parseRepoRef", () => {
  it("takes owner/name as it is", () => {
    expect(parseRepoRef("gageabass-jpg/schedule-buddy")).toBe("gageabass-jpg/schedule-buddy");
    expect(parseRepoRef("  o/r.js  ")).toBe("o/r.js");
  });

  it("takes a github.com address, with or without a scheme, .git, or a page inside the repository", () => {
    for (const text of [
      "https://github.com/o/r", "http://github.com/o/r", "github.com/o/r", "https://www.github.com/o/r/",
      "https://github.com/o/r.git", "https://github.com/o/r/issues/12", "https://github.com/o/r/tree/main/src", "https://github.com/o/r?tab=readme#top",
      "git@github.com:o/r.git",
    ]) expect(parseRepoRef(text), text).toBe("o/r");
  });

  it("keeps a dot in a repository's name", () => {
    expect(parseRepoRef("https://github.com/o/next.js")).toBe("o/next.js");
    expect(parseRepoRef("o/next.js.git")).toBe("o/next.js");
  });

  it("gives nothing for what is not a repository", () => {
    for (const text of ["", "   ", "just-a-name", "o/", "/r", "a/b/c", "https://github.com/o", "https://gitlab.com/o/r", "https://example.com/github.com/o/r", "o r/x"]) {
      expect(parseRepoRef(text), JSON.stringify(text)).toBeNull();
    }
  });
});

describe("isImported", () => {
  it("knows an issue by the link line in a task's description, wherever the task lives", () => {
    const tasks = [task({ projectId: null, description: "Body\n\nFrom GitHub: https://github.com/o/r/issues/1" })];
    expect(isImported(proposal({}), undefined, tasks, [])).toBe(true);
  });

  it("does not take issue 1 for issue 12", () => {
    const tasks = [task({ description: "x\n\nFrom GitHub: https://github.com/o/r/issues/12" })];
    expect(isImported(proposal({}), "p", tasks, [])).toBe(false);
  });

  it("does not take a mention of the address in prose for an import", () => {
    const tasks = [task({ description: "see https://github.com/o/r/issues/1 later" })];
    expect(isImported(proposal({}), "p", tasks, [])).toBe(false);
  });

  it("knows a roadmap item by its title in the repository's project", () => {
    const item = proposal({ kind: "roadmap", title: "Dark mode", url: "https://github.com/o/r/blob/main/README.md" });
    expect(isImported(item, "p", [task({ title: "Dark mode" })], [])).toBe(true);
    expect(isImported(item, "p", [task({ title: "Dark mode", projectId: "other" })], [])).toBe(false);
    expect(isImported(item, undefined, [task({ title: "Dark mode" })], [])).toBe(false);
  });

  it("knows a dated milestone by its name in the project", () => {
    const m = proposal({ kind: "milestone", asMilestone: true, title: "v1.0" });
    expect(isImported(m, "p", [], [milestone({ name: "v1.0" })])).toBe(true);
    expect(isImported(m, "p", [], [milestone({ name: "v2.0" })])).toBe(false);
    expect(isImported(m, undefined, [], [milestone({ name: "v1.0" })])).toBe(false);
  });
});

describe("isImported, for items that kept the scan's id", () => {
  const issue = proposal({ id: "o/r#1" });

  it("knows an issue by its id, even after the description was rewritten", () => {
    const tasks = [task({ githubRef: "o/r#1", description: "My own notes now" })];
    expect(isImported(issue, undefined, tasks, [])).toBe(true);
  });

  it("compares ids without regard to case", () => {
    expect(isImported(issue, undefined, [task({ githubRef: "O/R#1" })], [])).toBe(true);
  });

  it("does not take issue 1 for issue 12, nor another repository's issue 1", () => {
    expect(isImported(issue, undefined, [task({ githubRef: "o/r#12" })], [])).toBe(false);
    expect(isImported(issue, undefined, [task({ githubRef: "other/r#1" })], [])).toBe(false);
  });

  it("does not let the old link-line rule claim an item that has a different id", () => {
    const tasks = [task({ githubRef: "o/r#99", description: "Body\n\nFrom GitHub: https://github.com/o/r/issues/1" })];
    expect(isImported(issue, undefined, tasks, [])).toBe(false);
  });

  it("knows a roadmap item by id after it was retitled, and not by a same-titled task with another id", () => {
    const item = proposal({ id: "o/r:README.md:dark-mode", kind: "roadmap", title: "Dark mode" });
    expect(isImported(item, "p", [task({ githubRef: "o/r:README.md:dark-mode", title: "Make it dark" })], [])).toBe(true);
    expect(isImported(item, "p", [task({ githubRef: "o/r:TODO.md:dark-mode", title: "Dark mode" })], [])).toBe(false);
    expect(isImported(item, "p", [task({ githubRef: "o/r:README.md:dark-mode", projectId: "other" })], [])).toBe(false);
  });

  it("knows a dated milestone by id after it was renamed", () => {
    const m = proposal({ id: "o/r@milestone:3", kind: "milestone", asMilestone: true, title: "v1.0" });
    expect(isImported(m, "p", [], [milestone({ githubRef: "o/r@milestone:3", name: "Launch" })])).toBe(true);
    expect(isImported(m, "p", [], [milestone({ githubRef: "o/r@milestone:4", name: "v1.0" })])).toBe(false);
  });
});

describe("what a ticked proposal creates", () => {
  it("is a task with the proposal's title, notes, priority and date, and where it came from", () => {
    expect(taskInputFor(proposal({}), "p9")).toEqual({
      title: "Fix it", description: "Body\n\nFrom GitHub: https://github.com/o/r/issues/1",
      projectId: "p9", priority: "high", status: "not_started", dueDate: "2026-12-05", githubRef: "x",
    });
  });

  it("is a milestone for a dated GitHub milestone, and remembers which one", () => {
    const m = proposal({ id: "o/r@milestone:3", kind: "milestone", asMilestone: true, title: "v1.0", dueDate: "2026-12-31", description: "D" });
    expect(milestoneInputFor(m, "p9")).toEqual({ projectId: "p9", name: "v1.0", description: "D", targetDate: "2026-12-31", githubRef: "o/r@milestone:3" });
  });
});

describe("summary", () => {
  it("says what was added and where", () => {
    expect(summary({ tasks: 12, milestones: 1, projects: 2, failed: 0 })).toBe("Added 12 tasks and 1 milestone across 2 projects.");
    expect(summary({ tasks: 1, milestones: 0, projects: 1, failed: 0 })).toBe("Added 1 task across 1 project.");
  });
  it("says when something could not be added, and when nothing was", () => {
    expect(summary({ tasks: 3, milestones: 0, projects: 1, failed: 2 })).toBe("Added 3 tasks across 1 project. 2 items could not be added.");
    expect(summary({ tasks: 0, milestones: 0, projects: 0, failed: 1 })).toBe("Nothing was added. 1 item could not be added.");
  });
});

import { describe, expect, it } from "vitest";
import {
  clip, dateOnly, issueProposals, milestoneProposals, plainText, priorityFromLabels, pullProposals,
  readIssues, readMilestones, readPulls, roadmapFiles, roadmapProposals,
} from "./scan.js";

const REPO = "gageabass-jpg/schedule-buddy";

describe("small helpers", () => {
  it("keeps the first part of a long text and says it was cut", () => {
    expect(clip("short", 10)).toBe("short");
    expect(clip("abcdefghij", 6)).toBe("abcde…");
  });

  it("reads the day out of a GitHub timestamp", () => {
    expect(dateOnly("2026-12-01T07:00:00Z")).toBe("2026-12-01");
    expect(dateOnly(null)).toBeNull();
    expect(dateOnly("soon")).toBeNull();
  });

  it("turns markdown into plain words", () => {
    expect(plainText("**Add** the [wall display](https://x.dev/a) _tests_ and `lint`")).toBe("Add the wall display tests and lint");
    expect(plainText("![badge](https://img) Ship it <!-- hidden -->")).toBe("Ship it");
  });
});

describe("priorityFromLabels", () => {
  it("reads bugs and urgent work as high", () => {
    expect(priorityFromLabels(["bug"])).toBe("high");
    expect(priorityFromLabels(["Priority: High", "ui"])).toBe("high");
    expect(priorityFromLabels(["security"])).toBe("high");
  });
  it("reads docs and chores as low", () => {
    expect(priorityFromLabels(["documentation"])).toBe("low");
    expect(priorityFromLabels(["good first issue"])).toBe("low");
  });
  it("does not mistake a word that merely contains a keyword", () => {
    expect(priorityFromLabels(["debugger", "highlights"])).toBe("medium");
  });
  it("defaults to medium", () => {
    expect(priorityFromLabels([])).toBe("medium");
    expect(priorityFromLabels(["enhancement"])).toBe("medium");
  });
});

describe("issues", () => {
  const raw = [
    { number: 1, title: "Tidy the README", body: "Fix the typos", html_url: "https://github.com/o/r/issues/1", labels: [{ name: "documentation" }] },
    { number: 2, title: "Crash on launch", body: "It crashes\n<!-- template -->", html_url: "https://github.com/o/r/issues/2", labels: [{ name: "bug" }], milestone: { due_on: "2026-12-05T08:00:00Z" } },
    { number: 3, title: "A pull request, not an issue", body: "", html_url: "https://github.com/o/r/pull/3", labels: [], pull_request: { url: "x" } },
    { number: 4, title: "Add dark mode", body: null, html_url: "https://github.com/o/r/issues/4", labels: ["enhancement"] },
    { title: "no number", html_url: "https://github.com/o/r/issues/5" },
    "garbage",
  ];

  it("skips what is not an issue and what is malformed", () => {
    expect(readIssues(raw).map((i) => i.number)).toEqual([1, 2, 3, 4]);
    expect(readIssues("nope")).toEqual([]);
  });

  it("proposes open issues, most important first, leaving out pull requests", () => {
    const { proposals, total } = issueProposals(REPO, readIssues(raw), 10);
    expect(total).toBe(3);
    expect(proposals.map((p) => p.title)).toEqual(["Crash on launch", "Add dark mode", "Tidy the README"]);
    expect(proposals.map((p) => p.priority)).toEqual(["high", "medium", "low"]);
  });

  it("carries the milestone's due date, a stable id and a link line", () => {
    const [crash] = issueProposals(REPO, readIssues(raw), 10).proposals;
    expect(crash.id).toBe(`${REPO}#2`);
    expect(crash.kind).toBe("issue");
    expect(crash.dueDate).toBe("2026-12-05");
    expect(crash.description).toContain("It crashes");
    expect(crash.description).not.toContain("template");
    expect(crash.description).toContain("Labels: bug");
    expect(crash.description.endsWith("From GitHub: https://github.com/o/r/issues/2")).toBe(true);
    expect(crash.asMilestone).toBe(false);
  });

  it("caps the list and reports how many there were", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ number: i + 1, title: `Issue ${i + 1}`, html_url: `https://github.com/o/r/issues/${i + 1}` }));
    const { proposals, total } = issueProposals(REPO, readIssues(many), 3);
    expect(proposals).toHaveLength(3);
    expect(total).toBe(5);
  });

  it("never makes a title the task form would refuse", () => {
    const long = [{ number: 1, title: "x".repeat(300), html_url: "https://github.com/o/r/issues/1" }];
    expect(issueProposals(REPO, readIssues(long), 5).proposals[0].title.length).toBeLessThanOrEqual(120);
  });
});

describe("pull requests", () => {
  const pr = (n: number, user: string, extra: object = {}, type = "User") => ({
    number: n, title: `Change ${n}`, html_url: `https://github.com/o/r/pull/${n}`, user: { login: user, type }, requested_reviewers: [], draft: false, ...extra,
  });

  it("asks you to finish your own draft and to merge or close your own open one", () => {
    const { proposals } = pullProposals(REPO, readPulls([pr(1, "me", { draft: true }), pr(2, "Me")]), "me", 10);
    expect(proposals.map((p) => p.title)).toEqual(["Finish PR #1: Change 1", "Merge or close PR #2: Change 2"]);
  });

  it("makes a review someone asked of you high priority, and puts it first", () => {
    const { proposals } = pullProposals(REPO, readPulls([pr(1, "me"), pr(2, "sam", { requested_reviewers: [{ login: "ME" }] })]), "me", 10);
    expect(proposals[0]).toMatchObject({ title: "Review PR #2: Change 2", priority: "high" });
    expect(proposals[0].description).toContain("asked you for a review");
  });

  it("treats a bot's pull request as low priority housekeeping", () => {
    const { proposals } = pullProposals(REPO, readPulls([pr(7, "dependabot[bot]", {}, "Bot")]), "me", 10);
    expect(proposals[0]).toMatchObject({ title: "Merge or close PR #7: Change 7", priority: "low" });
  });

  it("works when the signed-in name is not known", () => {
    const { proposals } = pullProposals(REPO, readPulls([pr(3, "sam")]), null, 10);
    expect(proposals[0].title).toBe("Review PR #3: Change 3");
  });

  it("links back to the pull request and has a stable id", () => {
    const [p] = pullProposals(REPO, readPulls([pr(4, "sam")]), "me", 10).proposals;
    expect(p.id).toBe(`${REPO}!4`);
    expect(p.kind).toBe("pull_request");
    expect(p.url).toBe("https://github.com/o/r/pull/4");
    expect(p.description.endsWith("From GitHub: https://github.com/o/r/pull/4")).toBe(true);
  });
});

describe("milestones", () => {
  const ms = readMilestones([
    { number: 1, title: "v1.0", description: "First release", html_url: "https://github.com/o/r/milestone/1", due_on: "2026-12-31T08:00:00Z", open_issues: 3, closed_issues: 5 },
    { number: 2, title: "Someday", description: "", html_url: "https://github.com/o/r/milestone/2", due_on: null, open_issues: 0, closed_issues: 0 },
  ]);

  it("turns a dated milestone into a milestone, with its progress", () => {
    const [m] = milestoneProposals(REPO, ms);
    expect(m).toMatchObject({ kind: "milestone", title: "v1.0", dueDate: "2026-12-31", asMilestone: true });
    expect(m.description).toContain("5 of 8 issues closed.");
    expect(m.description).toContain("First release");
  });

  it("turns an undated one into a task, because a milestone needs a date", () => {
    const m = milestoneProposals(REPO, ms)[1];
    expect(m).toMatchObject({ title: "Finish milestone: Someday", dueDate: null, asMilestone: false });
    expect(m.description).toContain("No issues attached yet.");
  });
});

describe("roadmap files", () => {
  const listing = [
    { type: "file", name: "README.md", path: "README.md", size: 4000, html_url: "https://github.com/o/r/blob/main/README.md" },
    { type: "file", name: "TODO.md", path: "TODO.md", size: 900, html_url: "https://github.com/o/r/blob/main/TODO.md" },
    { type: "file", name: "ROADMAP", path: "docs/ROADMAP", size: 500, html_url: "x" },
    { type: "file", name: "package.json", path: "package.json", size: 800, html_url: "x" },
    { type: "dir", name: "docs", path: "docs", size: 0, html_url: "x" },
    { type: "file", name: "README.md", path: "huge/README.md", size: 5_000_000, html_url: "x" },
    { type: "file", name: "TODO.md", path: "empty/TODO.md", size: 0, html_url: "x" },
  ];

  it("picks the roadmap-like files and reads a TODO before a README", () => {
    expect(roadmapFiles(listing).map((f) => f.path)).toEqual(["TODO.md", "docs/ROADMAP", "README.md"]);
  });

  it("copes with anything that is not a listing", () => {
    expect(roadmapFiles(null)).toEqual([]);
    expect(roadmapFiles({ message: "Not Found" })).toEqual([]);
  });
});

describe("roadmapProposals", () => {
  const file = { path: "README.md", url: "https://github.com/o/r/blob/main/README.md" };
  const titles = (md: string, max = 50): string[] => roadmapProposals(REPO, file, md, max).proposals.map((p) => p.title);

  it("takes unchecked task-list items anywhere and skips checked ones", () => {
    expect(titles("# Notes\n- [ ] Write tests\n- [x] Done thing\n* [ ] Add CI\n")).toEqual(["Write tests", "Add CI"]);
  });

  it("takes top-level bullets under a roadmap-like heading only", () => {
    const md = ["# App", "- not a task, just a feature list", "## Roadmap", "- Sync with the phone", "  - a sub point", "- **Export** to [CSV](https://x)", "## License", "- MIT"].join("\n");
    expect(titles(md)).toEqual(["Sync with the phone", "Export to CSV"]);
  });

  it("stays inside a roadmap section across its sub-headings, and leaves it at the next peer heading", () => {
    const md = ["## Planned", "### Soon", "- Search", "### Later", "1. Plugins", "## Contributing", "- Fork the repo"].join("\n");
    expect(titles(md)).toEqual(["Search", "Plugins"]);
  });

  it("ignores code blocks", () => {
    expect(titles("## TODO\n```\n- [ ] not real\n- also not\n```\n- real one")).toEqual(["real one"]);
  });

  it("drops duplicates and empty or placeholder items", () => {
    expect(titles("## TODO\n- Fix login\n- fix login\n- TBD\n- ab\n")).toEqual(["Fix login"]);
  });

  it("gives each item a stable id, a link and where it was found", () => {
    const [p] = roadmapProposals(REPO, file, "## Roadmap\n- Dark mode", 5).proposals;
    expect(p.id).toBe(`${REPO}:README.md:dark-mode`);
    expect(p).toMatchObject({ kind: "roadmap", title: "Dark mode", priority: "medium", dueDate: null, url: file.url, asMilestone: false });
    expect(p.description).toContain('In README.md, under "Roadmap".');
    expect(p.description.endsWith(`From GitHub: ${file.url}`)).toBe(true);
  });

  it("keeps a long item's full text in the description and a clipped title", () => {
    const long = `Rework ${"the whole sync engine ".repeat(10)}end`;
    const [p] = roadmapProposals(REPO, file, `## Roadmap\n- ${long}`, 5).proposals;
    expect(p.title.length).toBeLessThanOrEqual(120);
    expect(p.description).toContain("end");
  });

  it("caps the list and says how many there were", () => {
    const md = "## TODO\n" + Array.from({ length: 6 }, (_, i) => `- Item ${i}`).join("\n");
    const r = roadmapProposals(REPO, file, md, 4);
    expect(r.proposals).toHaveLength(4);
    expect(r.total).toBe(6);
  });

  it("finds nothing in an ordinary README", () => {
    expect(titles("# Project\nSome text.\n\n## Install\n- run npm i\n\n## License\nMIT")).toEqual([]);
  });
});

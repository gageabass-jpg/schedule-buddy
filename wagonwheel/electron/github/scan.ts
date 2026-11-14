import type { Priority } from "../../shared/types.js";
import { FROM_GITHUB, type GithubProposal } from "../../shared/github.js";

// Turning what GitHub sends into proposed tasks. Pure functions: no network, no Electron,
// so every rule here is covered by a test. GitHub's JSON is read defensively: a field that
// is missing or the wrong shape is skipped, never thrown on.

const TITLE_MAX = 120;        // a task title may not be longer
const BODY_MAX = 1200;        // how much of an issue's text goes into the task's description

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export const clip = (text: string, max: number): string => {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/** "2026-12-01T07:00:00Z" -> "2026-12-01". Anything else -> null. */
export const dateOnly = (iso: unknown): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(str(iso));
  return m ? m[1] : null;
};

/** Markdown to plain text, enough for a one-line title: links keep their words, emphasis and code ticks go. */
export function plainText(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")            // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")          // [words](url)
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")         // [words][ref]
    .replace(/<[^>]+>/g, " ")                         // inline html
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")            // bold, strike
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")   // italics
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const link = (url: string): string => `${FROM_GITHUB} ${url}`;
const withLink = (text: string, url: string, extra?: string): string =>
  [clip(text, BODY_MAX), extra, link(url)].filter((s) => s && s.length > 0).join("\n\n");

// ── Priority ────────────────────────────────────────────────────────────────

const HIGH = /\b(bug|crash|regression|security|vulnerab|urgent|critical|blocker|p0|p1|high)\b/;
const LOW = /\b(docs?|documentation|chore|question|wontfix|nice.to.have|low|p3|p4|good first issue|cleanup|typo)\b/;

/** Labels name priority loosely. Anything that reads as a bug or "urgent" is high; chores and docs are low. */
export function priorityFromLabels(labels: string[]): Priority {
  const text = labels.map((l) => l.toLowerCase()).join(" | ");
  if (HIGH.test(text)) return "high";
  if (LOW.test(text)) return "low";
  return "medium";
}

// ── Issues ──────────────────────────────────────────────────────────────────

export interface Issue { number: number; title: string; body: string; url: string; labels: string[]; milestoneDue: string | null; isPull: boolean }

export function readIssues(v: unknown): Issue[] {
  if (!Array.isArray(v)) return [];
  const out: Issue[] = [];
  for (const raw of v) {
    const o = obj(raw);
    if (!o) continue;
    const number = num(o.number);
    const title = str(o.title).trim();
    const url = str(o.html_url);
    if (!number || !title || !url) continue;
    const labels = (Array.isArray(o.labels) ? o.labels : []).map((l) => (typeof l === "string" ? l : str(obj(l)?.name))).filter(Boolean);
    out.push({ number, title, body: str(o.body), url, labels, milestoneDue: dateOnly(obj(o.milestone)?.due_on), isPull: !!o.pull_request });
  }
  return out;
}

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** Open issues, most important first (GitHub's own order, most recently touched first, breaks ties). */
export function issueProposals(repo: string, issues: Issue[], max: number): { proposals: GithubProposal[]; total: number } {
  const real = issues.filter((i) => !i.isPull);
  const ranked = real
    .map((issue, index) => ({ issue, index, priority: priorityFromLabels(issue.labels) }))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.index - b.index)
    .slice(0, max);
  return {
    total: real.length,
    proposals: ranked.map(({ issue, priority }) => ({
      id: `${repo}#${issue.number}`,
      kind: "issue" as const,
      title: clip(issue.title, TITLE_MAX),
      description: withLink(plainBody(issue.body), issue.url, issue.labels.length ? `Labels: ${issue.labels.join(", ")}` : undefined),
      priority,
      dueDate: issue.milestoneDue,
      url: issue.url,
      asMilestone: false,
    })),
  };
}

const plainBody = (md: string): string => md.replace(/<!--[\s\S]*?-->/g, "").replace(/\r/g, "").trim();

// ── Pull requests ───────────────────────────────────────────────────────────

export interface Pull { number: number; title: string; url: string; draft: boolean; author: string; authorIsBot: boolean; reviewers: string[] }

export function readPulls(v: unknown): Pull[] {
  if (!Array.isArray(v)) return [];
  const out: Pull[] = [];
  for (const raw of v) {
    const o = obj(raw);
    if (!o) continue;
    const number = num(o.number);
    const title = str(o.title).trim();
    const url = str(o.html_url);
    if (!number || !title || !url) continue;
    const user = obj(o.user);
    const reviewers = (Array.isArray(o.requested_reviewers) ? o.requested_reviewers : []).map((r) => str(obj(r)?.login)).filter(Boolean);
    out.push({ number, title, url, draft: o.draft === true, author: str(user?.login), authorIsBot: str(user?.type) === "Bot" || /\[bot\]$/.test(str(user?.login)), reviewers });
  }
  return out;
}

/** What to do about each open pull request depends on whose it is. */
export function pullProposals(repo: string, pulls: Pull[], viewer: string | null, max: number): { proposals: GithubProposal[]; total: number } {
  const me = (viewer ?? "").toLowerCase();
  const mine = (p: Pull): boolean => !!me && p.author.toLowerCase() === me;
  const asked = (p: Pull): boolean => !!me && p.reviewers.some((r) => r.toLowerCase() === me);
  const make = (p: Pull): GithubProposal => {
    let verb = "Review";
    let priority: Priority = "medium";
    let why = `Opened by ${p.author || "someone"}.`;
    if (asked(p)) { verb = "Review"; priority = "high"; why = `${p.author || "Someone"} asked you for a review.`; }
    else if (mine(p)) { verb = p.draft ? "Finish" : "Merge or close"; why = p.draft ? "Your draft pull request." : "Your open pull request."; }
    else if (p.authorIsBot) { verb = "Merge or close"; priority = "low"; why = `Opened by ${p.author}.`; }
    return {
      id: `${repo}!${p.number}`,
      kind: "pull_request",
      title: clip(`${verb} PR #${p.number}: ${plainText(p.title)}`, TITLE_MAX),
      description: withLink(why, p.url),
      priority,
      dueDate: null,
      url: p.url,
      asMilestone: false,
    };
  };
  const ranked = pulls.map(make).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]).slice(0, max);
  return { proposals: ranked, total: pulls.length };
}

// ── Milestones ──────────────────────────────────────────────────────────────

export interface Milestone { number: number; title: string; description: string; url: string; dueOn: string | null; open: number; closed: number }

export function readMilestones(v: unknown): Milestone[] {
  if (!Array.isArray(v)) return [];
  const out: Milestone[] = [];
  for (const raw of v) {
    const o = obj(raw);
    if (!o) continue;
    const number = num(o.number);
    const title = str(o.title).trim();
    const url = str(o.html_url);
    if (!number || !title || !url) continue;
    out.push({ number, title, description: str(o.description), url, dueOn: dateOnly(o.due_on), open: num(o.open_issues), closed: num(o.closed_issues) });
  }
  return out;
}

/** A milestone with a due date becomes a Wagonwheel milestone. One without a date can't (a milestone needs
 *  a date), so it becomes a task to finish it. */
export function milestoneProposals(repo: string, milestones: Milestone[]): GithubProposal[] {
  return milestones.map((m) => {
    const total = m.open + m.closed;
    const progress = total > 0 ? `${m.closed} of ${total} issues closed.` : "No issues attached yet.";
    const dated = m.dueOn !== null;
    return {
      id: `${repo}@milestone:${m.number}`,
      kind: "milestone" as const,
      title: clip(dated ? m.title : `Finish milestone: ${m.title}`, TITLE_MAX),
      description: withLink(m.description, m.url, progress),
      priority: "medium" as const,
      dueDate: m.dueOn,
      url: m.url,
      asMilestone: dated,
    };
  });
}

// ── README / TODO roadmap ───────────────────────────────────────────────────

export interface RepoFile { name: string; path: string; size: number; url: string }

const FILE_NAME = /^(roadmap|todo|to-do|tasks?|backlog|plan|readme)(\.(md|markdown|txt|rst))?$/i;
const MAX_FILE_BYTES = 200_000;

/** Which files in a directory listing are worth reading, best first (a TODO or roadmap beats a README). */
export function roadmapFiles(listing: unknown): RepoFile[] {
  if (!Array.isArray(listing)) return [];
  const files: RepoFile[] = [];
  for (const raw of listing) {
    const o = obj(raw);
    if (!o || str(o.type) !== "file") continue;
    const name = str(o.name);
    const size = num(o.size);
    if (!FILE_NAME.test(name) || size === 0 || size > MAX_FILE_BYTES) continue;
    files.push({ name, path: str(o.path) || name, size, url: str(o.html_url) });
  }
  const rank = (f: RepoFile): number => (/^readme/i.test(f.name) ? 1 : 0);
  return files.sort((a, b) => rank(a) - rank(b));
}

const SECTION = /\b(road\s?map|to-?\s?do|planned|upcoming|next( steps| up)?|future|ideas?|backlog|wish\s?list|known (issues|limitations)|improvements?|coming soon|not yet|missing)\b/i;

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** Unchecked task-list items anywhere, and the top-level bullets under a heading that reads like a
 *  roadmap ("Roadmap", "TODO", "Planned", "Known issues"…). Checked items and code blocks are skipped. */
export function roadmapProposals(repo: string, file: { path: string; url: string }, markdown: string, max: number): { proposals: GithubProposal[]; total: number } {
  const found: { title: string; full: string; section: string }[] = [];
  const seen = new Set<string>();
  let fenced = false;
  let heading = "";
  let matchLevel: number | null = null;

  const add = (rawItem: string): void => {
    const full = plainText(rawItem);
    if (full.length < 3 || /^(todo|tbd|n\/a)$/i.test(full)) return;
    const key = full.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ title: clip(full, TITLE_MAX), full, section: heading });
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;

    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      heading = plainText(h[2]);
      // A heading deeper than a matching section stays inside it; any other heading decides afresh.
      if (!(matchLevel !== null && level > matchLevel)) matchLevel = SECTION.test(heading) ? level : null;
      continue;
    }

    const open = /^\s*[-*+]\s+\[ \]\s+(.+)$/.exec(line);
    if (open) { add(open[1]); continue; }
    if (/^\s*[-*+]\s+\[[xX]\]/.test(line)) continue;

    if (matchLevel !== null) {
      const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);   // no indent: top level only
      if (bullet) add(bullet[1]);
    }
  }

  return {
    total: found.length,
    proposals: found.slice(0, max).map((f) => ({
      id: `${repo}:${file.path}:${slug(f.title)}`,
      kind: "roadmap" as const,
      title: f.title,
      description: withLink(f.full.length > f.title.length ? f.full : "", file.url, f.section ? `In ${file.path}, under "${f.section}".` : `In ${file.path}.`),
      priority: "medium" as const,
      dueDate: null,
      url: file.url,
      asMilestone: false,
    })),
  };
}

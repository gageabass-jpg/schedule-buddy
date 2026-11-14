import { AppError } from "../db/errors.js";
import type { GithubProposal, GithubRepo, GithubScan } from "../../shared/github.js";
import { USER_AGENT, unreachable, type Fetch } from "./device-flow.js";
import {
  issueProposals, milestoneProposals, pullProposals, readIssues, readMilestones, readPulls,
  roadmapFiles, roadmapProposals, type RepoFile,
} from "./scan.js";

// Reads from api.github.com with the person's token. Read-only: it only ever sends GET.

const API = "https://api.github.com";
const ISSUES_MAX = 40;
const PULLS_MAX = 25;
const ROADMAP_FILES_MAX = 4;
const ROADMAP_MAX = 40;

interface Reply { status: number; ok: boolean; body: string }
type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

interface Part { proposals: GithubProposal[]; notes: string[] }

export class GithubClient {
  /**
   * @param token       the current token, or null when signed out
   * @param onRejected  called when GitHub says the token is no good, so the caller can forget it
   */
  constructor(
    private readonly f: Fetch,
    private readonly token: () => string | null,
    private readonly onRejected: () => void = () => {},
  ) {}

  private async request(path: string, accept: string): Promise<Reply> {
    const token = this.token();
    if (!token) throw new AppError("github", "Sign in to GitHub first.");
    let res: Response;
    try {
      res = await this.f(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw unreachable();
    }
    if (res.status === 401) {
      this.onRejected();
      throw new AppError("github", "GitHub no longer accepts the saved sign-in. Sign in again.");
    }
    if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const when = Number.isFinite(reset) && reset > 0 ? ` It resets at ${new Date(reset * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "";
      throw new AppError("github", `GitHub's request limit for this sign-in is used up.${when}`);
    }
    return { status: res.status, ok: res.ok, body: await res.text().catch(() => "") };
  }

  /** A JSON answer. `data` is null when GitHub said no (404, 410, …): the caller decides what that means. */
  private async json(path: string): Promise<{ status: number; data: unknown }> {
    const r = await this.request(path, "application/vnd.github+json");
    if (!r.ok) return { status: r.status, data: null };
    try { return { status: r.status, data: JSON.parse(r.body) as unknown }; } catch { return { status: r.status, data: null }; }
  }

  async viewer(): Promise<string> {
    const r = await this.json("/user");
    const login = str(obj(r.data)?.login);
    if (!login) throw new AppError("github", "GitHub did not say who this sign-in belongs to. Try signing in again.");
    return login;
  }

  /** Up to 300 repositories the person can see, most recently pushed first. */
  async listRepos(): Promise<GithubRepo[]> {
    const out: GithubRepo[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await this.json(`/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=${page}`);
      if (!Array.isArray(r.data)) throw new AppError("github", `GitHub would not list your repositories (HTTP ${r.status}).`);
      for (const raw of r.data) {
        const o = obj(raw);
        const fullName = str(o?.full_name);
        if (!o || !fullName) continue;
        out.push({
          fullName,
          description: str(o.description),
          private: o.private === true,
          archived: o.archived === true,
          fork: o.fork === true,
          pushedAt: str(o.pushed_at) || null,
          openIssues: typeof o.open_issues_count === "number" ? o.open_issues_count : 0,
          url: str(o.html_url) || `https://github.com/${fullName}`,
        });
      }
      if (r.data.length < 100) break;
    }
    return out;
  }

  /** Read one repository and propose tasks from it. A part GitHub will not give (issues switched off, say)
   *  is left out with a note; a rejected sign-in or a used-up rate limit stops the whole scan. */
  async scanRepo(fullName: string, viewer: string | null): Promise<GithubScan> {
    const info = await this.json(`/repos/${fullName}`);
    if (info.status === 404) throw new AppError("github", `GitHub can't find ${fullName}, or this sign-in can't see it.`);
    const repo = obj(info.data);
    if (!repo) throw new AppError("github", `GitHub would not show ${fullName} (HTTP ${info.status}).`);
    const url = str(repo.html_url) || `https://github.com/${fullName}`;

    const parts = await Promise.all([
      this.milestones(fullName),
      this.issues(fullName),
      this.pulls(fullName, viewer),
      this.roadmap(fullName),
    ]);
    return {
      repo: { fullName, url, description: str(repo.description) },
      proposals: parts.flatMap((p) => p.proposals),
      notes: parts.flatMap((p) => p.notes),
    };
  }

  private async milestones(repo: string): Promise<Part> {
    const r = await this.json(`/repos/${repo}/milestones?state=open&sort=due_on&direction=asc&per_page=50`);
    if (!Array.isArray(r.data)) return { proposals: [], notes: r.status === 404 || r.status === 410 ? [] : [`Could not read milestones (HTTP ${r.status}).`] };
    return { proposals: milestoneProposals(repo, readMilestones(r.data)), notes: [] };
  }

  private async issues(repo: string): Promise<Part> {
    const all: unknown[] = [];
    for (let page = 1; page <= 2; page++) {
      const r = await this.json(`/repos/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc&page=${page}`);
      if (!Array.isArray(r.data)) {
        if (page === 1) return { proposals: [], notes: [r.status === 404 || r.status === 410 ? "Issues are turned off for this repository." : `Could not read issues (HTTP ${r.status}).`] };
        break;
      }
      all.push(...r.data);
      if (r.data.length < 100) break;
    }
    const { proposals, total } = issueProposals(repo, readIssues(all), ISSUES_MAX);
    return { proposals, notes: total > proposals.length ? [`Showing ${proposals.length} of ${total} open issues (most important first).`] : [] };
  }

  private async pulls(repo: string, viewer: string | null): Promise<Part> {
    const r = await this.json(`/repos/${repo}/pulls?state=open&per_page=50`);
    if (!Array.isArray(r.data)) return { proposals: [], notes: r.status === 404 ? [] : [`Could not read pull requests (HTTP ${r.status}).`] };
    const { proposals, total } = pullProposals(repo, readPulls(r.data), viewer, PULLS_MAX);
    return { proposals, notes: total > proposals.length ? [`Showing ${proposals.length} of ${total} open pull requests.`] : [] };
  }

  /** TODO, ROADMAP and README files in the repository's root and in docs/. */
  private async roadmap(repo: string): Promise<Part> {
    const [root, docs] = await Promise.all([this.json(`/repos/${repo}/contents`), this.json(`/repos/${repo}/contents/docs`)]);
    // One ranking across both folders, so a TODO in docs/ is read before the root README.
    const listing = [...(Array.isArray(root.data) ? root.data : []), ...(Array.isArray(docs.data) ? docs.data : [])];
    const files: RepoFile[] = roadmapFiles(listing).slice(0, ROADMAP_FILES_MAX);
    if (files.length === 0) return { proposals: [], notes: [] };

    const proposals: GithubProposal[] = [];
    const seen = new Set<string>();
    let cut = 0;
    const texts = await Promise.all(files.map(async (file) => {
      const r = await this.request(`/repos/${repo}/contents/${file.path.split("/").map(encodeURIComponent).join("/")}`, "application/vnd.github.raw+json");
      return r.ok ? r.body : "";
    }));
    files.forEach((file, i) => {
      const { proposals: found, total } = roadmapProposals(repo, file, texts[i], ROADMAP_MAX);
      for (const p of found) {
        const key = p.title.toLowerCase();
        if (seen.has(key) || proposals.length >= ROADMAP_MAX) { if (!seen.has(key)) cut++; continue; }
        seen.add(key);
        proposals.push(p);
      }
      cut += Math.max(0, total - found.length);
    });
    return { proposals, notes: cut > 0 ? [`Listed ${proposals.length} roadmap items; ${cut} more were left out.`] : [] };
  }
}

import type { Milestone, MilestoneInput, Project, ProjectInput, Task, TaskInput } from "@shared/types";
import { FROM_GITHUB, type GithubProposal, type GithubScan } from "@shared/github";

// How a GitHub scan meets the workspace: which project a repository belongs to, which proposals
// are already in the workspace, and what to create for the ones the person ticks. No React, no IPC.

type Repo = GithubScan["repo"];

export const repoShortName = (fullName: string): string => fullName.split("/")[1] ?? fullName;

/** The project a repository's tasks go into. The project connected to the repository is the answer.
 *  Failing that, a project that is not connected to anything and either holds the repository's address
 *  in its description or is named like the repository (a live one wins over an archived one). A project
 *  connected to some other repository is never a match, whatever it is called.
 *  Undefined means a scan would make a new project. */
export function projectForRepo(repo: Repo, projects: Project[]): Project | undefined {
  const full = repo.fullName.toLowerCase();
  const connected = projects.find((p) => p.githubRepo?.toLowerCase() === full);
  if (connected) return connected;
  const url = repo.url.toLowerCase();
  const name = repoShortName(repo.fullName).toLowerCase();
  const matches = (p: Project): boolean => !p.githubRepo && (p.description.toLowerCase().includes(url) || p.name.trim().toLowerCase() === name);
  return projects.find((p) => !p.archivedAt && matches(p)) ?? projects.find(matches);
}

/** What a scan makes when the repository has no project yet: a project connected to the repository. */
export function newProjectFor(repo: Repo): ProjectInput {
  return {
    name: repoShortName(repo.fullName),
    description: [repo.description.trim(), repo.url].filter(Boolean).join("\n\n"),
    status: "active",
    githubRepo: repo.fullName,
  };
}

/** "owner/name" from what a person pastes: that, or a github.com address (an issue or a branch inside it
 *  is fine), or an SSH address. Null when it is none of those. */
export function parseRepoRef(text: string): string | null {
  const t = text.trim();
  const part = "[A-Za-z0-9_.-]+";
  const bare = new RegExp(`^(${part})/(${part})$`).exec(t);
  const address = new RegExp(`^(?:(?:https?://)?(?:www\\.)?github\\.com[/:]|git@github\\.com:)(${part})/(${part}?)(?:\\.git)?(?:[/#?].*)?$`, "i").exec(t);
  const m = bare ?? address;
  if (!m) return null;
  const owner = m[1];
  const name = bare ? m[2].replace(/\.git$/i, "") : m[2];
  return owner && name ? `${owner}/${name}` : null;
}

const hasLinkLine = (description: string, url: string): boolean =>
  description.split("\n").some((line) => line.trim() === `${FROM_GITHUB} ${url}`);

/** Whether a proposal is already in the workspace, so a second scan does not add it twice.
 *  Issues, pull requests and undated milestones are found by their link line; a roadmap item has no
 *  address of its own, so it is found by its title in the project; a dated milestone by its name. */
export function isImported(p: GithubProposal, projectId: string | undefined, tasks: Task[], milestones: Milestone[]): boolean {
  if (p.asMilestone) return !!projectId && milestones.some((m) => m.projectId === projectId && m.name === p.title);
  if (p.kind === "roadmap") return !!projectId && tasks.some((t) => t.projectId === projectId && t.title === p.title);
  return tasks.some((t) => hasLinkLine(t.description, p.url));
}

export const taskInputFor = (p: GithubProposal, projectId: string): TaskInput => ({
  title: p.title,
  description: p.description,
  projectId,
  priority: p.priority,
  status: "not_started",
  dueDate: p.dueDate,
});

export const milestoneInputFor = (p: GithubProposal, projectId: string): MilestoneInput => ({
  projectId,
  name: p.title,
  description: p.description,
  targetDate: p.dueDate ?? "",
});

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One line for the toast after a scan is applied. */
export function summary(counts: { tasks: number; milestones: number; projects: number; failed: number }): string {
  const parts: string[] = [];
  if (counts.tasks) parts.push(plural(counts.tasks, "task", "tasks"));
  if (counts.milestones) parts.push(plural(counts.milestones, "milestone", "milestones"));
  const added = parts.length ? `Added ${parts.join(" and ")}` : "Nothing was added";
  const where = counts.projects ? ` across ${plural(counts.projects, "project", "projects")}` : "";
  const failed = counts.failed ? ` ${plural(counts.failed, "item", "items")} could not be added.` : "";
  return `${added}${where}.${failed}`;
}

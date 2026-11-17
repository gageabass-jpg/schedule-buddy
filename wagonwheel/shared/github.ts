// What crosses the IPC boundary for the GitHub scan. Types only: no Node, no DOM, no React.
//
// The sign-in token never leaves the main process. The window sees whether a sign-in
// exists and whose it is, and the tasks a scan proposes.

import type { Priority } from "./types.js";

export interface GithubStatus {
  /** The OAuth app's Client ID the person registered on GitHub, or null before they paste one. */
  clientId: string | null;
  signedIn: boolean;
  /** The GitHub user name of the signed-in account. */
  login: string | null;
  /** False when this Mac cannot keep a secret (no keychain): a sign-in then lasts until the app quits. */
  canKeepSignIn: boolean;
}

/** What the person needs to finish a sign-in in the browser. */
export interface GithubDeviceCode {
  /** The short code they type on github.com/login/device. */
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
  /** How long to wait between polls. */
  intervalSeconds: number;
}

export type GithubPoll =
  | { state: "pending"; intervalSeconds: number }
  | { state: "done"; status: GithubStatus }
  | { state: "expired" }
  | { state: "denied" };

export interface GithubRepo {
  /** "owner/name". */
  fullName: string;
  description: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  pushedAt: string | null;
  openIssues: number;
  url: string;
}

export type ProposalKind = "issue" | "pull_request" | "milestone" | "roadmap";

/** One thing a scan suggests adding to the workspace. Nothing is created until the person ticks it. */
export interface GithubProposal {
  /** Stable across scans of the same repo, e.g. "owner/name#12". */
  id: string;
  kind: ProposalKind;
  title: string;
  /** Ends with a "From GitHub: <url>" line, which is how a later scan knows it is already added. */
  description: string;
  priority: Priority;
  /** "YYYY-MM-DD", or null. */
  dueDate: string | null;
  /** Where it came from on GitHub. */
  url: string;
  /** True for a dated GitHub milestone, which becomes a Wagonwheel milestone instead of a task. */
  asMilestone: boolean;
}

export interface GithubScan {
  repo: { fullName: string; url: string; description: string };
  proposals: GithubProposal[];
  /** Things the person should know: a part GitHub would not give us, or a list that was cut short. */
  notes: string[];
}

/** The text every proposal's description ends with. */
export const FROM_GITHUB = "From GitHub:";

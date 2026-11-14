import { AppError } from "../db/errors.js";
import type { GithubDeviceCode, GithubPoll, GithubRepo, GithubScan, GithubStatus } from "../../shared/github.js";
import { GithubClient } from "./client.js";
import type { CredentialStore } from "./credentials.js";
import { pollDeviceToken, requestDeviceCode, type Fetch } from "./device-flow.js";

// The GitHub feature as the window sees it. It holds the one thing that lives only in memory
// (a sign-in in progress) and checks every argument, because they come from the window.

const CLIENT_ID = /^[A-Za-z0-9._-]{6,80}$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export interface GithubDeps {
  fetch: Fetch;
  store: CredentialStore;
  /** Opens a page in the person's browser. Handed only github.com addresses. */
  openExternal(url: string): void;
  now?: () => number;
}

export class GithubService {
  private pending: { deviceCode: string; interval: number; expiresAt: number } | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: GithubDeps) {
    this.now = deps.now ?? Date.now;
  }

  private client(): GithubClient {
    return new GithubClient(this.deps.fetch, () => this.deps.store.token(), () => this.deps.store.clear());
  }

  status(): GithubStatus {
    const { store } = this.deps;
    const signedIn = store.token() !== null;
    return { clientId: store.clientId(), signedIn, login: signedIn ? store.login() : null, canKeepSignIn: store.canKeep() };
  }

  setClientId(raw: string): GithubStatus {
    const id = (raw ?? "").trim();
    if (!CLIENT_ID.test(id)) {
      throw new AppError("validation", "That does not look like a GitHub Client ID. It is a short code on your OAuth app's page, such as Ov23liAbC123.");
    }
    this.deps.store.setClientId(id);
    this.pending = null;
    return this.status();
  }

  async startSignIn(includePrivate: boolean): Promise<GithubDeviceCode> {
    const clientId = this.deps.store.clientId();
    if (!clientId) throw new AppError("validation", "Add your OAuth app's Client ID first.");
    // "repo" is the only scope GitHub offers for reading private repositories; the app only reads.
    const code = await requestDeviceCode(this.deps.fetch, clientId, includePrivate ? "repo" : "public_repo");
    this.pending = { deviceCode: code.deviceCode, interval: code.interval, expiresAt: this.now() + code.expiresIn * 1000 };
    // Open GitHub's own page only. The address came from GitHub's reply, so it is checked, not trusted.
    try {
      const target = new URL(code.verificationUri);
      if (target.protocol === "https:" && target.hostname === "github.com") this.deps.openExternal(target.toString());
    } catch { /* the window shows the address too */ }
    return { userCode: code.userCode, verificationUri: code.verificationUri, expiresInSeconds: code.expiresIn, intervalSeconds: code.interval };
  }

  async pollSignIn(): Promise<GithubPoll> {
    const clientId = this.deps.store.clientId();
    const pending = this.pending;
    if (!clientId || !pending) throw new AppError("github", "No sign-in is waiting. Start again.");
    if (this.now() >= pending.expiresAt) { this.pending = null; return { state: "expired" }; }

    const result = await pollDeviceToken(this.deps.fetch, clientId, pending.deviceCode, pending.interval);
    switch (result.state) {
      case "pending":
        pending.interval = result.interval;
        return { state: "pending", intervalSeconds: result.interval };
      case "expired":
      case "denied":
        this.pending = null;
        return { state: result.state };
      case "done": {
        this.pending = null;
        const token = result.token;
        // Ask GitHub whose token this is before keeping it.
        const login = await new GithubClient(this.deps.fetch, () => token).viewer();
        this.deps.store.saveSignIn(token, login);
        return { state: "done", status: this.status() };
      }
    }
  }

  signOut(): GithubStatus {
    this.pending = null;
    this.deps.store.clear();
    return this.status();
  }

  listRepos(): Promise<GithubRepo[]> {
    return this.client().listRepos();
  }

  scanRepo(fullName: string): Promise<GithubScan> {
    const name = (fullName ?? "").trim();
    if (!REPO.test(name)) throw new AppError("validation", "That is not a repository name. It looks like owner/name.");
    return this.client().scanRepo(name, this.deps.store.login());
  }
}

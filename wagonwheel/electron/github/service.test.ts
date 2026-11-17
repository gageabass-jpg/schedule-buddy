import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CredentialStore, type SecretBox } from "./credentials.js";
import { GithubService } from "./service.js";
import type { Fetch } from "./device-flow.js";

// The GitHub feature, end to end, against a stand-in for GitHub: no network, no Electron.

/** A keychain stand-in: "encrypts" by reversing and tagging, so a test can tell the file is not plain. */
const box = (available = true): SecretBox => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(`enc:${[...plain].reverse().join("")}`),
  decrypt: (data) => [...data.toString().replace(/^enc:/, "")].reverse().join(""),
});

interface Call { method: string; url: string; headers: Record<string, string>; body: string }
type Handler = (call: Call) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };

/** A fake fetch that answers by "METHOD url-prefix" and records what was asked. */
function fakeGithub(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    const key = Object.keys(routes).filter((k) => `${call.method} ${url}`.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (!key) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    const r = routes[key](call);
    const body = r.text ?? JSON.stringify(r.json ?? {});
    return new Response(body, { status: r.status ?? 200, headers: r.headers });
  }) as Fetch;
  return { fetch: fetchFn, calls };
}

let dir: string;
let opened: string[];
let clock: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-github-"));
  opened = [];
  clock = 1_000_000;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = (): string => path.join(dir, "github.json");
const make = (routes: Record<string, Handler>, available = true) => {
  const gh = fakeGithub(routes);
  const store = new CredentialStore(file(), box(available));
  const service = new GithubService({ fetch: gh.fetch, store, openExternal: (u) => opened.push(u), now: () => clock });
  return { ...gh, store, service };
};

const DEVICE = "POST https://github.com/login/device/code";
const TOKEN = "POST https://github.com/login/oauth/access_token";
const deviceReply: Handler = () => ({ json: { device_code: "dev123", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 } });

/** Sign a service in, the way a person would. */
async function signIn(s: ReturnType<typeof make>, login = "gageabass-jpg"): Promise<void> {
  s.service.setClientId("Ov23liExample123");
  await s.service.startSignIn(true);
  const done = await s.service.pollSignIn();
  expect(done).toMatchObject({ state: "done" });
  expect(s.store.login()).toBe(login);
}

const signedInRoutes = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  [DEVICE]: deviceReply,
  [TOKEN]: () => ({ json: { access_token: "gho_secret_token", token_type: "bearer", scope: "repo" } }),
  "GET https://api.github.com/user": () => ({ json: { login: "gageabass-jpg" } }),
  ...extra,
});

describe("the Client ID", () => {
  it("is checked before it is kept, and said back in words", () => {
    const { service } = make({});
    expect(() => service.setClientId("")).toThrow(/does not look like a GitHub Client ID/);
    expect(() => service.setClientId("has spaces in it")).toThrow(/Client ID/);
    expect(service.status()).toMatchObject({ clientId: null, signedIn: false, login: null });
  });

  it("is remembered, trimmed", () => {
    const { service } = make({});
    expect(service.setClientId("  Ov23liExample123 ").clientId).toBe("Ov23liExample123");
    expect(new CredentialStore(file(), box()).clientId()).toBe("Ov23liExample123");
  });

  it("must be set before a sign-in can start", async () => {
    const { service } = make({});
    await expect(service.startSignIn(true)).rejects.toThrow(/Client ID/);
  });
});

describe("signing in (device flow)", () => {
  it("asks for the right scope and opens GitHub's page for the person", async () => {
    const s = make({ [DEVICE]: deviceReply });
    s.service.setClientId("Ov23liExample123");
    const code = await s.service.startSignIn(true);
    expect(code).toEqual({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresInSeconds: 900, intervalSeconds: 5 });
    expect(new URLSearchParams(s.calls[0].body).get("client_id")).toBe("Ov23liExample123");
    expect(new URLSearchParams(s.calls[0].body).get("scope")).toBe("repo");
    expect(opened).toEqual(["https://github.com/login/device"]);
  });

  it("asks only for public repositories when told to", async () => {
    const s = make({ [DEVICE]: deviceReply });
    s.service.setClientId("Ov23liExample123");
    await s.service.startSignIn(false);
    expect(new URLSearchParams(s.calls[0].body).get("scope")).toBe("public_repo");
  });

  it("never opens an address that is not github.com over https", async () => {
    const s = make({ [DEVICE]: () => ({ json: { device_code: "d", user_code: "U", verification_uri: "https://evil.example/login/device", expires_in: 900, interval: 5 } }) });
    s.service.setClientId("Ov23liExample123");
    await s.service.startSignIn(true);
    expect(opened).toEqual([]);
    const s2 = make({ [DEVICE]: () => ({ json: { device_code: "d", user_code: "U", verification_uri: "http://github.com/login/device", expires_in: 900, interval: 5 } }) });
    s2.service.setClientId("Ov23liExample123");
    await s2.service.startSignIn(true);
    expect(opened).toEqual([]);
  });

  it("keeps waiting while the person has not approved, and slows down when told", async () => {
    let answer: object = { error: "authorization_pending" };
    const s = make({ [DEVICE]: deviceReply, [TOKEN]: () => ({ json: answer }) });
    s.service.setClientId("Ov23liExample123");
    await s.service.startSignIn(true);
    expect(await s.service.pollSignIn()).toEqual({ state: "pending", intervalSeconds: 5 });
    answer = { error: "slow_down", interval: 10 };
    expect(await s.service.pollSignIn()).toEqual({ state: "pending", intervalSeconds: 10 });
    answer = { error: "authorization_pending" };
    expect(await s.service.pollSignIn()).toEqual({ state: "pending", intervalSeconds: 10 });
  });

  it("finishes: asks GitHub who it is, keeps the token encrypted, and reports the person", async () => {
    const s = make(signedInRoutes());
    await signIn(s);
    expect(s.service.status()).toEqual({ clientId: "Ov23liExample123", signedIn: true, login: "gageabass-jpg", canKeepSignIn: true });
    const onDisk = fs.readFileSync(file(), "utf8");
    expect(onDisk).not.toContain("gho_secret_token");
    expect(JSON.parse(onDisk).token).toBeTruthy();
    // a new run reads the sign-in back
    const again = new GithubService({ fetch: s.fetch, store: new CredentialStore(file(), box()), openExternal: () => {} });
    expect(again.status()).toMatchObject({ signedIn: true, login: "gageabass-jpg" });
  });

  it("has its token sent as a bearer header only to api.github.com", async () => {
    const s = make(signedInRoutes());
    await signIn(s);
    const user = s.calls.find((c) => c.url === "https://api.github.com/user");
    expect(user?.headers.Authorization).toBe("Bearer gho_secret_token");
    for (const c of s.calls.filter((c) => c.url.startsWith("https://github.com/"))) expect(c.headers.Authorization).toBeUndefined();
  });

  it("reports a code that ran out, by the clock", async () => {
    const s = make({ [DEVICE]: deviceReply, [TOKEN]: () => ({ json: { error: "authorization_pending" } }) });
    s.service.setClientId("Ov23liExample123");
    await s.service.startSignIn(true);
    clock += 901_000;
    expect(await s.service.pollSignIn()).toEqual({ state: "expired" });
    await expect(s.service.pollSignIn()).rejects.toThrow(/No sign-in is waiting/);
  });

  it("reports GitHub saying the code expired or was refused", async () => {
    for (const [error, state] of [["expired_token", "expired"], ["access_denied", "denied"]] as const) {
      const s = make({ [DEVICE]: deviceReply, [TOKEN]: () => ({ json: { error } }) });
      s.service.setClientId("Ov23liExample123");
      await s.service.startSignIn(true);
      expect(await s.service.pollSignIn()).toEqual({ state });
    }
  });

  it("explains an OAuth app that has device sign-in switched off", async () => {
    const s = make({ [DEVICE]: () => ({ status: 400, json: { error: "device_flow_disabled" } }) });
    s.service.setClientId("Ov23liExample123");
    await expect(s.service.startSignIn(true)).rejects.toThrow(/Enable Device Flow/);
  });

  it("explains a Client ID GitHub does not know", async () => {
    const s = make({ [DEVICE]: () => ({ status: 404, json: { error: "Not Found" } }) });
    s.service.setClientId("Ov23liExample123");
    await expect(s.service.startSignIn(true)).rejects.toThrow(/does not recognise that Client ID/);
  });

  it("says so, in words, when GitHub cannot be reached", async () => {
    const store = new CredentialStore(file(), box());
    const service = new GithubService({ fetch: (async () => { throw new TypeError("fetch failed"); }) as Fetch, store, openExternal: () => {} });
    service.setClientId("Ov23liExample123");
    await expect(service.startSignIn(true)).rejects.toThrow(/Could not reach GitHub/);
  });

  it("signs out: the token and name go, the Client ID stays", async () => {
    const s = make(signedInRoutes());
    await signIn(s);
    const status = s.service.signOut();
    expect(status).toEqual({ clientId: "Ov23liExample123", signedIn: false, login: null, canKeepSignIn: true });
    expect(fs.readFileSync(file(), "utf8")).not.toContain("token");
  });

  it("changing the Client ID signs out, because the token belonged to the other app", async () => {
    const s = make(signedInRoutes());
    await signIn(s);
    s.service.setClientId("Ov23liSomethingElse");
    expect(s.service.status()).toMatchObject({ signedIn: false, login: null, clientId: "Ov23liSomethingElse" });
  });

  it("on a Mac with no keychain, keeps the sign-in in memory and writes no secret", async () => {
    const s = make(signedInRoutes(), false);
    await signIn(s);
    expect(s.service.status()).toMatchObject({ signedIn: true, canKeepSignIn: false });
    expect(fs.readFileSync(file(), "utf8")).not.toContain("gho_secret_token");
    expect(fs.readFileSync(file(), "utf8")).not.toContain("token");
  });
});

describe("listing repositories", () => {
  it("lists what the person can see, in the shape the window uses", async () => {
    const s = make(signedInRoutes({
      "GET https://api.github.com/user/repos": () => ({ json: [
        { full_name: "gageabass-jpg/schedule-buddy", description: "Shifts", private: true, archived: false, fork: false, pushed_at: "2026-11-09T10:00:00Z", open_issues_count: 4, html_url: "https://github.com/gageabass-jpg/schedule-buddy" },
        { full_name: "gageabass-jpg/old", description: null, private: false, archived: true, fork: true, pushed_at: null, open_issues_count: 0 },
        { nope: true },
      ] }),
    }));
    await signIn(s);
    const repos = await s.service.listRepos();
    expect(repos).toHaveLength(2);
    expect(repos[0]).toEqual({ fullName: "gageabass-jpg/schedule-buddy", description: "Shifts", private: true, archived: false, fork: false, pushedAt: "2026-11-09T10:00:00Z", openIssues: 4, url: "https://github.com/gageabass-jpg/schedule-buddy" });
    expect(repos[1]).toMatchObject({ archived: true, fork: true, description: "", pushedAt: null, url: "https://github.com/gageabass-jpg/old" });
  });

  it("needs a sign-in", async () => {
    const { service } = make({});
    await expect(service.listRepos()).rejects.toThrow(/Sign in to GitHub first/);
  });

  it("forgets a sign-in GitHub no longer accepts, and says to sign in again", async () => {
    let reject = false;
    const s = make(signedInRoutes({ "GET https://api.github.com/user/repos": () => (reject ? { status: 401, json: { message: "Bad credentials" } } : { json: [] }) }));
    await signIn(s);
    reject = true;
    await expect(s.service.listRepos()).rejects.toThrow(/no longer accepts the saved sign-in/);
    expect(s.service.status().signedIn).toBe(false);
  });

  it("explains a used-up rate limit, with the reset time", async () => {
    const s = make(signedInRoutes({ "GET https://api.github.com/user/repos": () => ({ status: 403, json: {}, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" } }) }));
    await signIn(s);
    await expect(s.service.listRepos()).rejects.toThrow(/request limit .* used up\. It resets at/);
  });
});

describe("scanning a repository", () => {
  const R = "https://api.github.com/repos/gageabass-jpg/schedule-buddy";
  const scanRoutes = (extra: Record<string, Handler> = {}): Record<string, Handler> => signedInRoutes({
    [`GET ${R}/milestones`]: () => ({ json: [{ number: 1, title: "v1", description: "", html_url: "https://github.com/o/r/milestone/1", due_on: "2026-12-31T08:00:00Z", open_issues: 1, closed_issues: 1 }] }),
    [`GET ${R}/issues`]: () => ({ json: [
      { number: 7, title: "Fix the wall display", body: "It freezes", html_url: "https://github.com/o/r/issues/7", labels: [{ name: "bug" }] },
      { number: 8, title: "A PR", html_url: "https://github.com/o/r/pull/8", pull_request: {} },
    ] }),
    [`GET ${R}/pulls`]: () => ({ json: [{ number: 9, title: "Add tests", html_url: "https://github.com/o/r/pull/9", user: { login: "gageabass-jpg", type: "User" }, draft: true, requested_reviewers: [] }] }),
    [`GET ${R}/contents/docs`]: () => ({ json: [{ type: "file", name: "TODO.md", path: "docs/TODO.md", size: 100, html_url: "https://github.com/o/r/blob/main/docs/TODO.md" }] }),
    [`GET ${R}/contents/README.md`]: () => ({ text: "# App\n## Roadmap\n- Sync to phone\n" }),
    [`GET ${R}/contents/docs/TODO.md`]: () => ({ text: "- [ ] Write the wiki\n- [ ] Sync to phone\n" }),
    [`GET ${R}/contents`]: () => ({ json: [{ type: "file", name: "README.md", path: "README.md", size: 100, html_url: "https://github.com/o/r/blob/main/README.md" }] }),
    [`GET ${R}`]: () => ({ json: { html_url: "https://github.com/gageabass-jpg/schedule-buddy", description: "Shift schedule" } }),
    ...extra,
  });

  it("proposes from milestones, issues, pull requests and roadmap files, once each", async () => {
    const s = make(scanRoutes());
    await signIn(s);
    const scan = await s.service.scanRepo("gageabass-jpg/schedule-buddy");
    expect(scan.repo).toEqual({ fullName: "gageabass-jpg/schedule-buddy", url: "https://github.com/gageabass-jpg/schedule-buddy", description: "Shift schedule" });
    expect(scan.proposals.map((p) => `${p.kind}: ${p.title}`)).toEqual([
      "milestone: v1",
      "issue: Fix the wall display",
      "pull_request: Finish PR #9: Add tests",
      "roadmap: Write the wiki",
      "roadmap: Sync to phone",
    ]);
    expect(scan.notes).toEqual([]);
    // the raw-file request asks for the file's own text
    const raw = s.calls.find((c) => c.url.endsWith("/contents/docs/TODO.md"));
    expect(raw?.headers.Accept).toBe("application/vnd.github.raw+json");
    // reads only
    expect(s.calls.filter((c) => c.url.startsWith("https://api.github.com/")).every((c) => c.method === "GET")).toBe(true);
  });

  it("leaves a part out with a note when GitHub will not give it", async () => {
    const s = make(scanRoutes({ [`GET ${R}/issues`]: () => ({ status: 410, json: { message: "Issues are disabled" } }) }));
    await signIn(s);
    const scan = await s.service.scanRepo("gageabass-jpg/schedule-buddy");
    expect(scan.notes).toEqual(["Issues are turned off for this repository."]);
    expect(scan.proposals.some((p) => p.kind === "issue")).toBe(false);
    expect(scan.proposals.some((p) => p.kind === "pull_request")).toBe(true);
  });

  it("says when a repository is not there", async () => {
    const s = make(scanRoutes({ [`GET ${R}`]: () => ({ status: 404, json: { message: "Not Found" } }) }));
    await signIn(s);
    await expect(s.service.scanRepo("gageabass-jpg/schedule-buddy")).rejects.toThrow(/can't find gageabass-jpg\/schedule-buddy/);
  });

  it("refuses a name that is not owner/name, before anything is asked of GitHub", async () => {
    const s = make(scanRoutes());
    await signIn(s);
    const before = s.calls.length;
    for (const bad of ["", "just-a-name", "a/b/c", "a/b?x=1", "../etc/passwd", "a/b#c", "a b/c"]) {
      expect(() => s.service.scanRepo(bad)).toThrow(/not a repository name/);
    }
    expect(s.calls.length).toBe(before);
  });
});

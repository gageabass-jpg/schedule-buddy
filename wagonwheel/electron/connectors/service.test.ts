import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorsService, defaultClaudeCandidates, registerCommand, type Exec, type ExecResult } from "./service.js";

const EXE = "/Applications/Nucleus Wagonwheel.app/Contents/MacOS/Nucleus Wagonwheel";
const SERVER = "/Applications/Nucleus Wagonwheel.app/Contents/Resources/app.asar/dist-electron/electron/mcp/server.js";
const ADDRESS = "me@icloud.com";

let dir: string;
let calls: { file: string; args: string[]; env?: Record<string, string> }[];
let results: ((file: string, args: string[]) => Partial<ExecResult> | undefined)[];

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-conn-")); calls = []; results = []; });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const exec: Exec = async (file, args, options) => {
  calls.push({ file, args, env: options?.env });
  for (const r of results) { const out = r(file, args); if (out) return { code: 0, stdout: "", stderr: "", ...out }; }
  return { code: 0, stdout: "", stderr: "" };
};

const configFile = (): string => path.join(dir, "claude.json");
const writeConfig = (servers: Record<string, unknown>, extra: Record<string, unknown> = {}): void => fs.writeFileSync(configFile(), JSON.stringify({ ...extra, mcpServers: servers }));
const fakeClaude = (): string => { const f = path.join(dir, "claude"); fs.writeFileSync(f, "#!/bin/sh\n", { mode: 0o755 }); return f; };
const icloudDir = (): string => path.join(dir, "icloud-mail");
const installIcloud = (): void => { fs.mkdirSync(icloudDir()); fs.writeFileSync(path.join(icloudDir(), "server.mjs"), ""); fs.writeFileSync(path.join(icloudDir(), "run.sh"), "#!/bin/bash\n"); };

const make = (over: Partial<ConstructorParameters<typeof ConnectorsService>[0]> = {}) =>
  new ConnectorsService({ exe: EXE, serverPath: SERVER, packaged: true, configFile: configFile(), icloudDir: icloudDir(), claudeCandidates: [path.join(dir, "no-such-claude")], securityBin: "/usr/bin/security", exec, ...over });

const wagonEntry = (args: string[] = [SERVER], command = EXE) => ({ type: "stdio", command, args, env: { ELECTRON_RUN_AS_NODE: "1" } });
const icloudEntry = (address: string | undefined = ADDRESS) => ({ type: "stdio", command: "bash", args: ["/x/run.sh"], env: address ? { ICLOUD_MAIL_ADDRESS: address } : {} });

describe("registerCommand", () => {
  it("is the line to type in Terminal, with paths that contain spaces quoted", () => {
    expect(registerCommand(EXE, SERVER, false)).toBe(`claude mcp add wagonwheel --scope user -e ELECTRON_RUN_AS_NODE=1 -- "${EXE}" "${SERVER}"`);
    expect(registerCommand(EXE, SERVER, true)).toBe(`claude mcp add wagonwheel --scope user -e ELECTRON_RUN_AS_NODE=1 -- "${EXE}" "${SERVER}" --read-only`);
    expect(registerCommand("/opt/app/bin", "/opt/app/server.js", false)).toBe("claude mcp add wagonwheel --scope user -e ELECTRON_RUN_AS_NODE=1 -- /opt/app/bin /opt/app/server.js");
    expect(registerCommand('/we"ird/$HOME', "/s.js", false)).toContain('"/we\\"ird/\\$HOME"');
  });
});

describe("defaultClaudeCandidates", () => {
  it("looks in the usual places first, then along PATH, without repeats", () => {
    const c = defaultClaudeCandidates("/Users/me", "/usr/local/bin:/opt/x/bin");
    expect(c.slice(0, 2)).toEqual(["/Users/me/.local/bin/claude", "/Users/me/.claude/local/claude"]);
    expect(c).toContain("/opt/x/bin/claude");
    expect(c.filter((x) => x === "/usr/local/bin/claude")).toHaveLength(1);
  });
});

describe("Claude Code's connector status", () => {
  it("is not connected when Claude Code has no such connector, whether the file is missing, broken or empty", async () => {
    for (const setup of [() => undefined, () => fs.writeFileSync(configFile(), "{ not json"), () => fs.writeFileSync(configFile(), "[]"), () => writeConfig({}), () => fs.writeFileSync(configFile(), JSON.stringify({ mcpServers: "nope" }))]) {
      setup();
      const s = (await make().status()).claude;
      expect(s.state).toBe("not_connected");
      expect(s.readOnly).toBe(false);
    }
  });

  it("is connected when the registration runs this app's server, and says whether it is read-only", async () => {
    writeConfig({ wagonwheel: wagonEntry() });
    expect((await make().status()).claude).toMatchObject({ state: "connected", readOnly: false, registeredProgram: null });
    writeConfig({ wagonwheel: wagonEntry([SERVER, "--read-only"]) });
    expect((await make().status()).claude).toMatchObject({ state: "connected", readOnly: true });
  });

  it("says when it is registered but pointing somewhere else", async () => {
    writeConfig({ wagonwheel: wagonEntry(["/Users/me/Downloads/old/app.asar/server.js"], "/Users/me/Downloads/Nucleus Wagonwheel") });
    expect((await make().status()).claude).toMatchObject({ state: "elsewhere", readOnly: false, registeredProgram: "/Users/me/Downloads/Nucleus Wagonwheel" });
  });

  it("calls a development run what it is, whatever Claude Code has", async () => {
    writeConfig({ wagonwheel: wagonEntry() });
    expect((await make({ packaged: false }).status()).claude.state).toBe("dev_build");
  });

  it("offers both commands, and says whether Claude Code's tool can be found", async () => {
    let s = (await make().status()).claude;
    expect(s.claudeFound).toBe(false);
    expect(s.command).toBe(registerCommand(EXE, SERVER, false));
    expect(s.commandReadOnly).toBe(registerCommand(EXE, SERVER, true));
    s = (await make({ claudeCandidates: [path.join(dir, "no-such"), fakeClaude()] }).status()).claude;
    expect(s.claudeFound).toBe(true);
    // a file that is not executable, or a folder, does not count
    const plain = path.join(dir, "plain"); fs.writeFileSync(plain, "x", { mode: 0o644 });
    expect((await make({ claudeCandidates: [plain, dir] }).status()).claude.claudeFound).toBe(false);
  });

  it("never lets another connector's settings, or a secret in this file, leave the service", async () => {
    writeConfig(
      { wagonwheel: wagonEntry(), other: { type: "http", url: "https://x", headers: { Authorization: "Bearer SECRET-TOKEN-123" } }, stdio: { type: "stdio", command: "npx", args: ["-y", "thing"], env: { API_KEY: "SECRET-KEY-456" } }, icloud: icloudEntry() },
      { oauthAccount: { emailAddress: "someone@else.com" }, userID: "SECRET-USER-789" },
    );
    installIcloud();
    const everything = JSON.stringify(await make().status());
    for (const secret of ["SECRET-TOKEN-123", "SECRET-KEY-456", "SECRET-USER-789", "someone@else.com", "Bearer"]) expect(everything).not.toContain(secret);
  });
});

describe("connecting and disconnecting", () => {
  it("clears any earlier registration, then adds this one, with Claude Code's own command", async () => {
    const claude = fakeClaude();
    results.push((_f, args) => (args[1] === "add" ? undefined : undefined));
    const svc = make({ claudeCandidates: [claude] });
    await svc.connect(false);
    expect(calls.slice(0, 2)).toEqual([
      { file: claude, args: ["mcp", "remove", "wagonwheel", "--scope", "user"], env: undefined },
      { file: claude, args: ["mcp", "add", "wagonwheel", "--scope", "user", "-e", "ELECTRON_RUN_AS_NODE=1", "--", EXE, SERVER], env: undefined },
    ]);
  });

  it("adds --read-only when asked, and reports the new state", async () => {
    const claude = fakeClaude();
    // stand in for Claude Code: its `add` writes the registration
    results.push((_f, args) => { if (args[1] === "add") writeConfig({ wagonwheel: wagonEntry(args.slice(args.indexOf("--") + 2)) }); return undefined; });
    const s = await make({ claudeCandidates: [claude] }).connect(true);
    expect(calls[1].args.slice(-3)).toEqual([EXE, SERVER, "--read-only"].slice(-3));
    expect(calls[1].args[calls[1].args.length - 1]).toBe("--read-only");
    expect(s.claude).toMatchObject({ state: "connected", readOnly: true });
  });

  it("does not mind that there was nothing to remove first", async () => {
    const claude = fakeClaude();
    results.push((_f, args) => (args[1] === "remove" ? { code: 1, stderr: "No MCP server found with name: wagonwheel" } : undefined));
    await expect(make({ claudeCandidates: [claude] }).connect(false)).resolves.toBeTruthy();
  });

  it("says what Claude Code said when it refuses", async () => {
    const claude = fakeClaude();
    results.push((_f, args) => (args[1] === "add" ? { code: 1, stderr: "error: something is wrong\nwith the config\n" } : undefined));
    await expect(make({ claudeCandidates: [claude] }).connect(false)).rejects.toThrow("Claude Code would not add the connector: error: something is wrong with the config.");
  });

  it("explains itself when there is no tool to run, or this is a development run", async () => {
    await expect(make().connect(false)).rejects.toThrow(/command-line tool was not found/);
    await expect(make({ packaged: false, claudeCandidates: [fakeClaude()] }).connect(false)).rejects.toThrow(/installed Nucleus Wagonwheel/);
    expect(calls).toEqual([]);
  });

  it("removes the connector, and is fine when it is already gone", async () => {
    const claude = fakeClaude();
    writeConfig({ wagonwheel: wagonEntry() });
    results.push((_f, args) => { if (args[1] === "remove") writeConfig({}); return undefined; });
    const svc = make({ claudeCandidates: [claude] });
    expect((await svc.disconnect()).claude.state).toBe("not_connected");
    expect(calls).toEqual([{ file: claude, args: ["mcp", "remove", "wagonwheel", "--scope", "user"], env: undefined }]);
    calls.length = 0;
    await svc.disconnect();
    expect(calls).toEqual([]);   // nothing registered, so nothing to run
  });

  it("reports a removal Claude Code refused", async () => {
    const claude = fakeClaude();
    writeConfig({ wagonwheel: wagonEntry() });
    results.push((_f, args) => (args[1] === "remove" ? { code: 1, stderr: "permission denied" } : undefined));
    await expect(make({ claudeCandidates: [claude] }).disconnect()).rejects.toThrow("Claude Code would not remove the connector: permission denied.");
  });

  it("gives the Terminal command when it cannot run Claude Code to disconnect", async () => {
    writeConfig({ wagonwheel: wagonEntry() });
    await expect(make().disconnect()).rejects.toThrow("claude mcp remove wagonwheel --scope user");
  });
});

describe("the iCloud Mail connector's status", () => {
  it("is not installed, not registered, and says nothing about the password", async () => {
    expect((await make().status()).icloud).toEqual({ installed: false, registered: false, address: null, passwordStored: null, storeCommand: null });
    expect(calls).toEqual([]);   // no address, so no Keychain question
  });

  it("is installed but not yet registered", async () => {
    installIcloud();
    expect((await make().status()).icloud).toMatchObject({ installed: true, registered: false, address: null, passwordStored: null });
  });

  it("asks the Keychain only whether the password exists, never for the password", async () => {
    installIcloud();
    writeConfig({ "icloud-mail": icloudEntry() });
    results.push(() => ({ code: 44 }));
    const s = (await make().status()).icloud;
    expect(s).toEqual({ installed: true, registered: true, address: ADDRESS, passwordStored: false, storeCommand: `security add-generic-password -a "${ADDRESS}" -s "claude-icloud-mail" -w` });
    expect(calls).toEqual([{ file: "/usr/bin/security", args: ["find-generic-password", "-a", ADDRESS, "-s", "claude-icloud-mail"], env: undefined }]);
    expect(calls[0].args).not.toContain("-w");
    expect(calls[0].args).not.toContain("-g");
    results.length = 0;
    expect((await make().status()).icloud.passwordStored).toBe(true);
  });

  it("ignores an address that is not one", async () => {
    installIcloud();
    writeConfig({ "icloud-mail": icloudEntry("not an address") });
    expect((await make().status()).icloud).toMatchObject({ registered: true, address: null, passwordStored: null, storeCommand: null });
  });
});

describe("checking the iCloud sign-in", () => {
  it("runs the connector's own check with the registered address, and returns what it printed", async () => {
    installIcloud();
    writeConfig({ "icloud-mail": icloudEntry() });
    results.push(() => ({ code: 0, stdout: "Signed in to iCloud Mail as me@icloud.com.\n  INBOX   40000 messages,    197 unread\n" }));
    const r = await make().checkIcloud();
    expect(r).toEqual({ ok: true, output: "Signed in to iCloud Mail as me@icloud.com.\n  INBOX   40000 messages,    197 unread" });
    expect(calls[0]).toEqual({ file: "/bin/bash", args: [path.join(icloudDir(), "run.sh"), "--check"], env: { ICLOUD_MAIL_ADDRESS: ADDRESS } });
  });

  it("reports a failure with its explanation, and clips a very long one", async () => {
    installIcloud();
    writeConfig({ "icloud-mail": icloudEntry() });
    results.push(() => ({ code: 1, stderr: "No iCloud app-specific password is stored for me@icloud.com." }));
    expect(await make().checkIcloud()).toEqual({ ok: false, output: "No iCloud app-specific password is stored for me@icloud.com." });
    results.length = 0;
    results.push(() => ({ code: 1, stderr: "x".repeat(5000) }));
    expect((await make().checkIcloud()).output).toHaveLength(3001);
    results.length = 0;
    results.push(() => ({ code: 1 }));
    expect((await make().checkIcloud()).output).toBe("It exited with 1 and said nothing.");
  });

  it("says what is missing instead of running anything", async () => {
    await expect(make().checkIcloud()).rejects.toThrow(/not installed on this Mac/);
    installIcloud();
    await expect(make().checkIcloud()).rejects.toThrow(/not registered with Claude Code yet/);
    expect(calls).toEqual([]);
  });
});

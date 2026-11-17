import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { AppError } from "../db/errors.js";
import type { ClaudeConnectorStatus, ConnectorsStatus, IcloudCheck, IcloudConnectorStatus } from "../../shared/connectors.js";

// The Connectors panel's side of things: how Claude Code is set up to use Wagonwheel's connector and the
// iCloud Mail one. It READS Claude Code's own list of connectors (the `mcpServers` in ~/.claude.json) and
// changes it only by running Claude Code's own `claude mcp` command, never by editing that file. It never
// returns a secret: the file also holds other servers' settings, and nothing but a handful of facts about
// these two leaves this module.

export const CONNECTOR_NAME = "wagonwheel";
export const ICLOUD_NAME = "icloud-mail";
export const KEYCHAIN_SERVICE = "claude-icloud-mail";

export interface ExecResult { code: number; stdout: string; stderr: string }
export type Exec = (file: string, args: string[], options?: { env?: Record<string, string>; timeoutMs?: number }) => Promise<ExecResult>;

/** Run a program and always answer, never throw: the exit code says how it went (127 when it could not start). */
export const nodeExec: Exec = (file, args, options = {}) =>
  new Promise((resolve) => {
    execFile(file, args, { env: { ...process.env, ...options.env }, timeout: options.timeoutMs ?? 30_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      let code = 0;
      if (error) {
        const c = (error as { code?: unknown }).code;
        code = typeof c === "number" ? c : c === "ENOENT" ? 127 : 1;
      }
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

export interface ConnectorsDeps {
  /** The program a registration runs: the app's own executable (it runs the server as Node). */
  exe: string;
  /** The MCP server inside the app. */
  serverPath: string;
  /** False for a development run, which has no stable path to register. */
  packaged: boolean;
  /** Claude Code's settings file, where its connectors are listed. */
  configFile: string;
  /** Where the iCloud Mail connector's files are. */
  icloudDir: string;
  /** Places Claude Code's command-line tool might be, best first. */
  claudeCandidates: string[];
  securityBin: string;
  exec?: Exec;
}

/** Where `claude` usually is. An app started from the Dock has a short PATH, so look in the usual places too. */
export function defaultClaudeCandidates(home: string, pathVar = process.env.PATH ?? ""): string[] {
  const fixed = [path.join(home, ".local", "bin", "claude"), path.join(home, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  const onPath = pathVar.split(path.delimiter).filter(Boolean).map((d) => path.join(d, "claude"));
  return [...new Set([...fixed, ...onPath])];
}

const isExecutable = (file: string): boolean => {
  try { return fs.statSync(file).isFile() && (fs.accessSync(file, fs.constants.X_OK), true); } catch { return false; }
};

const shellWord = (s: string): string => (/^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, "\\$1")}"`);

/** The `claude mcp add` line for Wagonwheel's connector, as it would be typed in Terminal. */
export function registerCommand(exe: string, serverPath: string, readOnly: boolean): string {
  return ["claude mcp add", CONNECTOR_NAME, "--scope user", "-e ELECTRON_RUN_AS_NODE=1", "--", shellWord(exe), shellWord(serverPath), ...(readOnly ? ["--read-only"] : [])].join(" ");
}

interface Entry { command: string; args: string[]; env: Record<string, string> }
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const firstLines = (text: string, n = 3): string => text.trim().split("\n").filter(Boolean).slice(0, n).join(" ").slice(0, 400);

export class ConnectorsService {
  private readonly exec: Exec;
  constructor(private readonly d: ConnectorsDeps) {
    this.exec = d.exec ?? nodeExec;
  }

  /** Claude Code's user-level connectors, reduced to what is well-formed. Anything unreadable is simply none. */
  private servers(): Record<string, Entry> {
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(this.d.configFile, "utf8")); } catch { return {}; }
    const list = isObject(raw) && isObject(raw.mcpServers) ? raw.mcpServers : {};
    const out: Record<string, Entry> = {};
    for (const [name, v] of Object.entries(list)) {
      if (!isObject(v) || typeof v.command !== "string") continue;
      out[name] = {
        command: v.command,
        args: Array.isArray(v.args) ? v.args.filter((a): a is string => typeof a === "string") : [],
        env: isObject(v.env) ? Object.fromEntries(Object.entries(v.env).filter((e): e is [string, string] => typeof e[1] === "string")) : {},
      };
    }
    return out;
  }

  private claudeBin(): string | null {
    return this.d.claudeCandidates.find(isExecutable) ?? null;
  }

  private claudeStatus(servers: Record<string, Entry>): ClaudeConnectorStatus {
    const { exe, serverPath, packaged } = this.d;
    const entry = servers[CONNECTOR_NAME];
    let state: ClaudeConnectorStatus["state"];
    if (!packaged) state = "dev_build";
    else if (!entry) state = "not_connected";
    else state = entry.command === exe && entry.args[0] === serverPath ? "connected" : "elsewhere";
    return {
      state,
      readOnly: state === "connected" && !!entry?.args.includes("--read-only"),
      claudeFound: this.claudeBin() !== null,
      command: registerCommand(exe, serverPath, false),
      commandReadOnly: registerCommand(exe, serverPath, true),
      registeredProgram: state === "elsewhere" && entry ? entry.command : null,
    };
  }

  private async icloudStatus(servers: Record<string, Entry>): Promise<IcloudConnectorStatus> {
    const installed = fs.existsSync(path.join(this.d.icloudDir, "server.mjs"));
    const entry = servers[ICLOUD_NAME];
    const given = entry?.env.ICLOUD_MAIL_ADDRESS?.trim();
    const address = given && EMAIL.test(given) ? given : null;
    let passwordStored: boolean | null = null;
    if (address) {
      // Attributes only (no -w or -g), so the Keychain neither prompts nor reveals the password.
      const r = await this.exec(this.d.securityBin, ["find-generic-password", "-a", address, "-s", KEYCHAIN_SERVICE], { timeoutMs: 10_000 });
      passwordStored = r.code === 0;
    }
    return {
      installed,
      registered: !!entry,
      address,
      passwordStored,
      storeCommand: address ? `security add-generic-password -a "${address}" -s "${KEYCHAIN_SERVICE}" -w` : null,
    };
  }

  async status(): Promise<ConnectorsStatus> {
    const servers = this.servers();
    return { claude: this.claudeStatus(servers), icloud: await this.icloudStatus(servers) };
  }

  /** Register Wagonwheel's connector with Claude Code, replacing any earlier registration. */
  async connect(readOnly: boolean): Promise<ConnectorsStatus> {
    const { exe, serverPath, packaged } = this.d;
    if (!packaged) throw new AppError("connector", "Open the installed Nucleus Wagonwheel to connect it. A development run has no fixed location for Claude Code to start.");
    const claude = this.claudeBin();
    if (!claude) throw new AppError("connector", "Claude Code's command-line tool was not found on this Mac. Copy the command and run it in Terminal instead.");
    // `claude mcp add` refuses a name that exists, so clear it first. If there was none, that is fine.
    await this.exec(claude, ["mcp", "remove", CONNECTOR_NAME, "--scope", "user"]);
    const added = await this.exec(claude, ["mcp", "add", CONNECTOR_NAME, "--scope", "user", "-e", "ELECTRON_RUN_AS_NODE=1", "--", exe, serverPath, ...(readOnly ? ["--read-only"] : [])]);
    if (added.code !== 0) throw new AppError("connector", `Claude Code would not add the connector: ${firstLines(added.stderr || added.stdout) || `it exited with ${added.code}`}.`);
    return this.status();
  }

  async disconnect(): Promise<ConnectorsStatus> {
    if (this.servers()[CONNECTOR_NAME]) {
      const claude = this.claudeBin();
      if (!claude) throw new AppError("connector", `Claude Code's command-line tool was not found on this Mac. Run this in Terminal instead: claude mcp remove ${CONNECTOR_NAME} --scope user`);
      const removed = await this.exec(claude, ["mcp", "remove", CONNECTOR_NAME, "--scope", "user"]);
      if (removed.code !== 0 && this.servers()[CONNECTOR_NAME]) throw new AppError("connector", `Claude Code would not remove the connector: ${firstLines(removed.stderr || removed.stdout) || `it exited with ${removed.code}`}.`);
    }
    return this.status();
  }

  /** Ask the iCloud Mail connector to sign in (its own `--check`), and report what it said. */
  async checkIcloud(): Promise<IcloudCheck> {
    const servers = this.servers();
    const run = path.join(this.d.icloudDir, "run.sh");
    if (!fs.existsSync(run)) throw new AppError("connector", `The iCloud Mail connector is not installed on this Mac (expected in ${this.d.icloudDir}).`);
    const given = servers[ICLOUD_NAME]?.env.ICLOUD_MAIL_ADDRESS?.trim();
    if (!given || !EMAIL.test(given)) throw new AppError("connector", "The iCloud Mail connector is not registered with Claude Code yet, so there is no address to sign in with.");
    const r = await this.exec("/bin/bash", [run, "--check"], { env: { ICLOUD_MAIL_ADDRESS: given }, timeoutMs: 60_000 });
    const output = `${r.stdout}${r.stderr}`.trim();
    return { ok: r.code === 0, output: output.length > 3000 ? `${output.slice(0, 3000)}…` : output || (r.code === 0 ? "Signed in." : `It exited with ${r.code} and said nothing.`) };
  }
}

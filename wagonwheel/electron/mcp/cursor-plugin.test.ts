import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { Workspace } from "../db/repo.js";
import { buildTools } from "./tools.js";

// The Cursor plugin in ../../cursor-plugin is only files, so these tests are what keeps it honest:
// the manifest follows Cursor's rules, the server it starts is the one Claude Code starts, and
// every tool its instructions name is a tool the connector really has.

const root = fileURLToPath(new URL("../../", import.meta.url));
const plugin = path.join(root, "cursor-plugin");
const read = (...p: string[]): string => fs.readFileSync(path.join(plugin, ...p), "utf8");
const json = (...p: string[]) => JSON.parse(read(...p)) as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

/** The `key: value` lines between the --- fences of a markdown file. */
function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error("no frontmatter");
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

const toolNames = (readOnly: boolean): string[] => buildTools(new Workspace(openDatabase(":memory:")), { readOnly }).map((t) => t.name);

describe("the manifest", () => {
  const manifest = json(".cursor-plugin", "plugin.json");

  it("has a name Cursor accepts, and says what the plugin is", () => {
    expect(manifest.name).toMatch(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(String(manifest.description).length).toBeGreaterThan(20);
  });

  it("names its logo by a relative path that exists, and no component path leaves the plugin", () => {
    expect(manifest.logo).toBe("assets/logo.svg");
    expect(fs.existsSync(path.join(plugin, manifest.logo))).toBe(true);
    for (const key of ["rules", "agents", "skills", "commands", "hooks", "mcpServers"]) {
      for (const p of [manifest[key]].flat().filter((v) => typeof v === "string")) {
        expect(p, key).not.toMatch(/(^|\/)\.\.(\/|$)|^\//);
      }
    }
  });

  it("holds no secret: it declares no variables and mcp.json has no placeholders", () => {
    expect(manifest.variables).toBeUndefined();
    expect(read("mcp.json")).not.toMatch(/\$\{/);
  });
});

describe("mcp.json", () => {
  const server = json("mcp.json").mcpServers.wagonwheel;

  it("starts the app's own connector on the app's own Node, like the Claude Code registration", () => {
    expect(Object.keys(json("mcp.json").mcpServers)).toEqual(["wagonwheel"]);
    expect(server.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
    expect(server.args).toHaveLength(1);
    expect(server.args[0]).toMatch(/\/Contents\/Resources\/app\.asar\/dist-electron\/electron\/mcp\/server\.js$/);
    // The README's `claude mcp add` is the other way in; both must name the same two files.
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    const named = new Set([...readme.matchAll(/"(\/Applications\/Nucleus Wagonwheel\.app\/[^"]+)"/g)].map((m) => m[1]));
    expect(named.has(server.command)).toBe(true);
    expect(named.has(server.args[0])).toBe(true);
  });

  it("is where the build puts the server, relative to the app bundle", () => {
    expect(fs.existsSync(path.join(root, "electron", "mcp", "server.ts"))).toBe(true);   // tsc emits it to dist-electron/electron/mcp/server.js
  });
});

describe("the skill and the command", () => {
  const skill = read("skills", "wagonwheel", "SKILL.md");
  const command = read("commands", "wagonwheel-week.md");

  it("carry the frontmatter Cursor reads, with names that match their files", () => {
    expect(frontmatter(skill).name).toBe("wagonwheel");
    expect(frontmatter(skill).description.length).toBeGreaterThan(40);
    expect(frontmatter(command).name).toBe("wagonwheel-week");
    expect(frontmatter(command).description.length).toBeGreaterThan(20);
  });

  it("name only tools the connector has", () => {
    const real = new Set(toolNames(false));
    const mentioned = new Set(
      [skill, command].flatMap((t) => [...t.matchAll(/`((?:get|list|create|update|complete|add|record|delete|remove)_[a-z_]+)`/g)].map((m) => m[1])),
    );
    expect(mentioned.size).toBeGreaterThan(8);
    for (const name of mentioned) expect(real.has(name), name).toBe(true);
  });

  it("describe the read-only tool as read-only and the bill tool as a write", () => {
    expect(toolNames(true)).toContain("list_services");
    expect(toolNames(true)).not.toContain("record_service_bill");
    expect(skill).toMatch(/`list_services`[^\n]*[\s\S]*It is read-only/);
  });

  it("do not promise a delete tool", () => {
    expect(toolNames(false).some((n) => /^(delete|remove)_/.test(n))).toBe(false);
    expect(skill).toMatch(/no delete tools/i);
  });
});

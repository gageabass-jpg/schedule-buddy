#!/usr/bin/env node
// Starts the server exactly as cursor-plugin/mcp.json says, says hello the way an MCP client does,
// asks for its tools, and prints them. Nothing is read or changed in your workspace.
//
//   node scripts/check-cursor-plugin.mjs [path/to/plugin]    (default: ./cursor-plugin)
//
// It exits 0 when the server answers with its tools, 1 otherwise. The app must be installed where
// mcp.json points and have been opened once (that creates the database).

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.argv[2] ?? path.join(here, "..", "cursor-plugin"));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, ".cursor-plugin", "plugin.json"), "utf8"));
const servers = JSON.parse(fs.readFileSync(path.join(dir, "mcp.json"), "utf8")).mcpServers;
const [name, spec] = Object.entries(servers)[0];
const fail = (message) => { console.error(`FAIL  ${message}`); process.exit(1); };

if (!fs.existsSync(spec.command)) fail(`${spec.command} is not there. Install Nucleus Wagonwheel first, or edit the paths in mcp.json.`);

const child = spawn(spec.command, spec.args ?? [], { env: { ...process.env, ...(spec.env ?? {}) }, stdio: ["pipe", "pipe", "pipe"] });
let out = "";
let err = "";
const replies = new Map();
child.stderr.on("data", (d) => { err += d; });
child.stdout.on("data", (d) => {
  out += d;
  let at;
  while ((at = out.indexOf("\n")) >= 0) {
    const line = out.slice(0, at);
    out = out.slice(at + 1);
    if (!line.trim()) continue;
    try { const msg = JSON.parse(line); if (msg.id !== undefined) replies.set(msg.id, msg); } catch { /* not a reply */ }
  }
});
const timer = setTimeout(() => { child.kill(); fail(`no answer in 15 s. ${err.trim() || "(the server printed nothing)"}`); }, 15000);
const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const reply = async (id) => { while (!replies.has(id)) await new Promise((r) => setTimeout(r, 25)); return replies.get(id); };
child.on("exit", (code) => { if (code && !replies.has(2)) { clearTimeout(timer); fail(`the server stopped (exit ${code}). ${err.trim()}`); } });

send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check-cursor-plugin", version: "1" } } });
const init = await reply(1);
if (!init.result) fail(`initialize was refused: ${JSON.stringify(init.error)}`);
send({ method: "notifications/initialized" });
send({ id: 2, method: "tools/list" });
const list = await reply(2);
if (!list.result?.tools?.length) fail(`tools/list returned no tools: ${JSON.stringify(list)}`);
clearTimeout(timer);
child.stdin.end();

const tools = list.result.tools;
const read = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
const write = tools.filter((t) => !t.annotations?.readOnlyHint).map((t) => t.name);
console.log(`OK    plugin "${manifest.name}" ${manifest.version}: server "${name}" is ${init.result.serverInfo?.name} ${init.result.serverInfo?.version}`);
console.log(`      ${tools.length} tools. Read: ${read.join(", ")}`);
console.log(`      Change things: ${write.join(", ")}`);

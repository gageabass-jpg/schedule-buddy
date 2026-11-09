#!/usr/bin/env node
// Runs the end-to-end suite. On Linux with no display it starts a virtual one (xvfb-run).
// Usage: node e2e/run.mjs [--test-name-pattern=…] [test files…]      Accept a changed screenshot: UPDATE_SNAPSHOTS=1 node e2e/run.mjs
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const given = process.argv.slice(2);
const flags = given.filter((a) => a.startsWith("--"));              // e.g. --test-name-pattern=dashboard
const named = given.filter((a) => !a.startsWith("--"));
const files = named.length ? named : ["e2e/screenshot.test.mjs", "e2e/app.test.mjs"];
const node = ["--test", "--test-concurrency=1", "--test-timeout=120000", ...flags, ...files];
const virtual = process.platform === "linux" && !process.env.DISPLAY;
const [cmd, args] = virtual ? ["xvfb-run", ["-a", "-s", "-screen 0 1600x1000x24", "node", ...node]] : ["node", node];
const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: process.env });
if (r.error) { console.error(r.error.message); process.exit(1); }
process.exit(r.status ?? 1);

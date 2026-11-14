import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDatabase } from "../db/database.js";
import { Workspace } from "../db/repo.js";
import { createMcpServer, serveStdio } from "./protocol.js";
import { buildTools, WAGONWHEEL_INSTRUCTIONS } from "./tools.js";

// The Wagonwheel connector for Claude Code: a stdio MCP server that opens the same database file
// as the app, so Claude Code can read and update your projects and tasks whether or not the app is
// open. Run it with the app's own Node, so nothing else needs installing:
//
//   ELECTRON_RUN_AS_NODE=1 "/Applications/Nucleus Wagonwheel.app/Contents/MacOS/Nucleus Wagonwheel" \
//     "/Applications/Nucleus Wagonwheel.app/Contents/Resources/app.asar/dist-electron/electron/mcp/server.js"
//
// Options: --read-only (or WAGONWHEEL_MCP_READONLY=1) leaves out every tool that changes anything.
//          WAGONWHEEL_DATA_DIR points it at another data folder (the tests do).

/** Where the app keeps its data: the folder named after the app, in the platform's usual place. */
function dataDir(): string {
  if (process.env.WAGONWHEEL_DATA_DIR) return process.env.WAGONWHEEL_DATA_DIR;
  const name = "Nucleus Wagonwheel";
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", name);
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), name);
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), name);
}

function version(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function main(): void {
  const file = path.join(dataDir(), "wagonwheel.db");
  if (!fs.existsSync(file)) {
    process.stderr.write(`Wagonwheel has no workspace at ${file} yet. Open the app once, then try again.\n`);
    process.exit(1);
  }
  const db = openDatabase(file);
  const readOnly = process.argv.includes("--read-only") || process.env.WAGONWHEEL_MCP_READONLY === "1";
  const server = createMcpServer({
    name: "wagonwheel",
    version: version(),
    instructions: WAGONWHEEL_INSTRUCTIONS + (readOnly ? "\nThis connection is read-only." : ""),
    tools: buildTools(new Workspace(db), { readOnly }),
  });
  void serveStdio(server).then(() => { try { db.close(); } catch { /* already closed */ } process.exit(0); });
}

main();

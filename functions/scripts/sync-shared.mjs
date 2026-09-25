// Copy the shared domain modules into functions/src before tsc runs.
//
// Firebase packs only the functions directory when it deploys, so a sibling
// folder can't be imported from here at runtime — the copy is what makes
// shared/ reachable on the server. It is generated, gitignored, and rewritten
// on every build, so shared/ stays the single source of truth.

import { cp, rm, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "..", "shared");
const to = join(here, "..", "src", "shared");

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });

const files = await readdir(to);
console.log(`synced shared/ -> functions/src/shared (${files.join(", ")})`);

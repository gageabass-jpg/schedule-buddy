// Tests for the isolation guard. Each case builds a real git repository in a temp
// folder, so the guard is exercised against real history, real patch-ids and real
// rename handling. Run: node --test scripts/guard-wagonwheel-isolation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), "guard-wagonwheel-isolation.mjs");

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  const write = (file, text) => {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  };
  const commit = (files, message) => {
    for (const [f, t] of Object.entries(files)) write(f, t);
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD").trim();
  };
  commit({ "desktop/a.ts": "a\n", "shared-ui/b.ts": "b\n", "README.md": "r\n" }, "base");
  return { dir, git, write, commit, remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function guard(r, env = {}, extra = []) {
  const res = spawnSync("node", [GUARD, "--base", "main", "--head", "HEAD", "--repo", r.dir, ...extra], {
    encoding: "utf8",
    env: { ...process.env, PR_TITLE: "", PR_BRANCH: "", PR_LABELS: "", ...env },
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

function withRepo(fn) {
  const r = makeRepo();
  try { r.git("checkout", "-q", "-b", "feature"); return fn(r); } finally { r.remove(); }
}

test("a Wagonwheel-only pull request passes", () => withRepo((r) => {
  r.commit({ "wagonwheel/x.ts": "x\n" }, "wagonwheel: add x");
  const g = guard(r, { PR_BRANCH: "wagonwheel/x" });
  assert.equal(g.code, 0, g.err);
}));

test("one commit that changes wagonwheel/ and desktop/ fails, and names the file", () => withRepo((r) => {
  r.commit({ "wagonwheel/x.ts": "x\n", "desktop/a.ts": "changed\n" }, "tweak things");
  const g = guard(r);
  assert.equal(g.code, 1);
  assert.match(g.err, /desktop\/a\.ts/);
  assert.match(g.err, /same commit also changes wagonwheel\//);
}));

test("a neutral commit to shared-ui fails when the same PR changes wagonwheel/", () => withRepo((r) => {
  r.commit({ "wagonwheel/x.ts": "x\n" }, "add x");
  r.commit({ "shared-ui/b.ts": "changed\n" }, "adjust button padding");
  const g = guard(r);
  assert.equal(g.code, 1);
  assert.match(g.err, /this pull request changes wagonwheel\//);
}));

test("a Nucleus-only change with no link to Wagonwheel passes", () => withRepo((r) => {
  r.commit({ "desktop/a.ts": "fixed a bug\n" }, "Fix week view overflow");
  const g = guard(r, { PR_TITLE: "Fix week view overflow", PR_BRANCH: "fix/week-view" });
  assert.equal(g.code, 0, g.err);
}));

test("a shared-ui change whose message mentions Wagonwheel fails", () => withRepo((r) => {
  r.commit({ "shared-ui/b.ts": "changed\n" }, "Tweak Button for the Wagonwheel theme");
  const g = guard(r);
  assert.equal(g.code, 1);
  assert.match(g.err, /message mentions Wagonwheel/);
}));

test("the branch name, the title and a label each make a PR a Wagonwheel PR", () => {
  for (const env of [{ PR_BRANCH: "claude/wagonwheel-icons" }, { PR_TITLE: "Wagonwheel: new colours" }, { PR_LABELS: "bug, Wagonwheel" }]) {
    withRepo((r) => {
      r.commit({ "shared-ui/b.ts": "changed\n" }, "adjust padding");
      const g = guard(r, env);
      assert.equal(g.code, 1, JSON.stringify(env));
      assert.match(g.err, /named or labelled for Wagonwheel/);
    });
  }
});

test("folders that only look like the protected ones do not count", () => withRepo((r) => {
  r.commit({ "desktop-tools/a.ts": "x\n", "shared-uix/b.ts": "x\n", "wagonwheel/c.ts": "x\n" }, "wagonwheel: stuff");
  const g = guard(r);
  assert.equal(g.code, 0, g.err);
}));

test("moving a file OUT of desktop/ is caught by its old path", () => withRepo((r) => {
  fs.mkdirSync(path.join(r.dir, "wagonwheel"));
  r.git("mv", "desktop/a.ts", "wagonwheel/a.ts");
  r.git("commit", "-q", "-m", "move a");
  r.commit({ "wagonwheel/other.ts": "x\n" }, "wagonwheel: other");
  const g = guard(r);
  assert.equal(g.code, 1);
  assert.match(g.err, /desktop\/a\.ts/);
}));

test("changing a protected file and reverting it in the same PR still fails (strict, on purpose)", () => withRepo((r) => {
  r.commit({ "wagonwheel/x.ts": "x\n" }, "wagonwheel: x");
  r.commit({ "shared-ui/b.ts": "changed\n" }, "oops");
  r.commit({ "shared-ui/b.ts": "b\n" }, "revert oops");
  assert.equal(guard(r).code, 1);
}));

test("no commits passes", () => withRepo((r) => {
  assert.equal(guard(r).code, 0);
}));

test("an unknown revision is a usage error, not a pass", () => withRepo((r) => {
  const res = spawnSync("node", [GUARD, "--base", "nope", "--head", "HEAD", "--repo", r.dir], { encoding: "utf8" });
  assert.equal(res.status, 2);
}));

// ── There is no bypass ──────────────────────────────────────────────────────

test("an allowlist file does nothing: there is no exception mechanism", () => withRepo((r) => {
  const sha = r.commit({ "shared-ui/b.ts": "changed\n" }, "adjust padding");
  const id = execFileSync("git", ["patch-id", "--stable"], { cwd: r.dir, input: r.git("diff-tree", "-p", "--no-renames", "--root", sha), encoding: "utf8" }).split(/\s+/)[0];
  r.commit({ ".github/wagonwheel-guard.allow": `${id}  # try to excuse it\n` }, "add an allowlist");
  r.commit({ "wagonwheel/x.ts": "x\n" }, "wagonwheel: x");
  const g = guard(r);
  assert.equal(g.code, 1);
  assert.match(g.err, /adjust padding/);
}));

test("a separate Nucleus pull request, with no link to Wagonwheel, passes with no bypass (how the extraction landed)", () => withRepo((r) => {
  r.commit({ "desktop/a.ts": "moved\n", "shared-ui/b.ts": "moved\n" }, "Extract shared UI primitives into shared-ui/");
  const g = guard(r, { PR_TITLE: "Extract shared UI primitives into shared-ui/ (no behaviour change)", PR_BRANCH: "claude/shared-ui-extraction" });
  assert.equal(g.code, 0, g.err);
}));

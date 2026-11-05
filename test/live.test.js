/** Live smoke test: snapshot the REAL machine running the test.
 * No network, no fixture. On a bare machine every collector reports
 * "not-installed" and the snapshot is valid JSON with zero entries.
 * The test asserts the shape, not the machine: it passes on any machine
 * where the collectors behave gracefully. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const CLI = join(ROOT, "dist", "cli.js");

describe("live smoke (this machine)", () => {
  it("snapshots the real home without crashing", () => {
    const work = mkdtempSync(join(tmpdir(), "toolwatch-live-"));
    const out = join(work, "live.json");
    const r = spawnSync("node", [CLI, "snapshot", "--out", out], { cwd: work, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const snap = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(snap.toolwatch, "0.1.0");
    assert.match(snap.fingerprint, /^[0-9a-f]{64}$/);
    assert.ok(Array.isArray(snap.entries));
    for (const [name, info] of Object.entries(snap.collectors)) {
      assert.ok(["ok", "not-installed", "error"].includes(info.status), `${name}: ${info.status}`);
    }
  });
  it("check against its own snapshot reports no drift", () => {
    const work = mkdtempSync(join(tmpdir(), "toolwatch-live2-"));
    const out = join(work, "live.json");
    const r1 = spawnSync("node", [CLI, "snapshot", "--out", out], { cwd: work, encoding: "utf8" });
    assert.equal(r1.status, 0, r1.stderr);
    const r2 = spawnSync("node", [CLI, "check", "--baseline", out], { cwd: work, encoding: "utf8" });
    assert.equal(r2.status, 0, r2.stdout);
    assert.match(r2.stdout, /No drift/);
  });
});

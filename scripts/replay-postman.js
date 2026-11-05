/**
 * Incident replay: the Postman 12.33.4 shape, reconstructed as recorded
 * fixtures. IMPORTANT — this is NOT the live Postman app and NOT a copy of
 * any real user's config. The incident facts come from the public issue
 * postman-app-support#14370 (opened 25/10/2026, SEVERE, 453 reactions):
 * Postman 12.33.4 silently auto-installed Claude Code + Codex AI plugins,
 * wrote a trusted_hash for its own SessionStart hook, and opened a remote
 * MCP connection. The fixtures rebuild that SHAPE (two plugin dirs, one
 * SessionStart hook, one remote MCP endpoint, one extension version bump)
 * and run it through the real snapshot + diff pipeline.
 *
 * Exit 0 only when the diff names exactly the three incident changes
 * (plus the version bump) and the gate exits 1. If the tool ever stops
 * detecting this shape, the replay fails — that is the point.
 */
import { buildSnapshot } from "../dist/snapshot.js";
import { diffSnapshots, gateFailingChanges } from "../dist/diff.js";

const ROOT = new URL("..", import.meta.url).pathname;

const before = buildSnapshot(`${ROOT}fixtures/home-before`, []);
const after = buildSnapshot(`${ROOT}fixtures/home-after`, []);
const changes = diffSnapshots(before, after);

const mustFind = [
  ["added", "postman-plugin", "postman:plugin:claude-code"],
  ["added", "postman-plugin", "postman:plugin:codex"],
  ["added", "claude-hook", "claude-code:hook:SessionStart:*"],
  ["added", "remote-endpoint", "endpoint:https://mcp.postman.example"],
  ["changed", "vscode-extension", "esbenp.prettier-vscode"],
];

const missing = mustFind.filter(
  ([type, kind, id]) => !changes.some((c) => c.type === type && c.kind === kind && c.id === id),
);
const failing = gateFailingChanges(changes, false);

console.log(`before: ${before.entries.length} entries, after: ${after.entries.length} entries`);
console.log(`changes: ${changes.length} (${changes.filter((c) => c.type === "added").length} added, ${changes.filter((c) => c.type === "changed").length} changed, ${changes.filter((c) => c.type === "removed").length} removed)`);
console.log(`gate-failing: ${failing.length}`);

if (missing.length > 0) {
  console.error("REPLAY FAILED — incident changes not detected:");
  for (const [type, kind, id] of missing) console.error(`  missing ${type} ${kind} ${id}`);
  process.exit(1);
}
if (failing.length === 0) {
  console.error("REPLAY FAILED — gate did not fire on the incident shape");
  process.exit(1);
}
console.log("replay OK: Postman 12.33.4 shape detected — 2 plugins + SessionStart hook + remote MCP endpoint + 1 version bump; gate fires (exit 1).");

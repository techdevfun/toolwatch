/**
 * Diff two snapshots: added / removed / changed entries, keyed by kind+id.
 * A "changed" entry keeps the same id but a different sha256 — the classic
 * shape of a tool update that bumped a version or rewrote a config.
 */
import type { Change, Entry, Snapshot } from "./types.js";
import { TRUST_KINDS } from "./types.js";

export function diffSnapshots(before: Snapshot, after: Snapshot): Change[] {
  const key = (e: Entry) => `${e.kind}\n${e.id}`;
  const beforeMap = new Map(before.entries.map((e) => [key(e), e]));
  const afterMap = new Map(after.entries.map((e) => [key(e), e]));
  const changes: Change[] = [];

  for (const [k, a] of afterMap) {
    const b = beforeMap.get(k);
    if (!b) {
      changes.push({ type: "added", kind: a.kind, id: a.id, after: a });
    } else if (b.sha256 !== a.sha256 || b.detail !== a.detail) {
      changes.push({ type: "changed", kind: a.kind, id: a.id, before: b, after: a });
    }
  }
  for (const [k, b] of beforeMap) {
    if (!afterMap.has(k)) {
      changes.push({ type: "removed", kind: b.kind, id: b.id, before: b });
    }
  }

  const rank = { added: 0, changed: 1, removed: 2 };
  return changes.sort((x, y) =>
    rank[x.type] !== rank[y.type]
      ? rank[x.type] - rank[y.type]
      : x.kind === y.kind
        ? x.id < y.id
          ? -1
          : 1
        : x.kind < y.kind
          ? -1
          : 1,
  );
}

/** Trust-relevant additions or changes — the set that gates CI. */
export function gateFailingChanges(changes: Change[], strict: boolean): Change[] {
  return changes.filter((c) => {
    if (!TRUST_KINDS.has(c.kind)) return false;
    if (strict) return true;
    return c.type === "added" || c.type === "changed";
  });
}

function changeLine(c: Change): string {
  const mark = c.type === "added" ? "+" : c.type === "removed" ? "-" : "~";
  const base = `${mark} ${c.type.toUpperCase().padEnd(7)} ${c.kind.padEnd(20)} ${c.id}`;
  if (c.type === "changed" && c.before && c.after) {
    return `${base}\n           ${c.before.detail}\n        -> ${c.after.detail}`;
  }
  if (c.type === "added" && c.after) return `${base}\n           ${c.after.detail}`;
  if (c.type === "removed" && c.before) return `${base}\n           ${c.before.detail}`;
  return base;
}

/** Human-readable diff table. */
export function formatDiff(changes: Change[]): string {
  if (changes.length === 0) return "No changes — trust surface is identical.";
  const lines = changes.map(changeLine);
  const added = changes.filter((c) => c.type === "added").length;
  const removed = changes.filter((c) => c.type === "removed").length;
  const changed = changes.filter((c) => c.type === "changed").length;
  lines.push(`\n${changes.length} change(s): ${added} added, ${changed} changed, ${removed} removed.`);
  return lines.join("\n");
}

/** Machine-readable diff (same content, JSON). */
export function diffToJson(before: Snapshot, after: Snapshot, changes: Change[]): string {
  return JSON.stringify(
    {
      before: { createdAt: before.createdAt, fingerprint: before.fingerprint },
      after: { createdAt: after.createdAt, fingerprint: after.fingerprint },
      changes: changes.map((c) => ({
        type: c.type,
        kind: c.kind,
        id: c.id,
        before: c.before ? { detail: c.before.detail, sha256: c.before.sha256 } : null,
        after: c.after ? { detail: c.after.detail, sha256: c.after.sha256 } : null,
      })),
    },
    null,
    2,
  );
}

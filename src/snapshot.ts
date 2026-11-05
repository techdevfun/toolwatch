/**
 * Snapshot model: run the collectors, sort entries canonically, fingerprint.
 * The fingerprint is a sha256 of the sorted entry list, so two snapshots of
 * an unchanged machine are byte-identical in every field that matters.
 */
import { hostname, platform } from "node:os";
import { collectAll } from "./collectors.js";
import { sha256 } from "./hash.js";
import type { Entry, Snapshot } from "./types.js";

export const VERSION = "0.1.0";

/** Canonical entry order: kind, then id. */
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) =>
    a.kind === b.kind ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.kind < b.kind ? -1 : 1,
  );
}

/** Fingerprint: sha256 of the canonical JSON of the sorted entries. */
export function fingerprintEntries(entries: Entry[]): string {
  const sorted = sortEntries(entries);
  const canonical = sorted
    .map((e) => `${e.kind}\n${e.id}\n${e.detail}\n${e.sha256}`)
    .join("\n---\n");
  return sha256(canonical);
}

export function buildSnapshot(home: string, repos: string[]): Snapshot {
  const collectors = collectAll(home, repos);
  const entries = sortEntries(collectors.flatMap((c) => c.entries));
  const summary: Snapshot["collectors"] = {};
  for (const c of collectors) {
    summary[c.name] = { status: c.status, entries: c.entries.length };
  }
  return {
    toolwatch: VERSION,
    createdAt: new Date().toISOString(),
    platform: platform(),
    hostname: hostname(),
    home,
    collectors: summary,
    entries,
    fingerprint: fingerprintEntries(entries),
  };
}

/** Parse and validate a snapshot file (throws on bad shape). */
export function parseSnapshot(data: unknown): Snapshot {
  if (typeof data !== "object" || data === null) throw new Error("snapshot is not an object");
  const s = data as Record<string, unknown>;
  if (typeof s.toolwatch !== "string") throw new Error("snapshot has no toolwatch version");
  if (!Array.isArray(s.entries)) throw new Error("snapshot has no entries array");
  for (const e of s.entries as unknown[]) {
    const entry = e as Record<string, unknown>;
    if (
      typeof entry.id !== "string" ||
      typeof entry.kind !== "string" ||
      typeof entry.detail !== "string" ||
      typeof entry.sha256 !== "string"
    ) {
      throw new Error("snapshot entry is missing id/kind/detail/sha256");
    }
  }
  return s as unknown as Snapshot;
}

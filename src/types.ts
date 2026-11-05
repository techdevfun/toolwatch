/**
 * Shared types for toolwatch: one snapshot is a flat, canonical list of
 * trust-surface entries, each with a content hash so a diff can tell a
 * version bump apart from a brand-new plugin or hook.
 */

export type CollectorStatus = "ok" | "not-installed" | "error";

export type EntryKind =
  | "vscode-extension"
  | "vscode-mcp-server"
  | "claude-plugin"
  | "claude-hook"
  | "claude-mcp-server"
  | "cursor-extension"
  | "cursor-mcp-server"
  | "postman-plugin"
  | "git-hook"
  | "shell-rc"
  | "remote-endpoint";

export interface Entry {
  /** Stable identity, e.g. "esbenp.prettier-vscode" or "claude-code:hook:SessionStart". Version lives in detail/hash, so a bump diffs as CHANGED. */
  id: string;
  kind: EntryKind;
  /** Short human-readable detail (never a secret, never a full URL with credentials). */
  detail: string;
  /** sha256 of the entry's canonical content (file bytes, config JSON, command). */
  sha256: string;
}

export interface CollectorResult {
  name: string;
  status: CollectorStatus;
  /** Present only when status is "error". */
  error?: string;
  entries: Entry[];
}

export interface Snapshot {
  toolwatch: string;
  createdAt: string;
  platform: string;
  hostname: string;
  /** The home directory that was snapshotted (fixture homes differ from $HOME). */
  home: string;
  collectors: Record<string, { status: CollectorStatus; entries: number }>;
  entries: Entry[];
  /** sha256 of the canonical (sorted) entry list. */
  fingerprint: string;
}

export type ChangeType = "added" | "removed" | "changed";

export interface Change {
  type: ChangeType;
  kind: EntryKind;
  id: string;
  before?: Entry;
  after?: Entry;
}

/** Every entry kind in the trust surface is trust-relevant by definition. */
export const TRUST_KINDS: ReadonlySet<EntryKind> = new Set([
  "vscode-extension",
  "vscode-mcp-server",
  "claude-plugin",
  "claude-hook",
  "claude-mcp-server",
  "cursor-extension",
  "cursor-mcp-server",
  "postman-plugin",
  "git-hook",
  "shell-rc",
  "remote-endpoint",
]);

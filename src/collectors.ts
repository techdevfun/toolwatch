/**
 * Collectors: one function per dev tool. Each collector reads well-known
 * config paths under a home directory and returns trust-surface entries.
 * A missing tool is a normal result ("not-installed"), never an error —
 * a snapshot must work on a machine that has none of these tools.
 *
 * Privacy rules (enforced here, not just documented):
 *  - Shell startup files are hashed, never copied into the snapshot.
 *  - Remote endpoints are recorded as scheme://host only — userinfo,
 *    path and query are stripped, so no credential can leak.
 *  - Hook commands are recorded truncated to 200 chars with their full
 *    sha256; snapshots are local audit artifacts, keep them out of
 *    public repos (see README "Honest limits").
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { sha256, sha256Parts } from "./hash.js";
import type { CollectorResult, Entry } from "./types.js";

export type McpServerConfig = Record<string, unknown>;

function readJsonFile(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listSubdirs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => {
        try {
          return statSync(join(dir, n)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

function shortHash(h: string): string {
  return h.slice(0, 12);
}

/** Extract "scheme://host" from a URL string; undefined when unparseable. */
export function endpointHost(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "ws:" && u.protocol !== "wss:") {
      return undefined;
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

/**
 * Turn an MCP `servers` map into mcp-server entries plus remote-endpoint
 * entries for every server that points at a remote URL.
 */
export function mcpServerEntries(
  source: string,
  mcpKind: "vscode-mcp-server" | "claude-mcp-server" | "cursor-mcp-server",
  servers: Record<string, McpServerConfig> | undefined,
): Entry[] {
  const entries: Entry[] = [];
  if (!servers) return entries;
  for (const name of Object.keys(servers).sort()) {
    const cfg = servers[name] as Record<string, unknown>;
    const url = typeof cfg.url === "string" ? cfg.url : undefined;
    const type = typeof cfg.type === "string" ? cfg.type : undefined;
    const command = typeof cfg.command === "string" ? cfg.command : undefined;
    const transport = url ? (type ?? (url.startsWith("ws") ? "websocket" : "http")) : "stdio";
    const detail = url
      ? `${transport} ${endpointHost(url) ?? "unparseable-url"}`
      : `stdio ${command ?? "unknown-command"}`;
    entries.push({
      id: `${source}:mcp:${name}`,
      kind: mcpKind,
      detail,
      sha256: sha256(JSON.stringify(cfg)),
    });
    if (url) {
      const host = endpointHost(url);
      if (host) {
        entries.push({
          id: `endpoint:${host}`,
          kind: "remote-endpoint",
          detail: `via ${source} mcp server "${name}" (${transport})`,
          sha256: sha256Parts([source, name, host]),
        });
      }
    }
  }
  return entries;
}

/** Parse a VS Code / Cursor extensions directory into entries. */
export function parseExtensionsDir(
  dir: string,
  kind: "vscode-extension" | "cursor-extension",
): Entry[] {
  const entries: Entry[] = [];
  for (const sub of listSubdirs(dir)) {
    const pkgPath = join(dir, sub, "package.json");
    const pkg = readJsonFile(pkgPath);
    if (pkg && typeof pkg.publisher === "string" && typeof pkg.name === "string") {
      const version = typeof pkg.version === "string" ? pkg.version : "unknown";
      // The version lives in detail/hash, NOT in the id: a version bump
      // then diffs as one CHANGED row instead of an added+removed pair.
      const id = `${pkg.publisher}.${pkg.name}`;
      entries.push({
        id,
        kind,
        detail: `version ${version}`,
        sha256: sha256(JSON.stringify({ publisher: pkg.publisher, name: pkg.name, version })),
      });
    } else {
      // No readable manifest: record the directory name so a silently
      // dropped/added extension still shows up in the diff.
      entries.push({
        id: sub,
        kind,
        detail: "no readable package.json",
        sha256: sha256(sub),
      });
    }
  }
  return entries;
}

function vscodeCollector(home: string): CollectorResult {
  const entries: Entry[] = [];
  const extDir = join(home, ".vscode", "extensions");
  const settingsPath = join(home, ".config", "Code", "User", "settings.json");
  const installed = isDir(extDir) || existsSync(settingsPath);
  if (!installed) {
    return { name: "vscode", status: "not-installed", entries };
  }
  if (isDir(extDir)) entries.push(...parseExtensionsDir(extDir, "vscode-extension"));
  const settings = readJsonFile(settingsPath);
  if (settings) {
    const mcp = settings.mcp as Record<string, unknown> | undefined;
    const servers = (mcp?.servers ?? settings.mcpServers) as
      | Record<string, McpServerConfig>
      | undefined;
    entries.push(...mcpServerEntries("vscode", "vscode-mcp-server", servers));
  }
  return { name: "vscode", status: "ok", entries };
}

/** Parse Claude Code hooks from a settings.json object into entries. */
export function parseClaudeHooks(settings: Record<string, unknown>): Entry[] {
  const entries: Entry[] = [];
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks) return entries;
  for (const event of Object.keys(hooks).sort()) {
    const matchers = hooks[event];
    if (!Array.isArray(matchers)) continue;
    for (const m of matchers) {
      const matcher = m as Record<string, unknown>;
      const pattern = typeof matcher.matcher === "string" ? matcher.matcher : "*";
      const hookList = Array.isArray(matcher.hooks) ? matcher.hooks : [];
      for (const h of hookList) {
        const hook = h as Record<string, unknown>;
        const command = typeof hook.command === "string" ? hook.command : "";
        const type = typeof hook.type === "string" ? hook.type : "command";
        entries.push({
          id: `claude-code:hook:${event}:${pattern}`,
          kind: "claude-hook",
          detail: `${type} ${command.slice(0, 200)}`,
          sha256: sha256(command),
        });
      }
    }
  }
  return entries;
}

/** Parse Claude Code plugins from a ~/.claude/plugins tree into entries. */
export function parseClaudePlugins(pluginsDir: string): Entry[] {
  const entries: Entry[] = [];
  for (const marketplace of listSubdirs(pluginsDir)) {
    for (const plugin of listSubdirs(join(pluginsDir, marketplace))) {
      const manifest = readJsonFile(join(pluginsDir, marketplace, plugin, ".claude-plugin", "plugin.json"));
      const version =
        manifest && typeof manifest.version === "string" ? manifest.version : "unknown";
      entries.push({
        id: `claude-code:plugin:${plugin}`,
        kind: "claude-plugin",
        detail: `marketplace ${marketplace} version ${version}`,
        sha256: sha256(JSON.stringify({ marketplace, plugin, version })),
      });
    }
  }
  return entries;
}

function claudeCodeCollector(home: string): CollectorResult {
  const entries: Entry[] = [];
  const claudeJson = join(home, ".claude.json");
  const settingsPath = join(home, ".claude", "settings.json");
  const pluginsDir = join(home, ".claude", "plugins");
  const installed = existsSync(claudeJson) || existsSync(settingsPath) || isDir(pluginsDir);
  if (!installed) {
    return { name: "claude-code", status: "not-installed", entries };
  }
  const global = readJsonFile(claudeJson);
  if (global) {
    entries.push(
      ...mcpServerEntries(
        "claude-code",
        "claude-mcp-server",
        global.mcpServers as Record<string, McpServerConfig> | undefined,
      ),
    );
  }
  const settings = readJsonFile(settingsPath);
  if (settings) {
    entries.push(...parseClaudeHooks(settings));
    entries.push(
      ...mcpServerEntries(
        "claude-code",
        "claude-mcp-server",
        settings.mcpServers as Record<string, McpServerConfig> | undefined,
      ),
    );
  }
  if (isDir(pluginsDir)) entries.push(...parseClaudePlugins(pluginsDir));
  return { name: "claude-code", status: "ok", entries };
}

function cursorCollector(home: string): CollectorResult {
  const entries: Entry[] = [];
  const cursorDir = join(home, ".cursor");
  if (!isDir(cursorDir)) {
    return { name: "cursor", status: "not-installed", entries };
  }
  const extDir = join(cursorDir, "extensions");
  if (isDir(extDir)) entries.push(...parseExtensionsDir(extDir, "cursor-extension"));
  const mcp = readJsonFile(join(cursorDir, "mcp.json"));
  if (mcp) {
    entries.push(
      ...mcpServerEntries(
        "cursor",
        "cursor-mcp-server",
        mcp.mcpServers as Record<string, McpServerConfig> | undefined,
      ),
    );
  }
  return { name: "cursor", status: "ok", entries };
}

/** Candidate Postman plugin directories (best effort; see README). */
export const POSTMAN_PLUGIN_DIRS = [
  join(".config", "Postman", "plugins"),
  join(".config", "Postman", "PluginData"),
  join(".local", "share", "Postman", "plugins"),
];

function postmanCollector(home: string): CollectorResult {
  const entries: Entry[] = [];
  const configDir = join(home, ".config", "Postman");
  if (!isDir(configDir)) {
    return { name: "postman", status: "not-installed", entries };
  }
  for (const rel of POSTMAN_PLUGIN_DIRS) {
    const dir = join(home, rel);
    for (const plugin of listSubdirs(dir)) {
      const pkg = readJsonFile(join(dir, plugin, "package.json"));
      const version = pkg && typeof pkg.version === "string" ? pkg.version : "unknown";
      // Hash only this plugin's own identity: adding a sibling plugin must
      // not rewrite the hash of every existing plugin (that would turn one
      // "added" into N spurious "changed" rows in the diff).
      entries.push({
        id: `postman:plugin:${plugin}`,
        kind: "postman-plugin",
        detail: `version ${version} · dir ${rel}`,
        sha256: sha256(JSON.stringify({ plugin, version, manifest: pkg ?? null })),
      });
    }
  }
  return { name: "postman", status: "ok", entries };
}

/** Lines that look like a shell startup file fetching and executing code. */
export const SUSPICIOUS_SHELL_PATTERNS: RegExp[] = [
  /\bcurl\b[^|]*\|\s*(sh|bash)\b/i,
  /\bwget\b[^|]*\|\s*(sh|bash)\b/i,
  /\beval\s*["']?\$\(/i,
  /\beval\s*["']?\$\{\s*curl/i,
  /\|\s*sudo\s+(sh|bash)\b/i,
];

export function countSuspiciousShellLines(content: string): number {
  let n = 0;
  for (const line of content.split("\n")) {
    if (SUSPICIOUS_SHELL_PATTERNS.some((re) => re.test(line))) n++;
  }
  return n;
}

export const SHELL_RC_FILES = [".bashrc", ".zshrc", ".bash_profile", ".profile", ".zprofile"];

function shellCollector(home: string): CollectorResult {
  const entries: Entry[] = [];
  let found = false;
  for (const file of SHELL_RC_FILES) {
    const path = join(home, file);
    if (!existsSync(path)) continue;
    found = true;
    try {
      const content = readFileSync(path, "utf8");
      const suspicious = countSuspiciousShellLines(content);
      entries.push({
        id: `shell-rc:${file}`,
        kind: "shell-rc",
        detail: `sha256:${shortHash(sha256(content))} suspicious-lines:${suspicious}`,
        sha256: sha256(content),
      });
    } catch (err) {
      return {
        name: "shell",
        status: "error",
        error: `cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`,
        entries,
      };
    }
  }
  return { name: "shell", status: found ? "ok" : "not-installed", entries };
}

/** Parse one repo's .git/hooks directory into entries (non-sample files only). */
export function parseGitHooks(repoDir: string): Entry[] {
  const entries: Entry[] = [];
  const hooksDir = join(repoDir, ".git", "hooks");
  let names: string[] = [];
  try {
    names = readdirSync(hooksDir).sort();
  } catch {
    return entries;
  }
  const repoName = basename(repoDir);
  for (const name of names) {
    if (name.endsWith(".sample")) continue;
    const path = join(hooksDir, name);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      const content = readFileSync(path);
      const executable = (st.mode & 0o111) !== 0;
      entries.push({
        id: `git-hook:${repoName}:${name}`,
        kind: "git-hook",
        detail: `${executable ? "executable" : "non-executable"} sha256:${shortHash(sha256(content))}`,
        sha256: sha256(content),
      });
    } catch {
      continue;
    }
  }
  return entries;
}

function gitHooksCollector(repos: string[]): CollectorResult {
  const entries: Entry[] = [];
  for (const repo of repos) entries.push(...parseGitHooks(repo));
  return { name: "git-hooks", status: "ok", entries };
}

/** Run every collector against a home directory. */
export function collectAll(home: string, repos: string[]): CollectorResult[] {
  const results: CollectorResult[] = [
    vscodeCollector(home),
    claudeCodeCollector(home),
    cursorCollector(home),
    postmanCollector(home),
    shellCollector(home),
  ];
  if (repos.length > 0) results.push(gitHooksCollector(repos));
  return results;
}

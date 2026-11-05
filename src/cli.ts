#!/usr/bin/env node
/**
 * toolwatch — snapshot your dev-tool trust surface and diff it across updates.
 *
 *   toolwatch snapshot [--out FILE] [--repos DIR...] [--home DIR]
 *   toolwatch diff <snap-a> <snap-b> [--json] [--strict]
 *   toolwatch check --baseline FILE [--repos DIR...] [--home DIR] [--json] [--strict]
 *   toolwatch watch --baseline FILE [--interval SECONDS] [--once] [--repos DIR...]
 *
 * Exit codes: 0 = no trust-relevant change (or snapshot written),
 * 1 = trust-relevant addition/change found (CI gate), 2 = usage/IO error.
 * `diff`/`check` treat removals as non-gating by default; --strict gates
 * on removals too.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { diffSnapshots, diffToJson, formatDiff, gateFailingChanges } from "./diff.js";
import { buildSnapshot, parseSnapshot, VERSION } from "./snapshot.js";
import type { Snapshot } from "./types.js";

const HELP = `toolwatch ${VERSION} — snapshot your dev-tool trust surface and diff it across updates.

USAGE
  toolwatch snapshot [--out FILE] [--repos DIR...] [--home DIR]
      Capture plugins, hooks, MCP servers, remote endpoints, git hooks and
      shell startup files into a JSON snapshot. Default output:
      ./toolwatch.snapshot.json
  toolwatch diff <snap-a> <snap-b> [--json] [--strict]
      Show exactly what changed between two snapshots. Exit 1 when a
      trust-relevant addition or change is found (CI gate).
  toolwatch check --baseline FILE [--repos DIR...] [--home DIR] [--json] [--strict]
      Snapshot the current machine and compare it against a stored baseline.
  toolwatch watch --baseline FILE [--interval SECONDS] [--once] [--repos DIR...]
      Re-check on an interval (default 60s) until drift is found, then exit 1.
      --once performs a single check.

COLLECTORS (each reports ok / not-installed / error, never crashes)
  vscode      ~/.vscode/extensions + MCP servers in Code settings
  claude-code ~/.claude.json + ~/.claude/settings.json (hooks, MCP) + plugins
  cursor      ~/.cursor/extensions + ~/.cursor/mcp.json
  postman     plugin dirs under ~/.config/Postman (best effort, see README)
  shell       ~/.bashrc ~/.zshrc ~/.bash_profile ~/.profile ~/.zprofile
              (hashed, never copied; only a suspicious-line count is stored)
  git-hooks   .git/hooks of repos passed via --repos (opt-in, default off)

EXIT CODES
  0  snapshot written, or no trust-relevant change
  1  trust-relevant addition/change found (add --strict to gate on removals too)
  2  usage error, unreadable snapshot, or IO error

Snapshots are local audit artifacts: they list your extensions, hook
commands and endpoint hosts. Do not commit them to a public repo.`;

function fail(message: string): never {
  console.error(`toolwatch: ${message}`);
  process.exit(2);
}

interface Args {
  positional: string[];
  flags: Record<string, string | boolean>;
  repos: string[];
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const repos: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--repos") {
      i++;
      while (i < argv.length && !argv[i].startsWith("--")) {
        repos.push(argv[i]);
        i++;
      }
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[a.slice(2)] = argv[i + 1];
        i++;
      } else {
        flags[a.slice(2)] = true;
      }
      i++;
      continue;
    }
    positional.push(a);
    i++;
  }
  return { positional, flags, repos };
}

function flagStr(flags: Record<string, string | boolean>, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

function readSnapshot(path: string): Snapshot {
  if (!existsSync(path)) fail(`snapshot not found: ${path}`);
  try {
    return parseSnapshot(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    fail(`cannot read snapshot ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function printSnapshotSummary(snap: Snapshot, outPath?: string): void {
  console.log(`snapshot ${snap.fingerprint.slice(0, 12)} — ${snap.entries.length} entries, ${snap.createdAt}`);
  for (const [name, info] of Object.entries(snap.collectors)) {
    console.log(`  ${name.padEnd(12)} ${info.status.padEnd(13)} ${info.entries} entries`);
  }
  if (outPath) console.log(`wrote ${outPath}`);
}

function cmdSnapshot(args: Args): void {
  const home = flagStr(args.flags, "home") ?? homedir();
  const out = flagStr(args.flags, "out") ?? "toolwatch.snapshot.json";
  const repos = args.repos.map((r) => resolve(r));
  const snap = buildSnapshot(home, repos);
  try {
    writeFileSync(out, JSON.stringify(snap, null, 2) + "\n", "utf8");
  } catch (err) {
    fail(`cannot write ${out}: ${err instanceof Error ? err.message : String(err)}`);
  }
  printSnapshotSummary(snap, out);
}

function reportDiff(before: Snapshot, after: Snapshot, args: Args): number {
  const changes = diffSnapshots(before, after);
  const strict = args.flags.strict === true;
  const failing = gateFailingChanges(changes, strict);
  if (args.flags.json === true) {
    console.log(diffToJson(before, after, changes));
  } else {
    console.log(formatDiff(changes));
  }
  if (failing.length > 0) {
    console.error(
      `\nDRIFT: ${failing.length} trust-relevant change(s) — review, then re-baseline with 'toolwatch snapshot'.`,
    );
    return 1;
  }
  if (changes.length > 0) {
    console.log("\nOnly removals — nothing new was added. Re-baseline when ready.");
  }
  return 0;
}

function cmdDiff(args: Args): number {
  if (args.positional.length !== 2) fail("diff needs two snapshot files: toolwatch diff <a> <b>");
  const before = readSnapshot(args.positional[0]);
  const after = readSnapshot(args.positional[1]);
  return reportDiff(before, after, args);
}

function currentSnapshot(args: Args): Snapshot {
  const home = flagStr(args.flags, "home") ?? homedir();
  const repos = args.repos.map((r) => resolve(r));
  return buildSnapshot(home, repos);
}

function cmdCheck(args: Args): number {
  const baselinePath = flagStr(args.flags, "baseline");
  if (!baselinePath) fail("check needs --baseline FILE");
  const baseline = readSnapshot(baselinePath);
  const current = currentSnapshot(args);
  if (current.fingerprint === baseline.fingerprint) {
    console.log("No drift — current state matches the baseline.");
    return 0;
  }
  return reportDiff(baseline, current, args);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function cmdWatch(args: Args): Promise<number> {
  const baselinePath = flagStr(args.flags, "baseline");
  if (!baselinePath) fail("watch needs --baseline FILE");
  const intervalSec = Number(flagStr(args.flags, "interval") ?? "60");
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    fail("--interval must be a positive number of seconds");
  }
  const once = args.flags.once === true;
  for (;;) {
    const code = cmdCheck(args);
    if (code !== 0 || once) return code;
    console.log(`no drift — re-checking in ${intervalSec}s (Ctrl-C to stop)`);
    await sleep(intervalSec * 1000);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(HELP);
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-V") {
    console.log(`toolwatch ${VERSION}`);
    return;
  }
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  if (cmd === "snapshot") {
    if (args.positional.length > 0) fail("snapshot takes no positional arguments");
    cmdSnapshot(args);
    return;
  }
  if (cmd === "diff") {
    process.exitCode = cmdDiff(args);
    return;
  }
  if (cmd === "check") {
    process.exitCode = cmdCheck(args);
    return;
  }
  if (cmd === "watch") {
    process.exitCode = await cmdWatch(args);
    return;
  }
  fail(`unknown command: ${cmd}\n${HELP}`);
}

main().catch((err) => {
  console.error(`toolwatch: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});

# Fixtures — provenance

All fixtures are synthetic reconstructions, not copies of any real user's
config. They exist so tests and the incident replay run with zero network.

## home-before / home-after

A minimal fake HOME: one VS Code extension (Prettier), one Claude Code
PreToolUse hook, one local stdio MCP server, one shell startup file.
`home-after` is the same HOME after the Postman 12.33.4 shape of change:

- two Postman plugin dirs added (`claude-code`, `codex`)
- one Claude Code SessionStart hook added
  (`postman-ai-bridge --session-start --trusted-hash a1b2c3d4`)
- one remote MCP server added (`https://mcp.postman.example/v1` —
  `.example` is a reserved documentation domain, not a real host)
- Prettier bumped 12.4.0 → 12.5.0

Incident facts: postman-app-support#14370 (opened 25/10/2026, SEVERE,
453 reactions) — Postman 12.33.4 auto-installed Claude Code + Codex AI
plugins, wrote a trusted_hash for its own SessionStart hook, and opened
a remote MCP connection. The fixture rebuilds the *shape* of that event
so `toolwatch diff` can be shown naming exactly those changes.

## repo-with-hooks

Not stored in the repo: GitHub's git-data API rejects any path containing
a `.git` component, so the hook fixture is built in a temp dir by
`test/e2e.test.js` (one executable `pre-commit` hook plus one
`commit-msg.sample` that the collector must ignore). The parser itself is
covered by unit tests in `test/unit.test.js`.

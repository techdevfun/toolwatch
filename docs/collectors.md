# Collectors — exact paths read (v0.1.0)

Every collector reads well-known config paths under a home directory.
A missing tool reports `not-installed`; a collector never guesses a path
it does not know. Shell startup files are hashed, never copied.

## vscode

- `~/.vscode/extensions/*/package.json` — publisher, name, version.
  A directory without a readable manifest is still recorded (by directory
  name) so a silently added extension shows up in the diff.
- `~/.config/Code/User/settings.json` — `mcp.servers` (or top-level
  `mcpServers`) → MCP server entries + remote-endpoint entries.

## claude-code

- `~/.claude.json` — top-level `mcpServers`.
- `~/.claude/settings.json` — `hooks` (event → matcher → command) and
  `mcpServers`.
- `~/.claude/plugins/<marketplace>/<plugin>/.claude-plugin/plugin.json`
  — plugin name + version.

## cursor

- `~/.cursor/extensions/*/package.json` — same layout as VS Code.
- `~/.cursor/mcp.json` — top-level `mcpServers`.

## postman

Best-effort plugin directories (first existing wins per plugin):

- `~/.config/Postman/plugins/`
- `~/.config/Postman/PluginData/`
- `~/.local/share/Postman/plugins/`

Each subdirectory is one plugin; `package.json` inside it supplies the
version when present. Sandboxed installs (flatpak/snap) with different
layouts report `not-installed` rather than a guessed answer.

## shell

- `~/.bashrc`, `~/.zshrc`, `~/.bash_profile`, `~/.profile`, `~/.zprofile`

Each file contributes one entry: its sha256 plus a count of
suspicious-looking lines (`curl … | sh`, `wget … | bash`,
`eval "$(…)"`, `| sudo sh`). File contents are never stored.

## git-hooks

Opt-in only: `toolwatch snapshot --repos <dir…>` reads
`<dir>/.git/hooks/` and records every non-`.sample` file with its sha256
and executable bit. The working tree is never walked.

## remote-endpoint

Derived, not collected separately: every MCP server entry with a remote
`url` also yields one `remote-endpoint` entry holding scheme + host only
(`https://mcp.example.com`). Userinfo, path, and query are stripped, so
no credential can leak into a snapshot.

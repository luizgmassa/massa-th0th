# M12 — First-class multi-agent installer

## Goal
One command installs massa-ai MCP config (and skill pointers) into each
supported agent's config file, with safe-merge, backup, --dry-run, --uninstall,
and a home-write consent gate. Today `install.sh` only *prints* config blocks;
`apps/claude-plugin/install.sh` is the only real writer (Claude Code only,
blind cp). Replace the print-only path with a typed, testable TS installer.

## Scope (currently-printed agents only)
- Claude Code: `~/.claude/settings.json` — mcpServers merge.
- Claude Desktop (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json` — mcpServers merge.
- Codex: `~/.codex/config.toml` — `[mcp_servers.<id>]` TOML table.
- Cursor: `~/.cursor/mcp.json` — mcpServers merge.
- OpenCode: `~/.config/opencode/opencode.json` — mcpServers merge.

Deferred (formats unstated in install.sh): Gemini, Grok, Devin.

## Non-goals
- Skill-root file copying (apps/claude-plugin/install.sh still owns that; this
  installer only writes MCP config. Skill-root consolidation tracked as
  follow-up).
- Hook block writing (install.sh print_hooks_guide stays the source; a future
  iteration can extend AgentWriter with a hooks plan).
- TOML general-purpose parser (hand-rolled, scoped to `[mcp_servers.*]`).

## Implementation
- `scripts/install-agents.ts` (TS over bash; matches repo's scripts/*.ts convention).
- `AgentWriter` interface: `configPath / plan / apply / uninstall`.
- Per-agent writers; JSON writers share `JsonMcpWriter` base; `CodexWriter` is TOML.
- Safe-merge: deep-merge preserves all user keys; only the `massa-ai` owned
  key is replaced. Owned key carries `_massaAiOwned: true` marker so
  uninstall is exact.
- Backup: `<path>.massa-ai.bak-<iso-ts>` before every write; directory
  ensured first so the backup copy succeeds.
- Flags: `--dry-run`, `--uninstall`, `--agent <name>`, `--target <dir>`,
  `--api-base <url>`, `--yes`.
- Home-write gate: refuses real `$HOME` without `--yes` (or `--dry-run` /
  `--target`). Throws `ConsentError` → CLI exit 13.

## Tests (temp-dir only)
- Per JSON writer: plan-empty, apply+backup, user-keys-preserved, idempotent,
  uninstall (preserve + drop-empty + no-op), invalid-JSON-throws-no-write.
- Codex TOML writer: plan-empty, apply preserves user tables + top-level keys,
  idempotent, uninstall preserves others.
- Orchestration: `--dry-run` writes nothing, `--agent` limits to one,
  full install writes all (skips claude-desktop off-mac), second run no-op,
  `--uninstall` across agents preserves user keys.
- Consent gate: refuses real home without `--yes`; allows with `--yes`,
  `--dry-run`, or tmpdir target.

## Gate
- `bun test scripts/__tests__/install-agents.test.ts` → 46 pass / 0 fail.
- `bunx tsc --noEmit` (ESNext/bundler) on both files → clean.
- CLI smoke against tmpdir: dry-run writes 0; real writes 5 + 5 backups;
  second run 0/0; no-consent exits 13.
- Never run against real `$HOME`.

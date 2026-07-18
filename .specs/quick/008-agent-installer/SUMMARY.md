# Quick 008: First-class multi-agent installer (M12)

## Result
- Status: Complete
- Commit: `d8bf093`
- Files changed: `scripts/install-agents.ts` (new), `scripts/__tests__/install-agents.test.ts` (new, 46 tests). No new deps.

## Agents wired (5)
claude-code (`~/.claude/settings.json`), claude-desktop macOS (`~/Library/Application Support/Claude/claude_desktop_config.json`; skipped off-darwin), codex (`~/.codex/config.toml`, `[mcp_servers.*]`), cursor (`~/.cursor/mcp.json`), opencode (`~/.config/opencode/opencode.json`). All emit the exact shapes `install.sh` already prints.

## Deferred (follow-up)
Gemini, Grok, Devin — `install.sh` prints no config shapes for them; formats unstated. Document shapes first, then add writers. Skill-root file copies (slash commands, navigator subagent) still owned by `apps/claude-plugin/install.sh`; consolidation behind the same AgentWriter interface is a follow-up.

## Behavior
- Deep-merge preserves every user key; only the massa-th0th-owned entry is replaced (carries a namespaced `_massaTh0thOwned` marker for exact uninstall).
- Backup `<path>.massa-th0th.bak-<ts>` before every write (dir ensured first).
- `--dry-run` prints diff, writes nothing, no backup. `--uninstall` removes only massa-th0th keys, drops emptied `mcpServers`. Idempotent (second run = 0 writes / 0 backups).
- Flags: `--dry-run --uninstall --agent <name> --target <dir> --api-base <url> --yes`.

## Home-write safety
`assertHomeWriteConsent` refuses real `$HOME` unless `--yes` / `--dry-run` / `--target`; throws `ConsentError` → CLI exit 13. All tests inject tmpdir; the refuse-path test targets `os.homedir()` and asserts the throw. No test or smoke touched real `~/`.

## Gate
- `bun test scripts/__tests__/install-agents.test.ts` → 46 pass / 0 fail.
- `bunx tsc --noEmit` → clean.
- CLI smoke (tmpdir): dry-run 0 writes / 5-change diff; real 5 writes + 5 backups; second run 0/0; no-consent exit 13.

## SPEC_DEVIATION
TOML parser is hand-rolled and scoped to `[mcp_servers.*]` (not a full AST); user content outside our table is byte-passthrough — backup protects on malformed input. `_massaTh0thOwned` marker is visible to users (namespaced boolean, required for safe uninstall).

## Residual risk
- Scoped TOML parser (backup mitigates).
- Marker key visible to users (documented).
- Skill-root copies not yet consolidated (follow-up).

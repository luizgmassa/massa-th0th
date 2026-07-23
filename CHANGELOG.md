# Changelog

All notable changes to massa-th0th are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Bootstrap contract merged into `skills/AGENTS.md` (`massa-th0th:bootstrap` markers) with 12-agent sub-agent registry; `UAS_` env vars adapted to `MASSA_TH0TH_`
- Unified TypeScript symlink skills installer (`scripts/install-skills.ts`) for all 4 tools (Claude/Codex/Cursor/OpenCode) with `--apply/--uninstall/--dry-run/--check`, state v1→v2 migration, conflict abort, idempotent
- 8 workflow guide docs migrated to `docs/` (spec-driven, tdd, rfc, commit, ticket, maestro, mobile-figma, context-slices)
- Persona-router skill and 5-persona catalog migrated to `skills/persona-router/` + `skills/massa-th0th/personas/` (filename-only `prompt_path`)
- 296 tests ported to bun test (185 `validate-repository.test.ts` + 39 `install-skills.test.ts` + 56 `install-agents.test.ts` + 16 `subagent-parity.test.ts`)
- `install:skills` / `uninstall:skills` npm scripts
- AGENTS.md at repo root for agent startup contract routing
- `.tool-versions` and `mise.toml` pinning Bun 1.3.14 + Node 25.9.0
- `CHANGELOG.md` with `[Unreleased]` section and CI merge gate
- ADR closing D5 Cypher subset deferral (`docs/adr/0001-remove-d5-cypher-subset.md`)
- `docs/removed-features.md` documenting intentionally removed features (commit 5547afc)
- OS-level sandbox wrapper for executor (macOS seatbelt + Linux Docker, default `auto`)
- `format: json_schema` constrained decoding for Ollama structured LLM calls
- Web UI write mode (memory edit/delete + proposal approve/reject, gated by `MASSA_TH0TH_WEB_WRITE_MODE=true`)
- Web UI markdown rendering (`marked` + `DOMPurify` with XSS prevention)
- Web UI SSE real-time updates for dashboard + memory list
- Hook deadline breadcrumb-on-fire observability in `massa-th0th-hook`
- Native Codex plugin bundle (`apps/codex-plugin/`) with manifest, skills, hooks, MCP, and idempotent installer
- Native Cursor plugin bundle (`apps/cursor-plugin/`) with manifest, skills, hooks, MCP, agents, and idempotent installer
- `pre-tool-use` event added to shared hook binary `EVENT_MAP` for Codex/Cursor parity
- Claude Code `install.sh` hooks auto-write (array-append, idempotent)
- Root `install.sh` plugin menu extended to all four tools (Claude, Codex, Cursor, OpenCode)
- `FEATURES.md` — complete feature reference (23 features, 52-tool roster, config tables, structural indexing detail)
- Deconfliction hints in `install-agents.ts` for Claude, Codex, Cursor, and OpenCode
- 12 subagent specialists (investigator, planner, builder, reviewer, context-curator, verification-agent, requirements-analyst, architecture-specialist, test-engineer, documentation-agent, audit-specialist, mobile-specialist) emitted across all four host plugins (Claude `.md`, Codex `.toml`, Cursor bundled, OpenCode `agents install`), with parity tests (drift, pinning, collision, exact-12) and a `generate-subagent-artifacts.ts` drift gate
- massa-th0th workflow skill (router + 38 workflows + 80 references + `lessons.py`) copied into `skills/massa-th0th/` (123 files)

### Changed

- 12 agent charters relocated from `skills/<name>/` to `skills/agents/<name>/`; `generate-subagent-artifacts.ts` and `skills/AGENTS.md` registry updated (meta-skills `massa-th0th-memory` + `synapse-usage` stay at `skills/` top level)
- 14 audit/fix workflows + spec-driven + exploration rewritten to use 24 named dispatch blocks (9-field capability-packet schema) instead of duplicated inline dispatch prose; old role names mapped (`implementer`→`builder`, `verifier`→`verification-agent`, `domain-mapper`+`coupling-auditor`+`deepening-architect`→`architecture-specialist`)
- README consolidated: removed VSCode section, merged 4 plugin sections into one table, replaced duplicated tables with links to FEATURES.md
- TODO.md updated: multi-language tree-sitter marked COMPLETE, json_schema marked shipped, Codex+Cursor plugin parity added
- Architecture tree tool count corrected 47 → 52

- `local-health-checker.ts` now reads `config.get("embedding").model` instead of hardcoding `nomic-embed-text:latest`
- Executor sandbox defaults to `auto` (uses sandbox if available, falls back to best-effort)

### Removed

- Stale `compression.llm` deprecated alias reference from README.md (code already dropped in `da4c60f`)

### Fixed

- LLM/embedding model defaults now consistent across config, health-checker, and docs
- **OpenCode MCP writer bug (CRIT)**: `install-agents.ts` `OpenCodeWriter` now writes under the `mcp` key (not `mcpServers`) with the OpenCode-specific entry shape (`type: "local"`, `command: ["bunx", ...]`, `environment` not `env`, `enabled: true`) per FEATURES.md — OpenCode host now discovers the massa-th0th MCP server; shared `JsonMcpWriter` parameterized via `serversKey()` so claude-code/cursor/claude-desktop remain unchanged
- **Stale `th0th_*`-prefixed tool names removed** from `skills/agents/investigator/SKILL.md` (`th0th_search`→`search`, `th0th_get_references`→`get_references`), `skills/agents/context-curator/SKILL.md` (`th0th_recall`→`recall`, `th0th_search`→`search`), and `skills/persona-router/SKILL.md` (`th0th_recall`→`recall`) — canonical un-prefixed names per FEATURES.md; 8 generated agent files regenerated for parity
- **Broken `ai-context-handoff` repo xref** in `agent-handoff.md` reworded to "host-installed, not repo-local" (the skill lives in `~/.config/opencode/skills/`, not the repo)
- **`synapse-usage/SKILL.md` stale intro** rewritten: now MCP-first (10 Synapse tools) with REST as fallback; endpoint count corrected 6→8
- **`.specs/` path prefix drift** fixed in `agent-handoff.md`, `long-session.md`, `references/spec-driven/artifact-store.md` (canonical paths: `.specs/project/FEATURES.json`, `.specs/project/STATE.md`, `.specs/HANDOFF.md`, `.specs/features/<slug>/`)
- **`_th0th_remember_best_effort`** renamed to `_remember_best_effort` in `skills/massa-th0th/scripts/lessons.py` (4 sites) — no `th0th_`-prefixed symbols remain in skills/
- **`OLAMA_VERSION` typo** in `validate-vscode-integration.sh` fixed (variable was `OLLAMA_VERSION`, printed as `${OLAMA_VERSION}` — Ollama version was always blank)
- **`install.sh` docker-fetch operator-precedence bug** fixed: `[ -f "$s" ] || need_fetch=true && break` → `[ -f "$s" ] || { need_fetch=true; break; }` (`&&` bound tighter than `||`, inverting the missing-script detection)
- **Stale "5 shell scripts" text** in `install.sh` updated to reference the shared `massa-th0th-hook.ts` Bun binary (Codex/Cursor symlink to it)
- **`Bun.file().toString()` bug** in `diagnose.ts` fixed: `ollamaCandidates` is now async and reads `/etc/resolv.conf` via `await Bun.file(...).text()` (`.toString()` returned `[object BunFile]`, silently breaking WSL2 nameserver detection)
- **`validate-vscode-integration.sh` bunx branch** now mirrors the npx branch's `tools/list` success/failure check (bunx users previously got no MCP tool-count validation)
- **`setup-local-first.sh` search-quality prompt idempotency**: the interactive query-understanding/rerank prompt now only runs on first run (when `.env` doesn't exist), not on every re-run
- **`ClaudeCodeWriter` plugin-hooks coordination**: `install-agents.ts` now detects massa-th0th plugin hooks (`_massaTh0thOwned` markers) in `~/.claude/settings.json` and confirms the MCP entry merged alongside (plugin hooks preserved by `deepMerge`); new tests prove coexistence
- **FEATURES.md roster gap**: `rename_project` + `merge_projects` added to the 52-tool roster table (both already in `CANONICAL_ORDER` and `th0th-tools.md` but missing from the FEATURES.md table)
- **Validator test coverage**: `validate-repository.test.ts` expanded from 34 → 185 scenarios, porting ~150 missing contract checks from the legacy Python `test_validate_repository.py` (persona catalog deep validation, hook-enforcement contract, lessons dual-write, harness state path migration, context slices, agents harness routing, RFC/TDD/ticket/commit workflow contracts, deterministic router precedence, verification ladder, spec-driven phase gates, audit-report-IO, evidence gate, context firewall, synapse policy, th0th-tools matrix, canonical tool naming, docs guides)

## [Wave 6] - 2026-07-22

### Added

- N31: God-file decomposition (symbol-repository-pg, tool-definitions, auto-improve-job, smart-chunker) behind byte-identical facades
- N32: Embedded MCP mode (`MASSA_TH0TH_EMBEDDED=true` routes direct to core services)
- N30: Single `massa-th0th-hook` Bun binary replacing 7 shell scripts
- N20: Parallel test runner with ZERO-LOSS UNION GUARD
- N28: Dashboard route + scheduler/status + hooks/queue-status routes
- N29: `MASSA_TH0TH_SCHEDULER_SAFE_DEFAULTS=true` scheduler preset

## [Wave 5] - 2026-07-22

### Added

- N2: Cycle detection (iterative Tarjan SCC) in architecture
- N3: Multi-source BFS CTE for impact analysis
- N5: Grouped prefix-factored tree output format
- N11: Lease-based single-writer for indexing
- N12: Idempotent incremental import
- N13: Capture-policy module (bounded pure module)
- N14: Persisted maintenance scheduler
- N26: Synapse UX compression (`synapse_task_begin`/`synapse_task_end`)
- N27: SSE/WebSocket push for `index_status`

## [Wave 4] - 2026-07-21

### Added

- N1: Generation-based cursor staleness (412 teaching error)
- N4: `*_total`/`*_omitted` invariant on all clamped lists
- N6: Enum teaching errors across 11 tool handlers
- N7: Three-source git diff + secrets denylist
- N8: Shell-arg validation for git refs
- N9: `read_file` 500-line cap + `source_clipped` flag
- N10: SQL bounds regression test

### Changed

- N25: Spec docs reconciled with reality (PG parity migrations exist)
- N33: Dead code sweep (all `catch{}` replaced with `logger.warn`)
- N36: `xdg.ts` extraction (unified config systems)
- M29: `sqlite-removal` closed; `sqlite-removal-followup` split
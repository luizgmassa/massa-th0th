# Repository Rename Part 2: residual `th0th` → `massa-ai` — Specification

Slug: `repo-rename-massa-ai-part2`. Workflow: spec-driven (Large/Complex).
Source: user follow-up to PR #18 (`repo-rename-massa-ai`), which left residual
`massa-th0th` and standalone `th0th` references across `bun.lock`,
`CHANGELOG.md`, `.specs/`, `skills/`, plugin `agents/`, `docs/`, and a few source files.

## Intent

Finish the `massa-th0th → massa-ai` rename by replacing every residual
`massa-th0th`-family identifier and every standalone `th0th` concept reference
with the `massa-ai` identity, across the categories the first PR missed.

## Scope — In

### Residual identifier families
- `massa-th0th` (kebab), `massa_th0th` (snake), `MassaTh0th` (Pascal),
  `MASSA_TH0TH` (scream), `massaTh0th` (camel) → `massa-ai` family equivalents.
- Standalone `th0th` / `Th0th` concept references (memory, restart state, tools)
  → `massa-ai` / `Massa-ai` equivalents.
- `th0th_*` MCP tool wire-prefix legacy aliases in `observation-extractor.ts`
  → removed (user-accepted; breaks read-side backward-compat with existing DB
  hook observations — no DB migration performed).
- `th0thFetch` / `th0thGet` / `th0thGetWithQuery` internal helper names in
  `apps/opencode-plugin/src/index.ts` → `massaAiFetch` / `massaAiGet` /
  `massaAiGetWithQuery`.
- `/tmp/ollama-th0th.log` temp path in `ensure-ollama.sh` →
  `/tmp/ollama-massa-ai.log`.

### Files touched (categories)
1. `bun.lock` — workspace root `name` key regenerated via `bun install`.
2. `CHANGELOG.md` — historical `massa-th0th` refs rewritten to `massa-ai`
   (user decision: breaks append-only; accepted).
3. `.specs/project/{STATE.md,FEATURES.json}` — active state concept refs.
4. `.specs/features/**` — completed-feature concept refs (`Th0th Memory`,
   `th0th memory`, `th0th_*`-prefix historical descriptions).
5. `.specs/features/repo-rename-massa-ai/**` — the prior feature's own
   artifacts quoting `massa-th0th` as the old name: preserved as quoted history
   (this is the rename record itself).
6. `.specs/archive/**` — historical archive; preserved as-is (out of scope).
7. `packages/core/src/services/hooks/observation-extractor.ts` — remove
   `th0th_*` case arms + comments.
8. `packages/core/src/services/symbol/architecture.ts` — comment ref.
9. `scripts/ensure-ollama.sh` — temp log path.
10. `scripts/__tests__/validate-repository.test.ts` — update assertions that
    guarded the now-removed `th0th_*` aliases; keep the "no `th0th_`-prefixed
    tool names" guard (it still must pass — there will be zero `th0th_*` names).
11. `apps/opencode-plugin/src/index.ts` — rename internal helpers.
12. `apps/{claude,codex,cursor,opencode}-plugin/agents/massa-ai-*.{md,toml}`
    (~48 generated files) — `Th0th Memory` concept line → `Massa-ai Memory` or
    equivalent; regenerate via `generate-subagent-artifacts.ts` if it owns
    them, else edit in place.
13. `docs/massa-ai-spec-driven.md`, `docs/massa-ai-tdd.md` — concept refs.
14. `skills/AGENTS.md`, `skills/agents/*/SKILL.md` (12), `skills/massa-ai/**`
    (~46 files: SKILL.md, workflows/*, references/*, scripts/lessons.py) —
    concept + prose refs.
15. `skills/massa-ai/references/installation.md` — full upstream correction:
    `S1LV4/th0th` → `luizgmassa/massa-ai`, `@th0th-ai/*` → `@massa-ai/*`,
    `TH0TH_*` env → `MASSA_AI_*`, `th0th` prose → `massa-ai`.
16. `README.md`, `FEATURES.md` — non-credit `th0th` refs (Credits section
    `[th0th](https://github.com/S1LV4/th0th)` preserved per user decision).

## Scope — Out

- On-disk repo folder rename (user does manually).
- GitHub repo / npm registry rename (only refs in code/docs).
- Existing-user data migration (no DB migration for removed `th0th_*` aliases;
  old DB hook observations storing `th0th_*` wire-names will stop matching —
  user-accepted behavioral consequence).
- `.specs/archive/**` (historical archive, preserved).
- `.specs/features/repo-rename-massa-ai/**` own artifacts quoting the old name
  as the rename record (preserved as quoted history of the rename itself).
- `RLM_LLM_*` env namespace (unchanged).
- Tree-sitter `patches/`, `node_modules/`, `dist/`, `build/`, `.turbo/` (build
  artifacts regenerated).
- README/FEATURES Credits line `[th0th](https://github.com/S1LV4/th0th)`.

## User Decisions (gray-area resolutions)

| ID | Decision | Rationale |
| --- | --- | --- |
| D1 | CHANGELOG historical `massa-th0th` refs rewritten to `massa-ai` | User chose to update all entries; breaks append-only convention, accepted. |
| D2 | `observation-extractor.ts` `th0th_*` legacy case arms REMOVED (not kept as aliases) | User chose removal; breaks read-side backward-compat with existing DB rows, accepted. No DB migration. |
| D3 | `.specs/features/**` `th0th`/`Th0th` concept refs → `massa-ai` | Describe current concepts, not legacy names. |
| D4 | `installation.md` upstream corrected to `luizgmassa/massa-ai` | Aligns install reference with the real project identity. |
| D5 | README/FEATURES Credits `[th0th](S1LV4/th0th)` preserved | User chose to keep as external upstream acknowledgment. |

## Requirements

### R1 — observation-extractor.ts (behavior change, D2)
- **R1.1** Remove `case "th0th_read_file":` arm (line ~99); keep canonical
  `case "read_file":` arm only.
- **R1.2** Remove legacy alias arms `case "th0th_search"`, `"th0th_search_def"`,
  `"th0th_get_refs"`, `"th0th_recall"`, `"th0th_store"`, `"th0th_compact_snapshot"`
  (lines ~133-148); keep canonical arms.
- **R1.3** Guard `toolName !== "Read" && toolName !== "th0th_read_file" &&
  toolName !== "read_file"` → `toolName !== "Read" && toolName !== "read_file"`
  (line ~276); drop `th0th_read_file` OR-clause.
- **R1.4** Update comment "legacy th0th_* wire-names are kept as read-side
  aliases" → remove or rewrite to reflect that aliases are no longer kept.

### R2 — architecture.ts
- **R2.1** Comment "adapted to th0th's symbol_imports / symbol_references" →
  "adapted to massa-ai's symbol_imports / symbol_references".

### R3 — ensure-ollama.sh
- **R3.1** `/tmp/ollama-th0th.log` → `/tmp/ollama-massa-ai.log` (2 sites:
  nohup redirect + echo "Check logs").

### R4 — opencode-plugin index.ts
- **R4.1** `async function th0thFetch` → `async function massaAiFetch`.
- **R4.2** `async function th0thGet` → `async function massaAiGet`.
- **R4.3** `async function th0thGetWithQuery` → `async function massaAiGetWithQuery`.
- **R4.4** All call sites updated (`th0thFetch(...)`, `th0thGet(...)`,
  `th0thGetWithQuery(...)`, `return th0thGet<T>(...)`).

### R5 — validate-repository.test.ts
- **R5.1** Remove/adjust assertions that asserted the PRESENCE of `th0th_*`
  legacy aliases (if any); since aliases are removed, those assertions must
  not expect `th0th_*` arms.
- **R5.2** KEEP the guard "no `th0th_`-prefixed tool names in skills/" — it
  still must pass (zero `th0th_*` names remain).
- **R5.3** Comments referencing `_th0th_remember_best_effort` historical rename
  preserved as history (comment-only, no behavior).
- **R5.4** "lessons th0th type" / "dual-write/tag contract" prose in test
  descriptions/comments → `massa-ai` where it describes current concepts.

### R6 — docs/
- **R6.1** `docs/massa-ai-spec-driven.md` line 28, 58: `th0th stores...` /
  `th0th memory used as context` → `massa-ai stores...` / `massa-ai memory`.
- **R6.2** `docs/massa-ai-tdd.md` line 54: `th0th, Synapse, diagram rendering`
  → `massa-ai, Synapse, diagram rendering`.

### R7 — skills/ (concept + prose refs)
- **R7.1** `skills/massa-ai/SKILL.md`: "th0th recall/search", "canonical th0th
  restart state" (×2), "supported th0th types" → `massa-ai` equivalents.
- **R7.2** `skills/AGENTS.md` line 207 (`th0th memories`), 382 (`Th0th Memory`)
  → `massa-ai memories`, `Massa-ai Memory`.
- **R7.3** `skills/agents/*/SKILL.md` (12 files): `Th0th Memory:` line →
  `Massa-ai Memory:` (or matching host convention).
- **R7.4** `skills/massa-ai/references/**` (~20 files): `th0th memory`,
  `th0th types`, `th0th restart state`, `th0th MCP`, `th0th REST`,
  `th0th exposes REST`, `th0th tools` prose → `massa-ai` equivalents.
- **R7.5** `skills/massa-ai/scripts/lessons.py`: `TH0TH_SUPPORTED_TYPES`,
  `TH0TH_LESSON_TYPE` constants, "th0th supported memory types", "Best-effort
  th0th memory write", "th0th MCP is agent-side only", "th0th exposes REST at
  TH0TH_API_URL", "massa-ai persistence tag contract for a lesson's th0th
  memory", "Re-emits th0th memory best-effort", "th0th=best-effort" →
  `massa-ai` equivalents. `TH0TH_API_URL`/`TH0TH_API_KEY` env fallbacks →
  `MASSA_AI_API_URL`/`MASSA_AI_API_KEY` (primary already is; remove legacy
  fallback or keep as documented compat — user decision needed if ambiguous;
  default: remove legacy `TH0TH_*` env fallbacks since installation.md is
  corrected to `MASSA_AI_*`).
- **R7.6** `skills/massa-ai/references/installation.md` (D4): full upstream
  correction — title `Th0th Installation` → `Massa-ai Installation`; `th0th
  stack` → `massa-ai stack`; `S1LV4/th0th` → `luizgmassa/massa-ai` (install.sh
  URL + git clone URL); `cd th0th` → `cd massa-ai`; `TH0TH_MODE`/`
  TH0TH_API_PORT`/`TH0TH_NO_START` → `MASSA_AI_MODE`/`MASSA_AI_API_PORT`/
  `MASSA_AI_NO_START`; `TH0TH_API_URL`/`TH0TH_API_KEY` → `MASSA_AI_API_URL`/
  `MASSA_AI_API_KEY`; `npx @th0th-ai/mcp-client` → `npx @massa-ai/mcp-client`;
  `bunx @th0th-ai/mcp-client` → `bunx @massa-ai/mcp-client`;
  `@th0th-ai/opencode-plugin` → `@massa-ai/opencode-plugin`.

### R8 — plugin agents (~48 generated files)
- **R8.1** `apps/{claude,cursor,opencode}-plugin/agents/massa-ai-*.md` and
  `apps/codex-plugin/agents/massa-ai-*.toml`: `Th0th Memory:` concept line →
  `Massa-ai Memory:` (or host-equivalent).
- **R8.2** If `generate-subagent-artifacts.ts` owns these files, regenerate
  after fixing `skills/agents/*/SKILL.md` sources; else edit in place. Verify
  drift gate (`--check` + parity test) passes.

### R9 — .specs/ (active + completed features)
- **R9.1** `.specs/project/STATE.md`: standalone `th0th` refs in completed-
  feature sections → `massa-ai` where describing current concepts; preserve
  `massa-th0th` where quoting the old name in the rename history line.
- **R9.2** `.specs/project/FEATURES.json`: `th0th` refs in feature descriptions
  → `massa-ai`.
- **R9.3** `.specs/features/**` (wave-4, wave-5, sub-agent-system,
  workflow-tools-adaptation, repository-maintenance, hook-attribution-repair,
  multi-language-tree-sitter-breadth, project-identity-rename): `th0th`/
  `Th0th` concept refs → `massa-ai` (D3). Preserve `massa-th0th` where quoting
  the old name in the `project-identity-rename` rename record.
- **R9.4** `.specs/features/repo-rename-massa-ai/**`: PRESERVE as the rename
  record (quotes `massa-th0th` as the old name). Out of scope.
- **R9.5** `.specs/archive/**`: PRESERVE as historical archive. Out of scope.

### R10 — CHANGELOG.md (D1)
- **R10.1** Rewrite historical `massa-th0th`, `massa_th0th`, `MassaTh0th`,
  `MASSA_TH0TH` refs in pre-rename entries → `massa-ai` family.
- **R10.2** The new rename entry (line ~12) already uses old names as history
  of the rename action — keep its description of the `massa-th0th → massa-ai`
  transition (it is the record of the change itself).

### R11 — README.md, FEATURES.md (non-credit)
- **R11.1** `README.md`: `th0th_*`-prefixed / `th0th` concept refs in body
  (non-Credits) → `massa-ai`.
- **R11.2** `FEATURES.md`: `th0th_*`-prefixed / `th0th` concept refs (lines
  432, 460, 1112, 1211) → `massa-ai`; the `th0th-tools matrix` test-name
  reference → `mcp-tools matrix` or `massa-ai-tools matrix`.
- **R11.3** Credits line `[th0th](https://github.com/S1LV4/th0th)` PRESERVED
  (D5).

### R12 — bun.lock
- **R12.1** Run `bun install` after confirming root `package.json` name is
  `massa-ai` (it is); `bun.lock` workspace `name` key regenerates from
  `massa-th0th` → `massa-ai`. Do NOT hand-edit `bun.lock`.

### R13 — Build & verification gate
- **R13.1** `bun run type-check` passes (6 tsc projects).
- **R13.2** `bun run build` passes (5 packages).
- **R13.3** `bun test` passes (or affected suites).
- **R13.4** Residual scan: `rg -i 'th0th' --hidden -g '!node_modules' -g '!.git'
  -g '!dist' -g '!build' -g '!bun.lock' -g '!.specs/archive' -g '!.specs/features/repo-rename-massa-ai'`
  → only README/FEATURES Credits `S1LV4/th0th` line + `validate-repository.test.ts`
  historical-rename comments (enumerated exemptions). No `massa-th0th`-family
  identifiers remain in active code.

## Acceptance Criteria (testable)

- **AC-R1** `rg '"th0th_(read_file|search|search_def|get_refs|recall|store|compact_snapshot)"' packages/core/src/services/hooks/observation-extractor.ts` → 0; canonical arms `case "read_file":`, `case "search":`, `case "recall":`, `case "store_memory":`, `case "compact_snapshot":`, `case "search_definitions":`, `case "get_references":` present; line ~276 guard is `toolName !== "Read" && toolName !== "read_file"` (no `th0th_read_file`).
- **AC-R2** `rg -i 'th0th' packages/core/src/services/symbol/architecture.ts` → 0; `massa-ai's` present.
- **AC-R3** `rg 'ollama-th0th' scripts/ensure-ollama.sh` → 0; `ollama-massa-ai` present (2 sites).
- **AC-R4** `rg 'th0thFetch|th0thGet|th0thGetWithQuery' apps/opencode-plugin/src/index.ts` → 0; `massaAiFetch|massaAiGet|massaAiGetWithQuery` present.
- **AC-R5** `bun test scripts/__tests__/validate-repository.test.ts` passes; `rg 'th0th_' scripts/__tests__/validate-repository.test.ts` returns only historical-rename comments (`_th0th_remember_best_effort`, "no th0th_-prefixed" guard descriptions) — no assertion expects `th0th_*` aliases to exist.
- **AC-R6** `rg -i 'th0th' docs/massa-ai-spec-driven.md docs/massa-ai-tdd.md` → 0; `massa-ai` present.
- **AC-R7** `rg -i '\bth0th\b|Th0th' skills/ -g '!**/installation.md'` → 0 (installation.md handled by R7.6); `rg -i 'S1LV4/th0th|@th0th-ai|TH0TH_' skills/massa-ai/references/installation.md` → 0; `luizgmassa/massa-ai`, `@massa-ai/`, `MASSA_AI_` present in installation.md.
- **AC-R8** `rg -i 'Th0th Memory' apps/*/agents/massa-ai-*.{md,toml}` → 0; `Massa-ai Memory` (or host-equivalent) present; drift gate passes.
- **AC-R9** `rg -i '\bth0th\b|Th0th' .specs/project/ .specs/features/wave-4-correctness-hygiene .specs/features/wave-5-cross-pollination .specs/features/sub-agent-system .specs/features/workflow-tools-adaptation .specs/features/repository-maintenance-2026-07-12 .specs/features/hook-attribution-repair .specs/features/multi-language-tree-sitter-breadth` → 0; `.specs/features/repo-rename-massa-ai/` and `.specs/archive/` exempted.
- **AC-R10** `rg 'massa-th0th|massa_th0th|MassaTh0th|MASSA_TH0TH|massaTh0th' CHANGELOG.md` → 0 (D1: all rewritten); the rename transition is described without old-name identifiers.
- **AC-R11** `rg -i 'th0th' README.md FEATURES.md` → only the Credits `[th0th](https://github.com/S1LV4/th0th)` line (2 matches, one per file); all other `th0th` refs → `massa-ai`.
- **AC-R12** `rg '"massa-th0th"' bun.lock` → 0; `rg '"massa-ai"' bun.lock` → match (root workspace name).
- **AC-R13** `bun run type-check` exit 0 (6 projects); `bun run build` exit 0 (5 packages); `bun test` affected suites exit 0.
- **AC-R14** Residual: `rg -i 'massa-th0th|massa_th0th|MassaTh0th|MASSA_TH0TH|massaTh0th' --hidden -g '!node_modules' -g '!.git' -g '!dist' -g '!build' -g '!bun.lock' -g '!.specs/archive' -g '!.specs/features/repo-rename-massa-ai' -g '!.specs/features/repo-rename-massa-ai-part2'` → 0. `rg -i '\bth0th\b' --hidden -g '!node_modules' -g '!.git' -g '!dist' -g '!build' -g '!.specs/archive' -g '!.specs/features/repo-rename-massa-ai' -g '!.specs/features/repo-rename-massa-ai-part2'` → only README/FEATURES Credits `S1LV4/th0th` + `validate-repository.test.ts` historical comments (enumerated).

## Verification Approach

- Per-requirement AC grep checks (deterministic, file:line evidence).
- Build gate: `bun run type-check && bun run build`.
- Test gate: `bun test` (focus affected suites; full run if green).
- Drift gate (R8): `generate-subagent-artifacts.ts --check` + parity test.
- Discrimination sensor: mutate one canonical observation-extractor arm back
  to `th0th_*`; confirm an extractor test fails; revert.
- Residual scan: zero `massa-th0th`-family + zero standalone `th0th` in active
  code (enumerated exemptions only).

## Dependencies / Preconditions

- Clean working tree on `main` (confirmed); branch
  `spec-repo-rename-massa-ai-part2` off `main`.
- Bun 1.3.14 + Node 25.9 installed (`.tool-versions`).
- `generate-subagent-artifacts.ts` present and drift gate operable.

## Risks

- **F1 (DB backward-compat, D2)**: removing `th0th_*` observation-extractor
  aliases means existing DB `hook_observations` rows storing `th0th_*` wire-name
  values stop matching on read. User-accepted; no DB migration. Mitigation:
  none (accepted consequence); document in CHANGELOG.
- **F2 (generated-file drift, R8)**: if `generate-subagent-artifacts.ts` owns
  plugin agent files, hand-editing them creates drift. Mitigation: fix
  `skills/agents/*/SKILL.md` sources first, then regenerate; run `--check`.
- **F3 (CHANGELOG rewrite, D1)**: rewriting historical entries breaks
  append-only convention and rewrites recorded history. User-accepted;
  irreversible. Mitigation: none (accepted).
- **F4 (substring traps)**: `massa-th0th` inside `massa-th0th-memory`,
  `massa-th0th-config`, etc. — longest-first ordering to avoid partial mangle.
  Mitigation: verify with case-drift grep `massaai-th0th|massa-ai-th0th`.
- **F5 (validate-repository.test.ts guards)**: the test contains guards
  asserting "no `th0th_*`-prefixed names in skills/" — these must STILL pass
  (they check absence, which remains true). Do not delete these guards.
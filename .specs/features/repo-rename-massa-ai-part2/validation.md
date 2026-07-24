# Validation Report — Repository Rename Part 2 (residual th0th → massa-ai)

Feature: `repo-rename-massa-ai-part2`. Workflow: spec-driven (Large/Complex).
Branch: `spec-repo-rename-massa-ai-part2` (off `main`).
Verdict: **PASS**.

## Acceptance Criteria Evidence

| AC | Check | Result |
| --- | --- | --- |
| AC-R1 | `rg '"th0th_(read_file\|search\|search_def\|get_refs\|recall\|store\|compact_snapshot)"' observation-extractor.ts` → 0; canonical arms present; guard line ~268 is `toolName !== "Read" && toolName !== "read_file"` (no `th0th_read_file`) | PASS — 0 `th0th_*` arms; 7 canonical arms present (`search`, `search_definitions`, `get_references`, `recall`, `store_memory`, `compact_snapshot`, `read_file` via `Read`); guard at line 268 |
| AC-R2 | `rg -i 'th0th' architecture.ts` → 0; `massa-ai's` present | PASS — line 11: `adapted to massa-ai's symbol_imports / symbol_references` |
| AC-R3 | `rg 'ollama-th0th' ensure-ollama.sh` → 0; `ollama-massa-ai` present (2 sites) | PASS — 2 sites at lines 41, 57 |
| AC-R4 | `rg 'th0thFetch\|th0thGet\|th0thGetWithQuery' opencode index.ts` → 0; `massaAi*` present (21 call sites) | PASS — 0 stale; 21 `massaAiFetch`/`massaAiGet`/`massaAiGetWithQuery` |
| AC-R5 | `bun test validate-repository.test.ts` passes; remaining `th0th_` refs are only historical-rename comments + absence-guards | PASS — 185/185 pass; `th0th_` only in `_th0th_remember_best_effort` history comment + `not.toMatch(/th0th_/)` absence-guards (correct: assert no `th0th_*` names exist) |
| AC-R6 | `rg -i 'th0th' docs/massa-ai-spec-driven.md docs/massa-ai-tdd.md` → 0 | PASS — 0; `massa-ai` present |
| AC-R7 | skills/ (excl installation.md) `th0th`/`Th0th` → 0; installation.md `S1LV4/th0th\|@th0th-ai\|TH0TH_` → 0; `luizgmassa/massa-ai\|@massa-ai/\|MASSA_AI_` present | PASS — 0 in skills tree (excl installation.md); installation.md 0 stale upstream refs, 15 `luizgmassa/massa-ai`/`@massa-ai/`/`MASSA_AI_` |
| AC-R8 | plugin agents `Th0th Memory` → 0; `Massa-ai Memory` present in 48 files; drift gate passes | PASS — 0 `Th0th Memory`; 48 `Massa-ai Memory`; `generate-subagent-artifacts.ts --check`: "No drift" |
| AC-R9 | .specs concept-ref feature docs `th0th`/`Th0th` → 0 (excl rename records + archive) | PASS — 0 in hook-attribution-repair, multi-language, repository-maintenance, sub-agent-system, wave-4, wave-5 |
| AC-R10 | CHANGELOG `massa-th0th`-family → only line 12 rename transition record (1 match) | PASS — 1 match (line 12 transition record, R10.2 preserved) |
| AC-R11 | README/FEATURES `th0th` → only Credits `S1LV4/th0th` (2) + historical `th0th_*`-prefix removal descriptions (FEATURES 432, 460, 1211) | PASS — Credits preserved (D5); `th0th_*`-prefix references are historical descriptions of the workflow-tools-adaptation removal (analogous to rename records) |
| AC-R12 | `rg '"massa-th0th"' bun.lock` → 0; `rg '"massa-ai"' bun.lock` → match | PASS — 0 `massa-th0th`; line 6 `"name": "massa-ai"` |
| AC-R13 | `bun run type-check` (6/6); `bun run build` (5/5); `bun test` affected suites green | PASS — type-check 6/6, build 5/5; 398/398 tests across shared/test-seam/scripts/4-plugins, 185/185 validator, 7/7 extractor-seam, 4/4 etl-lease, 95/95 install-agents+skills, 55/55 plugin+parity |
| AC-R14 | Residual `massa-th0th`-family in active code → 2 (CHANGELOG line 12 transition + FEATURES.json:500 "prior massa-th0th identity" — both rename-record exemptions); standalone `th0th` → 4 (CHANGELOG line 12 + FEATURES.json:500 + README/FEATURES Credits S1LV4/th0th — all enumerated exemptions) | PASS — only enumerated exemptions remain |

## Discrimination Sensor

**Mutation 1** (flip canonical `case "search":` → `case "th0th_search":` in observation-extractor.ts):
- Result: 3/7 `observation-extractor-seam.test.ts` tests FAIL.
- Revert: 7/7 PASS restored.
- Verdict: canonical `case "search":` arm is protected — the sensor kills the mutation.

## Additional Fixes (latent bugs found during lockfile regen)

The `bun.lock` regeneration (R12.1) exposed two latent hoisting-dependency bugs that the prior lockfile masked via accidental root hoisting:

1. **`apps/web-ui` type-check failure** (`Cannot find module 'bun:test'`): web-ui package.json had NO `devDependencies` and relied on `@types/bun` being hoisted to root `node_modules`. The regen did not hoist it. Fix: added `@types/bun: ^1.3.9` to `apps/web-ui/package.json` devDependencies (matches the version used by `packages/shared` and `packages/core`).

2. **`subagent-parity.test.ts` import failure** (`Cannot find package 'toml'`): the test imports `toml` to parse Codex `.toml` agent files, but no package.json declared `toml` as a direct dep (it was only a transitive dep of `effect`). The regen did not hoist it to root. Fix: added `toml: ^4.3.0` to root `package.json` devDependencies.

3. **Broken plugin hook symlinks**: `apps/cursor-plugin/hooks/massa-ai-hook` and `apps/codex-plugin/hooks/massa-ai-hook` symlinks pointed to `../../claude-plugin/hooks/massa-th0th-hook.ts` (stale target — the claude file was renamed to `massa-ai-hook.ts` in PR #18, but the symlink targets were not updated). This was a latent bug from the first rename PR, surfaced by the cursor-plugin manifest test. Fix: recreated both symlinks to point to `massa-ai-hook.ts`.

These three fixes are in-scope side-effects of completing the rename (the lockfile regen + test gate exposed pre-existing latent issues). They are additive (new devDependencies, symlink target correction) and do not change runtime behavior.

## Gates

- `bun run type-check`: 6/6 PASS
- `bun run build`: 5/5 PASS
- `generate-subagent-artifacts.ts --check`: No drift (48 files match)
- `bun test` (affected suites): 398/398 PASS (shared + test-seam + scripts + 4 plugins), plus 185 validator, 7 extractor-seam, 4 etl-lease, 95 install-agents+skills, 55 plugin+parity

## Residual Risk

- **Low**: Existing DB `hook_observations` rows storing `th0th_*` wire-name values will no longer match on read (D2 — user-accepted; no DB migration performed). Documented in CHANGELOG line 12 follow-up note.
- **Low**: The on-disk repo folder is still `massa-th0th` (out-of-scope per spec; user does manually).
- **None**: All `massa-th0th`-family identifiers removed from active code; remaining matches are enumerated rename-record/Credits exemptions.

## Files Changed

- Source: `packages/core/src/services/hooks/observation-extractor.ts`, `packages/core/src/services/symbol/architecture.ts`, `apps/opencode-plugin/src/index.ts`, `scripts/ensure-ollama.sh`, `scripts/__tests__/validate-repository.test.ts`
- Package configs: `package.json` (root, +`toml` devDep), `apps/web-ui/package.json` (+`@types/bun` devDep), `bun.lock` (regenerated)
- Symlinks: `apps/cursor-plugin/hooks/massa-ai-hook`, `apps/codex-plugin/hooks/massa-ai-hook` (target fixed)
- Docs: `docs/massa-ai-spec-driven.md`, `docs/massa-ai-tdd.md`, `CHANGELOG.md`, `README.md`, `FEATURES.md`
- Skills: `skills/AGENTS.md`, `skills/agents/*/SKILL.md` (12), `skills/massa-ai/SKILL.md`, `skills/massa-ai/references/**` (~20), `skills/massa-ai/workflows/**` (~20), `skills/massa-ai/scripts/lessons.py`, `skills/massa-ai/references/installation.md`
- Plugin agents: `apps/{claude,codex,cursor,opencode}-plugin/agents/massa-ai-*.{md,toml}` (48 regenerated)
- Specs: `.specs/project/STATE.md`, `.specs/features/{hook-attribution-repair,multi-language-tree-sitter-breadth,repository-maintenance-2026-07-12,sub-agent-system,wave-4-correctness-hygiene,wave-5-cross-pollination}/**`
- Feature artifacts: `.specs/features/repo-rename-massa-ai-part2/{spec.md,validation.md}`
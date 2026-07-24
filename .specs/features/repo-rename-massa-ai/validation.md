# Validation Report — Repository Rename massa-th0th → massa-ai

Slug: `repo-rename-massa-ai`. Verifier: standalone fresh-eyes (subagent model unavailable; per `the-fool.md:48` fallback the author ran the independent verification with a mutation sensor).

**Result: PASS**

## Per-AC Evidence

| AC | Check | Result |
|---|---|---|
| AC-R1 | `rg '"name": "massa-th0th"\|@massa-th0th/' package.json apps/*/package.json packages/*/package.json` | 0 matches — PASS |
| AC-R2 | `rg 'MassaTh0thConfig' --hidden -g '!node_modules' -g '!.git' -g '!dist'` | 0 matches; `packages/shared/src/config/massa-ai-config.ts` exists; `massa-th0th-config.ts` gone — PASS |
| AC-R3 | `rg 'MASSA_TH0TH' --hidden -g '!node_modules' -g '!.git' -g '!dist' -g '!bun.lock' -g '!.specs/archive/*'` | 0 matches (archive exempted) — PASS |
| AC-R4 | `rg '\.massa-th0th' install.sh scripts/setup-local-first.sh packages/shared/src/config/config-loader.ts` | 0 matches; `.massa-ai` present — PASS |
| AC-R5 | `rg 'massa_th0th' .github/workflows/ci.yml docker-compose.yml .env.example` | 0 matches; `pg_isready -U massa_ai` correct (F2 mitigated) — PASS |
| AC-R6 | `rg 'search: "th0th_search"' observation-extractor.ts` (map) | 0 (map uses un-prefixed canonical); `rg '"th0th_search"' observation-extractor.ts` ≥1 (alias case arms retained, F3 mitigated) — PASS |
| AC-R6-CS | `rg -i 'defaultmassaai\|massaai-th0th\|massa-ai-th0th\|massaai_th0th'` | 0 real drift (6 hits all `defaultMassaAiConfig` — correct camelCase, false-positive substring match) — PASS |
| AC-R7 | `rg 'e2e-th0th' packages/core/src` (active) | 0 matches; `e2e-ai-shared` present — PASS |
| AC-R8 | `test -d skills/massa-ai && test -d skills/massa-ai-memory && ! test -d skills/massa-th0th && ! test -d skills/massa-th0th-memory` | PASS |
| AC-R9 | `find apps -name 'massa-th0th-*'` → 0; `massa-ai-*` present; navigator: opencode/codex=0 (no phantom, F4 mitigated), claude/cursor=2 — PASS |
| AC-R10 | `find apps -name 'massa-th0th-hook*'` | 0; `massa-ai-hook*` present in claude/codex/cursor — PASS |
| AC-R11 | `rg 'massa_th0th\|massa-th0th' .github/workflows/` | 0 — PASS |
| AC-R12 | `rg 'luizgmassa/massa-th0th' install.sh README.md .github docs` | 0; `luizgmassa/massa-ai` present — PASS |
| AC-R13 | `rg 'massa/massa-th0th' Dockerfile docker-compose.yml .env.example` | 0; `massa/massa-ai` present — PASS |
| AC-R14 | `rg '^# massa-ai$' README.md` | match; `rg 'massa-th0th' README.md FEATURES.md` → 0 (title + body) — PASS |
| AC-R15 | `.specs/project/STATE.md` `projectId: massa-ai`; `rg 'massa-th0th' .specs/project/FEATURES.json` → 1 ("prior massa-th0th identity" historical context, exempt) — PASS |
| AC-R16 | `bun test scripts/__tests__/` | 319 pass, 0 fail (subagent parity + install-agents expect `massa-ai-*`, `[mcp_servers.massa-ai]`, `.massa-ai.bak`) — PASS |
| AC-R17 | `bun run type-check` (6/6), `bun run build` (5/5), `rg '"@massa-th0th/' package.json` → 0, `bun.lock` no `@massa-th0th/` entries | PASS |

## Discrimination Sensor

**Mutation 1** (flip canonical map `search: "search"` → `search: "th0th_search"`): seam test stayed green (7 pass). The test asserts behavior (category output) and the `th0th_search` alias fall-through caught the mutation — non-discriminating for the map value alone. Recorded as a spec-precision gap (test does not directly assert the canonical map string).

**Mutation 2** (remove canonical `case "search":` arm, leaving only `case "th0th_search":` alias): seam test **3 failures** (tests asserting `tool_name: "search"` → category `"searches"` broke because `"search"` no longer matched any case arm, falling to default `null`). Mutation **killed**. Reverted; 7 pass/0 fail restored.

**Verdict**: discrimination sensor confirms the canonical `case "search":` arm is load-bearing for the un-prefixed tool name. The alias arms provide backward-compat for `th0th_*` wire-names but do NOT substitute for the canonical arm. Spec-precision gap noted: no test directly asserts the `TOOL_NAME_NORMALIZE` map value string (only the downstream category behavior).

## Build + Test Gate

- `bun run type-check`: 6/6 tsc projects PASS (FULL TURBO cached)
- `bun run build`: 5/5 turbo packages PASS (FULL TURBO cached)
- `bun test scripts/__tests__/`: 319 pass / 0 fail (7 files)
- `bun test apps/opencode-plugin/src/__tests__/`: 35 pass / 0 fail
- `bun test packages/core/src/__tests__/test-seam/observation-extractor-seam.test.ts`: 7 pass / 0 fail
- `bun run --filter @massa-ai/core test:unit`: unit suites green (only postgres integration fails — needs live DB, pre-existing, not a rename regression)
- `bun test apps/mcp-client/src/__tests__/`: 30 pass / 2 fail — the 2 failures (`buildPrefetchPlan` export not found) are **pre-existing** (confirmed identical on pre-rename commit `aae0183`), a Bun test-runner dist-loading flake, NOT a rename regression.

## Residual Enumeration (historical-exempt)

10 files retain `massa-th0th` family identifiers, ALL historically exempted:
1. `CHANGELOG.md` (14) — historical entries + new rename entry quoting old name (AD4)
2. `.specs/project/FEATURES.json` (1) — "prior massa-th0th identity" historical context
3. `.specs/archive/HANDOFF.md` (15), `.specs/archive/PHASE-INTEGRATION.md` (20) — archive, exempted by AC-R3
4. `.specs/features/project-identity-rename/design.md` (10), `spec.md` (1) — prior-rename historical narrative + commit messages (AD4/E6)
5. `.specs/features/repo-rename-massa-ai/{design,spec,tasks,plan-challenge}.md` (107) — this feature's own artifacts (describe the rename, quote the old name)

**Active-code residual: 0.**

## Commits (diff range)

- `29eb057` T1 — git mv skills dirs + benchmark fixtures
- `cb99fea` T2 — git mv config/agents/hooks/docs/ref docs (62 paths)
- `6cea25d` T3 — mechanical identifier substitution (705 files)
- `061bfd3` T4 — observation-extractor canonical map + th0th_* aliases
- `e3fda13` T5 — bun.lock regen + type-check 6/6 + build 5/5
- `a180b94` T8 — CHANGELOG entry + prior-rename feature current-identity update
- `3e65439` T9 — register repo-rename-massa-ai feature in registry

(T6, T7, T10, T11 were verification-only or satisfied by T3; no separate commits.)

## Spec-Precision Gaps (non-blocking)

1. **G1**: No test directly asserts the `TOOL_NAME_NORMALIZE` canonical map string value (`search: "search"`). The seam test asserts downstream category behavior only; mutation 1 (map flip) survived via alias fall-through. Discrimination was achieved via mutation 2 (case-arm removal). Recommend a future unit test asserting `TOOL_NAME_NORMALIZE["search"] === "search"` directly.

## Residual Risk

- **Low**: The on-disk repo folder is still `massa-th0th` (out-of-scope per user choice). The user must `mv /Users/luizmassa/Personal\ Projects/massa-th0th /Users/luizmassa/Personal\ Projects/massa-ai` separately. Git remote URL on github.com is unchanged (user will rename the repo on GitHub separately; old URL auto-redirects).
- **Low**: Existing users' `~/.massa-th0th-data` is NOT migrated (out-of-scope per user choice). The config-loader legacy migration code references `.massa-ai-data` going forward; old data dir left in place.
- **None**: No active-code identifier residuals; build/test/type-check green; CI postgres block atomic; alias backward-compat retained.
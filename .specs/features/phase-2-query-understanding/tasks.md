# Phase 2 — Query Understanding: Tasks

Atomic, one commit per task. Conventional Commits. Never `git push`.

## Task 1 — Config schema

- Add `search.queryUnderstanding: { enabled; hydeEnabled; cacheTtlMs; cacheMaxSize }`
  to `ServerConfig` (`packages/shared/src/config/index.ts`).
- Add to `defaultConfig` (default `enabled: false`, `hydeEnabled: true`,
  `cacheTtlMs: 300_000`, `cacheMaxSize: 256`; env
  `SEARCH_QUERY_UNDERSTANDING_ENABLED`).
- Add to `mergeConfig` (shallow-merge the nested object).
- **Verify:** `bun run type-check` clean.
- **Commit:** `feat(config): add search.queryUnderstanding config block`.

## Task 2 — query-understanding.ts service + EventBus events

- Create `packages/core/src/services/search/query-understanding.ts`:
  - `QueryRewriteSchema` (zod), `QueryRewrite`, `QueryUnderstandingResult`.
  - `rewriteQuery(query, surface)` → `QueryRewrite | null`.
  - `hyde(query, surface, embedFn)` → `number[] | null` (embed only on LLM success).
  - TTL+size-bounded cache keyed by `(projectId, query)`; `clearCache()`.
  - `QueryUnderstandingService` class with `understand(query, projectId)`
    returning `{ expansions, keywords, hydeVector | null } | null`.
  - Injectable `QueryLlmSurface` (default = real `llm` handle).
- Add `search:query-rewritten` + `search:reranked` to `EventMap` in
  `services/events/event-bus.ts`.
- **Verify:** `bun run type-check` clean.
- **Commit:** `feat(search): add query-understanding service + events`.

## Task 3 — Wire fan-out into ContextualSearchRLM.search()

- Modify `search()`: when enabled, call `understand()`, fan out
  original+HyDE+rewritten-FTS, fuse via existing `fuseResults`. Emit
  `search:query-rewritten` + `search:reranked`. Thread `sessionId`.
- Wrap in try/catch → silent fall-through to original 2-stream path.
- Construct quoted FTS5 OR query from keywords/expansions.
- Instantiate `QueryUnderstandingService` in the constructor.
- **Verify:** `bun run test` (no regression vs 677) + `bun run type-check`.
- **Commit:** `feat(search): wire query-understanding fan-out into search`.

## Task 4 — Tests

- `packages/core/src/__tests__/query-understanding.test.ts`:
  - P2-REWRITE-01/02/03 (rewrite ok / disabled / zod-invalid).
  - P2-HYDE-01/02/03 (hyde ok / disabled / embed-not-called-on-llm-fail).
  - P2-CACHE-01/02 (reuse / TTL eviction / size cap).
- Degradation + retrieval-quality tests (P2-DEGRADE-01/02, P2-FANOUT-01/02,
  P2-QUALITY-01): use `_setLlmEnabledForTesting` + fake surface; do NOT
  mock `@massa-th0th/shared`.
- **Verify:** `bun run test` green (new tests pass, baseline intact).
- **Commit:** `test(search): cover query rewrite, HyDE, degradation, quality`.

## Task 5 — Validation + ledger

- Run `bun run test` + `bun run type-check`.
- Discrimination sensor (≥1 mutant killed).
- Write `validation.md` (verdict, per-AC evidence, sensor, gate output,
  same-author caveat).
- Update `project/STATE.md`, `project/FEATURES.json` (phase-2 row),
  `HANDOFF.md`.
- Append Phase-2 delta to `PHASE-INTEGRATION.md` + commit-ledger rows.
- **Commit:** `docs(specs): mark phase-2 complete and update handoff state`.

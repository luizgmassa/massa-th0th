# Repository Analysis

**Method:** read-only exploration subagent plus targeted main-agent source confirmation.
Current source overrides the stale 2026-07-10 index.

## Repository Map

- `apps/mcp-client`: MCP stdio schema registry and HTTP proxy; dispatch at
  `src/index.ts:109-232`, timeout/retry behavior at `src/api-client.ts:23-127`.
- `apps/tools-api`: Elysia composition root, routes, auth, scheduler, job reaper;
  `src/index.ts:60-134`.
- `apps/opencode-plugin`, `apps/claude-plugin`: host and lifecycle-capture integrations.
- `apps/web-ui`: read-only static UI served by Tools API.
- `packages/core`: tools/controllers, ETL, hybrid search, vectors, symbols, memory graph,
  Synapse, jobs, checkpoints, and execution sandbox.
- `packages/shared`: configuration, backend guards, types, logging, and metrics.
- PostgreSQL schema/migrations: `packages/core/prisma/`; legacy SQLite schemas also live
  inside repositories and `packages/core/migrations/`.

## Core Flows

- MCP → REST: `mcp-client/src/index.ts` validates tool input and proxies to Tools API.
- Search: `routes/search.ts:47-122` → `tools/search_project.ts:108-129` →
  `search-controller.ts:93-253` → `contextual-search-rlm.ts:554-905`.
- Index: `tools/index_project.ts:79-243` → `services/etl/pipeline.ts:60-202` →
  discover/parse/resolve/load stages.
- Memory: `controllers/memory-controller.ts:110-357`; store embeds/persists, then starts
  best-effort consolidation and graph linking.
- Synapse: lifecycle routes at `routes/synapse.ts:58-331`; modulation engine at
  `services/synapse/synapse-manager.ts:52+`.
- Checkpoints: gzip task state, memory/file integrity, seven-day default TTL, and backend
  delegate at `checkpoint-manager.ts:14-32,97-143,173-253`.

## Database and Performance Characteristics

- Backend detection is inconsistent: some factories accept only `postgresql`, others accept
  both PostgreSQL URL schemes, and `getDbConfig()` also accepts `DATABASE_TYPE`.
- PostgreSQL may allocate three pools: shared raw `pg`, Prisma adapter, and vector store;
  capacity is roughly `DB_POOL_SIZE + 10 + POSTGRES_VECTOR_POOL_SIZE`.
- Search initializes vector, keyword, cache, analytics, and symbol stores concurrently, then
  fuses vector/keyword/trigram/fuzzy/graph streams through RRF and proximity reranking.
- ETL batches: discovery 30, parse 20, load 10; PostgreSQL embedding sub-batch 8.
- For >2000 dimensions, PG uses binary-HNSW candidates followed by exact cosine rerank,
  capped at `min(limit*20, 200)`.
- Key knobs: `SEARCH_MIN_SCORE`, `SEARCH_DISABLE_KEYWORD`, `RRF_*`, auto-reindex file cap,
  HNSW/IVFFlat params, pool sizes, embedding RPM/TPM/batches, query-understanding/rerank
  switches, and cache TTL/capacity.
- Known full-index risk: concurrent full repository indexing can OOM; E2E intentionally reuses
  `e2e-ai-shared`.

## Confirmed Sharp Edges and Gaps

1. **Synapse not applied to search:** controller accepts `sessionId` but omits it from the
   `contextualSearch.search()` options (`search-controller.ts:125-137`); no production caller
   of `getSynapseManager()` exists.
2. **Cache-key semantics:** search cache keys omit `minScore` and `explainScores` although
   cached payloads are thresholded/explained (`search-cache.ts:130-158`,
   `search-cache-pg.ts:95-110`).
3. **Index race:** new `IndexProjectTool` calls `etlPipeline.run()` directly and bypasses the
   legacy per-project mutex (`index_project.ts:174-182`).
4. **Partial ETL acknowledgement:** vector and symbol writes are non-atomic; PG vector batch
   skips failed documents while Load counts requested documents as loaded.
5. **Incomplete force reindex:** pipeline clears symbols but can retain stale vector chunk IDs
   for deleted files or reduced chunk counts.
6. **PG memory blank FTS:** query construction can produce an empty `()` condition
   (`memory-repository-pg.ts:256-280`).
7. **PG graph divergence:** zero weight becomes 1.0; filters are ignored; increment is
   read-modify-write; batch counts failed/self edges; `autoExtracted` is not persisted
   (`graph-store-pg.ts:90-111,237-299,342-346`).
8. **Handoff/proposal PG absence:** Prisma declares models, but committed migrations create
   neither table; factories always choose SQLite (`handoff-repository.ts:290+`,
   `proposal-repository.ts:290+`). Dedicated API confirmed `SqliteProposalStore` under PG.
9. **Post-filter underfill:** include/exclude filters run after bounded retrieval and are not
   forwarded into search (`search-controller.ts:125-153`).
10. **Stale docs:** `.specs` handoff/state still describe several PG stores as absent although
    observation/session/job PG implementations now exist.

## Testing Topology

Static inventory found 114 core test files, 2 MCP, 6 Tools API, 1 OpenCode, and 1 shared.
PostgreSQL suites are `DATABASE_URL`-gated; live E2E also needs API/Ollama/MCP build and
`RUN_E2E`. Static destructive/auth/config runbooks remain expected skips.

## Scope Decision

The sharp edges above are findings, not automatic implementation scope. Diagnostic failures
and the PostgreSQL parity matrix decide which become fixes. Handoff/proposal absence and the
repository groups in `parity-matrix.md` are blocking coverage work under MNT-04.

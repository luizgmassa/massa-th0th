# Future Agent Memory — Repository Maintenance 2026-07-12

## Repo Map

- `packages/shared`: canonical env/config guards, shared contracts, types.
- `packages/core`: ETL/indexing, embeddings/caches, hybrid search, symbols/graph,
  memory, checkpoints, Synapse, observations, jobs/scheduler, handoffs/proposals.
- `apps/tools-api`: Elysia REST surface, background lifecycle wiring, web UI host.
- `apps/mcp-client`: stdio MCP-to-REST adapter and 42-tool contract.
- `apps/opencode-plugin`, `apps/claude-plugin`: host lifecycle capture/integration.
- `benchmarks`, `scripts`, `skills`: relevance/performance gates, operations, agent workflows.

## Data and Control Flow

`MCP → Tools API → core controller/service → PostgreSQL repositories/pgvector`.
Indexing is `discover → parse → resolve → load`; same-project runs are FIFO. A successful
load writes vectors and lexical rows, persists fingerprints/symbols, invalidates project
search cache, then publishes terminal completion. Partial load errors fail the job.

Hybrid retrieval combines vector and lexical streams with RRF, optional graph context,
tie-breaking proximity, response-tier shaping, and cache keys containing every
result-shaping option. `minScore` is raw vector similarity and therefore model-dependent.

Memory recall is stateful: returned rows have access counters reinforced after ranking, so
sequential identical recalls may have different scores. Compare stable transport fields,
not score equality across sequential calls.

## PostgreSQL Invariants

- Exact maintenance DB guard: `test:test@127.0.0.1:5433/massa_ai_test` plus
  `MASSA_AI_DEDICATED=1`.
- Fourteen migrations apply from scratch; latest adds handoff/proposal tables.
- PG handoff/proposal terminal transitions are conditional atomic updates; only one
  concurrent terminal decision wins.
- PG scheduler uses per-ID FIFO mutation chains and a real pending-operation drain.
- PG graph increments are atomic and capped; zero weights/false metadata are significant.
- Embedding cache identity is provider + model + exact untrimmed content. Factory follows
  the primary DB backend; cleanup/stats/clear are namespace-scoped.
- Reset/reindex clears vector, lexical, symbol, and search-cache state consistently.

## Test and Isolation Rules

- Turbo `test` caching must remain disabled.
- Default core tests exclude `src/__tests__/integration/**`; live integration owns
  `test:integration`.
- Bun `mock.module`, DB/global-state tests, and Tools API mock suites require child-process
  isolation. Extend classifiers when adding new global seams.
- Never set `RUN_E2E=0`; legacy gates treat any non-empty value as enabled. Use an empty or
  unset value.
- Turbo test env passthrough is explicit in `turbo.json`; add new service/test knobs there.
- Full E2E is sequential and cleanup finalizer must remain last.

## Performance Knobs and Sharp Edges

- `qwen3-embedding:8b` cold full-repo indexing is internally serialized by Ollama and can
  exceed the 420-second E2E deadline. Existing qwen relevance floors are authoritative.
- `bge-m3`/1024 is ~10× faster but has a different cosine distribution: one nonsense query
  exceeded qwen's 0.7 raw threshold and hit@1 was 0.357 vs the 0.360 floor. Do not weaken
  tests; calibrate scores per provider in a dedicated design if desired.
- Keep `OLLAMA_MAX_LOADED_MODELS=1` on constrained Apple Metal verification stacks.
- Concurrent full-repository indexes can OOM/wedge Ollama; reuse the intentional shared
  E2E index and run destructive cases sequentially.
- PostgreSQL embedding caches disappear on database reset; clean cold-stack verification
  cannot rely on the former external SQLite warm cache.

## Recommended Patterns

- Add PG parity assertions with exact backend guards whenever adding a SQLite scenario.
- Test state transitions with concurrent compare-and-set sensors and fresh-instance restart.
- Treat cache keys as behavioral contracts; include every option that changes raw results.
- Publish async job completion only after all durable writes and cache invalidation settle.
- Keep test fixtures distinct by project ID and use exact file allowlists.

## Durable Evidence

See `analysis.md`, `gate-manifest.md`, `failure-ledger.md`, `parity-matrix.md`, and
`validation.md` in this directory. These are the source of truth; raw command output was not
persisted.

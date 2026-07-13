# TODO — massa-th0th

Current architecture state and verified follow-up work. Detailed maintenance evidence lives in
`.specs/features/repository-maintenance-2026-07-12/`; E2E coverage decisions live in
`packages/core/src/__tests__/e2e/COVERAGE.md`.

Last updated: 2026-07-13.

## Architecture fixes and decisions already landed

### PostgreSQL is the acceptance backend

- PostgreSQL/pgvector now owns vectors, lexical search, memory, observations, checkpoints,
  Synapse sessions, jobs, graph data, embedding cache, handoffs, and proposals.
- Migration `20260713090000_add_handoffs_proposals_pg` closes the remaining handoff/proposal
  schema gap. PG factories no longer route those features to local SQLite.
- Handoff/proposal terminal transitions use atomic compare-and-set semantics. Scheduler writes
  use per-ID FIFO ordering and a real drain contract. Both have concurrency and restart tests.
- Every inventoried SQLite behavior group has assertion-equivalent PostgreSQL evidence. Add new
  backend-specific behavior to `parity-matrix.md` and its PG test in the same change.

### Indexing and retrieval consistency

- Same-project ETL jobs serialize FIFO. A job is complete only after durable writes, lexical
  indexing, symbol writes, and search-cache invalidation settle.
- Partial load errors fail the job instead of publishing misleading success. Force reset clears
  semantic, lexical, and symbol state so deleted or shortened files cannot leave stale chunks.
- Hybrid search writes PostgreSQL lexical rows and uses bounded fuzzy matching, proximity-aware
  ranking, and corrected RRF scoring.
- Search cache identity includes every result-shaping option, including `minScore`,
  `explainScores`, and include/exclude filters.
- Cross-file callee resolution seeds from persisted definitions and overlays fresher in-batch
  symbols. `listAllDefinitions` avoids the paged-query truncation that previously made inbound
  graph traversal sparse.

### Graph, memory, and lifecycle behavior

- `IGraphStore` is shared by SQLite and PostgreSQL. PostgreSQL preserves zero/false values,
  applies filters, clamps weights, increments atomically, and reports accurate batch counts.
- Typed edges, path tracing, git-diff impact analysis, architecture maps, and Louvain community
  detection form the supported graph layer. Test indexing remains opt-in through
  `include_tests`.
- PostgreSQL memory handles blank/special full-text queries consistently. Recall scores are
  response-local because recall reinforces access counts; transport parity compares stable
  fields and validates each score independently as finite and within `[0, 1]`.
- Embedding-cache identity includes provider, model, dimensions, and exact content. PostgreSQL
  cache selection, scoped cleanup/statistics, and restart behavior have parity coverage.

### Runtime and test isolation

- Default/root unit discovery excludes `src/__tests__/integration/**`; live integration owns
  `test:integration` and must use an explicit API URL.
- Bun mock/global-state suites run in isolated child processes. Turbo test caching stays disabled
  because tests depend on live databases, localhost services, and process-global mocks.
- Dedicated verification must attest PostgreSQL explicitly and use isolated resources. Never let
  a test fall back to the shared API on `:3333` or an implicit root `.env` database.
- Full-repository indexes run sequentially and reuse `e2e-th0th-shared`; concurrent full indexes
  can exhaust memory or wedge Ollama.
- SSRF protection pins resolved addresses through connect time, and execution tools resolve
  symlinks with `realpath` before boundary and deny-glob checks. These controls are containment,
  not an OS security boundary.

## Next steps

The five maintenance follow-ups tracked on 2026-07-13 are closed. Measured closure evidence is in
`.specs/features/close-maintenance-next-steps-2026-07-13/`; no additional in-scope next step
remains from that iteration.

## Deferred / out of scope

- **D5 Cypher subset** — declarative graph query engine. Revisit only if D1–D4 graph usage
  justifies the additional language and execution surface.
- **Multi-language tree-sitter breadth** — indexing remains TS/JS-centric; broad parser support
  is a separate feature.
- **OS-level sandbox for `execute`/`execute_file`/`batch_execute`** — current timeout,
  environment denylist, path-boundary, and symlink controls are best-effort containment. Use
  container/VM isolation before exposing execution to untrusted clients.
- **Native `format: json_schema` constrained decoding** — optional hardening for Ollama-backed
  structured LLM calls.

## Verification references

- Gate results: `.specs/features/close-maintenance-next-steps-2026-07-13/gate-manifest.md`
- PostgreSQL parity: `.specs/features/close-maintenance-next-steps-2026-07-13/postgres-parity-evidence.md`
- Failure history: `.specs/features/close-maintenance-next-steps-2026-07-13/failure-ledger.md`
- Final evidence: `.specs/features/close-maintenance-next-steps-2026-07-13/validation.md`
- E2E decisions and latest run: `packages/core/src/__tests__/e2e/COVERAGE.md`

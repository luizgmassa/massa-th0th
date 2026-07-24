# Eager Hummingbird — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/i-want-to-understand-eager-hummingbird.md` — “massa-ai Improvement Roadmap — Native TS Rebuild.”

## Intent/scope

The plan proposed a dependency-clean, native TypeScript implementation of four areas: search quality; sandbox execution and web ingestion; session-memory continuity; and deeper TS/JS graph analysis. It explicitly deferred a Cypher subset, broad multi-language parsing, and broader host-adapter work. It also required algorithms/patterns to be ported afresh rather than vendoring the referenced sibling implementations.

## Implemented outcome

Verified Git history shows implementation across all four planned areas:

- Search gained trigram and fuzzy lexical RRF streams, proximity reranking, a revived code-graph stream, chunker tuning, and a standalone needle CI gate. The dead advanced-search stub was removed and PostgreSQL `getCollection` implemented.
- The execution/web surface gained `execute`, `execute_file`, `batch_execute`, `fetch_and_index`, a run pool, intent-search support, SSRF controls, and HTML-to-Markdown conversion. Follow-up commits hardened package/test assertions, SSRF parsing and DNS pinning, symlink handling, and execution limits.
- Continuity gained scheduler jobs, expanded observation taxonomy, reference-based compaction snapshots, checkpoint/snapshot documentation, PostgreSQL Synapse session persistence, and later PostgreSQL observation/checkpoint and OpenCode lifecycle work.
- Graph work gained typed TS/JS structural edges, `trace_path`, `impact_analysis`, and richer architecture mapping with Louvain communities. Later commits added PostgreSQL graph parity, cross-file callee resolution, E2E coverage, and bounded caches/traversals.

These are commit/diff facts, not a claim that every manual or runtime verification in the source plan was rerun for this record.

## Commit evidence

### Phase 1 — search quality

- `88901e6` — `feat(search): add trigram+fuzzy lexical RRF streams + proximity rerank + revive code-graph stream`
- `981b7be` — `chore(core): remove dead advanced-context-search stub + implement postgres-vector-store getCollection`
- `af3dab6` — `test(search): promote needle benchmark to standalone harness + CI gate + tune chunker defaults`
- `0dba89f` — `test(search): decouple lexical-rrf stores from global config singleton`

### Phase 2 — sandbox and web

- `ba75d49` — `feat(executor): polyglot sandbox executor + run-pool + execute/execute_file/batch_execute tools`
- `c6e69cf` — `feat(web): fetch_and_index + SSRF guard + HTML→md conversion`
- `829cfee` — `fix(executor): correct package name assertion in execute_file test`
- `4b6f388` — `fix(ssrf): block IPv6 bracket + hex-mapped IPv4 SSRF bypass`
- `b50720d` — `fix(build): purge tsbuildinfo before tsc to guarantee emission`
- `6e7ec14` — `fix(security): pin DNS resolution in SSRF guard + resolve symlinks in executor`

### Phase 3 — continuity and persistence

- `c051468` — `feat(scheduler): in-process cron scheduler for consolidation/decay/auto-improve jobs`
- `634a5c6` — `feat(session): expand event taxonomy + reference-based compaction snapshot + compact_snapshot tool`
- `9187756` — `docs(session): reconcile checkpoint (index state) vs compaction snapshot (session state)`
- `0acfc05` — `feat(synapse): persist session store + working-memory buffer to PostgreSQL`
- `ba49f7e` — `fix(synapse): reconstruct working-memory buffer on load + await PG hydration`
- `45ff6c4` — `feat(hooks): wire observation-consolidation bridge into getHookService`
- `c249bb7` — `feat(checkpoint): PostgreSQL checkpoint store + Prisma model + migration`
- `f070b97` — `feat(opencode): emit lifecycle observations to hook_ingest`

### Phase 4 — typed graph

- `a43a2ef` — `refactor(graph): unify IGraphStore interface + route MemoryGraphService through it`
- `194db55` — `feat(observations): PgObservationStore + PG migration for observation persistence`
- `40087fa` — `feat(graph): typed structural edges (CALLS/DATA_FLOWS/HTTP_CALLS/EMITS/LISTENS) for TS/JS`
- `58c906c` — `feat(graph): trace_path tool — BFS/DFS traversal over typed edges`
- `ed0b88f` — `feat(graph): impact_analysis tool — git-diff impact propagation + centrality risk`
- `4b40304` — `feat(graph): richer project_map — packages/routes/entrypoints/hotspots + Louvain community detection`
- `133cc7d` — `feat(graph): PG findImporters + findEdges caller-FQN pushdown`
- `67a60e7` — `feat(etl): cross-file D1 callee resolve + include_tests`

### Hardening, verification, and operational follow-through

- `ef51da2` — `chore(embeddings): migrate offline provider to @huggingface/transformers`
- `4668b1e` — `fix: resolve MEDIUM findings (rust temp leak, batch cap, dim-agnostic metadata, hydrate storm, trace/impact bounds)`
- `3cdd636` — `test: fix batch isolation (remove disconnectPrisma pool-kill, pin DATABASE_URL)`
- `75b7394` — `fix: resolve LOW findings + scheduler resume nextRunAt correctness`
- `949617e` — `docs: refresh README (42 tools) + TODO (Phase 4/gaps/hardening, 284-s...)`
- `70504b2` — `fix: cap read_file caches (LRU 512) + write back metadata`
- `9379bde` / `28c0f04` / `be1fa3a` / `382b902` / `ac66ab0` / `07739a1` — `docs(todo):` follow-up closure/status updates
- `2315f3c` — `fix(checkpoint): make restore async, real PG memory check`
- `da4c60f` — `fix(config): reconcile MassaAiConfig + drop compression.llm`
- `091dbea` — `fix(deps): align mcp-client @types/node + shared dotenv`
- `51ce05c` — `test: drop redundant Phase-4 Dx:SKIP env guards`
- `03aa888` — `fix(test): align PG-integration gates to DB_AVAILABLE`
- `12ecdee` — `bench(llm-judge): qwen2.5 consolidator/salience/reranker harness`
- `614bf91` — `docs: add operational knobs + e2e/observation notes`
- `c1d68de` — `test(e2e): SF3 42-tool roster + D4/lifecycle asserts`
- `bb1860a` — `test(e2e): add Phase-4 graph suite (D1-D4)`
- `baa31cc` — `test(e2e): add new-feature suites (post-1367007)`
- `543166c` — `fix(symbol-graph): cap projectRootCache LRU 512`
- `81d3360` — `fix(embeddings): abort Ollama fetch on timeout`

## Preserved acceptance facts

- Graph extraction scope remains TS/JS first; `TODO.md` still records broad multi-language tree-sitter work as deferred.
- `TODO.md` still records the D5 Cypher subset as deferred until D1–D4 use justifies it. **CLOSED 2026-07-22 by ADR 0001** (`docs/adr/0001-remove-d5-cypher-subset.md`) — structural graph traversal (`trace_path`, `impact_analysis`, `get_architecture`) covers the use cases; deferral formally removed.
- The current E2E coverage ledger contains deterministic needle relevance floors and dedicated Phase-4 graph plus web/execution/new-feature suites.
- `TODO.md` states the execution controls are best-effort containment and advises container/VM isolation before exposure to untrusted clients; this preserves the source plan’s need to bound the new execution surface.
- The source plan’s native-rewrite/license constraint is an intent requirement. Commit metadata/diffs establish TypeScript implementation changes in this repository, but do not independently prove provenance of every algorithm.

## Deviations/unresolved gaps

- The source plan marked B4 think-in-code routing optional and lower priority. No commit in this range has a `think-in-code` routing-hook subject; this record cannot establish that B4 landed.
- The plan’s phase verification asks for measured needle improvement over the named baseline and several live end-to-end/manual checks. This record inspected commit/diff and existing-spec evidence only; it did not rerun those checks or report fresh benchmark values.
- The plan deferred D5 and multi-language parsing. Current `TODO.md` retains multi-language parsing as deferred; **D5 Cypher subset deferral CLOSED by ADR 0001** (2026-07-22). Neither is an execution omission.
- The source plan requested an OS-level sandbox only indirectly through execution safety requirements; current `TODO.md` explicitly says no OS-level sandbox exists. Treat present controls as containment, not an untrusted-code security boundary.

## Existing spec crossrefs

- `.specs/PHASE-INTEGRATION.md` — original virtual-lantern integration ledger and earlier phase contracts.
- `.specs/HANDOFF.md` — repository handoff state and later operational evidence.
- `.specs/features/close-maintenance-next-steps-2026-07-13/` — current maintenance gate, PostgreSQL parity, and final validation evidence.
- `packages/core/src/__tests__/e2e/COVERAGE.md` — E2E suite ownership and coverage decisions.
- `TODO.md` — current deferred scope and execution-sandbox boundary.

## Verification evidence

- Read the source plan in full.
- Inspected the requested Git range’s complete commit subjects and targeted direct-implementation diff statistics, including search, executor/web, scheduler/session, Synapse persistence, graph, and E2E commits.
- Confirmed current deferred-scope and suite references in `TODO.md` and `packages/core/src/__tests__/e2e/COVERAGE.md`.
- Local artifact checks after this write: target file is non-empty and `git diff --check` passes.

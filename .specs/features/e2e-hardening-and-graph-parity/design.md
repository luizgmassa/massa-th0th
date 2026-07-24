# Rippling Dove Hardening — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/read-users-luizmassa-personal-projects-m-rippling-dove.md` — phased plan to close selected open findings and technical debt, make Phase-4 and PostgreSQL tests run instead of skip, expand E2E coverage, then verify and reconcile documentation.

## Intent/scope

Plan facts: T1–T8 address graph/ETL, cache, checkpoint, config/dependency, and test-gate findings; T9 adds the qwen2.5 LLM-judge benchmark; T10 updates operations/E2E documentation; T11 updates and extends E2E. T12 was to reconcile `TODO.md`, `README.md`, and E2E coverage after V1/V2.

The source explicitly excludes `[low] adsads/`; it treats the vectors-empty note as T10 documentation. V1 required build, SQLite, and PostgreSQL batches; V2 required a live API/MCP/Ollama/PostgreSQL E2E run plus destructive E2E.

## Implemented outcome

Verified in-range commits implement T1–T11 surfaces: graph query parity, cross-file call resolution and `include_tests`, bounded caches, async PostgreSQL checkpoint restore, config/dependency alignment, unskipped Phase-4/PostgreSQL tests, benchmark assets, operational notes, and expanded E2E suites.

The same range also contains a SymbolGraph cache side-finding fix and an Ollama-timeout fix whose commit message attributes discovery to E2E V2. These are implementation facts from commits, not proof that every source-plan acceptance step ran at the range endpoint.

## Commit evidence

### Existing capabilities covered by the plan's E2E expansion

- `88901e6` search lexical-RRF; `ba75d49` executor; `c6e69cf` web ingestion; `c051468` scheduler; `634a5c6` session/compaction; `0acfc05` Synapse persistence.
- `40087fa` typed graph edges; `58c906c` trace path; `ed0b88f` impact analysis; `4b40304` richer project map; `c249bb7` PostgreSQL checkpoints; `f070b97` OpenCode lifecycle observations.

### Finding remediation and test gates

- `133cc7d` — `feat(graph): PG findImporters + findEdges caller-FQN pushdown` (T1); `9379bde` marks T1/T3 TODO items completed.
- `70504b2` — `fix: cap read_file caches (LRU 512) + write back metadata` (T3).
- `67a60e7` — `feat(etl): cross-file D1 callee resolve + include_tests` (T2); `28c0f04` marks T2/T4 TODO items completed.
- `2315f3c` — `fix(checkpoint): make restore async, real PG memory check` (T4).
- `da4c60f` — `fix(config): reconcile MassaAiConfig + drop compression.llm` (T5); `091dbea` — `fix(deps): align mcp-client @types/node + shared dotenv` (T6); `be1fa3a` marks T5/T6 items completed.
- `51ce05c` — `test: drop redundant Phase-4 Dx:SKIP env guards` (T7); `03aa888` — `fix(test): align PG-integration gates to DB_AVAILABLE` (T8); `382b902` marks T7/T8 done.

### Benchmark, docs, and E2E additions

- `12ecdee` — `bench(llm-judge): qwen2.5 consolidator/salience/reranker harness` (T9); `614bf91` — `docs: add operational knobs + e2e/observation notes` (T10); `ac66ab0` marks T9/T10 done.
- `c1d68de` — `test(e2e): SF3 42-tool roster + D4/lifecycle asserts` (T11a).
- `bb1860a` — `test(e2e): add Phase-4 graph suite (D1-D4)` (T11b); `baa31cc` — `test(e2e): add new-feature suites (post-1367007)` (T11c).

### In-range follow-up beyond named task commits

- `543166c` — `fix(symbol-graph): cap projectRootCache LRU 512`; `07739a1` records the T3 side finding in `TODO.md`.
- `81d3360` — `fix(embeddings): abort Ollama fetch on timeout`; commit message says an E2E V2 run exposed the live-index hang.

## Preserved acceptance facts

- Source-plan acceptance requires Phase-4 guards and PostgreSQL suites to run rather than skip. `51ce05c` and `03aa888` implement those gate changes; their commit messages report focused batch results.
- Source-plan acceptance requires a 42-tool E2E roster and Phase-4/post-`1367007` coverage. `c1d68de`, `bb1860a`, and `baa31cc` add those asserted surfaces.
- Source plan keeps D3's SQLite `DATABASE_URL=""` pin and defers broad multi-language parsing; `51ce05c` preserves the former, while `67a60e7` is TS/JS-oriented cross-file resolution.
- `[low] adsads/` remains outside this plan's requested fix scope.

## Deviations/unresolved gaps

- No in-range commit subject or inspected commit evidence establishes T12 final documentation reconciliation after V1/V2.
- The plan required a final full V1 then V2 sequence, including live and destructive E2E. Commit messages contain focused and historical verification claims, but this record did not run those commands or inspect final-range command logs; full acceptance is therefore unproven here.
- T11c's commit says scheduler and offline-embedding checks are gap probes because no black-box surface exists; this is narrower than an executable E2E assertion for those two areas.
- `543166c` and `81d3360` expand work beyond the named T1–T11 implementation tasks as side-finding/E2E-follow-up fixes.

## Existing spec crossrefs

- [Repository maintenance 2026-07-12](../../repository-maintenance-2026-07-12/spec.md)
- [Phase 4 bootstrap](../../phase-4-bootstrap/spec.md)
- [Phase 7 retrieval polish](../../phase-7-retrieval-polish/spec.md)
- [Current maintenance next steps](../../close-maintenance-next-steps-2026-07-13/spec.md)
- [E2E coverage ledger](../../../../packages/core/src/__tests__/e2e/COVERAGE.md)

## Verification evidence

- Read source plan, including T1–T12, V1/V2 requirements, exclusions, dependencies, and residual risks.
- Inspected complete requested commit range and targeted bodies/diff statistics for T1–T11, documentation closures, E2E additions, and follow-up fixes.
- This documentation task performs no runtime build, unit, PostgreSQL, live-stack, or destructive E2E execution; commit-message test claims are retained as historical evidence only.

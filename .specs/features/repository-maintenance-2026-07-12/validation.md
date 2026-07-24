# Validation Report

**Status:** Complete with one documented performance exception  
**Acceptance backend:** PostgreSQL 17 + pgvector 0.8.4  
**Dedicated database:** `massa_ai_test` at `127.0.0.1:5433`

## Acceptance Evidence

| Criterion | Evidence | Result |
| --- | --- | --- |
| MNT-01 baseline safety | baseline hashes/patch in `baseline.md`; protected shared API health checked throughout | PASS |
| MNT-02 repository analysis | `analysis.md` maps components, data flow, DB ownership, performance knobs, invariants, and debt | PASS |
| MNT-03 gate completeness | `gate-manifest.md` has explicit results for G01–G14; `failure-ledger.md` records invalid evidence separately | PASS |
| MNT-04 PostgreSQL parity | `parity-matrix.md` closes PAR-01–PAR-11 with direct PG assertions and runtime routing | PASS |
| MNT-05 root-cause fixes | F-01–F-31 each have focused evidence; assertions were strengthened or corrected only with source-backed contract proof | PASS |
| MNT-06 continuity | state, handoff, TODO, and memory synthesis finalized after G10 | PASS |

## Clean Verification

- Fresh schema reset applied all 14 migrations, including
  `20260713090000_add_handoffs_proposals_pg`.
- `bun run build`: 5/5 tasks.
- `bun run type-check`: 6/6 tasks.
- Uncached `bun run test`: 10/10 tasks; core 129 files in 74 isolated groups;
  explicit live integration excluded; exit 0.
- LLM judge: 4/4 against dedicated qwen2.5 instruct/coder models.
- Standard E2E before the parity amendments: all 18 sequential groups and cleanup passed.
- Post-amendment bge-m3 diagnostic completed the full suite but was rejected for acceptance:
  model-dependent `minScore` and hit@1 floors failed; thresholds were not weakened.
- Post-amendment default-qwen E2E: cold self-index exceeded the 420-second
  `beforeAll` deadline before assertions. The prior default-qwen full run passed; changed PG
  subsystems have focused parity/regression evidence; this performance exception is E-08.

## PostgreSQL Parity Sensors

- Vector/ETL/checkpoint/session: 27 tests, 115 assertions.
- Memory CRUD/FTS: 7 tests, 28 assertions.
- Search cache keys: 3 tests, 14 assertions; pre-fix collision sensor failed as expected.
- Graph: 6 PG tests including 25 concurrent increments; 32 SQLite regressions.
- Scheduler: 5 PG tests twice; 34 scheduler regressions.
- Embedding cache: 8 PG + 4 SQLite + 16 provider regressions.
- Handoff/proposal: 11 PG + 18 SQLite repository + 49 service regressions; direct
  PG row attestation and concurrent terminal compare-and-set behavior.

## Independent/Discrimination Evidence

- Pre-fix search-cache sensor reproduced `minScore`/`explainScores` collisions.
- Graph concurrent increment sensor distinguishes read-modify-write from atomic SQL.
- Scheduler rapid same-ID write sensor distinguishes fixed-delay drain from true FIFO drain.
- Memory access-reinforcement sensor proves why sequential transport recall scores are mutable.
- Exact dedicated guards reject any database other than
  `test:test@127.0.0.1:5433/massa_ai_test` in new PG parity suites.

## Protected Assets

- `medium-findings.test.ts`: baseline SHA-256
  `ca0ac04d0302a94b49fa806634073a0e234abfceaacfc02d217f922626cc1fda`; unchanged.
- `_bun-mock-guard.ts`: baseline SHA-256
  `41f38c754c968a9d3740bcc03e0387db46f5bd9d5ee0223f6022cb57b23091d7`; unchanged.
- `impact-analysis.ts`: user hunks preserved; only an approved disjoint Git date/ref fix
  was added, with focused regression evidence.
- Shared API `:3333`: never restarted; final health sentinel returned `ok`.
- Dedicated API `:3334` was stopped; owned Ollama `:11435` and PostgreSQL `:5433`
  were stopped after the final identity/migration check.

## Residual Risks

- Cold qwen3-embedding:8b indexing is the dominant verification cost. `bge-m3` is much
  faster but has a different cosine-score distribution and narrowly misses the qwen-tuned
  relevance floor. Keep acceptance thresholds model-specific or calibrate per-provider
  scores in a separate design change.
- Static destructive runbooks N1, N3, E25, and F88 require external orchestration and remain
  documented expected skips; executable N9/N12/N13/F87 passed on the dedicated stack.

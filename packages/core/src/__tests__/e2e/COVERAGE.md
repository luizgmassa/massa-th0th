# massa-th0th E2E Coverage

Current E2E contract for `packages/core/src/__tests__/e2e/`.

Last updated: 2026-07-13. Acceptance backend: PostgreSQL 17 + pgvector 0.8.4.

## Coverage decisions

- Standard E2E runs sequentially against a dedicated Tools API, PostgreSQL database, MCP build,
  and Ollama instance. The shared developer API on `:3333` is never a test target.
- `MASSA_TH0TH_DEDICATED=1`, explicit `DATABASE_URL`/`POSTGRES_VECTOR_URL`, and
  `VECTOR_STORE_TYPE=postgres` are required. Backend attestation must fail closed rather than infer
  PostgreSQL from API-local cache files.
- All mutable project IDs use the E2E prefix guard. Destructive scenarios run only in the
  dedicated destructive gate.
- The suite reuses `e2e-th0th-shared` to avoid concurrent full-repository indexing and Ollama OOM.
  Cleanup verification stays last and checks for leaked prefixed data.
- Index readiness requires both stable non-zero document counts and the originating job's
  terminal `completed` status. A failed job aborts immediately with its recorded error.
- HTTP/MCP matrices compare stable contract fields. Volatile IDs/timestamps are normalized.
  Memory recall scores are validated independently because the first recall reinforces access
  counts before the second transport runs.
- Relevance thresholds are embedding-profile contracts. A faster provider may not reuse qwen's
  raw-score or hit@1 thresholds without an explicit calibration design.
- Live E2E is excluded from root/unit discovery. `RUN_E2E` must be `1` to enable it; leave it unset
  or empty to disable it, never the truthy string `0`.

## Suite map

| File | Coverage responsibility |
| --- | --- |
| `00.harness.smoke.test.ts` | API/MCP availability and basic transport contract |
| `02.indexing.test.ts` | index, status, reindex/reset, lifecycle, terminal job consistency |
| `05.memory.test.ts` | remember/recall/update/delete/list and HTTP/MCP parity |
| `06.checkpoints.test.ts` | checkpoint create/list/restore |
| `08.search.test.ts` | hybrid search, response tiers, compression, file/symbol tools |
| `09.symbol-graph.test.ts` | definitions, references, project map, navigation |
| `10.synapse.test.ts` | session create/prime/access/persistence and transport parity |
| `11.lifecycle.test.ts` | hooks, bootstrap, handoffs, and proposals |
| `12.observability.test.ts` | health, metrics, analytics, SSE, Swagger, and UI endpoints |
| `13.cli.test.ts` | CLI flags and isolated configuration operations |
| `14.needles.test.ts` | deterministic relevance hit@1, hit@5, and MRR floors |
| `15.nfr.test.ts` | concurrency, performance, isolation, and resilience properties |
| `16.destructive.test.ts` | dedicated-only saturation/outage/configuration scenarios |
| `17.cleanup-verify.test.ts` | final prefixed-data leak check |
| `18.graph-phase4.test.ts` | typed edges, trace paths, impact analysis, architecture maps |
| `19.web-exec.test.ts` | web controller and execution-tool behavior |
| `20.new-features.test.ts` | observations, compact snapshots, proposals, Synapse PG persistence |
| `backend-attestation.test.ts` | dedicated/non-dedicated backend-detection unit contract |

The MCP surface is defined by `apps/mcp-client/src/tool-definitions.ts`; coverage should follow
that source rather than duplicating a tool count here. When a tool or endpoint is added, update
the responsible suite row and add HTTP/MCP equivalence where both transports exist.

## Tests updated in the 2026-07-13 maintenance pass

- `backend-attestation.test.ts`: 4 assertions cover authoritative dedicated PostgreSQL/SQLite
  declarations, remote non-dedicated behavior, and unknown fallback.
- `02.indexing.test.ts`: readiness now waits for stable documents plus the exact job's terminal
  completion and reports terminal failures directly.
- `05.memory.test.ts`: recall matrices compare stable transport data while enforcing numeric,
  finite, `[0, 1]` scores on both responses.
- `15.nfr.test.ts`: concurrent-project fixtures use distinct IDs and include searchable fixture
  metadata files, removing accidental cross-project aliasing and empty-probe ambiguity.
- `20.new-features.test.ts`: Synapse prime fixtures use the current memory shape and assert both
  `primed` and reconstructed buffer size.
- `_helpers.ts`: dedicated backend attestation uses the explicit vector-store declaration; API
  cache-file listings no longer misclassify a PostgreSQL data plane as SQLite.

## Latest real verification data

The authoritative command ledger is
`.specs/features/repository-maintenance-2026-07-12/gate-manifest.md`.

| Gate | Latest measured result |
| --- | --- |
| Build | 5/5 tasks passed |
| Type-check | 6/6 tasks passed |
| Root aggregate | Uncached 10/10 Turbo tasks passed; core ran 129 files in 74 isolated groups; exit 0 |
| LLM judge | 4/4 passed against dedicated qwen2.5 instruct/coder models |
| PostgreSQL parity sensors | Vector/ETL/checkpoint/session 27 tests/115 assertions; memory 7/28; search-cache 3/14; graph 6 PG plus 32 SQLite regressions; scheduler 5 PG twice plus 34 regressions; embedding cache 8 PG plus 4 SQLite plus 16 provider regressions; handoff/proposal 11 PG plus 18 SQLite plus 49 service regressions |
| Destructive E2E | N9, N12, N13, and F87 passed; N1, N3, E25, and F88 remain explicit external-orchestration skips; 0 executable failures |

### Standard E2E result sequence

1. The full default-qwen run before the final parity amendments passed all 18 sequential groups
   and cleanup.
2. The post-amendment `bge-m3` diagnostic completed the full suite. It was not accepted because
   `08.search` returned one nonsense hit at raw `minScore: 0.7`, and `14.needles` hit@1 was
   `0.357` against the qwen-calibrated `0.360` floor; hit@5 and MRR passed.
3. The final post-amendment default-qwen cold run did not reach assertions: repository indexing
   exceeded the 420-second `02.indexing` setup deadline at roughly `0.10–0.14 files/s`.

Therefore G10 is a documented performance exception, not a claimed clean post-amendment full
pass. The changed memory matrix passed live 25/25, and every changed PostgreSQL subsystem has
focused parity/regression evidence. Acceptance thresholds were not weakened.

## Active E2E follow-ups

- Eliminate the cold-qwen G10 exception with a dedicated fixture/warm-cache strategy or a
  separately designed provider-calibration contract.
- Automate N1, N3, E25, and F88 on the dedicated stack without touching shared services.
- Rebuild `e2e-th0th-shared` without the stale `adsads/` path that can pollute N11 ranking.

## Commands

From `packages/core` with the dedicated stack running:

```bash
RUN_E2E=1 bun test src/__tests__/e2e/
RUN_E2E=1 RUN_E2E_DESTRUCTIVE=1 bun test src/__tests__/e2e/16.destructive.test.ts
```

Use the complete isolated environment from the gate manifest. Never rely on Bun's root `.env`
for the acceptance database.

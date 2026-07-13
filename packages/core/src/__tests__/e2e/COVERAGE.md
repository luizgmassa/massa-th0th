# massa-th0th E2E Coverage

Current E2E contract for `packages/core/src/__tests__/e2e/`.

Last updated: 2026-07-13. Acceptance backend: PostgreSQL 17 + pgvector 0.8.4.

## Coverage decisions

- Standard E2E runs sequentially against a dedicated Tools API, PostgreSQL database, MCP build,
  and Ollama instance. The shared developer API on `:3333` is never a test target.
- `MASSA_TH0TH_DEDICATED=1`, explicit `DATABASE_URL`/`POSTGRES_VECTOR_URL`, and
  `VECTOR_STORE_TYPE=postgres` are required. Backend attestation must fail closed rather than infer
  PostgreSQL from API-local cache files.
- Commit-locked fixture recovery additionally requires an explicit fixture path, API origin
  `http://127.0.0.1:3334`, and both database URLs at
  `127.0.0.1:5433/massa_th0th_test`; a partial dedicated declaration fails closed before
  availability probes, HTTP calls, or shared-index work.
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
| `21.qwen-fixture.test.ts` | negative discrimination for the commit-locked qwen fixture |
| `22.path-identity.test.ts` | same-process wrong-root rebuild plus direct PostgreSQL manifest/path sentinels |
| `23.owned-destructive.test.ts` | owned N1/N3/E25/F88 outage, restart, configuration, and recovery orchestration |
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
- `_helpers.ts`: shared-index checks coalesce only while in flight, then revalidate canonical
  workspace identity before every later reuse in the same Bun process.
- `read_file.ts`: the process-lifetime read-file tool refreshes an affected cached project root
  when the existing canonical `indexing:started` lifecycle event announces a rebuild.

## Latest real verification data

The authoritative command ledger is
`.specs/features/close-maintenance-next-steps-2026-07-13/gate-manifest.md`.

| Gate | Latest measured result |
| --- | --- |
| Build | 5/5 tasks passed |
| Type-check | 6/6 tasks passed |
| Root aggregate | Uncached 10/10 Turbo tasks passed; core ran 80/80 isolated groups; exit 0 |
| Focused maintenance | 61/61 passed, 191 assertions, 0 skip |
| Destructive E2E | Owned N1/N3/E25/F88: 4/4 passed, 79 assertions, 0 skip; every outage recovered |
| Standard qwen G10 | Clean PostgreSQL/qwen stack at fixture HEAD `02b7475`: 243 pass, 6 explained skips, 0 fail across 17 sequential files; cleanup-last 2/0/0 |
| Relevance | Two identical sweeps: hit@1 .643, hit@3 .786, hit@5 .929, hit@10 .929, MRR .746; floors unchanged |
| Cleanup/path | Zero unexpected E2E workspaces and zero invalid vector/symbol paths; 34+34 manifest-contained distinct paths |

### Standard E2E result sequence

The accepted 2026-07-13 run started from an empty PostgreSQL 17/pgvector database and a local
46-file sparse clone locked to commit `02b7475`. Cold qwen indexed 34 discoverable sources into
468 chunks and 1,070 symbols in 369.091 seconds, within the unchanged 420-second gate. The 17
standard files then completed with 243 passes and six explained skips in 781.80 seconds. Cleanup
ran as its own final command and passed 2/2. Direct SQL verified the sole shared workspace,
manifest-contained paths, and no `adsads/`, absolute, traversal, or prefixed-project leak.

The six skips are deliberate: one internal Synapse effect; F87/F88 destructive variants covered
by the separate owned gate; shared-workspace deletion; deep vector internals without an API
surface; and auth-on restart outside the auth-off standard stack. No unexplained skip remains.

After the accepted run, commit `2e5ad3d` added the final fail-closed guard for incomplete
dedicated intent. Its fixture/backend matrix passed 12/12 with 38 assertions, including a
zero-fetch negative test, and type-check passed 6/6. The user explicitly waived repeating the
full qwen G10 for this test-helper-only delta; no partial rerun is counted above.

## Commands

From `packages/core` with the dedicated stack running:

```bash
RUN_E2E=1 bun test --max-concurrency 1 \
  src/__tests__/e2e/00.harness.smoke.test.ts \
  src/__tests__/e2e/02.indexing.test.ts \
  src/__tests__/e2e/05.memory.test.ts \
  src/__tests__/e2e/06.checkpoints.test.ts \
  src/__tests__/e2e/08.search.test.ts \
  src/__tests__/e2e/09.symbol-graph.test.ts \
  src/__tests__/e2e/10.synapse.test.ts \
  src/__tests__/e2e/11.lifecycle.test.ts \
  src/__tests__/e2e/12.observability.test.ts \
  src/__tests__/e2e/13.cli.test.ts \
  src/__tests__/e2e/14.needles.test.ts \
  src/__tests__/e2e/15.nfr.test.ts \
  src/__tests__/e2e/18.graph-phase4.test.ts \
  src/__tests__/e2e/19.web-exec.test.ts \
  src/__tests__/e2e/20.new-features.test.ts \
  src/__tests__/e2e/21.qwen-fixture.test.ts \
  src/__tests__/e2e/22.path-identity.test.ts
RUN_E2E=1 bun test --max-concurrency 1 src/__tests__/e2e/17.cleanup-verify.test.ts
RUN_E2E=1 RUN_E2E_DESTRUCTIVE=1 bun test src/__tests__/e2e/16.destructive.test.ts
RUN_E2E=1 RUN_OWNED_DESTRUCTIVE=1 bun test --max-concurrency 1 src/__tests__/e2e/23.owned-destructive.test.ts
```

Use the complete isolated environment from the gate manifest. Never rely on Bun's root `.env`
for the acceptance database.

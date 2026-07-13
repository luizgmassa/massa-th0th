# Final Verification Evidence

Measured on 2026-07-13 against local code commit
`02b7475fa519ff29be05e6d161390685a0024037`. Test credentials below belong only to the
run-owned disposable database; no secret or root `.env` value is recorded.

## Isolation and ownership

- Database: `postgresql://test:test@127.0.0.1:5433/massa_th0th_test` for both
  `DATABASE_URL` and `POSTGRES_VECTOR_URL`; `VECTOR_STORE_TYPE=postgres`.
- PostgreSQL: 17.10, pgvector 0.8.4, PID 18151, data directory
  `/tmp/massa-th0th-g10-review-8YB45s/postgres`.
- Ollama: 0.31.2, PID 19055, `127.0.0.1:11435`, model `qwen3-embedding:8b`, 7.6B
  Q4_K_M, embedding dimension 4096.
- Tools API: PID 19706, `http://127.0.0.1:3334`, scheduler disabled.
- Fixture: `/tmp/massa-th0th-g10-review-8YB45s/qwen-fixture`, 46 hash-verified files,
  HEAD `02b7475fa519ff29be05e6d161390685a0024037`.
- Developer-owned API: PID 9754, start `2026-07-12 20:39:53 -0300`, command
  `bun src/index.ts`; `/health` returned `status:ok` before and after. It received no request
  other than the required `/health` probes and was never signaled or reconfigured.

The run-owned listeners were recorded with:

```bash
rtk lsof -nP -iTCP:5433 -iTCP:3334 -iTCP:11435 -sTCP:LISTEN
rtk ps -p 18151,19055,19706,9754 -o pid=,lstart=,command=
```

The fixture command exited 0:

```bash
MASSA_TH0TH_DEDICATED=1 \
MASSA_TH0TH_E2E_PROJECT_PATH=/tmp/massa-th0th-g10-review-8YB45s/qwen-fixture \
bun scripts/prepare-qwen-e2e-fixture.ts
```

The API was started from `apps/tools-api` with the following explicit environment; Bun's root
`.env` therefore could not select the acceptance database or service:

```bash
HOME=/tmp/massa-th0th-g10-review-8YB45s/home \
XDG_CONFIG_HOME=/tmp/massa-th0th-g10-review-8YB45s/config \
DATABASE_URL=postgresql://test:test@127.0.0.1:5433/massa_th0th_test \
POSTGRES_VECTOR_URL=postgresql://test:test@127.0.0.1:5433/massa_th0th_test \
VECTOR_STORE_TYPE=postgres MASSA_TH0TH_DEDICATED=1 \
MASSA_TH0TH_API_URL=http://127.0.0.1:3334 MASSA_TH0TH_API_PORT=3334 \
MASSA_TH0TH_API_KEY= MASSA_TH0TH_SCHEDULER_ENABLED=false \
MASSA_TH0TH_JOB_STALE_MS=300000 MASSA_TH0TH_JOB_REAPER_INTERVAL_MS=60000 \
OLLAMA_BASE_URL=http://127.0.0.1:11435 OLLAMA_HOST=127.0.0.1:11435 \
OLLAMA_MODELS=/Users/luizmassa/.ollama/models EMBEDDING_PROVIDER=ollama \
OLLAMA_EMBEDDING_MODEL=qwen3-embedding:8b OLLAMA_EMBEDDING_DIMENSIONS=4096 \
RLM_LLM_ENABLED=false /Users/luizmassa/.bun/bin/bun src/index.ts
```

## Standard G10 command and result

From `packages/core`, the following command exited 0 in 781.80 seconds:

```bash
HOME=/tmp/massa-th0th-g10-review-8YB45s/home \
XDG_CONFIG_HOME=/tmp/massa-th0th-g10-review-8YB45s/config RUN_E2E=1 \
MASSA_TH0TH_DEDICATED=1 \
MASSA_TH0TH_E2E_PROJECT_PATH=/tmp/massa-th0th-g10-review-8YB45s/qwen-fixture \
DATABASE_URL=postgresql://test:test@127.0.0.1:5433/massa_th0th_test \
POSTGRES_VECTOR_URL=postgresql://test:test@127.0.0.1:5433/massa_th0th_test \
VECTOR_STORE_TYPE=postgres MASSA_TH0TH_API_URL=http://127.0.0.1:3334 \
MASSA_TH0TH_API_PORT=3334 MASSA_TH0TH_API_KEY= MASSA_TH0TH_SCHEDULER_ENABLED=false \
OLLAMA_BASE_URL=http://127.0.0.1:11435 OLLAMA_HOST=127.0.0.1:11435 \
OLLAMA_MODELS=/Users/luizmassa/.ollama/models EMBEDDING_PROVIDER=ollama \
OLLAMA_EMBEDDING_MODEL=qwen3-embedding:8b OLLAMA_EMBEDDING_DIMENSIONS=4096 \
RLM_LLM_ENABLED=false bun test --max-concurrency 1 \
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
```

Result: 243 pass, 6 skip, 0 fail, 1,999 assertions, 17 files. The cold load indexed 34
discoverable files into 468 chunks and 1,070 symbols in 369.091 seconds. The canonical shared
ID was `e2e-th0th-shared-b4c0f19595b437ab`.

Two identical relevance sweeps measured hit@1 0.643, hit@3 0.786, hit@5 0.929, hit@10
0.929, and MRR 0.746. The existing floors remained 0.36/0.64/0.47; no query, threshold, or
timeout was changed.

The six skips were all pre-declared and source-backed:

1. Synapse E20 is internal and not publicly observable.
2. F87 queue saturation is destructive and passed in the owned G06 gate.
3. F88 hook disable/re-enable is destructive and passed in the owned G06 gate.
4. Shared-workspace deletion would destroy standard-suite shared state and is covered by G06.
5. N15 deep vector internals have no public API surface; direct PostgreSQL sentinels cover
   stored dimension/path integrity.
6. N18 requires an auth-on API restart and is outside the standard auth-off stack.

Passing tests also reported three bounded latency caveats without weakening assertions: F90
handoff search, WF5 web fetch-to-search, and OB1 observation-to-memory search did not surface
their markers within their existing 120/90/90-second best-effort windows. Their load-bearing
durable/admission contracts passed.

## G02-G06 exact commands

G02, G03, and G05 ran from repository root:

```bash
bun run build
bun run type-check
TURBO_FORCE=true RUN_E2E= RUN_OWNED_DESTRUCTIVE= \
RUN_E2E_DESTRUCTIVE= RLM_LLM_ENABLED=false \
DATABASE_URL=postgresql://test:test@127.0.0.1:5433/massa_th0th_test \
POSTGRES_VECTOR_URL=postgresql://test:test@127.0.0.1:5433/massa_th0th_test \
VECTOR_STORE_TYPE=postgres MASSA_TH0TH_DEDICATED=1 \
MASSA_TH0TH_API_URL=http://127.0.0.1:3334 MASSA_TH0TH_API_PORT=3334 \
MASSA_TH0TH_API_KEY= MASSA_TH0TH_SCHEDULER_ENABLED=false \
OLLAMA_BASE_URL=http://127.0.0.1:11435 OLLAMA_HOST=127.0.0.1:11435 \
OLLAMA_MODELS=/Users/luizmassa/.ollama/models EMBEDDING_PROVIDER=ollama \
OLLAMA_EMBEDDING_MODEL=qwen3-embedding:8b OLLAMA_EMBEDDING_DIMENSIONS=4096 \
bun run test
```

Results respectively: build 5/5, exit 0, about 6 seconds; type-check 6/6, exit 0,
3.522 seconds; uncached root aggregate 10/10 Turbo tasks with core 80/80 isolated groups,
exit 0, 61.078 seconds.

G04 ran from `packages/core` against the owned PostgreSQL acceptance database. The nine-file
command was:

```bash
RUN_E2E= RLM_LLM_ENABLED=false \
DATABASE_URL=postgresql://test:test@127.0.0.1:5433/massa_th0th_test \
POSTGRES_VECTOR_URL=postgresql://test:test@127.0.0.1:5433/massa_th0th_test \
VECTOR_STORE_TYPE=postgres MASSA_TH0TH_DEDICATED=1 \
bun test \
  src/__tests__/search-synapse-integration.test.ts \
  src/__tests__/synapse-buffer-integration.test.ts \
  src/__tests__/search-controller.test.ts \
  src/__tests__/search-filter-overfetch.test.ts \
  src/__tests__/search-cache-key-parity.test.ts \
  src/__tests__/search-dependency-outage.test.ts \
  src/__tests__/embedding-cache-parity.test.ts \
  src/__tests__/index-project-identity.test.ts \
  src/__tests__/qwen-e2e-fixture.test.ts
```

Result: exit 0; 61 pass, 0 fail, 0 skip, 191 assertions, Bun 1.406 seconds. Later reviewer
remediation added two focused assertions/tests; their final 12-test command and results are
recorded under “Final safety delta and user waiver.”

G06 is self-provisioning and ownership-attesting; it ran from `packages/core` with no external
service environment inherited as acceptance authority:

```bash
RUN_E2E=1 RUN_OWNED_DESTRUCTIVE=1 \
bun test --max-concurrency 1 src/__tests__/e2e/23.owned-destructive.test.ts
```

Result: exit 0; 4 pass, 0 fail, 0 skip, 79 assertions, 14.56 seconds. The harness itself created
and attested the disposable PostgreSQL/Ollama/API resources before each signal and removed them
afterward.

## Cleanup-last and direct sentinels

The same explicit environment was used for the separate last command:

```bash
bun test --max-concurrency 1 src/__tests__/e2e/17.cleanup-verify.test.ts
```

Result: exit 0; 2 pass, 0 fail, 0 skip, 2 assertions, 29 ms. It found only
`e2e-th0th-shared-b4c0f19595b437ab` among prefixed workspaces and no non-shared memory leak.

The final read-only PostgreSQL sentinel command exited 0:

```bash
/opt/homebrew/opt/postgresql@17/bin/psql \
  postgresql://test:test@127.0.0.1:5433/massa_th0th_test -Atc \
  "select 'unexpected_e2e_workspaces', count(*) from workspaces where project_id like 'e2e-th0th-%' and project_id <> 'e2e-th0th-shared-b4c0f19595b437ab';
   select 'invalid_vector_paths', count(*) from (select distinct metadata->>'filePath' p from vector_documents_4096d where project_id='e2e-th0th-shared-b4c0f19595b437ab') s where p is null or p='' or p like '/%' or p like '%../%' or p like '../%' or p like '%adsads/%' or p like 'qwen-fixture/%';
   select 'invalid_symbol_paths', count(*) from (select distinct relative_path p from symbol_files where project_id='e2e-th0th-shared-b4c0f19595b437ab') s where p is null or p='' or p like '/%' or p like '%../%' or p like '../%' or p like '%adsads/%' or p like 'qwen-fixture/%';
   select 'vector_rows', count(*), count(distinct metadata->>'filePath') from vector_documents_4096d where project_id='e2e-th0th-shared-b4c0f19595b437ab';
   select 'symbol_paths', count(distinct relative_path) from symbol_files where project_id='e2e-th0th-shared-b4c0f19595b437ab';
   select 'workspace', project_id, project_path, files_count, chunks_count, symbols_count from workspaces where project_id='e2e-th0th-shared-b4c0f19595b437ab';"
```

Measured rows: unexpected workspaces 0; invalid vector paths 0; invalid symbol paths 0; 468
vector rows across 34 paths; 34 symbol paths; canonical workspace 34 files/468 chunks/1,070
symbols. `22.path-identity.test.ts` independently compared every distinct path with the frozen
fixture manifest.

## Teardown

Only ownership-recorded run resources were stopped. The API and Ollama sessions received
SIGINT; PostgreSQL was stopped with:

```bash
/opt/homebrew/opt/postgresql@17/bin/pg_ctl \
  -D /tmp/massa-th0th-g10-review-8YB45s/postgres stop -m fast -w
```

`lsof` then found no listener on `5433`, `3334`, or `11435`. The run root
`/tmp/massa-th0th-g10-review-8YB45s` was removed. Shared PID 9754 retained the same start time
and returned healthy afterward.

## Remote drift exception

The baseline was clean `main` at `cc985905fae3495a31a16aaf0fbd75435a2e63df`, aligned with
`origin/main`. During execution, `refs/remotes/origin/main` independently advanced to
`8dad87af48891a46477987ace830252b81b833d1`:

```text
8dad87a refs/remotes/origin/main@{2026-07-13 14:26:09 -0300}: update by push
cc98590 refs/remotes/origin/main@{2026-07-13 09:57:26 -0300}: update by push
```

This orchestrator did not invoke `git push`, cannot attribute the actor from local evidence, and
did not rewrite or repair the remote. Consequently the local technical gates pass, but the
requested no-push outcome cannot be certified as an end-to-end run invariant.

## Final safety delta and user waiver

The final reviewer found that generic E2E helpers could still probe or mutate through a partially
declared dedicated environment. Commit `2e5ad3d3831362e89e3b03e8bcfcdaa8f4c72041` now rejects
partial dedicated intent before availability probes, HTTP calls, or shared-index work. Focused
verification was:

```bash
cd packages/core
bun test src/__tests__/qwen-e2e-fixture.test.ts \
  src/__tests__/e2e/backend-attestation.test.ts
cd ../..
bun run type-check
```

Results: 12 pass, 0 fail, 38 assertions, 1.201 seconds for focused tests; type-check 6/6 in
3.771 seconds. The negative test replaces `fetch`, calls `ensureSharedIndex()` with incomplete
dedicated pins, asserts the ownership error, and proves the fetch count remains zero.

A clean downstream stack was provisioned at commit `2e5ad3d` with PIDs PostgreSQL 28746, Ollama
29350, and API 29772. The fixture was hash-verified at the same HEAD with 46 files. The full G10
was in cold load (10/34 files) when the user explicitly instructed the orchestrator to skip this
repeat. The test was interrupted and is not acceptance evidence. API and Ollama were stopped,
PostgreSQL was stopped with ownership-verified `pg_ctl`, dedicated ports `5433`, `3334`, and
`11435` were confirmed free, and `/tmp/massa-th0th-g10-final-2e5ad3d` was removed. Shared PID
9754 retained its start time and healthy status.

## Evidence retention disclosure

Terminal output was measured live but was not copied into a separate raw-log artifact. The exact
accepted G10 command, environment, result counts, identities, skip reasons, SQL sentinels, and
teardown are preserved above. G02-G06 exact commands and measured results are preserved above,
but their raw transcripts were not separately persisted. The final
aborted stack's provisioning commands were captured during this session: `initdb` (one sandboxed
attempt rejected, escalated retry exit 0), `pg_ctl ... start -w`, `createdb`, `CREATE EXTENSION
vector`, and repository-local `prisma migrate deploy` applying 14 migrations. No partial result
from that aborted run is used to close a gate.

The captured provisioning sequence, from repository root unless noted, was:

```bash
/opt/homebrew/opt/postgresql@17/bin/initdb \
  -D /tmp/massa-th0th-g10-final-2e5ad3d/postgres \
  -U test --auth=trust --no-locale
/opt/homebrew/opt/postgresql@17/bin/pg_ctl \
  -D /tmp/massa-th0th-g10-final-2e5ad3d/postgres \
  -o '-p 5433 -h 127.0.0.1' \
  -l /tmp/massa-th0th-g10-final-2e5ad3d/postgres.log start -w
/opt/homebrew/opt/postgresql@17/bin/createdb \
  -h 127.0.0.1 -p 5433 -U test massa_th0th_test
/opt/homebrew/opt/postgresql@17/bin/psql \
  postgresql://test:test@127.0.0.1:5433/massa_th0th_test \
  -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS vector;'
cd packages/core
DATABASE_URL=postgresql://test:test@127.0.0.1:5433/massa_th0th_test \
POSTGRES_VECTOR_URL=postgresql://test:test@127.0.0.1:5433/massa_th0th_test \
VECTOR_STORE_TYPE=postgres ./node_modules/.bin/prisma migrate deploy
cd ../..
OLLAMA_HOST=127.0.0.1:11435 \
OLLAMA_MODELS=/Users/luizmassa/.ollama/models \
/usr/local/bin/ollama serve
```

All commands above exited 0 after the sandbox-rejected `initdb` attempt was retried with the
required host permission. Listener ownership was then recorded with `lsof`, and PostgreSQL
reported database `massa_th0th_test`, address `127.0.0.1`, port 5433, version 17.10, and pgvector
0.8.4. The Tools API command is identical to the accepted command above except for the run-root
suffix and the explicit `MASSA_TH0TH_E2E_PROJECT_PATH` required by `2e5ad3d`.

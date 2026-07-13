# Gate Manifest

Frozen before implementation. Rows may gain measured evidence; they may not be removed. Prior evidence under `repository-maintenance-2026-07-12/` is referenced, never rewritten.

## Verified Baseline

- HEAD/origin: `cc985905fae3495a31a16aaf0fbd75435a2e63df`; branch `main`; worktree clean.
- Bun `1.3.11`; Node `v25.9.0`; Turbo `2.10.2`; PostgreSQL tools `17.10`; Ollama client `0.31.2`; RTK available.
- Shared `:3333`: PID `9754`, start `2026-07-12 20:39:53 -0300`, command `bun src/index.ts`, health `ok`, service `massa-th0th-tools-api`, version `1.0.0`.
- Dedicated ports `3334`, `5433`, and `11435`: free.
- Required env: `DATABASE_URL=postgresql://test:test@127.0.0.1:5433/massa_th0th_test`, same `POSTGRES_VECTOR_URL`, `VECTOR_STORE_TYPE=postgres`, `MASSA_TH0TH_DEDICATED=1`.

## Sequential Gates

| ID | Gate | Required result | Status |
| --- | --- | --- | --- |
| G01 | Spec artifact validation and plan challenge | All artifacts active; full Evidence Audit serious findings incorporated; JSON and diff checks pass | PASS — delegated critic timed out read-only; strict local fallback completed |
| G02 | Build | `bun run build`, all tasks pass | PASS — 5/5 Turbo tasks |
| G03 | Type-check | `bun run type-check`, all tasks pass | PASS — 6/6 Turbo tasks |
| G04 | Focused unit/PG gates | Synapse, filters/cache, outage, embedding cache, workspace/index identity all pass | PASS — 61/61, 191 assertions |
| G05 | Uncached root aggregate | Explicit dedicated env, `TURBO_FORCE=true`, `RUN_E2E=`; all tasks pass | PASS — 10/10 Turbo tasks, core 80/80 isolated groups |
| G06 | Test-owned destructive suite | N1/N3/E25/F88 execute, pass, recover, no unexplained skip | PASS — 4/4, 79 assertions, 0 skip |
| G07 | Clean reprovision | Dedicated PostgreSQL/API/Ollama rebuilt; exact identity/version/provider/model/dimension | PASS — PG17.10/pgvector0.8.4, qwen3-embedding:8b/4096 |
| G08 | Standard qwen G10 | Commit-locked fixture; all sequential groups and cleanup pass within unchanged gates | PASS — 245 pass, 6 explained skips, 0 fail; cleanup last |
| G09 | PostgreSQL path/cleanup sentinels | No prefixed leaks, `adsads/`, absolute, traversal, or out-of-manifest paths | PASS — zero violations; 34 vector + 34 symbol paths |
| G10 | Final cleanup/shared sentinel/reviewer | Dedicated ports free; shared before/after PID/start/health recorded without mutation (independent drift reported, not repaired); read-only review accepts evidence | PASS WITH EXCEPTIONS — reviewer accepts technical/evidence closure under explicit downstream waiver; no-push remains uncertifiable |

## Evidence Fields

Every measured row records exact command, exit code, duration, pass/fail/skip counts, backend/database identity, provider/model/dimension, owned PIDs, skip reasons, and artifact/log pointer. Raw secrets and root `.env` values are never recorded.

## TASK-002 Measured Evidence

- Focused unit/Synapse gate: explicit dedicated env; 8 files; 82 pass, 0 fail, 0 skip; Bun-reported 181 ms, command wall 4.9 s; exit 0.
- Live F24: explicit PostgreSQL `127.0.0.1:5433/massa_th0th_test`, API `:3334`, Ollama `:11435`, qwen3-embedding:8b/4096; 1 pass, 0 fail, 0 skip, 35 filtered; 1.66 s; exit 0.
- Type-check: latest 6/6 Turbo tasks; 3.741 s; exit 0.
- Owned listeners: PostgreSQL PID 23481/data directory `/tmp/massa-th0th-close-20260713-1424/postgres`; Ollama PID 24780; API PID 25391. Shared `:3333` remained PID 9754 and healthy.
- Temporary F24 index: 4 files/4 chunks, 0 errors, 3.517 s; project `e2e-th0th-shared` inside the dedicated DB only. This stack is disposable and will be reprovisioned before fixture/G10 acceptance.

## TASK-003 Measured Evidence

- Focused filter/controller/cache gate: explicit dedicated env; 3 files; 25 pass, 0 fail, 0 skip; Bun-reported 148 ms, command wall 5.3 s; exit 0. Includes assertion-equivalent SQLite and dedicated PostgreSQL cache-key checks.
- Live F18: explicit PostgreSQL `127.0.0.1:5433/massa_th0th_test`, API `:3334`, Ollama `:11435`, qwen3-embedding:8b/4096; 1 pass, 0 fail, 0 skip, 35 filtered; Bun-reported 160 ms; exit 0.
- Type-check after the final implementation: 6/6 Turbo tasks; 3.217 s; exit 0.
- Disposable live fixture refresh: 5 files/7 chunks, 0 errors, 185 ms; project `e2e-th0th-shared` in the dedicated DB. API PID 35336; PostgreSQL PID 23481; Ollama PID 24780.
- Shared `:3333` remained PID 9754 and healthy after TASK-003. No shared process or data was mutated.
- Skip ledger: none. The 35 F18 entries reported as filtered are non-selected tests, not runtime skips.

## TASK-004 Measured Evidence

- Red sensor: 4 new zero-hit/outage/tool-envelope tests; 3 pass and the required-vector rejection assertion fails because the promise resolves `[]`; 1 fail; Bun-reported 106 ms, command wall 4.0 s; exit 1.
- Focused green gate: explicit dedicated env; 5 files covering outage transparency plus existing query-understanding/HyDE, lexical/graph, filters, and controller behavior; 52 pass, 0 fail, 0 skip; Bun-reported 1.75 s, command wall 6.3 s; exit 0.
- Type-check: 6/6 Turbo tasks; 3.221 s; exit 0.
- Structured transport seam: `SearchProjectTool` converts the surfaced required-vector rejection into the existing `{success:false,error}` response consumed unchanged by Tools API and MCP proxy. Live owned PostgreSQL/Ollama outage execution remains assigned to TASK-007 N1/N3.
- Shared `:3333` remained PID 9754 and healthy after TASK-004. No shared process or data was mutated. Skip ledger: none.

## TASK-005 Measured Evidence

- Bounded full-repository cold-qwen sample: empty dedicated PostgreSQL database; qwen3-embedding:8b/4096; stopped at 10 distinct completed files before the 180-second cap; 97 chunks and 97 embedding-cache rows; indexing job active for 51.795 s, measured throughput 0.193 files/s.
- Commit-locked fixture: local sparse clone at tested HEAD; 5 unique needle targets, 20 tracked source distractors, and 21 explicitly required support files; SHA-256 validation rejects changed, missing, secret, generated, `adsads/`, absolute, and traversal paths. Fixture selection requires both `MASSA_TH0TH_DEDICATED=1` and an explicit path.
- Cache dimension red/green: 8 pass/2 expected fail before dimension enforcement; final SQLite/PostgreSQL parity 10 pass, 0 fail. Final combined fixture/cache/search regression gate: 28 pass, 0 fail, 0 skip; Bun 1.468 s; exit 0.
- Focused live qwen/PostgreSQL sequence: `02.indexing` 19/19 in 401.15 s; `08.search` 36/36 in 24.84 s; `14.needles` 1/1 in 171 ms with identical sweeps at hit@1 .643, hit@5 .857, hit@10 .929, MRR .732; `18.graph-phase4` 9/9 in 896 ms; disposable negative fixture 1/1 in 3.63 s. No Bun test was skipped.
- Search relevance prerequisite exposed by the live fixture is independently committed as `e995ea6`; stale needle source spans are independently committed as `66607d3`. Neither qwen threshold, query, nor timeout changed.
- Type-check after final implementation: 6/6 Turbo tasks; 3.804 s; exit 0. Current owned listeners: PostgreSQL PID 23481, Ollama PID 24780, API PID 53768. Shared `:3333` remains PID 9754 and healthy.
- Conditional skip ledger from `08.search`: F21 stale auto-reindex path not isolated because the shared fixture was fresh; E5 cache internals lack public introspection; E6 keyword-only score breakdown is not publicly isolatable; E7 would require stopping Ollama and belongs to TASK-007; E29 is an internal fusion detail without a public toggle. Each test executed and passed its documented contract; Bun reported zero skips.

## TASK-006 Measured Evidence

- Canonical/profile unit gate: 10 pass, 0 fail, 0 skip; 27 assertions; latest Bun 1.404 s; exit 0. Covers symlink realpath, same-root alias reuse, non-force wrong-root refusal, force-owned replacement, five-field profile identity sensitivity, invalid-dimension fail-closed behavior, and dedicated-only guarded rebuild.
- Live wrong-root/path gate: seeded a fully warm duplicate fixture under the derived shared ID, proved all three warm probes hit, then `ensureSharedIndex` reset only the guarded dedicated prefix and rebuilt the canonical root. Final 3 pass, 0 fail, 0 skip; 351 assertions; Bun 8.63 s; exit 0. A live non-force API request for the wrong root returned structured `success:false` without changing the workspace.
- Derived identity `e2e-th0th-shared-cf1a4754d3e50a0f` binds fixture commit `7d680fd329578dfaec60e73cbfd3ae88224989c7`, manifest hash, provider `ollama`, model `qwen3-embedding:8b`, and dimension `4096`. Stored canonical root is `/private/tmp/massa-th0th-close-20260713-1424/qwen-fixture-t6`.
- Direct dedicated PostgreSQL sentinel: 468 vectors across 34 distinct metadata paths and 34 symbol-file paths; every path is relative, traversal-free, excludes `adsads/`, and belongs to the checked manifest. Search regression 36/36 in 35.33 s; symbol/workspace regression 23/23 in 6.48 s.
- Type-check: 6/6 Turbo tasks; latest 3.963 s; exit 0. Owned listeners: PostgreSQL PID 23481, Ollama PID 24780, API PID 64524. Shared `:3333` remains PID 9754 and healthy; it was not otherwise contacted or mutated.
- Conditional skip ledger: search reasons are unchanged from TASK-005. Symbol F46 and F49 lacked duplicate/FQN ambiguity in the sparse index and executed their documented best-effort assertions; Bun reported zero skips.

## TASK-007 Measured Evidence

- Exact gate: explicit dedicated PostgreSQL/vector/API/Ollama env plus `RUN_E2E=1 RUN_OWNED_DESTRUCTIVE=1 bun test --max-concurrency 1 src/__tests__/e2e/23.owned-destructive.test.ts`; exit 0; 4 pass, 0 fail, 0 skip; 73 assertions; Bun 14.44 s.
- Backend identity: native PostgreSQL 17 + pgvector at `127.0.0.1:5433/massa_th0th_test`; Ollama `qwen3-embedding:8b`, dimension 4096; isolated home/config and temporary PostgreSQL data directory. The harness refused preoccupied dedicated ports and used repository-local Prisma migrations.
- Ownership proof: initial PostgreSQL PID 77391/data directory `/var/folders/2s/y7r9gt5d15s48_z4nxkhyldr0000gn/T/massa-th0th-owned-destructive-JY5G71/postgres`/executable `/opt/homebrew/Cellar/postgresql@17/17.10/bin/postgres`, Ollama PID 77417/executable `/Applications/Ollama.app/Contents/Resources/ollama`, and API PID 77428/executable `/Users/luizmassa/.bun/bin/bun`. Listener PID, process start/executable/command, and PostgreSQL `postmaster.pid` were revalidated before every signal.
- N1: after warm unique search/recall/remember operations, uncached search, recall, and remember each returned structured `success:false` while owned Ollama was stopped; Ollama restarted as PID 77475 and uncached search recovered with `success:true`.
- N3: PostgreSQL outage returned HTTP and MCP `success:false`; PostgreSQL restarted as PID 77503, API restarted as PID 77526, and the data-plane probe recovered with `success:true`.
- E25: API termination left durable job `58b0ff53-3e9c-441a-9fbb-f66f3a8f98eb` running; restart PID 77574 marked it failed with exact error `process restart`; recovery job `c384fdf6-9957-49f9-9d6f-90bb91a45368` completed.
- F88: single and batch hooks returned 202 when enabled, 423 after dedicated API restart PID 77601 with `HOOKS_ENABLED=false`, and 202 after enabled restart PID 77626.
- Teardown: all owned `3334`, `5433`, and `11435` listeners stopped and the temporary run directory was removed. Shared `:3333` remained healthy at PID 9754 before and after. Skip ledger: none.
- Type-check after the final harness: 6/6 Turbo tasks; 3.286 s; exit 0.

## TASK-008 Final Measured Evidence

- G02: `bun run build`; 5/5 Turbo tasks; exit 0; command wall about 6 s.
- G03: `bun run type-check`; 6/6 Turbo tasks; final implementation rerun 3.522 s; exit 0.
- G04: nine focused files spanning Synapse, controller/filter/cache, outage, embedding cache, workspace identity, and qwen fixture; 61 pass, 0 fail, 0 skip; 191 assertions; Bun 1.406 s; exit 0.
- G05: `TURBO_FORCE=true RUN_E2E= RUN_OWNED_DESTRUCTIVE= RUN_E2E_DESTRUCTIVE= RLM_LLM_ENABLED=false bun run test`; 10/10 Turbo tasks, 0 cached; core 80/80 isolated groups; 1m01.078s; exit 0. Live E2E was excluded by contract, not counted as a Bun skip.
- G06 final: explicit owned destructive command with `RUN_E2E=1 RUN_OWNED_DESTRUCTIVE=1`; 4 pass, 0 fail, 0 skip; 79 assertions; 14.56 s. N1/N3/E25/F88 all executed. Final recovery API PID 92401; F88 API PIDs 92428/92453. Shared PID 9754 remained healthy.
- Reviewer remediation: commit `7c23e3f` gates destructive fixture/profile behavior; commit `02b7475` source-verifies N06-N10 spans and refreshes the dataset hash; commit `2e5ad3d` closes the remaining generic path by rejecting partial dedicated intent before availability probes, HTTP, or shared-index work. Final focused fixture/backend matrix 12/12 with 38 assertions and type-check 6/6 passed; the negative regression observed zero fetch calls.
- G07/G08 clean reviewer rerun: empty native PostgreSQL 17.10 database with pgvector 0.8.4; PIDs PostgreSQL 18151, Ollama 19055, API 19706; qwen3-embedding:8b/4096. Commit-locked fixture HEAD `02b7475fa519ff29be05e6d161390685a0024037`, 46 hash-verified files.
- G08 standard run: 17 sequential files, `bun test --max-concurrency 1`, 243 pass, 6 skip, 0 fail, 1,999 assertions, 781.80 s; cold load 34 files/468 chunks/1,070 symbols in 369.091 s. Cleanup ran as the separate last command: 2 pass, 0 fail, 0 skip, 29 ms. Total: 245 pass, 6 explained skips, 0 fail across 18 files.
- Relevance: two identical qwen sweeps at hit@1 .643, hit@3 .786, hit@5 .929, hit@10 .929, MRR .746; unchanged floors .36/.64/.47. Negative fixture discrimination passed.
- G09 direct SQL: unexpected prefixed workspaces 0; invalid vector paths 0; invalid symbol paths 0; 468 vectors over 34 distinct vector paths and 34 symbol paths. Sole shared workspace `e2e-th0th-shared-b4c0f19595b437ab` stored the canonical fixture root and reported 34 files/468 chunks/1,070 symbols.
- G10 cleanup: owned API/Ollama/PostgreSQL stopped after ownership recording; dedicated ports free; final run root removed. Shared `:3333` stayed PID 9754 with the same start time and health `ok` before and after; it was never managed or mutated.
- Exact commands, environment, exit codes, durations, identities, skips, sentinels, and teardown are recorded in `final-verification-evidence.md`.
- The clean G10 above was completed at `02b7475`. A second clean stack at `2e5ad3d` was provisioned and reached 10/34 cold-load files, then was stopped on the user's explicit instruction to skip repeating the full G10. It is not counted as gate evidence; all its owned resources were removed. Residual risk: the final test-helper-only fail-closed patch has focused/type-check evidence but not a repeated full qwen run.
- Process exception: `origin/main` independently advanced from baseline `cc98590` to `8dad87a` at `2026-07-13 14:26:09 -0300` (`update by push`). This orchestrator did not invoke `git push`, could not attribute the actor, and did not repair the remote; therefore local technical acceptance passes but the no-push outcome cannot be certified as a run invariant.
- Final read-only review verdict: local technical acceptance PASS considering the explicit user waiver; documentation/evidence PASS; no-push NOT CERTIFIABLE.
- Standard G10 skip ledger (6): internal Synapse threshold effect; F87 saturation and F88 hook toggling reserved for/covered by G06; destructive shared-workspace deletion; deep vector internals not API-observable; auth-on restart not part of the auth-off standard stack. No new unexplained skip.

## Artifact Checksums

Initial SHA-256 freeze (before plan challenge):

| Artifact | SHA-256 |
| --- | --- |
| `spec.md` | `994951b5ff9b6f9fc682efc4790df29b41860ef6b2613b8a8be4e5ffd16460cb` |
| `context.md` | `a74e9390ce6c50dd5acfda1f1d91ee9717635f48e49fef23d7d0b5b12135d36f` |
| `design.md` | `91600195268c26cbdebbbe9dc933ef5ef664ba26293793ca14ee806315e0d053` |
| `tasks.md` | `c1113162d2e6054c0689a6caaa21bd619546c925ad77d236673823514f4cf050` |
| `failure-ledger.md` | `e066e84dfd1b72a2fb972303e34474a5bf1711e61756d50dcdb2549334d2622b` |
| `validation.md` | `f5488233cdcbc4afc8c3f3e6b75c3e7ac38b6909c4be65de5d9604cb0301ad59` |
| `postgres-parity-evidence.md` | `d38cc49bf8b012931d9c2c0205d1745e024d91ff9bc82bc6fb1678e3873da2c5` |

Final documentation records the post-execution hashes. `gate-manifest.md` uses its Git blob ID at each committed freeze because a file cannot embed its own stable cryptographic checksum.

Final SHA-256 freeze after implementation, measured documentation, reviewer remediation, and the
user-waived repeated G10:

| Artifact | SHA-256 |
| --- | --- |
| `spec.md` | `994951b5ff9b6f9fc682efc4790df29b41860ef6b2613b8a8be4e5ffd16460cb` |
| `context.md` | `a74e9390ce6c50dd5acfda1f1d91ee9717635f48e49fef23d7d0b5b12135d36f` |
| `design.md` | `91600195268c26cbdebbbe9dc933ef5ef664ba26293793ca14ee806315e0d053` |
| `tasks.md` | `b9c654f36d38263ba777d69657f9fa3ccf92b3780d217b8715fa6b014f93c7a8` |
| `failure-ledger.md` | `3706f57223c2432582424f128805550f3f5401e3dec7e0f72909bb82016cfd82` |
| `validation.md` | `eab8ce63b3b33bc88549be254ec704ee12633f666fd665b3ef286003e2c07931` |
| `postgres-parity-evidence.md` | `d45c88f1eb8813ed9e849355bdaeb1bb8f30b033cacacbc48a3c670d6ddd3146` |
| `final-verification-evidence.md` | `f8a689e579d52d8e40935d89d1ce0b0e32ea555027a635bb2c381a27f6442494` |

The committed `gate-manifest.md` blob ID is recorded in the final handoff after the documentation
commit; embedding it here would recursively change that ID.

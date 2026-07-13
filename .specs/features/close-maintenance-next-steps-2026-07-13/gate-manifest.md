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
| G02 | Build | `bun run build`, all tasks pass | PENDING |
| G03 | Type-check | `bun run type-check`, all tasks pass | PENDING |
| G04 | Focused unit/PG gates | Synapse, filters/cache, outage, embedding cache, workspace/index identity all pass | PENDING |
| G05 | Uncached root aggregate | Explicit dedicated env, `TURBO_FORCE=true`, `RUN_E2E=`; all tasks pass | PENDING |
| G06 | Test-owned destructive suite | N1/N3/E25/F88 execute, pass, recover, no unexplained skip | PENDING |
| G07 | Clean reprovision | Dedicated PostgreSQL/API/Ollama rebuilt; exact identity/version/provider/model/dimension | PENDING |
| G08 | Standard qwen G10 | Commit-locked fixture; all sequential groups and cleanup pass within unchanged gates | PENDING |
| G09 | PostgreSQL path/cleanup sentinels | No prefixed leaks, `adsads/`, absolute, traversal, or out-of-manifest paths | PENDING |
| G10 | Final cleanup/shared sentinel/reviewer | Dedicated ports free; shared before/after PID/start/health recorded without mutation (independent drift reported, not repaired); read-only review accepts evidence | PENDING |

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

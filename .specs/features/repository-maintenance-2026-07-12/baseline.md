# Immutable Baseline

- HEAD: `81d33606fb6826e1759a073006b165419d0e3ba4`; branch: `main`
- Dirty patch SHA-256: `a4233b365819c931418a10119ef94d08efe45998713636644142d199e590ac0b`
- Bun `1.3.11`; Node `v25.9.0`; Git `2.49.0`
- Shared API: PID `9754`; health `ok`; service `massa-ai-tools-api`; version `1.0.0`
- Sandbox note: shared API health needs host-network access.

## User-Owned Dirty Files

| Path | SHA-256 | Fence |
| --- | --- | --- |
| `packages/core/src/services/symbol/impact-analysis.ts` | `ce795d782329288db4378c11136f5830cdd94102147fec434c814dd98568f176` | No edit without overlap report |
| `packages/core/src/__tests__/medium-findings.test.ts` | `ca0ac04d0302a94b49fa806634073a0e234abfceaacfc02d217f922626cc1fda` | No edit without overlap report |
| `packages/core/src/__tests__/_bun-mock-guard.ts` | `41f38c754c968a9d3740bcc03e0387db46f5bd9d5ee0223f6022cb57b23091d7` | Untracked; no edit without overlap report |

These changes address Bun process-global `mock.module` contamination around impact-analysis
and ETL suites. Related failures are `observed-on-user-dirty-baseline`, not maintenance regressions.

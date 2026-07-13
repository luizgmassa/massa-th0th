# Read-File Cache Correctness Specification

Slug: `read-file-cache-correctness`. Source: `read-packages-core-src-tests-e2e-coverag-declarative-tower.md`.

## Requirements

- Read-file cache keys distinguish request variants required by the plan’s correctness analysis.
- A load-bearing regression test protects the stale/colliding-cache failure mode.
- Dependency/type alignment needed by the changed test surface remains compatible.

## Deviations and Verification

Later LRU capping (`70504b2`) is additional hardening beyond the plan’s no-eviction scope. Historical `0455084` implementation evidence is retained; no fresh Bun/E2E/database run was performed.

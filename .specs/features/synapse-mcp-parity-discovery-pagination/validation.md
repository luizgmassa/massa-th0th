# M20 + M54 Validation

**Date**: 2026-07-19
**Diff range**: `16082bc..ff8dbbd`
**Verifier**: independent sub-agent
**Verdict**: PASS

## Acceptance Evidence

- AC1: GET/POST/PATCH/DELETE auth, path, body, parsed failures, and `isError` covered by 9 transport tests.
- AC2: live owned-stack Synapse suite passed create/get/update/prime/access/prefetch/list/end, missing and true-expiry behavior across HTTP/MCP.
- AC3: 0, 1, 99, 100, 101, and 201 registries traverse in order without gaps or duplicates.
- AC4: malformed, stale, reordered, description-changed, and input-schema-changed cursors return `InvalidParams`.
- AC5: strict roster is 47/47 unique, one page; README documents future cursor-aware clients.

## Gates

- Focused unit: 15 passed, 0 failed, 104 assertions.
- MCP package type-check and build: passed.
- Live Synapse: 21 passed, one pre-existing justified internal-only skip, 104 assertions.
- Discrimination: 2/2 killed (`100→99` page size; `isError true→false`).
- Worktree clean; scratch mutation worktree removed.

Tests, specs, fixtures, snapshots, schemas, public contracts, and validator checks were not weakened. Residual risk: live tests can return early if MCP startup fails, but the 104-assertion owned-stack run proves this validation execution used the live MCP path.

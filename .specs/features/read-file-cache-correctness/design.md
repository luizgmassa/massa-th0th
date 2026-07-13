# Declarative Tower Cache Correctness — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/read-packages-core-src-tests-e2e-coverag-declarative-tower.md`.

## Intent/scope

The source plan prescribed two serial fixes followed by a fresh verification
pass: correct `ReadFileTool` cache identity for metadata-affecting options, and
align `@types/bun` declarations in shared and core with mcp-client. It required
the cache regression to use one tool instance and a stubbed
`SymbolGraphService`, and specified a full `08.search` E2E run as the
order-dependent F33 proof. It also explicitly excluded cache range/format
options from the cache key and asked not to change TTL/eviction behavior.

## Implemented outcome

Verified source and commit facts show `0455084` implemented both planned fixes.
`readFileWithCache` now serializes `filePath`, `includeSymbols`,
`includeImports`, `projectId`, and `relativePath`; the focused unit test uses a
single `ReadFileTool` with a `SymbolGraphService` stub and asserts that a second
read with `includeSymbols:false` has no symbols metadata. The same commit sets
core's `@types/bun` to `^1.3.9` and adds shared's `@types/bun` at `^1.3.9`; the
current mcp-client declaration is also `^1.3.9`.

Subsequent commit `70504b2` deliberately diverged from the plan's no-eviction
scope guard by capping both read-file maps with a 512-entry LRU and adding
cache-hit metadata writeback. This is follow-up hardening, not part of the
source plan's two fixes.

## Commit evidence (hash/subject grouped)

### Direct plan implementation

- `0455084fd9c5f5e1c93c566cd50023325116d701` — `feat(llm): per-task model routing (qwen2.5 swap) + read_file cache/abs-path fixes`
  - Patch changes `packages/core/src/tools/read_file.ts`,
    `packages/core/src/__tests__/read-file.test.ts`,
    `packages/core/package.json`, and `packages/shared/package.json`.
  - Its patch contains the planned five-field JSON cache key and the
    same-instance, injected-symbol-service regression test.
  - Its patch changes core `@types/bun` from `^1.3.8` to `^1.3.9` and adds
    shared `@types/bun` `^1.3.9`.
  - Commit message and `COVERAGE.md` claim a full rebuild/restart, `08.search`
    `36/0/0` with F33 green, and focused verification. Those are historical
    commit/document claims, not tests rerun for this record.

### Follow-up hardening and related cleanup

- `70504b24932cb2edb1e019cc0a37fe3da439404e` — `fix: cap read_file caches (LRU 512) + write back metadata`
  - Adds 512-entry LRU behavior to `fileCache` and `projectRootCache`, plus
    tests for LRU promotion/eviction and legacy-entry metadata writeback.
- `091dbea28cb9e74d805a103e3d525d5702dcba1b` — `fix(deps): align mcp-client @types/node + shared dotenv`
  - Resolves two dependency skews that the source plan listed as later
    side-findings: mcp-client `@types/node` and shared `dotenv`.

## Preserved acceptance facts

- Cache identity includes exactly the five metadata-affecting fields named by
  the plan; range, compression, target-ratio, and format controls remain
  post-cache behavior.
- The regression exercises one tool instance, same file, and distinct
  `includeSymbols` values, with a stub that makes the symbols assertion
  load-bearing.
- Current `packages/shared`, `packages/core`, and `apps/mcp-client` manifests
  all declare `@types/bun` `^1.3.9`.
- Repository historical documentation records Bun lock resolution at
  `@types/bun@1.3.14`; this record did not run `bun install` to independently
  re-confirm it.

## Deviations/unresolved gaps

- This documentation task did not rebuild packages, restart `:3333`, run Bun
  tests, inspect live PostgreSQL, or rerun E2E. Verification outcomes above are
  attributed only to commit and coverage-document claims.
- `70504b2` expanded cache behavior beyond the plan's explicit no-eviction
  guard. Its patch supplies focused tests, but this record does not independently
  validate runtime effects.
- The source plan requested a new final verification agent and a consolidated
  side-findings table. No separate commit uniquely evidences that agent/report;
  later commits address the documented unbounded-cache, `@types/node`, and
  `dotenv` follow-ups.

## Existing spec crossrefs

- [Repository maintenance spec](../../repository-maintenance-2026-07-12/spec.md)
  covers repository maintenance acceptance and its validation artifact records
  cache-key verification practices.
- [Repository maintenance validation](../../repository-maintenance-2026-07-12/validation.md)
  records cache-key collision sensors as part of maintenance evidence.
- [Maintenance future-agent memory](../../repository-maintenance-2026-07-12/future-agent-memory.md)
  states that cache keys are behavioral contracts and must include every option
  that changes raw results.
- [Previous side-findings execution](read-packages-core-src-tests-e2e-coverag-bubbly-riddle.md)
  identifies `0455084` as the later read-file follow-up and distinguishes its
  broader LLM changes from earlier plan execution.

## Verification evidence

- Read source plan, focused commit metadata/patches, current manifest and
  read-file source, and the referenced existing spec artifacts.
- `test -s` confirms this plan-execution artifact is non-empty.
- `git diff --check` is clean after this documentation-only write.

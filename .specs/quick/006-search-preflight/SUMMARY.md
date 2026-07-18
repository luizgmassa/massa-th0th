# M10 — Search Admission Preflight (SUMMARY)

## What shipped

Two-tier admission gate on the shared `SearchController.searchProject` path,
inherited by both `search_project` and `search_code`.

- `ContextualSearchRLM.checkSearchAdmission(projectId, projectPath?)`
  (`packages/core/src/services/search/contextual-search-rlm.ts`):
  - **Tier 1 — HARD-FAIL**: pure metadata existence via
    `IndexManager.getIndexMetadata(projectId)` (promoted from private to
    public). Null metadata → `{admitted:false, error}`. No projectPath, no
    filesystem scan.
  - **Tier 2 — WARN**: when `projectPath` is supplied, delegates to the
    existing `isIndexStale`. Stale → `{admitted:true, stale:{...}}`. Admission
    still succeeds; search runs.
  - No `projectPath` → stale check skipped gracefully.
- `SearchController.searchProject` calls the gate BEFORE auto-reindex and
  BEFORE `contextualSearch.search()`. `!admitted` throws (the tool's existing
  catch wraps it into `{success:false, error}`). `admitted && stale` attaches
  `warning` + `stale` to the returned `ProjectSearchResult`.
- `ProjectSearchResult` gains optional `warning?: string` and
  `stale?: {reason, modifiedFiles?, newFiles?, deletedFiles?}`.

## SPEC_DEVIATION / deliberate behavior change

**Unindexed projects previously returned `{success:true, results:[]}` — a
plausible-but-misleading empty hit. They now return
`{success:false, error:"Project '<id>' is not indexed. Run index_project
first, then retry."}` and `search()` is never called.**

This is the intended fail-fast behavior approved for the safe default. The
soft recommendation ("Check if project is indexed: list_projects()") and the
`autoReindex` opt-in path are preserved and coexist with the new default gate.

### Client impact note

Any client that today relies on `results:[]` as a signal for "unindexed"
(rather than "genuinely no matches") will see a new `success:false` envelope
instead. Genuine zero-hit retrieval on an indexed project is unchanged — it
still returns `{success:true, results:[]}`. Clients should branch on
`success:false` (error path) vs `success:true` (search ran, possibly empty).

## Gate evidence

- `bun test packages/core/src/__tests__/search-admission-preflight.test.ts`
  → 5 pass / 0 fail (22 expects). Covers all four tiers + search_code parity.
- Existing non-PG search suite:
  `search-dependency-outage`, `search-filter-overfetch`,
  `search-ranking-regression`, `search-session-hook`,
  `search-synapse-integration` → 30 pass / 0 fail (no regression).
- `bunx tsc --noEmit` (core) → clean.
- Env-blocked (not faked): `keyword-search-pg.test.ts`
  (`RUN_POSTGRES_TESTS=1` + PG `DATABASE_URL`), `e2e/08.search.test.ts`
  (live stack + Ollama).

## Residual risk

- Clients relying on empty-result-on-unindexed semantics (see client impact
  note) need to handle the new `success:false` envelope.
- Tier 2 staleness only fires when the caller supplies `projectPath`.
  `search_code` never passes one, so it gets Tier 1 protection but cannot
  surface staleness warnings — by design (graceful skip).
- `isIndexStale` returns `check_failed` (isStale:true) on internal errors; in
  that case a present-but-unverifiable index is reported as stale (warning),
  which is the safe side.

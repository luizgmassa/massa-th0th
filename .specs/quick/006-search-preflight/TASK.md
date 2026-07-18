# M10 — Search Admission Preflight

Intent: make `search_project` / `search_code` fail-fast when a project is
UNINDEXED instead of returning plausible empty results, and warn (not fail)
when the project is indexed but stale. Two-tier gate on the shared controller
path, so both tool entry points inherit it.

## Acceptance

- New `ContextualSearchRLM.checkSearchAdmission(projectId, projectPath?)`
  returning `{admitted, error?, stale?}`:
  - Tier 1 (HARD-FAIL): cheap metadata existence check via
    `IndexManager.getIndexMetadata(projectId)` (now public). When metadata is
    null → `{admitted:false, error:"Project '<id>' is not indexed. Run
    index_project first, then retry."}`. No projectPath needed.
  - Tier 2 (WARN): only when `projectPath` is supplied, run `isIndexStale`. If
    stale for any reason (files_changed / path_mismatch / age_threshold) →
    `{admitted:true, stale:{reason, modifiedFiles?, newFiles?, deletedFiles?}}`.
    Admission still succeeds.
  - No `projectPath` → stale check skipped (graceful), `{admitted:true}`.
- `SearchController.searchProject` calls `checkSearchAdmission` BEFORE the
  auto-reindex branch and BEFORE `contextualSearch.search()`:
  - `!admitted` → throws (tool envelope wraps as `{success:false, error}`).
  - `admitted && stale` → search proceeds, `warning` + `stale` attached to the
    returned `ProjectSearchResult`.
  - fresh → behavior unchanged.
- `ProjectSearchResult` gains optional `warning?: string` and
  `stale?: {reason, modifiedFiles?, newFiles?, deletedFiles?}`.

## Tests (DB-free; mock indexManager + contextualSearch seams)

`search-admission-preflight.test.ts`:
- unindexed (metadata null) → `{success:false, error matches /not indexed/}`,
  `contextualSearch.search` NOT called.
- `search_code` path also hard-fails on unindexed (parity).
- indexed + fresh + projectPath → search called, result unchanged, no warning.
- indexed + stale + projectPath → search STILL called, result carries
  `warning` + `stale`.
- indexed + no projectPath → search proceeds, no stale check, no warning.

## Gate

- `bun test search-admission-preflight.test.ts` green.
- Existing non-PG search tests stay green: `search-dependency-outage`,
  `search-filter-overfetch`, `search-ranking-regression`,
  `search-session-hook`, `search-synapse-integration`.
- `bunx tsc --noEmit` clean (core).
- PG / live-stack tests (`keyword-search-pg`, `e2e/08.search`) env-blocked,
  not faked.

## Constraints

- Gate covers BOTH `search_project` and `search_code` (shared controller).
- Behavior-preserving for indexed-and-fresh searches — no perf regression
  (existence check is cheap; stale check only runs when projectPath given and
  reuses the existing autoReindex logic).
- Do NOT remove the soft "Check if project is indexed" recommendation or the
  `autoReindex` opt-in path — they coexist with the new default-path gate.
- Do NOT fail on stale — warn only.

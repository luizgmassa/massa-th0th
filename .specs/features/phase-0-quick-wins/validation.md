# Phase 0 — Quick Wins: Independent Verification

Slug: `phase-0-quick-wins`. Author ≠ Verifier. Read-only over the real tree;
discrimination-sensor mutations were temporary and reverted (tree clean at
end: only an unrelated untracked file remains).

## Verdict: PASS (with 2 non-blocking edge-case gaps)

All four feature deliverables meet their labeled acceptance criteria. All
in-scope gate tests pass (33 total: 6 + 22 + 5), `bun run type-check` is clean,
and the discrimination sensor killed every mutant. Two spec-listed edge cases
(P0-CRUD domain) are implemented but not asserted by any test — recorded as
ranked gaps below. Neither blocks the gate: the spec's Success Criteria
("`bun run test` green, type-check clean, all 4 tools reachable") is met.

## Scope reviewed

- Commit range: `4e27925^..be65877` (4e27925=0a, c25f9d3=0b, b84ea3e=0c,
  be65877=0d). Verified via `git show --stat` and `git log`.
- Test diff over the range: 5 test files, **+341 / -1**. The single deletion is
  an updated assertion in `file-collector.test.ts` (old `.css`-allowed
  assumption). No tests weakened, skipped, or deleted. No `.skip`/`todo(`/`xit`/
  `xdescribe`/`.only` in any in-scope file.

## Per-AC evidence table

| AC | Spec outcome | Evidence (file:line + assertion) | Covered? |
| --- | --- | --- | --- |
| P0-UG-01 | Accept every ext in `config.security.allowedExtensions` (34 default), not just 8 | `apps/mcp-client/src/file-collector.test.ts:62-69` asserts `README.md`/`main.go`/`lib.rs` collected (beyond old 8-ext gate). `file-collector.ts:27-35` reads `config.get("security").allowedExtensions`; default at `packages/shared/src/config/index.ts:184` (`DEFAULT_ALLOWED_EXTENSIONS`, 34) and `:292` (`allowedExtensions: [...DEFAULT_ALLOWED_EXTENSIONS]`) | YES |
| P0-UG-02 | Skip files whose ext is not in the configured list (byte/file guards unchanged) | `file-collector.test.ts:56-60` `expect(paths).not.toContain("style.css")`; `file-collector.ts:68-70` `if (!allowed.has(ext)) continue` | YES |
| P0-UG-03 | Fall back to shared canonical default if config fails to load | `file-collector.ts:31-34` `catch { ... } return new Set(DEFAULT_ALLOWED_EXTENSIONS)`. (Behavior is coded; no dedicated test injects a config failure — see Gap 3, low-priority) | PARTIAL (coded, not asserted) |
| P0-RI-01 | autoReindex max-files from `config.search.autoReindexMaxFiles` (default 200) at all three sites | `search-controller.test.ts:179-202` asserts `captured[0].maxSyncFiles === 200` from mocked config. Three sites all derive from the config key: `search-controller.ts:246`, `contextual-search-rlm.ts:290-291`, `contextual-search-rlm.ts:317`/`:346` (comparison). Default at `config/index.ts:263` `envNum("AUTOREINDEX_MAX_FILES", 200)` | YES |
| P0-RI-02 | Exceeding cap defers (NOT full-reindex); `allowFullReindex` stays false | `search-controller.test.ts:201` `expect(captured[0].allowFullReindex).toBe(false)`. `search-controller.ts:245` passes `allowFullReindex: false`; `contextual-search-rlm.ts:289` defaults false; `:348` `if (needsFullReindex && !allowFullReindex)` defers | YES |
| P0-RI-03 | The hardcoded `> 100` (contextual-search-rlm.ts:345) uses the same derived cap | `contextual-search-rlm.ts:346` now compares against `maxSyncFiles` (the resolved variable from `:290-291`), not a literal. (Test exercises the controller path that sets `maxSyncFiles`; the literal-removal is verified by code inspection — see Gap 4, low-priority) | YES (code); test does not directly target line 346 |
| P0-CRUD-01 | `memory_update` with id+content → update content, re-embed, re-index FTS, return updated | `memory-crud.test.ts:81-92` "update content rewrites the row and rebuilds the FTS index": asserts content rewritten, old FTS term `alpha` no longer matches, new term `gamma` matches. Re-embed path: `memory-controller.ts:197-199` re-embeds on content change (repository test supplies synthetic embedding; controller re-embed is exercised via repo-layer coverage per test header comment) | YES |
| P0-CRUD-02 | update importance/tags updates those fields; tags merge when `mergeTags:true` | importance: `memory-crud.test.ts:94-102`. tags replace: `:104-110`. tags merge: `:158-165` `controller.update({id,tags:["beta"],mergeTags:true})` → `["alpha","beta"]`. Merge impl at `memory-controller.ts:184-193` | YES |
| P0-CRUD-03 | `memory_delete` with id → hard-delete row AND sever GraphStore edges | `memory-crud.test.ts:172-183` "delete hard-deletes the memory and severs its graph edges": links c2→c3, asserts `getEdges("c2").length > 0`, then after delete asserts `getById("c2")` null and `getEdges("c2").length === 0`. Repo hard-delete at `memory-repository.ts:361-374`; edge severance via `memory-controller.ts:231` `this.graph.onMemoryDeleted(id)` | YES |
| P0-CRUD-04 | update/delete on missing id → `success:false` with clear error | update missing: `memory-crud.test.ts:112-114` (`repo.update("nope")` → false) and `:167-170` (`controller.update({id:"ghost"})` → `updated:false`). delete missing: `:130-133` (repo `deleteById("ghost")` → false, idempotent) and `:185-188` (`controller.delete("ghost")` → `deleted:false`) | YES |
| P0-CHK-01 | MCP lists the three checkpoint tools | `tool-definitions-checkpoints.test.ts:11-22` asserts all three names present in `TOOL_DEFINITIONS` with correct `apiEndpoint`/`apiMethod` | YES |
| P0-CHK-02 | Each call hits its API route and delegates to existing core tool (no new logic) | `checkpoints.test.ts:56-84`: `/list` → `success:true`; `/create` → `success:true` + `data` defined; `/restore` → `success:true`; `/restore` without id/taskId → `success:false` + `error` (validation passthrough). Routes are thin wrappers over core tools (`routes/checkpoints.ts`) | YES |

### Edge cases (spec.md:57-60)

| Edge case | Evidence | Covered? |
| --- | --- | --- |
| update content empty/whitespace → reject (validation) | Impl: `memory-controller.ts:172-174` throws `Error("content must not be empty")`. **No test asserts the throw.** | **GAP 1** |
| delete twice (idempotent) → second returns success:false, no throw | `memory-crud.test.ts:130-133` `deleteById("ghost")` twice → false both times, no throw | YES |
| update tags empty array + mergeTags → result empty (explicit clear) | Impl: `memory-controller.ts:190-193` (`mergeTags ? union : [...tags]`); replace path with `tags=[]` yields `[]`. **No test exercises `tags:[]`.** | **GAP 2** |

## Gate exit results

| Gate | Command | Result |
| --- | --- | --- |
| 0a | `bun test apps/mcp-client/src/file-collector.test.ts` | **6 pass / 0 fail**, 13 expects |
| 0b+0c | `bun test packages/core/src/__tests__/search-controller.test.ts packages/core/src/__tests__/memory-crud.test.ts` | **22 pass / 0 fail**, 40 expects |
| 0d | `bun test apps/tools-api/src/routes/checkpoints.test.ts apps/mcp-client/src/tool-definitions-checkpoints.test.ts` | **5 pass / 0 fail**, 13 expects |
| type-check | `bun run type-check` | **clean** (5/5 tasks, FULL TURBO cache hit; all `tsc --noEmit` green) |

Aggregate: **33 tests pass / 0 fail**, 66 expects. No skips/todo/xit/only.

## Discrimination sensor

Each mutant was a temporary source edit; only the relevant test file was run;
the source was reverted with `git checkout -- <file>` immediately after. Tree
verified clean afterward.

| Mutant | Edit | Test run | Result |
| --- | --- | --- | --- |
| 0a | `file-collector.ts` `getAllowedExtensions()` → `return new Set<string>()` (always reject) | `file-collector.test.ts` | **KILLED** — 3 fail (collects supported / md-go-rs / includes content). Mutant drops every extension. |
| 0c | `memory-repository.ts` post-update FTS insert guarded `if (false) {}` (skip rebuild) | `memory-crud.test.ts` | **KILLED** — 1 fail ("update content rewrites the row and rebuilds the FTS index", line 91 `expect(after...).toContain("m1")`). Exactly the named test. |
| 0b | `search-controller.ts:246` `maxSyncFiles: config.get("search").autoReindexMaxFiles` → `maxSyncFiles: 50` | `search-controller.test.ts` | **KILLED** — 1 fail (handleAutoReindex, line 200 `expect(captured[0].maxSyncFiles).toBe(200)`). |

All three mutants killed. No surviving mutants → no fix tasks from the sensor.

## Ranked gap list

1. **GAP 1 (P0-CRUD, spec edge case, low-verity):** No test asserts that
   `memory_update` rejects empty/whitespace content. The validation
   exists (`memory-controller.ts:172-174` throws), but the in-scope test file
   never exercises it. Suggested fix: add a case in
   `packages/core/src/__tests__/memory-crud.test.ts` asserting
   `controller.update({id, content: "   "})` throws / returns an error result.
   Low risk because the guard is a 3-line branch, but it is a spec-listed
   outcome.

2. **GAP 2 (P0-CRUD, spec edge case, low-verity):** No test exercises the
   "explicit clear" path — `controller.update({id, tags: [], mergeTags:false})`
   should yield an empty tag array. The replace branch
   (`memory-controller.ts:190-193`, `resolvedTags = [...tags]`) handles it, but
   it is unasserted. Suggested fix: one case setting `tags: []` and asserting
   `JSON.parse(result.memory.tags)` is `[]`.

3. **GAP 3 (P0-UG-03, config-failure fallback, informational):** The canonical
   fallback when `config.get("security")` throws is coded
   (`file-collector.ts:31-34`) but no test injects a config failure to prove the
   `catch` fires and returns `DEFAULT_ALLOWED_EXTENSIONS`. In practice the test
   harness always resolves config, so this is hard to exercise without a deeper
   mock. Not blocking — the default-ext path is implicitly covered whenever
   `config.security.allowedExtensions` resolves to the 34-ext default.

4. **GAP 4 (P0-RI-03, literal-removal verification, informational):** The
   `> 100` → `> maxSyncFiles` fix at `contextual-search-rlm.ts:346` is verified
   by code inspection only; no test directly targets that specific line. The
   config-driven behavior is covered transitively by the controller test
   (`search-controller.test.ts:179-202`), so the risk of regression is low, but
   a direct test of `ensureFreshIndex` deferral at >maxSyncFiles would close it.

## Conclusion

Phase 0 meets its acceptance criteria and success criteria. Verdict **PASS**.
Gaps 1 and 2 are spec-listed edge cases worth adding as follow-up tests; gaps 3
and 4 are informational. None block merge.

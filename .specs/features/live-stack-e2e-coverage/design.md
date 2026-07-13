# Live-Stack E2E Coverage — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/create-a-plan-to-silly-cookie.md` — live-stack E2E plan for MCP stdio and HTTP-direct parity, initially covering 35 MCP tools.

## Intent and scope

Plan claimed a real-stack, throwaway-project E2E suite: shared MCP/HTTP helpers, matrix comparisons, indexing through cleanup, feature domains, NFR and destructive-stack separation, needles benchmark, CLI/API smoke checks, and a final coverage audit. It explicitly deferred implementation from the planning round.

## Implemented outcome

Verified commit history shows an implemented Bun E2E suite under `packages/core/src/__tests__/e2e/`, with shared MCP/HTTP helpers, polyglot fixtures, coverage record, domain suites, NFR/destructive suites, cleanup verification, and a `test:e2e` package script. Subsequent commits fixed defects surfaced by that suite, expanded coverage to newly added capabilities, and changed the roster assertion from 35 to 42 tools.

This is commit-backed implementation evidence; it does not by itself prove every planned scenario was executed against a live stack at the final range endpoint.

## Commit evidence

### Original harness and planned domains

- `517cc331cef05a53af2e03e0239712c2975a14b5` — `test(e2e): add live-stack E2E suite covering all 35 MCP tools`
  - Added harness, MCP client helper, polyglot fixture, suites `00`, `02`, `05`–`17`, coverage document, and `test:e2e` script.
  - Commit message claims HTTP/MCP matrix assertions, HTTP-only and CLI coverage, needles benchmark, prefix-isolatable NFR, and dedicated destructive-suite gating.
- `af3dab65161eec41c38b352bbbc7d82ee5dd6839` — `test(search): promote needle benchmark to standalone harness + CI gate + tune...`
  - Added standalone needles benchmark and CI gate assets.

### Coverage-audit fixes and operational hardening

- `b953ae720cb2e6c5710c08ca80b8ef7f536ca05c` — `fix(e2e): resolve 11 OPEN bugs from T14 coverage audit`
  - Fixed MCP POST path substitution, Synapse/schema mismatches, indexing terminal-state handling, CLI/config behavior, and PG symbol-reference handling; updated E2E suites and coverage record.
- `3dd9fbca10fb0a4cf805176652c845458a16a467` — `docs(e2e): apply migration #14 to shared DB; all 11 fixes now live`
  - Records application of the nullable `target_fqn` migration to the shared DB; this is historical commit testimony, not a current-environment check.
- `1367007549e9b9ece28f69d44e0dd061ad04fde4` — `fix(e2e): resolve all COVERAGE residuals (#12/#15-18/N7/OOM/.env) + PG job-store parity`
  - Updated E2E coverage and fixed timeout, reindex/search, schema, result-limit, needles, and PG job-store issues.
- `6b5852f8c572ca3f459199fc3b60ce568a91e121` — `fix(core): resolve 5 OPEN COVERAGE side-findings (A–E) + verify green`
  - Extended E2E checks and fixed LLM response, read-file format, guard, and job-store issues.
- `0455084fd9c5f5e1c93c566cd50023325116d701` — `feat(llm): per-task model routing (qwen2.5 swap) + read_file cache/abs-path fixes`
  - Updated E2E coverage and related read-file/index-job behavior.
- `614bf91e5c72cf25c76f465846768bc7351c18f1` — `docs: add operational knobs + e2e/observation notes`
  - Added documented dedicated-stack knobs and an E2E helper caveat.

### Scope growth after original plan

- `c1d68de5316776e3dbdd8e38b29a1b9c690dec47` — `test(e2e): SF3 42-tool roster + D4/lifecycle asserts`
  - Changed harness roster assertion to 42 and strengthened graph/lifecycle coverage.
- `bb1860a7d5500334881a5ffebf68d14671ea750e` — `test(e2e): add Phase-4 graph suite (D1-D4)`
  - Added `18.graph-phase4.test.ts` for typed edges, traversal, impact analysis, and architecture map paths.
- `baa31ccb31681628b15544ea3ba5bab2651d8ed8` — `test(e2e): add new-feature suites (post-1367007)`
  - Added `19.web-exec.test.ts` and `20.new-features.test.ts` for web/executor and later feature coverage.
- `81d33606fb6826e1759a073006b165419d0e3ba4` — `fix(embeddings): abort Ollama fetch on timeout`
  - Fixed a live-index hang exposed by an E2E V2 run, according to its commit message.

## Spec/acceptance facts

- Plan required real API, MCP stdio, Ollama, and PostgreSQL; mutations were confined to `e2e-th0th-*` project IDs with cleanup.
- Plan required availability-gated skips with stated reasons and a dedicated-stack gate for globally disruptive scenarios.
- Plan specified 35 tools. Later commit evidence establishes a 42-tool test roster; coverage scope therefore evolved.
- Commit `517cc331` added source artifacts matching the planned harness, domain suites, benchmark, destructive gate, and cleanup evidence surface.

## Deviations or unresolved gaps

- Original source plan described future implementation and 35 tools; range ended with broader 42-tool coverage plus extra feature suites.
- Commit messages report live verification and benchmark numbers, but no final-range command output was inspected here. Do not infer a complete final suite run.
- Dedicated/destructive scenarios remain conditional by design; this review did not establish their execution.
- E2E findings triggered production fixes and migrations, expanding beyond plan-only test scaffolding.

## Existing spec crossrefs

- [Phase 1 memory foundation](../../phase-1-memory-foundation/spec.md)
- [Phase 2 query understanding](../../phase-2-query-understanding/spec.md)
- [Phase 3 hook capture](../../phase-3-hook-capture/spec.md)
- [Phase 4 bootstrap](../../phase-4-bootstrap/spec.md)
- [Phase 6 handoffs](../../phase-6-handoffs/spec.md)
- [Phase 7 retrieval polish](../../phase-7-retrieval-polish/spec.md)

## Verification evidence

- Read source plan, its task breakdown, matrix contract, risks, and verification criteria.
- Inspected in-range commit subjects, bodies, and changed-file statistics, including the E2E path history and later related feature/benchmark commits.
- Confirmed final tree contains the plan-relevant E2E artifacts by commit diff evidence; no live-stack command was run for this documentation task.

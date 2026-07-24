# LESSONS - auto-maintained by skills/massa-ai/scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features | window_days=45 | quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - UNION GUARD missing-suite path has no discriminating test. No test injects a suite into SUITE_TABLE but not into results. Add a mock-drop test asserting exit 1 + UNION GUARD FAIL.
- signal: `surviving_mutant` | recurrence: 1 feature(s) | scope: `test-strength` | harmful: 0 | confidence: 0.62
- features: wave-6-architecture-features
- evidence: scripts/run-tests-parallel.ts:243-257 + scripts/__tests__/run-tests-parallel.test.ts:69-74 (test-strength)
- last seen: 2026-07-22T21:39:38Z

### L-002 - Hook binary tests assert exit 0 only, never POST body/endpoint/count. Removing second pre-compact POST survived. Add capture-server test verifying 2 POSTs to correct endpoints + body shapes.
- signal: `surviving_mutant` | recurrence: 1 feature(s) | scope: `test-strength` | harmful: 0 | confidence: 0.62
- features: wave-6-architecture-features
- evidence: apps/claude-plugin/hooks/massa-ai-hook.ts:219-227 + apps/claude-plugin/hooks/__tests__/massa-ai-hook.test.ts (test-strength)
- last seen: 2026-07-22T21:39:38Z

### L-003 - M25 name-tail resolution has 0 behavior tests. Test only checks method exists. Add tests mocking listWorkspaces asserting unique/ambiguous/not-found paths.
- signal: `ac_gap` | recurrence: 1 feature(s) | scope: `test-coverage` | harmful: 0 | confidence: 0.62
- features: wave-6-architecture-features
- evidence: packages/core/src/__tests__/m25-m26-resolution-serialize.test.ts:101-107 (test-coverage)
- last seen: 2026-07-22T21:39:38Z

### L-004 - N20 crash test assumes architecture-map fails with DATABASE_URL empty but it passes via SQLite fallback. Test gets exit 0, expects non-zero. Rewrite to use genuinely-failing suite or wire unused crashTest variable.
- signal: `gate_fail` | recurrence: 1 feature(s) | scope: `test-design` | harmful: 0 | confidence: 0.62
- features: wave-6-architecture-features
- evidence: scripts/__tests__/run-tests-parallel.test.ts:113 (test-design)
- last seen: 2026-07-22T21:39:38Z

### L-005 - When a unit test bypasses a version-gate threshold via a testing seam (_setJsonSchemaSupportedForTesting), the threshold logic (_checkJsonSchemaSupport minor >= 5) is uncovered. Add direct tests of the version parser with mocked version strings (0.5.0, 0.4.9, 1.0.0, garbage) so threshold regressions are caught.
- signal: `surviving_mutant` | recurrence: 1 feature(s) | scope: `packages/core` | harmful: 0 | confidence: 0.62
- features: wave-7-hygiene-ui-process
- evidence: packages/core/src/__tests__/llm-client-json-schema.test.ts:62-69 (packages/core)
- last seen: 2026-07-22T23:54:13Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_

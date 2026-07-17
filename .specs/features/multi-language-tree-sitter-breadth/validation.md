# Multi-Language Tree-sitter Breadth — Independent Validation

**Role:** Final independent verifier (TLC v3 Validate phase). Author ≠ verifier.
**Date:** 2026-07-17
**Repo:** `/Users/luizmassa/Personal Projects/massa-th0th` (branch `main`)
**Baseline:** `5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03`
**Diff range:** `5d43a96..aa7464b` (30 commits; feature commits `e56b73d`→`aa7464b`, including the native re-baseline `202bebf` and perf optimization `490f302`)
**Runtime:** Bun `1.3.11`, Node `25.9.0` (npm `11.14.1`), macOS arm64 only.

## Overall VERDICT: PARTIAL

All twelve acceptance criteria are met **except AC-008 (MLTS-014)**, which is **NOT-MET / blocked-on-perf**. The TS/JS characterization/parity portion of AC-008 is satisfied (T7/T9); only the MLTS-014/MLTS-022 throughput/RSS regression thresholds remain unmet (TASK-025). The single residual risk is the performance block; no correctness, packaging, generation-safety, transport-parity, or docs gap was found.

## Per-Acceptance-Criterion Table

| AC | Requirement | Verdict | One-line evidence (independently confirmed) |
| --- | --- | --- | --- |
| AC-001 | MLTS-001,019 — manifest exhaustiveness + unknown semantic-only | PASS | `language-manifest.test.ts` asserts `expectedCount:33, actualCount:33, exhaustive:true` and ordered equality with `DEFAULT_ALLOWED_EXTENSIONS`; `.toml` resolves `unsupported_structural_language`. Sensor (a) kills a 34th entry. |
| AC-002 | MLTS-002,003,020,021 — arm64 load/parse, liveness split | PASS | `verify:tree-sitter-source-dist` PASS: 33+33 parses, 27+27 modules, patchSha256 `e79aec7b…`, Mach-O arm64, RSS 925696 B patched delta (<16 MiB), missing+incompatible sensors true; `/health` stays live while parser readiness fails (T4/T23/T24 tests). |
| AC-003 | MLTS-004 — bounded pool, cursor-before-tree, 16 MiB stress | PASS | `structural-runtime.test.ts` (T5) covers FIFO/capacity/timeout/cleanup; disposal stress PASS (median delta 81920 B << 16777216 bound) measured again in this validation. |
| AC-004 | MLTS-005,006,007 — kinds/FQNs/spans goldens | PASS | `structural-identity.test.ts` nested/overload/Unicode/BOM/CRLF goldens + frozen canonical hash `b738f0516b…`. Sensor (b) kills a separator mutation across 4 goldens. |
| AC-005 | MLTS-008,009,015 — capability tiers, edge rules, all languages | PASS | 122 structural tests pass (query-pack/resolver/identity/etl/manifest); T15-T19 cohort fixtures cover required/forbidden/unsupported + unresolved payloads for all 33 extensions. |
| AC-006 | MLTS-010,011,012,013 — generation build-beside/CAS/activation | PASS | `graph-generation-{migration,lifecycle-pg,symbol-repository-pg,etl-lifecycle}.test.ts` (owned PostgreSQL) cover backfill, lease/CAS, completeness, atomic activation, active/pending isolation. |
| AC-007 | MLTS-012,017,018 — recoverable vs hard failure, stale retention | PASS | Recovered syntax retains structure + diagnostics; hard failure blocks activation; incremental hard failure retains last-known-good + stale diagnostics (T13/T14/T21 tests). |
| AC-008 | MLTS-014 — TS/JS parity **AND** throughput ≤25% / RSS ≤50% | **NOT-MET** | TS/JS characterization + `smartChunk` parity PASS (T7/T9, 105/105 ETL tests). **MLTS-014 perf thresholds FAIL:** throughput regression 84.33% (>25%), RSS regression 220.7% (>50%). Disposal stress + corpus checksum PASS. TASK-025 blocked-on-perf. |
| AC-009 | MLTS-016 — Vue/Markdown embedded, two-level, fallback, dedupe | PASS | `structural-data-document.test.ts` (16 pass) covers declared/unknown/malformed/repeated/nested fences, Unicode/CRLF/BOM, host remap, scope FQNs, recursion limit. |
| AC-010 | MLTS-006,018,023 — modern/legacy FQN + ambiguity transport parity | PASS | `structural-transport.test.ts` asserts PostgreSQL/HTTP/MCP return identical modern/legacy/ambiguous payloads; additive kinds + diagnostics summaries (T20/T21). |
| AC-011 | MLTS-017,018 — >10 details bounded, aggregate counts retained | PASS | `diagnostics.ts` `MAX_STRUCTURAL_DIAGNOSTIC_DETAILS=10` + `slice(0,10)`; PG test asserts `parser_error_count:14, detail_count:10` (aggregate survives, details bounded). |
| AC-012 | MLTS-021,022 — final gates pass exact thresholds, no unexplained skips | PARTIAL | All gates pass **except** the frozen benchmark threshold (MLTS-022). Type-check 6/6, build 5/5, native smoke PASS, workflow static tests PASS, docs parity 13/13. The benchmark FAIL is the same root cause as AC-008 and is not an unexplained skip. |

## Discrimination Sensors (author-independent)

Three behavior-level faults were injected into throwaway copies, confirmed killed by the suite, then discarded. `git status` clean after each.

| Sensor | Fault injected | Test guard | Result |
| --- | --- | --- | --- |
| (a) Manifest exhaustiveness | Added a 34th `entry(".toml", …)` to `LANGUAGE_MANIFEST` in `language-manifest.ts` | `language-manifest.test.ts` → `assertLanguageManifestExhaustive()` | **KILLED:** `0 pass, 1 fail, 1 error` — `actualCount:34, extra:[".toml"], exhaustive:false`. Mutant discarded. |
| (b) FQN golden separator | Changed nested-FQN separator `~` → `-` in `fqn-codec.ts:171` | `structural-identity.test.ts` nested/overload/reserved/canonical goldens | **KILLED:** 4 golden assertions failed, incl. frozen hash `b738f0516b…` (received `Outer.method-method-…`). Mutant discarded. |
| (c) Docs parity forbidden phrase | Injected "zero symbols" into README structural-indexing prose | `polyglot-indexing-docs.test.ts` forbidden-phrase scan | **KILLED:** `12 pass, 1 fail` — offender `/zero[\s-]*symbols?/i` matched. Mutant discarded. |

Note on sensor scope: an initial attempt to mutate `DEFAULT_ALLOWED_EXTENSIONS` in `packages/shared/src/config/index.ts` did **not** fail the manifest test, because the test imports `@massa-th0th/shared/config` which resolves to the built `shared/dist` artifact, not the edited source. This is a real observation (the manifest test couples to the built shared dist, not live source), but it does not weaken AC-001: the manifest-side mutation (sensor a) is killed deterministically, and the manifest's own `assertLanguageManifestExhaustive()` runs at module load against whatever `DEFAULT_ALLOWED_EXTENSIONS` the resolved artifact provides. Recorded for transparency; no test weakening was performed.

## Gate Results (run this validation, read-only)

| Gate | Command | Result |
| --- | --- | --- |
| Native source/dist | `bun run verify:tree-sitter-source-dist` | **PASS** — 33+33 parses, 27+27 modules, patchSha256 `e79aec7b96eb8114e85ebcb90f0a8b12076bcd8aa08c09bb88929621e1c1446d`, RSS patchedMedianDelta 925696 B (<16 MiB), missing+incompatible sensors true, 10 behavior sensors, 100 stress cycles. |
| Structural core | `bun test structural-query-pack structural-identity structural-resolver structural-etl language-manifest` | **PASS** — 122 pass / 0 fail / 1133 assertions. |
| Scripts + benchmark harness | `bun test verify-tree-sitter-package-artifact verify-tree-sitter-grammars native-macos-arm64-workflow polyglot-indexing-docs benchmark.test.ts` | **PASS** — 55 pass / 0 fail / 316 assertions. |
| Type-check | `bun run type-check` | **PASS** — 6/6 tasks. |
| Build | `bun run build` | **PASS** — 5/5 tasks. |
| AC-009/010 anchored | `bun test structural-data-document structural-transport` | **PASS** — 16 pass / 0 fail. |
| Frozen benchmark | `bun run bench:parser -- --baseline 5d43a96…` | **FAIL (known block)** — `throughputRegressionPct:84.33 (>25)`, `rssRegressionPct:220.7 (>50)`, `throughputPass:false`, `rssPass:false`; `disposalStressPass:true`, `corpusChecksumMatch:true`, `verdict:FAIL`. |

Tree state: `git status` clean after all sensors and gates; no tracked file mutated by this validation.

## Residual Risk

- **AC-008 / MLTS-014 (sole unmet acceptance criterion):** TS/JS throughput and RSS regression thresholds are not met. Candidate throughput ≈ 1.18 MB/s vs the 5.73 MB/s (25% of baseline) target; RSS ≈ 220.7% regression vs the 50% limit. Profiling attributes the residual cost to spec-required per-symbol rich extraction (signatures, spans, FQN materialization) that the regex baseline does not perform. **Unblock:** TASK-025 performance optimization. A prior 2.2× gain is committed (`490f302`); further work is required to reach the thresholds. The 25% throughput threshold may be infeasible for a full-AST indexer vs regex; RSS 50% may be reachable. This is a known, honestly-reported block — not a manufactured PASS.
- No correctness, generation-safety, transport-parity, packaging, CI, or documentation residual risk was identified. All discrimination sensors confirm the suite kills behavior-level faults. The AC-008/AC-012 benchmark FAIL is the only deviation from a full PASS and is confined to the performance contract.

## Artifact Store Evidence

- Active key: `.specs/features/multi-language-tree-sitter-breadth/validation.md`
- Verifier: independent (TLC v3 Validate), distinct from feature author.
- This file is the only artifact created by this validation; no implementation file was edited.

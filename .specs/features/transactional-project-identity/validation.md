# M16 + M17 — Validation

Verdict: **PASS** (independent verifier: see §8)
Diff range: `1e21f9a..HEAD` (T1 `3dc85b5` … T7). Base before feature: `476b93f`.
Environment: macOS arm64, Bun **1.3.11** (repo pin `packageManager: bun@1.3.11`; machine default 1.3.14 fails the exact-version native parser gate — see §6), PostgreSQL 127.0.0.1:5432, owned acceptance DB `massa_ai_identity_t6`.

## 1. Task-by-task evidence

| Task | Commit | Gate evidence |
| --- | --- | --- |
| T1 contracts + migration | `3dc85b5` | `project-identity-migration.test.ts` 3/3 (re-run T7, owned DB deploys cleanly, 19 migrations); contracts/hashing/plan schemas inside identity unit batch 70/70 |
| T2 discovery + planner | `be0e9c5` | planner/discovery unit tests inside 70/70; unknown-store blocking proven in acceptance test 5 |
| T3 transactional apply | `15cf45b` | apply unit tests inside 70/70; rollback failpoints proven in acceptance test 6 |
| T4 writer guard + invalidation + adapter resolution | `c9e361b` | guard-installer/alias-resolver/write-seams/invalidator tests inside 70/70; 2 review rounds (4 P1 + 14 P2 remediated); user decision 2026-07-20: application-layer alias resolution at 11 write seams implemented (replaced explicit queue-drain) |
| T5 REST + MCP transports | `5f6865f` | HTTP `project-identity.test.ts` 5/5; MCP `tool-definitions-identity` + `-synapse` 4/4 (roster 47→49); review fixed P1 preview-acquire→503 mapping + release-on-throw + Elysia `INVALID_REQUEST` envelope |
| T6 PostgreSQL acceptance | `d5ecb6f` | acceptance 9/9 ×3 consecutive on owned DB (recorded); 2 independent review rounds (round 1 FAIL → P1 alias-chain flatten + P2 payload scoping remediated; round 2 PASS, deferred P3s §5) |
| T7 validation (this) | see §7 | full regression (T6 gate 9/9 green inside suite), type-check 6/6, build `--force` 5/5, identity unit 70/70, baseline failure classification §6, independent verifier §8 |

## 2. Requirement → evidence map

| Spec requirement | Evidence |
| --- | --- |
| 1. Live source / unused target / same-root merge / pre-mutation failure | acceptance T4 "different-root, collision, stale-plan, and operation-reuse conflicts fail without mutation"; planner unit tests |
| 2. Durable aliases; chains flattened; retired IDs never re-registered | acceptance T8 "alias chains flatten: rename A→B then merge B→C re-points A→C" (T6 review fix #9); alias-resolver unit tests; `project_identity_aliases` invariants in T1 migration |
| 3. One PostgreSQL guard; ordered exclusive locks; blocked writers resolve post-commit alias | acceptance T2 "two PostgreSQL backends: a guarded writer blocked during apply lands on the target, never stranded"; T4 trigger guard + 11 application write seams (design.md "T4 Implementation Notes") |
| 4. information_schema discovery + explicit adapters; unclassified store blocks apply | acceptance T5 "unknown storage blocks apply without mutation"; T2 registry/adapters |
| 5. One transaction: rewrite, byte-equivalent dedupe, graph history preserved, newest generation active, supersede others, recompute counts, alias, caches, one strict result keyed by operationId | acceptance T1 "rename moves every store …" and T9 "merge moves rows, selects the newest activated generation, and retires the source workspace"; T3 apply unit tests |
| 6. Immutable audit; composite/semantic conflicts abort entire transaction | acceptance T1 (immutable audit preserved, zero mutable source refs) + T4 (conflicts abort, no mutation); `operation_log` never rewritten (guard resolves only NEW rows) |
| 7. Repeated operationId returns stored result; reuse with different material fails | acceptance T3 "lost-response retry returns the one stored result with exactly one operation row" + operation-reuse branch of T4 |
| 8. Post-commit invalidators run for both ids; best-effort event cannot fail committed op | acceptance T7 "post-commit invalidation covers both ids and a throwing invalidator never flips the committed result"; invalidator-registry unit tests |
| 9. Typed sanitized errors; no SQL or stored payloads exposed | contracts unit tests (error codes); HTTP typed-envelope tests (`INVALID_REQUEST` via framework `code`, no INTERNAL_ERROR); sanitized log warnings observed (`[project-identity] … (sanitized)`) |

## 3. Acceptance-criterion → evidence map

| AC | Evidence |
| --- | --- |
| Rename/merge preview/apply parity across Core, HTTP, MCP | service unit tests (70/70 batch); HTTP 5/5; MCP 4/4; shared `createProjectIdentityService` composition |
| Two PostgreSQL processes prove writers cannot strand the source id | acceptance T2 (two-backend writer race) |
| Lost-response retry returns one stored result + exactly one audit entry | acceptance T3 |
| Different-root, collision, stale-plan, unknown-storage, operation-reuse conflicts fail without mutation | acceptance T4 + T5 |
| Injected pre-commit failures preserve byte-equivalent snapshot; post-commit invalidator/event failures do not change committed response | acceptance T6 + T7 |
| Zero mutable source references after apply | acceptance T1 + T9 zero-source-ref assertions (payload fingerprint/rewrite scoped to source∪target rows, T6 fix #10) |
| Both source and target caches invalidated after commit | acceptance T7; invalidator registry report includes both ids |

## 4. T6 production-bug ledger (found by the acceptance gate + reviews; all fixed)

1. `hash.ts` tagged canonical forms for Date/bytea/bigint.
2. `pg-array-codec.ts` for TEXT tags holding `{a,b}` literals.
3. `memories.metadata` registry encoding json→json-text (TEXT column) — root of the preview-passes/apply-CONFLICT failure (planHash covers conflicts; test never inspected `preview.conflicts`).
4. Roots-first direct-store rewrite (non-deferred FKs `documents→projects` RESTRICT, `symbol_*→workspaces`).
5. Merge winner-first supersede→move→reactivate vs non-deferrable `graph_generations_one_active_per_project` partial unique index (23505).
6. Alias-qualified merge dedupe projections (42702 `hit_count`).
7. Canonically sorted fingerprint inputs (order-dependent planHash → spurious PLAN_CHANGED).
8. Sequential planner queries (Bun pg pipelining desync wedged pooled clients — 5s hook timeouts, 08P01).
9. Merge flattens inbound alias chains before retiring source roots (`project_identity_aliases_target_fkey` ON DELETE RESTRICT; rename A→B then merge B→C failed 23503) + chained acceptance test (spec req 2).
10. Payload fingerprint/rewrite scoped to source∪target rows when the table has project_id (liveness + zero-source-ref AC; `scheduled_jobs` keeps global scan by design).

Test-harness fixes (T6): `serviceFor` wrapper transparent passthrough + restore-on-release (callback-drop wedged pool); lock signal after settle; writer release-after-settle; unknown-storage preview-resolves/apply-rejects; `operation_log` seed `success` (CHECK).

T7-found (test-infrastructure only, no production change):
- `apps/tools-api/src/__tests__/project-reset.test.ts`: whole-module mock did not satisfy T5's new runtime imports (`createProjectIdentityService`, `ProjectIdentityError`) — link-time `SyntaxError` under the full suite; mock completed (stubs never invoked by reset routes). Latent since T5; surfaced only by the T7 workspace regression.
- `turbo.json`: `test.passThroughEnv` lacked `IDENTITY_ACCEPTANCE_DATABASE_URL`, so the T6 acceptance suite silently **skipped** under `bun run test` (11 skip/0 pass observed); added so the gate runs inside the workspace suite. Immediately re-run: acceptance 9/9 pass inside the suite.
- `packages/core/src/__tests__/project-identity-planner.test.ts`: new fixture "payload fingerprint ignores unrelated projects in project_id-bearing tables" closing the independent verifier's surviving mutant M4 (§8) — third-project `memories` row (jsonb + text-array payloads) must leave planHash/stores untouched; re-probed against the M4 mutant, killed exactly.

## 5. Deferred P3s (documented, non-blocking, from T6 review round 2)

1. `pg-array-codec` unquoted `NULL`→`""` normalization (pinned behavior; changing it risks silent data drift).
2. `hash.ts` `date:` tag TZ-dependence for TIMESTAMP-without-tz (same-host invariant holds; cross-TZ planHash comparison is out of scope) + plain-string tag collision needing crafted data.
3. Registry dead `project_identity_operations` catalog entry (harmless; table has no `project_id`).
4. `vector_documents`/`symbol_*` unseeded in the acceptance snapshot (covered by unit fakes; direct-store rewrite proven on seeded stores).

## 6. Pre-existing failure classification (full-regression survivors)

Full workspace regression at HEAD under pinned Bun 1.3.11 (`IDENTITY_ACCEPTANCE_DATABASE_URL` set): **1432 pass**, T6 acceptance 9/9 inside the suite, every failure below reproduced at clean baseline `1e21f9a` (HEAD~7, docs-only delta — zero production code change vs pre-T1) on the same shared dev DB.

| Suite | HEAD fails | Baseline fails | Root cause | Verdict |
| --- | --- | --- | --- | --- |
| `scheduler-store-pg` | 1 (persist/hydrate parity) | 1 (identical test) | shared-DB fixture drift | pre-existing |
| `etl-pipeline-queue` | 4 | 3 (same file, same error family) | `graph_generation_workspace_missing:*` — synthetic workspace rows absent from shared dev DB; the 4th HEAD failure ("partial ETL result") **passes solo at HEAD** → cross-test shared-state contamination, not feature semantics | pre-existing family (count variance documented) |
| `etl-cache-invalidation` | 1 | 1 (identical test) | shared-DB fixture drift | pre-existing |
| `auto-improve-job` | 2 (5s timeouts) | 2 identical timeouts (+2 baseline-only tool-registration fails) | timing flake; HEAD strictly better | pre-existing flaky |
| `qwen-e2e-fixture` | 2 | 2 (identical tests) | commit-locked fixture sha256/sparse-clone mismatch vs local fixture state | pre-existing |
| `trace-path` | 2–4 per run (race-variant subset) | 8 (superset, same error class) | shared-DB graph-generation workspace fixture race (`graph_generation_workspace_missing:p4d2-trace-path`) | pre-existing shared-db fixture race |

Environment note: machine default Bun drifted to 1.3.14; the exact-version native structural parser (AD-004/AD-005, pinned `bun@1.3.11`) then fails every structural suite with `PARSER_NOT_READY`. All T7 evidence uses an isolated Bun 1.3.11 binary (no global change). Under 1.3.11 the structural category is fully green.

## 7. T7 gate log

| Gate | Command | Result |
| --- | --- | --- |
| Identity unit | `bun test packages/core/src/__tests__/project-identity-*.test.ts` | 70 pass / 0 fail (81 tests incl. 11 env-gated acceptance skips) |
| Migration gate | `bun test …/project-identity-migration.test.ts` | 3/3 |
| T6 acceptance in suite | `IDENTITY_ACCEPTANCE_DATABASE_URL=… bun run test` | 9/9 pass inside workspace suite; 9/9 re-confirmed after M4 re-probe restore |
| MCP | inside workspace suite | tool-definitions-identity + synapse 4/4 |
| HTTP | inside workspace suite | project-identity routes 5/5; tools-api package green |
| Workspace regression | same | 1432 pass; only §6 classified failures |
| type-check | `bun run type-check` | 6/6 |
| build | `bun run build --force` | 5/5, 0 cached |
| Baseline repro | 6 failing files at `1e21f9a` under Bun 1.3.11 | §6 table |

## 8. Independent verifier

Verdict: **PASS** (author ≠ verifier; subagent with fresh context re-derived all evidence).

- **Sensors re-run independently** (pinned Bun 1.3.11): identity unit 69→70 pass / 0 fail, acceptance 9/9, migration 3/3, MCP 4/4, HTTP 5/5 — author's counts confirmed. Tests assert DB-visible spec outcomes (row counts, alias rows, byte-snapshot equality, distinct `pg_backend_pid`s), not implementation internals. No `.skip`/`todo`/commented assertions (only the documented env-gate). `dryRun` default true verified on both transports. Req 9 sanitization verified: fixed-message error table, only `code`+fixed `message` serialized, a dedicated unit test injects SQL/payload text and asserts zero leak.
- **Requirement/AC coverage:** all 9 requirements and all 7 acceptance criteria mapped to verified committed evidence (Y/Y; no evidence-or-zero gaps).
- **Discrimination sensor — 5 mutation probes (one at a time, each restored):**
  1. M1 alias-chain flatten removed (`apply.ts repairGraphForMerge`) — **KILLED** by acceptance T8 (exact 23503 `project_identity_aliases_target_fkey`).
  2. M2 roots-first ordering inverted — **KILLED** by acceptance T1 (23503 `documents_project_id_fkey`).
  3. M3 canonical stores sort removed (`hash.ts`) — **KILLED** by contracts unit "deterministic version-bound SHA-256 plan hash".
  4. M4 planner payload fingerprint `scoped=false` (global scan) — **SURVIVED** all committed tests (P3 gap: no fixture seeded an unrelated third project's payload row). **Closed in T7**: new planner fixture (§4) added; re-probed — M4 **KILLED**, exactly one failing test; code restored, identity unit 70/70, acceptance 9/9 re-confirmed.
  5. M5 merge payload rewrite source-only (`apply.ts rewritePayloadStore`) — **KILLED** by apply unit "dedupes byte-equivalent rows…".
- **Remaining gaps:** none. P1/P2: none. The single P3 was remediated inside T7 (fix→re-verify round 2 of ≤3).
- **Cleanliness:** post-restore `git status` showed only the three intended T7 files + this report; no commits, no residue.

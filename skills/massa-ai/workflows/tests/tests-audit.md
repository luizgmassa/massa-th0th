### Tests Audit

Use this workflow for findings-only audit of test coverage, regression protection, assertion quality, fixture reliability, and missing deterministic sensors in a concrete target: modified files, explicit files/globs, commit ranges, branch comparisons, modules/packages, symbols/classes/functions, feature/runtime flows, explicitly requested whole-repo scope, or an implementation scope packet supplied by `workflows/implementation/implementation-audit.md`.

Do not use this workflow to write, run, or fix test findings as the main task; route that to `workflows/tests/tests-fix.md`. Do not use it for generic correctness, security, architecture, code quality, or requirements findings; route those to the dedicated workflows.

This workflow is findings-only. Do not edit code unless the user separately asks for fixes.

1. Resolve/reuse `workflowSessionId`: `test-audit-[entity]`
2. Load shared references:
   - `references/codebase-investigation.md`
   - `references/audit-scope.md`
   - `references/audit-report-io.md` before writing the final direct audit report
   - `references/mobile-context.md` when the scope touches KMP, iOS, Android, native bridges, mobile lifecycle, offline sync, permissions, local persistence, UI snapshots/screenshots, or backend-mobile contracts
   - `references/context-firewall.md` before inspecting large diffs, logs, snapshots, generated reports, or broad search output
   - `references/synapse-policy.md` when repeated massa-ai searches are expected
   - `references/agent-orchestration.md` only for large scopes, explicit parallel/subagent requests, PR subagent invocation, or independent verification of high-impact findings
3. `recall` -> load testing conventions, mock boundaries, prior flaky tests, known regressions, project constraints, reusable verification recipes, and accepted test exceptions for the target area.
   - Apply the Memory Freshness Gate from `references/audit-scope.md`; recalled exceptions are leads, not proof.
4. Establish the investigation scope before proceeding:
   - Modified files scope: use when the user says modified files, changed files, current changes, uncommitted changes, staged changes, or unstaged changes.
   - Explicit files/globs scope: use when the user names files, directories, or globs.
   - Commit range scope: use when the user provides commits/ranges or asks for commits made by me, my branch commits, or test gaps introduced by branch commits.
   - Branch comparison scope: use when the user names base/head branches, refs, or a branch diff.
   - Codebase area scope: use when the user names a path, module, package, feature area, test suite, or glob.
   - Symbol/class/function scope: use when the user names public classes, functions, APIs, handlers, or exported surfaces.
   - Feature/flow scope: use when the user names a runtime flow, user journey, or feature area.
   - Whole-repo scope: use only when the user explicitly asks for a whole-repo tests audit.
   - Implementation parent scope: use only when `workflows/implementation/implementation-audit.md` invokes this workflow with a concrete implementation scope packet.
   - If the target focus is missing, vague, or too broad, ask for a concrete target from the supported scope types in `references/audit-scope.md`.
   - Build the shared scope packet from `references/audit-scope.md` and carry it into the report.
5. For modified files scope:
   - Include staged and unstaged tracked files from the working tree.
   - Include untracked non-generated source, test, fixture, schema, config, and docs files only when they can affect runtime, validation, or test behavior.
   - Exclude deleted files unless their deletion can break test coverage, imports, exports, routing, migrations, config, tests, or packaging.
   - Exclude generated, dependency, build, log, cache, temporary, and secret paths per repo rules.
   - Inspect diffs first, then tests and surrounding code needed to understand regression risk.
6. For commit range scope:
   - If the user supplied explicit commits or a revision range, use that exact range.
   - If the user asked for commits made by me, resolve author identity from `git config user.email`; if empty, use `git config user.name`.
   - For branch-relative commit scopes, resolve the branch base from the upstream merge-base first, then fall back in order to `origin/main`, `origin/master`, `main`, and `master`.
   - If the user asked for commits made by me, review branch-unique commits authored by the resolved identity.
   - If no explicit range, required author identity, or branch base can be resolved, ask the user for the missing value before proceeding.
   - Inspect changed files and diffs from those commits, then tests, fixtures, config, schemas, and prior bug patterns only as needed.
7. For codebase area scope:
   - Require a concrete path, module, package, feature area, or glob.
   - If the target area is missing, ask for it before proceeding.
   - Follow the shared retrieval order from `references/codebase-investigation.md` to find production entry points, tests, fixtures, mocks, test commands, and coverage-sensitive config.
8. For explicit files/globs, branch comparison, symbol/class/function, feature/flow, or explicitly requested whole-repo scope:
   - Resolve the target with `references/audit-scope.md` and record the resolution method, base/head when relevant, resolved files, exclusions, and freshness timestamp.
   - For symbol/class/function targets, inspect definitions, call paths, behavior contracts, tests, fixtures, mocks, and test commands only as needed.
   - For feature/flow targets, map changed or targeted behavior to existing tests and deterministic harnesses.
   - If whole-repo scope is requested, map major test surfaces first and report skipped depth checks rather than implying exhaustive coverage.
9. For implementation parent scope:
   - Accept the exact scope packet from `implementation-audit`; do not broaden beyond resolved files, nearby tests, fixtures, config, and callers needed to verify regression protection.
   - Return compact findings to the parent implementation audit; do not write broad project memories unless explicitly assigned.
10. Investigation pass. Dispatch `audit-specialist` per `references/agent-orchestration.md` when the scope justifies an isolated read-only subagent:

> **Dispatch: audit-specialist** — see `skills/agents/audit-specialist/SKILL.md`
> - trigger: large scope, explicit parallel/subagent request, PR subagent invocation, or independent verification of high-impact finding
> - scope: the tests audit target — test files, fixtures, harnesses, coverage
> - permissions: read-only
> - inputs: shared scope packet; `lens: performance` (test coverage is under the performance lens); recalled testing conventions, flaky tests, known regressions
> - sensors: map behavior to tests; check missing tests for new branches, error paths, async logic, migrations; fixture health, assertion quality, flakiness root-cause
> - output: findings with missing/weak coverage type, location, evidence, regression risk, severity, simplest test direction, deterministic sensor, verification suggestion
> - firewall: raw diffs/logs/search output summarized, not returned raw
> - memory: suggest-only; main agent persists reusable testing patterns

    - Map changed or targeted behavior to existing tests, fixtures, mocks, and deterministic harnesses.
   - Check missing tests for new branches, error paths, auth/validation/persistence changes, async or race-prone logic, migrations, public contracts, and recalled bug patterns.
   - For mobile scopes, check KMP shared and platform-specific `actual` tests, Android/iOS harnesses, native bridge payload coverage, permissions, lifecycle, offline sync, deep links, push/background flows, UI snapshots/screenshots, device-matrix assumptions, and platform parity claims from `references/mobile-context.md`.
   - Check weak assertions, tests that only assert implementation details, fixture drift, nondeterminism, hidden network/time/filesystem dependencies, skipped tests, and weakened snapshots.
   - For each candidate finding, record the concrete claim, source evidence, impacted behavior, likely regression path, provisional severity, and what would disprove it.
11. False-positive pass:
   - Try to disprove every candidate before reporting it.
   - Check existing unit, integration, e2e, contract, snapshot, fixture, and harness coverage; also check framework-generated coverage and accepted exceptions.
   - If a deterministic test command is cheap and in scope, run it as a sensor; if not, report the skipped command and reason.
   - Drop candidates disproven by evidence, downgrade candidates with partial mitigation, and mark low-confidence findings explicitly.
12. Severity rules (apply the countable threshold first, then the qualitative clause):
   - `critical`: missing or broken tests around data loss, auth/privacy, migration, deployment-blocking, irreversible corruption risk, OR >10 affected files; otherwise use the qualitative clause below.
   - `high`: missing or weak tests around a core flow, public contract, persistence behavior, validation, security boundary, or severe regression risk.
   - `medium`: missing edge-flow coverage, flaky or nondeterministic test risk, fixture drift, weak assertions, or missing regression coverage around changed logic (<=10 affected files).
   - `low`: minor coverage gap, low-impact assertion hardening, incomplete evidence, or weakly supported concern.
13. Final report:
   - Findings first, ordered by severity: `critical`, `high`, `medium`, `low`.
   - Each finding must use `TST-<N>` and include the canonical fields from `references/audit-report-io.md`: severity, confidence, file/line, evidence, impacted behavior, regression risk, simplest test direction, deterministic sensor, and verification suggestion.
   - If no test audit findings are found, say that clearly and list scope checked plus skipped checks.
   - Include ruled-out candidates when they were plausible enough to matter.
   - Include scope checked, deterministic evidence or skipped-check notes, memory outcome, and residual risk.
   - Include the Verification/Test Fidelity Checklist from `references/audit-report-io.md`; tie every `TST-*` finding or no-finding claim to deterministic sensors, commands/artifacts, results, validation assets, or skipped-check reasons. Model judgment alone cannot satisfy verification/testing all-clear.
   - For direct top-level invocation, use the Plan Mode save rule and canonical report contract from `references/audit-report-io.md` for `audits/tests/<YYYY-MM-DD tests-audit>.md`.
   - For implementation audit child invocation, return compact findings to the parent unless the parent explicitly requests saved audit artifacts.
14. Persist only durable knowledge:
   - Do not persist one-off findings.
   - Persist repeated test gap patterns, project-specific testing conventions, accepted exceptions, flaky-test patterns, or reusable verification recipes after scoring with the Importance Calibration System.
   - Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:tests-audit`, `entity:<entity>`, and one `memory:<tier>` tag.
15. Complete the Evidence Gate from `references/evidence-gate.md`.

## Examples

User asks: "Find test gaps in modified files."

1. Use `workflowSessionId=test-audit-modified-files`.
2. Scope to staged, unstaged, and relevant untracked files; inspect changed behavior before tests.
3. Map changed behavior to existing tests and deterministic harnesses.
4. Report findings by severity with simplest test direction.

User asks: "Audit src/payments test coverage."

1. Use `workflowSessionId=test-audit-payments`.
2. Scope to `src/payments`, its tests, fixtures, mocks, config, and public contracts.
3. Report missing regression coverage, weak assertions, flaky risks, and skipped checks.

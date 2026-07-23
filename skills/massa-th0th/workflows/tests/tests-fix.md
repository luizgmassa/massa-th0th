### Tests Fix

Use this workflow only to execute fixes from a tests audit markdown report.

Do not use this workflow for findings-only test coverage, assertion quality, fixture health, flakiness, or regression-risk review; route that to `workflows/tests/tests-audit.md`. Do not use it for generic "write some tests" work without an audit report; route broad test planning through the relevant feature, debug, refactor, or spec-driven workflow.

1. Resolve/reuse `workflowSessionId`: `tests-fix-[entity]`
2. Load shared references:
   - `references/audit-report-io.md` before any code or test change
   - `references/lessons.md` to load confirmed project lessons
   - `references/codebase-investigation.md` before changing unfamiliar tests or fixtures
   - `references/mobile-context.md` when the report target touches KMP, iOS, Android, native bridges, mobile lifecycle, offline sync, permissions, local persistence, UI snapshots/screenshots, or backend-mobile contracts
   - `references/verification-ladder.md` before non-trivial edits
   - `references/context-firewall.md` before inspecting large logs, snapshots, generated reports, or broad search output
   - `references/agent-orchestration.md` only for large/high-risk findings, disjoint implementation slices, or independent verification
3. `th0th_recall` -> load testing conventions, mock boundaries, test frameworks, prior flaky tests, known regressions, accepted exceptions, and reusable verification recipes for the report target.
4. Select the tests audit report with execution focus:
   - Establish the report selector, target focus, and optional finding selector before selecting a report. Target focus can be a behavior, flow, module, test suite, files/globs, branch comparison, commit range, symbol/class/function, or explicit whole-repo target.
   - If the user gives a path, read that exact markdown file.
   - If the user asks for "latest" or gives no path, require a concrete target focus first; do not run the latest tests report against an unspecified target.
   - Select the latest `audits/tests/<YYYY-MM-DD tests-audit>.md` only after target focus is known, using `references/audit-report-io.md`.
   - Stop if no report exists; do not infer findings from conversation history.
   - Validate the report with `references/audit-report-io.md`: workflow, `ProjectId`, `Target`, `Target Focus`, scope, git base/head, required fields, `TST-` IDs, resolved files or material scope evidence, and current file/line evidence. Stop on invalid, stale, target-drifted, or ambiguous reports before editing.
5. Extract actionable test findings:
   - Keep findings with concrete `Location`, `Evidence`, impacted behavior, regression risk, `Simplest Test Direction`, `Deterministic Sensor`, and `Verification Suggestion`.
   - Ignore ruled-out candidates, no-finding sections, and low-confidence hardening ideas unless the user explicitly asks to include them.
   - If the user supplied finding IDs, extract only those IDs after validating they exist and match the current target focus.
   - Rank by regression risk, severity, dependency order, and determinism.
6. Build a coverage execution map before editing:
   - Finding ID -> behavior under test, missing/weak assertion, fixture/mock boundary, deterministic harness, validation asset, expected failure before fix when possible, and verification command.
   - Separate missing coverage, weak assertion, fixture drift, flakiness, skipped test, and missing deterministic sensor findings.
   - For mobile findings, include KMP/shared vs platform-specific boundary, native bridge payload or backend-mobile contract, Android/iOS harness, device matrix or simulator/emulator assumptions, platform parity expectation, and skipped platform checks from `references/mobile-context.md`.
7. Size each finding with `references/verification-ladder.md`:
   - Quick: local test addition, assertion strengthening, fixture field correction, or focused skipped-test restoration.
   - Standard: integration harness change, shared fixture/mocking repair, flake root-cause fix, or production seam needed for deterministic testing; define verification recipe first.
   - Spec-driven: test strategy redesign, broad harness migration, unclear behavior contract, or production behavior change beyond enabling deterministic tests; pause and route to `workflows/spec-driven.md` or ask for approval.
8. Apply test fixing methods:
   - Missing coverage: write the smallest deterministic test that fails on the risky behavior and passes with correct behavior.
   - Weak assertions: assert externally meaningful behavior, outputs, side effects, persisted state, emitted events, or user-visible contracts rather than implementation details.
   - Fixture drift: repair fixtures/builders to match current contracts while keeping them minimal and explicit.
   - Flakiness: prove root cause first; control time, randomness, async scheduling, filesystem, network, and global state with deterministic seams.
   - Missing sensor: add or document the focused command needed to prove the regression cannot recur.
   - Mobile coverage: prefer KMP/shared tests before device loops when the behavior is shared; use Android/iOS harnesses, bridge contract tests, screenshot/snapshot checks, lifecycle or permission simulations, and parity validation when the report finding requires them.
9. Guard validation assets:
   - Never weaken assertions only to make the suite pass.
   - Do not delete coverage, snapshots, fixtures, or benchmarks unless the audit report explicitly calls them obsolete and behavior remains protected elsewhere.
   - Prefer production-code changes only when required to expose a deterministic seam or fix a real bug found while writing the audited test.
10. Use strict harness sensors:
   - Never rely on AI subjective evaluation.
   - If verification found a reusable signal (`ac_gap`, `surviving_mutant`, `spec_precision_gap`, `spec_deviation`, `gate_fail`), record it via `references/lessons.md`:
     `python3 skills/massa-th0th/scripts/lessons.py --root . add --feature "<slug>" --signal "<signal>" --source "<ref>" --text "<one terse lesson>"`
   - Apply the Mandatory Verification Fix Gate from `references/verification-ladder.md`: run the report's Verification Suggestion or an equivalent deterministic command/artifact check for each selected finding or coherent group.
   - Run the actual focused test command first, then broader relevant suites when feasible, such as `rtk yarn test`, `rtk npm test`, `rtk pytest`, or `rtk cargo test`.
   - Continue only when the execution harness returns a clean exit code, or report the exact skipped-check reason.
   - A finding cannot be marked `fixed` when a target-relevant command or artifact check exists but was not attempted; if verification cannot run, mark it `blocked`, `deferred`, or `skipped` with an allowed skipped-check reason.
   - Record command/artifact, result, skipped reason or `none`, highest Verification Ladder level reached, validation assets protected, and residual risk.
11. Use agent orchestration only when it improves signal. Dispatch per `references/agent-orchestration.md`:

> **Dispatch: builder** — see `skills/agents/builder/SKILL.md`
> - trigger: large/high-risk finding, disjoint implementation slice, or explicit subagent request
> - scope: one isolated test finding with a disjoint write set
> - permissions: write (disjoint write set)
> - inputs: the finding ID, missing/weak coverage type, fixture/mock boundary, deterministic harness, and verification command
> - sensors: focused test command (`bun test`, `pytest`, `cargo test`) with clean exit code; no weakened assertions
> - output: implementation summary, test counts, commands run, deviations
> - firewall: raw test output/logs summarized
> - memory: suggest-only; main agent persists reusable testing patterns

> **Dispatch: verification-agent** — see `skills/agents/verification-agent/SKILL.md`
> - trigger: independent verification of a high-risk test fix
> - scope: the fixed finding's assertions, fixtures, and report claim closure
> - permissions: read-only
> - inputs: the finding, the applied fix, the verification suggestion, and validation assets
> - sensors: deterministic command (focused test suite, assertion inspection, fixture-not-weakened check) and report claim closure
> - output: confirmed/disproven closure verdict with evidence
> - firewall: raw test output/logs summarized
> - memory: suggest-only; main agent persists reusable verification recipes
   - Main agent owns report parsing, prioritization, memory writes, final synthesis, and Evidence Gate.
12. At completion, persist only durable knowledge after scoring with the Importance Calibration System:
   - Testing conventions, deterministic harness recipes, flaky-test root causes, accepted exceptions, or reusable edge-case coverage patterns.
   - Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:tests-fix`, `entity:<entity>`, and one `memory:<tier>` tag.
13. Complete the Evidence Gate from `references/evidence-gate.md`; do not mark tests complete without a clean deterministic exit code or explicit skipped-check reason.

## Examples

User asks: "Use tests-fix to fix latest audit findings for report scheduling."

1. Confirm target focus is `report scheduling`, then read the latest matching `audits/tests/* tests-audit.md`.
2. Validate metadata, target focus, freshness, required fields, and current evidence before editing.
3. Map each finding to missing coverage, weak assertions, fixture drift, flakiness, or missing sensor work.
4. Add or repair deterministic tests without weakening validation assets.
5. Run focused tests and report broader skipped checks when needed.

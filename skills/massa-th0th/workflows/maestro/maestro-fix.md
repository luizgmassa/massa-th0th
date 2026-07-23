### Maestro Fix

Use this child-only workflow to fix confirmed `MST-*` findings from a saved Maestro audit report or an explicit `maestro-audit` handoff.

Reject direct use without a saved `audits/maestro/<YYYY-MM-DD maestro-audit.md>` report or a parent audit handoff that includes the same required metadata. Do not execute from chat summaries, remembered findings, inline comments, or unsaved model analysis. The saved report or parent handoff is the source of truth.

1. Resolve/reuse `workflowSessionId`: `maestro-fix-[entity]`.
2. Load shared references:
   - `references/maestro.md` as the index before choosing focused Maestro references.
   - `references/maestro/fact-ledger.md` before making any Maestro claim; tag facts as `official-doc`, `live-help`, `repo-convention`, or `excluded/unverified`.
   - `references/maestro/cli-device.md` before CLI checks, device/platform readiness, local sharding, or executable runs.
   - `references/maestro/artifacts-reports.md` before report/artifact/debug-output, screenshot, video, recording, or AI report claims.
   - `references/maestro/patterns.md` before applying flow, setup/teardown, fixture, validation asset, or skipped-check rules.
   - `references/maestro/yaml-commands.md` before changing unfamiliar command syntax.
   - `references/maestro/selectors.md` before changing selector strategy.
   - `references/maestro/workspace-execution.md` before changing config, tags, execution order, sharding, or CI command shape.
   - `references/maestro/config-env-output.md` before changing env, properties, report-output flags, or artifact directories.
   - `references/maestro/js-scripting.md` before changing JavaScript helpers or logs.
   - `references/maestro/cloud.md` only when saved finding scopes Cloud execution or Cloud artifact evidence.
   - `references/maestro/mcp.md` only when saved finding scopes Maestro MCP or Viewer evidence.
   - `references/audit-report-io.md` before report validation or source edits.
   - `references/lessons.md` to load confirmed project lessons
   - `references/mobile-context.md` for platform scope, parity, and device/emulator assumptions.
   - `references/codebase-investigation.md` before changing unfamiliar flows, fixtures, setup/teardown, or CI wiring.
   - `references/verification-ladder.md` before non-trivial edits.
   - `references/context-firewall.md` before large reports, logs, screenshots, videos, JUnit XML, or generated artifacts.
   - `references/naming-standards.md` before naming flows, tags, fixtures, selectors, or test data.
3. Select and validate the report:
   - Prefer an exact report path plus optional `MST-*` IDs.
   - For `latest` or omitted path, require a concrete target focus, then select only from `audits/maestro/`.
   - Validate metadata: `Workflow: maestro-audit`, `ProjectId`, `WorkflowSessionId`, `Target`, `Target Focus`, `Scope`, `Git Base`, `Git Head`, `Scenario Source`, flow inventory, Maestro run matrix, JUnit report/artifact evidence, Verification/Test Fidelity Checklist, and Execution Handoff.
   - Stop on invalid, stale, target-drifted, or ambiguous reports.
4. Extract actionable findings:
   - Keep only selected `MST-*` findings with concrete location, scenario source, evidence, impacted journey, flake or coverage risk, simplest sufficient fix, and Verification Suggestion.
   - Ignore no-finding claims, ruled-out candidates, skipped checks, and low-confidence ideas unless the user explicitly changes scope after revalidation.
5. Revalidate current source and report drift:
   - Reinspect current flow/subflow/fixture/setup files and current CI command shape.
   - Confirm evidence still applies; stop or re-audit if files, flow paths, target, app behavior, or expected behavior have drifted.
6. Fix only allowed artifacts:
   - You may edit only Maestro flows, subflows, fixtures, setup/teardown, and test data unless the saved audit finding directly scopes Maestro CI/report wiring.
   - Maestro flows.
   - Subflows.
   - Fixtures.
   - Setup/teardown.
   - Test data.
   - Directly required Maestro CI/report wiring when the audit finding targets it.
7. If evidence points to an app bug, product behavior gap, missing selector/test ID in production code, backend issue, or requirements ambiguity, stop and route to `workflows/debug.md`, `workflows/feature.md`, or `workflows/requirements/requirements-audit.md`. Do not modify production app behavior in this child workflow.
8. Apply fixes using stable-flow design from `references/maestro/patterns.md`:
   - Replace arbitrary sleeps with observable state waits when possible.
   - Replace brittle selectors with stable selectors, accessibility labels, or test IDs already present.
   - Keep setup/teardown explicit, idempotent, and isolated.
   - Protect existing flows, subflows, fixtures, snapshots, baselines, report consumers, and CI commands unless the audit finding explicitly scopes them.
9. Use strict harness sensors:
   - If verification found a reusable signal (`ac_gap`, `surviving_mutant`, `spec_precision_gap`, `spec_deviation`, `gate_fail`), record it via `references/lessons.md`:
     `python3 skills/massa-th0th/scripts/lessons.py --root . add --feature "<slug>" --signal "<signal>" --source "<ref>" --text "<one terse lesson>"`
   - Apply the Mandatory Verification Fix Gate from `references/verification-ladder.md`: run the report's Verification Suggestion or an equivalent deterministic command/artifact check for each selected `MST-*` finding or coherent group.
   - Prefer repository-specific Maestro commands; otherwise run `maestro test --format junit --output <report.xml> --test-output-dir <artifact-dir> <flow-or-directory>`.
   - A finding cannot be marked `fixed` when a target-relevant command or artifact check exists but was not attempted.
   - If verification cannot run, mark it `blocked`, `deferred`, or `skipped` with an allowed skipped-check reason.
10. Produce a closure matrix with `MST-*` ID, status (`fixed`, `blocked`, `deferred`, or `skipped`), changed files, command/artifact, result, skipped reason or `none`, highest Verification Ladder level reached, validation assets protected, JUnit report path, artifact dir, device/platform, and residual risk.
11. Persist only durable Maestro fix patterns, flake root causes, selector/test-ID policy, setup/teardown recipes, device matrix constraints, or reusable verification commands after Importance Calibration. Use `workflow:maestro-fix` and required memory tags.
12. Complete the Evidence Gate from `references/evidence-gate.md`.

## Examples

User asks: "Fix MST-2 from audits/maestro/2026-06-29 maestro-audit.md."

1. Read and validate the saved report.
2. Reinspect current flow evidence and fix only the targeted Maestro flow/subflow/fixture surface.
3. Run the report's Verification Suggestion or equivalent Maestro command and report the closure matrix.

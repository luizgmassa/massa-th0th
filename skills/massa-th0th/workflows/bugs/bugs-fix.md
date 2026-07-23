### Bugs Fix

Use this workflow only to execute fixes from a bugs audit markdown report.

Do not use this workflow for findings-only bug discovery; route that to `workflows/bugs/bugs-audit.md`. Do not use it for one known broken behavior without an audit report; route that to `workflows/debug.md`. Do not use it for broad product/design changes; route those to `workflows/spec-driven.md`.

1. Resolve/reuse `workflowSessionId`: `bugs-fix-[entity]`
2. Load shared references:
   - `references/audit-report-io.md` before any code or test change
   - `references/lessons.md` to load confirmed project lessons
   - `references/codebase-investigation.md` before changing unfamiliar bug paths
   - `references/verification-ladder.md` before non-trivial edits
   - `references/context-firewall.md` before inspecting large diffs, logs, snapshots, generated reports, or broad search output
   - `references/agent-orchestration.md` only for large/high-risk findings, disjoint implementation slices, or independent verification
3. `recall` -> load prior bug patterns, known regressions, fragile flows, accepted exceptions, testing conventions, and reusable verification recipes for the report target.
4. Select the bugs audit report with execution focus:
   - Establish the report selector, target focus, and optional finding selector before selecting a report. Target focus can be a flow, module, files/globs, branch comparison, commit range, symbol/class/function, feature area, or explicit whole-repo target.
   - If the user gives a path, read that exact markdown file.
   - If the user asks for "latest" or gives no path, require a concrete target focus first; do not run the latest bugs report against an unspecified target.
   - Select the latest `audits/bugs/<YYYY-MM-DD bugs-audit>.md` only after target focus is known, using `references/audit-report-io.md`.
   - Stop if no report exists; do not infer findings from conversation history.
   - Validate the report with `references/audit-report-io.md`: workflow, `ProjectId`, `Target`, `Target Focus`, scope, git base/head, required fields, `BUG-` IDs, resolved files or material scope evidence, and current file/line evidence. Stop on invalid, stale, target-drifted, or ambiguous reports before editing.
5. Extract actionable bug findings:
   - Keep findings with concrete `Bug Class`, `Impacted Flow`, `Trigger or Repro Path`, `Root Cause Hypothesis`, `Regression Risk`, `Location`, `Evidence`, `Simplest Fix Direction`, and `Verification Suggestion`.
   - Ignore ruled-out candidates, no-finding sections, and low-confidence hardening ideas unless the user explicitly asks to include them.
   - If the user supplied finding IDs, extract only those IDs after validating they exist and match the current target focus.
   - Rank by severity, trigger likelihood, regression risk, dependency order, and verification cost.
6. Build a bug-fix map before editing:
   - Finding ID -> impacted flow, trigger/repro path, suspected root cause, expected behavior, current behavior, files likely affected, validation assets, and verification command.
   - Group findings only when one small fix addresses the same root cause.
   - Keep unrelated cleanup out of scope.
7. Size each finding with `references/verification-ladder.md`:
   - Quick: local guard, null/state fix, small validation correction, deterministic branch fix, config/default correction, or focused regression test.
   - Standard: multi-file data-flow fix, persistence or async behavior change, public contract correction, migration-adjacent repair, or meaningful test impact; define repro and verification recipe first.
   - Spec-driven: new behavior policy, broad design change, cross-boundary ownership decision, migration strategy, or unclear expected behavior; pause and route to `workflows/spec-driven.md` or ask for approval.
8. Apply bug fixing methods:
   - Reproduce or confirm the trigger first when feasible; otherwise prove the root-cause path from current source evidence.
   - Trace input -> transformation -> output and fix the divergence point closest to the root cause.
   - Preserve existing public contracts unless the report explicitly identifies them as the bug.
   - Prefer the smallest behavior-preserving fix: guard, validation, state update, ordering, await/async correction, persistence constraint, config default, or call-site contract alignment.
   - Add or update regression tests for the trigger path when feasible; include positive coverage so the fix does not over-block valid behavior.
   - Do not weaken tests, fixtures, snapshots, types, or public contracts to make the fix pass.
9. Use agent orchestration only when it improves signal. Dispatch per `references/agent-orchestration.md`:

> **Dispatch: builder** — see `skills/agents/builder/SKILL.md`
> - trigger: large/high-risk finding, disjoint implementation slice, or explicit subagent request
> - scope: one isolated bug finding with a disjoint write set
> - permissions: write (disjoint write set)
> - inputs: the finding ID, repro path, root cause, and simplest fix direction
> - sensors: report's verification suggestion or equivalent deterministic command; repro path must fail before fix and pass after
> - output: implementation summary, commands run, test counts, deviations
> - firewall: raw diffs/logs summarized
> - memory: suggest-only; main agent persists reusable bug patterns

> **Dispatch: verification-agent** — see `skills/agents/verification-agent/SKILL.md`
> - trigger: independent verification of a high-risk bug fix
> - scope: the fixed finding's repro path, tests, and report claim closure
> - permissions: read-only
> - inputs: the finding, the applied fix, the verification suggestion, and validation assets
> - sensors: deterministic command (repro path, focused tests, inspection) and report claim closure
> - output: confirmed/disproven closure verdict with evidence
> - firewall: raw test output/logs summarized
> - memory: suggest-only; main agent persists reusable verification recipes
   - Main agent owns report parsing, prioritization, memory writes, final synthesis, and Evidence Gate.
10. Verify each completed finding:
   - If verification found a reusable signal (`ac_gap`, `surviving_mutant`, `spec_precision_gap`, `spec_deviation`, `gate_fail`), record it via `references/lessons.md`:
     `python3 skills/massa-th0th/scripts/lessons.py --root . add --feature "<slug>" --signal "<signal>" --source "<ref>" --text "<one terse lesson>"`
   - Apply the Mandatory Verification Fix Gate from `references/verification-ladder.md`: run the report's Verification Suggestion or an equivalent deterministic command/artifact check for each selected finding or coherent group.
   - A finding cannot be marked `fixed` when a target-relevant command or artifact check exists but was not attempted; if verification cannot run, mark it `blocked`, `deferred`, or `skipped` with an allowed skipped-check reason.
   - Run the report's verification suggestion when available.
   - Run focused regression tests first, then relevant lint/type/build/test commands when feasible.
   - Confirm validation assets were not weakened.
   - Record command/artifact, result, skipped reason or `none`, highest Verification Ladder level reached, validation assets protected, and residual risk.
11. At completion, persist only durable knowledge:
   - Root causes, fragile project-specific flows, accepted exceptions, or reusable regression-test recipes after scoring with the Importance Calibration System.
   - Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:bugs-fix`, `entity:<entity>`, and one `memory:<tier>` tag.
12. Complete the Evidence Gate from `references/evidence-gate.md`.

## Examples

User asks: "Use bugs-fix to fix latest audit findings for checkout persistence."

1. Confirm target focus is `checkout persistence`, then read the latest matching `audits/bugs/* bugs-audit.md`.
2. Validate metadata, target focus, freshness, required fields, and current evidence before editing.
3. Confirm each trigger or root-cause path.
4. Fix the smallest root-cause divergence and add regression coverage when feasible.
5. Run focused verification and report skipped broader checks.

User asks: "Fix BUG-2 from audits/bugs/2026-06-07 bugs-audit.md."

1. Read the specified report and only execute `BUG-2`.
2. Preserve other bug findings for later.
3. Report evidence for `BUG-2` closure and residual risks.

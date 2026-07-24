### Requirements Fix

Use this workflow only to execute fixes from a requirements audit markdown report.

Do not use this workflow for findings-only requirements review; route that to `workflows/requirements/requirements-audit.md`. Do not use it for broad feature design when acceptance criteria are missing; route that to `workflows/spec-driven.md`.

1. Resolve/reuse `workflowSessionId`: `requirements-fix-[entity]`
2. Load shared references:
   - `references/audit-report-io.md` before any code change
   - `references/lessons.md` to load confirmed project lessons
   - `references/codebase-investigation.md` before changing unfamiliar requirement flows
   - `references/verification-ladder.md` before non-trivial edits
   - `references/context-firewall.md` before inspecting large specs, diffs, generated reports, or broad search output
   - `references/agent-orchestration.md` only for large/high-risk findings, disjoint implementation slices, or independent verification
3. `recall` -> load product decisions, accepted scope constraints, public contracts, compatibility rules, requirement interpretations, and verification recipes for the report target.
4. Select the requirements audit report with execution focus:
   - Establish the report selector, target focus, requirements source, and optional finding selector before selecting a report. Target focus can be a flow, feature, public contract, module, files/globs, branch comparison, commit range, symbol/class/function, or explicit whole-repo target.
   - If the user gives a path, read that exact markdown file.
   - If the user asks for "latest" or gives no path, require a concrete target focus first; do not run the latest requirements report against an unspecified target.
   - Select the latest `audits/requirements/<YYYY-MM-DD requirements-audit>.md` only after target focus is known, using `references/audit-report-io.md`.
   - Stop if no report exists; do not infer findings from conversation history.
   - Validate the report with `references/audit-report-io.md`: workflow, `ProjectId`, `Target`, `Target Focus`, scope, git base/head, required fields, `REQ-` IDs, requirement source, resolved files or material scope evidence, and current file/line evidence. Stop on invalid, stale, target-drifted, or ambiguous reports before editing.
5. Extract actionable findings:
   - Keep findings with concrete `Requirement Source`, `Requirement ID or Quote`, `Requirement Gap Type`, `Location`, `Evidence`, `Impact`, `Simplest Fix Direction`, and `Verification Suggestion`.
   - Ignore ruled-out candidates and no-finding sections.
   - If the user supplied finding IDs, extract only those IDs after validating they exist and match the current target focus and requirements source.
   - Rank by mandatory requirement severity, dependency order, user-visible impact, compatibility risk, and testability.
6. Build a traceability matrix before editing:
   - Requirement ID/source -> audit finding ID -> current implementation evidence -> desired behavior -> files likely affected -> tests/docs needed -> verification command.
   - Mark each item as missing requirement, contradicted requirement, out-of-scope behavior, compatibility break, docs mismatch, or test/docs gap.
7. Size each finding with `references/verification-ladder.md`:
   - Quick: local behavior correction, docs wording fix, config default correction, or focused test alignment.
   - Standard: multi-file behavior change, public API compatibility fix, UI/API contract update, or meaningful test impact; define verification recipe first.
   - Spec-driven: ambiguous requirement, new feature beyond audited scope, contract redesign, migration, or stakeholder tradeoff; pause and route to `workflows/spec-driven.md` or ask for approval.
8. Apply requirements fixing methods:
   - Missing requirement: implement the smallest behavior that satisfies the source requirement and add direct acceptance coverage.
   - Contradicted requirement: change behavior to match the source of truth, unless the report identifies a newer accepted decision.
   - Out-of-scope behavior: remove or guard behavior that exceeds non-goals, while preserving existing supported contracts.
   - Compatibility break: restore previous public contract or add a compatible bridge if the report requires compatibility.
   - Docs/test mismatch: update docs or tests to reflect delivered behavior only when implementation already matches the requirement.
9. Guard scope:
   - Do not reinterpret requirements beyond the report and cited source.
   - Preserve non-goals and explicit constraints.
   - If a finding exposes a product decision gap, stop and ask rather than inventing policy.
10. Use agent orchestration only when it improves signal. Dispatch per `references/agent-orchestration.md`:

> **Dispatch: builder** — see `skills/agents/builder/SKILL.md`
> - trigger: large/high-risk finding, disjoint implementation slice, or explicit subagent request
> - scope: one isolated requirements finding with a disjoint write set
> - permissions: write (disjoint write set)
> - inputs: the finding ID, requirement source, gap/contradiction/ambiguity, and simplest fix direction
> - sensors: report's verification suggestion or equivalent deterministic command; requirements-trace check
> - output: implementation summary, commands run, test counts, deviations
> - firewall: raw diffs/logs summarized
> - memory: suggest-only; main agent persists reusable requirements patterns

> **Dispatch: verification-agent** — see `skills/agents/verification-agent/SKILL.md`
> - trigger: independent verification of a high-risk requirements fix
> - scope: the fixed finding's requirement alignment, test coverage, and report claim closure
> - permissions: read-only
> - inputs: the finding, the applied fix, the verification suggestion, and validation assets
> - sensors: deterministic command (requirements-trace check, test coverage, doc/spec alignment) and report claim closure
> - output: confirmed/disproven closure verdict with evidence
> - firewall: raw test output/logs summarized
> - memory: suggest-only; main agent persists reusable verification recipes
   - Main agent owns report parsing, traceability matrix, memory writes, final synthesis, and Evidence Gate.
11. Verify each completed finding:
   - If verification found a reusable signal (`ac_gap`, `surviving_mutant`, `spec_precision_gap`, `spec_deviation`, `gate_fail`), record it via `references/lessons.md`:
     `python3 skills/massa-ai/scripts/lessons.py --root . add --feature "<slug>" --signal "<signal>" --source "<ref>" --text "<one terse lesson>"`
   - Apply the Mandatory Verification Fix Gate from `references/verification-ladder.md`: run the report's Verification Suggestion or an equivalent deterministic command/artifact check for each selected finding or coherent group.
   - A finding cannot be marked `fixed` when a target-relevant command or artifact check exists but was not attempted; if verification cannot run, mark it `blocked`, `deferred`, or `skipped` with an allowed skipped-check reason.
   - Run the report's verification suggestion when available.
   - Run acceptance tests, targeted unit/integration tests, docs checks, type/build checks, or manual artifact inspection relevant to the requirement.
   - Update the traceability matrix status in the final report summary.
   - Record command/artifact, result, skipped reason or `none`, highest Verification Ladder level reached, validation assets protected, and residual risk.
12. At completion, persist only durable knowledge:
   - Accepted requirement interpretations, scope constraints, compatibility rules, or reusable acceptance-test recipes after scoring with the Importance Calibration System.
   - Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:requirements-fix`, `entity:<entity>`, and one `memory:<tier>` tag.
13. Complete the Evidence Gate from `references/evidence-gate.md`.

## Examples

User asks: "Use requirements-fix to fix latest audit for checkout flow."

1. Confirm target focus is `checkout flow`, then read the latest matching `audits/requirements/* requirements-audit.md`.
2. Validate metadata, target focus, freshness, required fields, requirement source, and current evidence before editing.
3. Build a requirement traceability matrix.
4. Fix mandatory gaps and contradictions before lower-severity docs/test issues.
5. Verify against the cited requirement source.

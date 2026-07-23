### Implementation Fix

Use this workflow only to execute confirmed findings from a saved implementation audit markdown report.

Do not execute from chat summaries, inline review comments, remembered findings, or old PR audit reports. The saved `audits/implementation/<YYYY-MM-DD implementation-audit.md>` report is the source of truth. Route fresh findings work to `workflows/implementation/implementation-audit.md`.

1. Resolve/reuse `workflowSessionId`: `implementation-fix-[entity]`.
2. Load shared references:
   - `references/audit-report-io.md` before any code or test change.
   - `references/audit-scope.md` for target matching and freshness.
   - `references/lessons.md` to load confirmed project lessons
   - `references/codebase-investigation.md` before changing unfamiliar paths.
   - `references/verification-ladder.md` before non-trivial edits.
   - `references/naming-standards.md` before introducing, renaming, or preserving identifiers as part of a finding fix.
   - `references/context-firewall.md` before large diffs, logs, snapshots, reports, or broad searches.
   - `references/agent-orchestration.md` only for high-risk findings, disjoint implementation slices, or independent verification.
3. `recall` -> load prior implementation audit decisions, known regressions, architecture/security boundaries, accepted exceptions, testing conventions, and reusable verification recipes for the target.
4. Select the report with an explicit execution focus:
   - Establish report selector, target focus, and optional source-qualified finding IDs before selecting a report.
   - If the user provides a path, read that exact markdown file.
   - If the user asks for `latest` or omits a path, require a concrete target focus first, then select the latest matching `audits/implementation/<YYYY-MM-DD implementation-audit.md>` using `references/audit-report-io.md`.
   - Stop if no saved report exists. Tell the user to run `implementation-audit` or provide a report path.
   - Reject reports missing `Workflow: implementation-audit`, `ProjectId`, `WorkflowSessionId`, `Target`, `Target Focus`, `Scope`, `Git Base`, `Git Head`, `Source Evidence Timestamp`, or `Requirements Source`/`n/a`.
5. Validate freshness before editing:
   - Verify project, target, target focus, scope, base/head, and resolved files match the current execution target.
   - Re-resolve the current target and stop when material drift invalidates the report unless the user explicitly accepts the risk.
   - Inspect every selected finding's current location and evidence. Stop or re-audit when files moved, cited code no longer exists, evidence no longer proves the claim, or newer code changed the contract.
   - Treat unknown required fields, low-confidence suspects, skipped lenses, and `not evaluated` lenses as non-actionable unless explicitly included by the user.
6. Extract actionable findings:
   - Require source-qualified IDs of the form `Area/PREFIX-N` (e.g., `Correctness/BUG-1`, `Architecture/ARCH-1`, `Code Quality/CQ-1`, `Security/SEC-2`, `Requirements/REQ-1`, `Tests/TST-1`), plus severity, confidence, source lens, original ID, location, evidence, impact, smallest fix direction, and verification suggestion. The Area must match the source lens that produced the finding; the canonical area/prefix table and discipline live in `references/audit-report-io.md` (Source-Qualified Finding IDs).
   - Ignore ruled-out candidates, skipped-check notes, no-finding summaries, and suspects unless explicitly selected.
   - Treat SonarQube-derived items as actionable only when the saved implementation report already normalized them to a supported source-qualified ID with source lens, original ID, Sonar issue/rule evidence, location, impact, and verification suggestion. Never execute directly from raw SonarQube MCP output, quality gate summaries, chat summaries, or remembered Sonar findings.
   - If finding IDs are supplied, execute only those IDs after validating target and report membership.
   - Deduplicate findings sharing one root cause while preserving every original ID in the closure matrix.
7. Build one remediation matrix before editing: finding -> source lens -> severity -> confidence -> root fix -> likely files -> validation assets -> naming/public-contract impact -> verification command -> dependency/order -> status. Prioritize critical/high findings, then dependency order, blast radius, and verification cost. Keep unrelated cleanup out of scope.
8. Route each fix by source lens:
   - Correctness/`BUG-`: apply `bugs-fix` methods and add regression coverage when feasible.
   - Security/`SEC-`: apply `security-fix` methods, fail closed, and add negative validation when feasible.
   - Tests/`TST-`: apply `tests-fix` methods and strengthen deterministic sensors without brittle fixtures.
   - Requirements/`REQ-`: apply `requirements-fix` methods and preserve traceability, non-goals, and compatibility.
   - Architecture/`ARCH-`: apply `architecture-fix` methods; route broad redesign to `spec-driven`.
   - Code Quality/`CQ-`: apply `code-quality-fix` methods using small reversible simplification.
9. Size each finding with `references/verification-ladder.md`. Quick findings may proceed locally; Standard findings require characterization and an explicit recipe; ambiguous, cross-boundary, migration-heavy, or broad redesign findings pause and route to `spec-driven`.
10. Orchestrate conservatively. The main agent owns report parsing, scope/freshness, prioritization, questions, memory, and final evidence. Dispatch per `references/agent-orchestration.md`:

> **Dispatch: builder** — see `skills/agents/builder/SKILL.md`
> - trigger: isolated finding with disjoint write set and concrete verification
> - scope: one isolated implementation finding with a disjoint write set
> - permissions: write (disjoint write set)
> - inputs: the source-qualified finding ID (`Area/PREFIX-N`), target files, validation assets, and verification command
> - sensors: report's verification suggestion or equivalent deterministic command per lens
> - output: implementation summary, commands run, test counts, deviations
> - firewall: raw diffs/logs summarized
> - memory: suggest-only; main agent persists reusable patterns

> **Dispatch: verification-agent** — see `skills/agents/verification-agent/SKILL.md`
> - trigger: high-risk, security, public-contract, or multi-file fix
> - scope: the fixed finding's behavior, contracts, tests, and report claim closure
> - permissions: read-only
> - inputs: the finding, the applied fix, the verification suggestion, and validation assets
> - sensors: deterministic command per lens (tests, import checks, security checks) and report claim closure
> - output: confirmed/disproven closure verdict with evidence
> - firewall: raw test output/logs summarized
> - memory: suggest-only; main agent persists reusable verification recipes

    Never run parallel writers against shared files or contracts.
11. Verify each completed finding with the Mandatory Verification Fix Gate from `references/verification-ladder.md`: run the report's Verification Suggestion or an equivalent deterministic command/artifact check, then run focused tests, build, lint, type, static, or runtime checks relevant to the source lens. Reinspect tests, fixtures, snapshots, types, specs, public contracts, and touched identifiers so validation assets were not weakened and names follow `references/naming-standards.md`. A finding cannot be marked `fixed` when a target-relevant command or artifact check exists but was not attempted; if verification cannot run, mark it `blocked`, `deferred`, or `skipped` with an allowed skipped-check reason.
12. Produce a closure matrix with finding ID, source lens, status (`fixed`, `deferred`, `blocked`, `skipped`), changed files, command/artifact, result, skipped reason or `none`, highest Verification Ladder level reached, validation assets protected, residual risk, and exact next step for deferred or blocked findings.
13. If verification found a reusable signal (`ac_gap`, `surviving_mutant`, `spec_precision_gap`, `spec_deviation`, `gate_fail`), record it via `references/lessons.md`:
     `python3 skills/massa-th0th/scripts/lessons.py --root . add --feature "<slug>" --signal "<signal>" --source "<ref>" --text "<one terse lesson>"`
14. Persist only reusable root-cause patterns, approved remediation exceptions, durable architecture/security/requirements decisions, or project-specific verification recipes after Importance Calibration. Use `workflow:implementation-fix` and required project/session/entity/memory tags.
15. Complete `references/evidence-gate.md`.

## Examples

User asks: "Use implementation-fix to fix the latest audit findings for my modified files."

1. Resolve modified files as target focus and select the latest matching implementation report.
2. Validate report metadata, current files, and finding evidence.
3. Fix confirmed findings by source lens and report the closure matrix.

User asks: "Fix Security/SEC-2 from audits/implementation/2026-06-15 implementation-audit.md."

1. Read the exact report and validate `Security/SEC-2` against current source.
2. Apply security-fix methods only to that finding.
3. Preserve all other findings for later execution.

### Architecture Fix

Use this workflow only to execute fixes from an architecture audit markdown report.

Do not use this workflow for findings-only architecture review; route that to `workflows/architecture/architecture-audit.md`. Do not use it for broad new design work with missing requirements; route that to `workflows/spec-driven.md`.

1. Resolve/reuse `workflowSessionId`: `architecture-fix-[entity]`
2. Load shared references:
   - `references/audit-report-io.md` before any code change
   - `references/architecture-lenses.md`
   - `references/architecture-domain-lens.md` when executing domain or bounded-context findings
   - `references/architecture-coupling-lens.md` when executing dependency, contract, or coupling findings
   - `references/architecture-deepening-lens.md` when executing module-depth, seam, adapter, locality, or testability findings
   - `references/lessons.md` to load confirmed project lessons
   - `references/codebase-investigation.md` before changing unfamiliar modules
   - `references/verification-ladder.md` before non-trivial edits
   - `references/context-firewall.md` before inspecting large diffs, dependency graphs, generated reports, or broad search output
   - `references/agent-orchestration.md` only for large/high-risk findings, disjoint implementation slices, or independent verification
3. `th0th_recall` -> load ADRs, known boundaries, coupling patterns, accepted exceptions, rejected refactors, verification recipes, and project constraints for the report target.
4. Select the architecture audit report with execution focus:
   - Establish the report selector, target focus, and optional finding selector before selecting a report. Target focus can be a module, boundary, flow, files/globs, branch comparison, commit range, symbol/class/function, or explicit whole-repo target.
   - If the user gives a path, read that exact markdown file.
   - If the user asks for "latest" or gives no path, require a concrete target focus first; do not run the latest architecture report against an unspecified target.
   - Select the latest `audits/architecture/<YYYY-MM-DD architecture-audit>.md` only after target focus is known, using `references/audit-report-io.md`.
   - Stop if no report exists; do not infer findings from conversation history.
   - Validate the report with `references/audit-report-io.md`: workflow, `ProjectId`, `Target`, `Target Focus`, scope, git base/head, required fields, `ARCH-` IDs, resolved files or material scope evidence, and current file/module evidence. Stop on invalid, stale, target-drifted, or ambiguous reports before editing.
5. Extract actionable architecture findings:
   - Keep findings with concrete `Lens`, `Boundary/Module`, `Tradeoff`, `Location`, `Evidence`, `Impact`, `Simplest Fix Direction`, and `Verification Suggestion`.
   - Require lens-specific closure evidence: domain findings need language/ownership or integration evidence; coupling findings need strength/distance/volatility or dependency-direction evidence; deepening findings need deletion-test, seam, dependency-category, or test-surface evidence.
   - Ignore ruled-out candidates and no-finding sections.
   - Ignore `suspect` findings unless the user explicitly asks to address suspects or the report supplies a deterministic follow-up check that confirms them.
   - If the user supplied finding IDs, extract only those IDs after validating they exist and match the current target focus.
   - Rank by severity, dependency order, boundary blast radius, and ease of deterministic verification.
6. Build an execution map before editing:
   - Finding ID -> target modules, affected bounded context or seam, current dependency direction, desired dependency direction, behavior that must stay unchanged, validation assets, and rollback path.
   - Split work when one report contains independent findings. Do not mix unrelated architecture moves in one edit loop.
7. Size each finding with `references/verification-ladder.md`:
   - Quick: local move/inline/rename/adapter clarification with small blast radius.
   - Standard: multi-file behavior-preserving refactor, public API adjustment, package boundary change, or test impact; define characterization checks first.
   - Spec-driven: migration, broad boundary redesign, new service boundary, unclear ownership, or user-visible behavior change; pause and route to `workflows/spec-driven.md` or ask for approval.
8. Apply architecture fixing methods:
   - Domain: align language and ownership, move misplaced concepts into the right bounded context, separate generic/supporting concerns from core domain logic, and preserve ubiquitous language in names.
   - Coupling: reduce strength before distance; replace internal model sharing with explicit contracts, remove cross-boundary knowledge of internals, invert dependencies at stable seams, keep cohesive local coupling close, and avoid cycles.
   - Deepening: delete shallow pass-through modules, merge split concepts when locality improves, deepen useful interfaces by hiding invariants and ordering, test through the interface, and clarify seams only where variation, dependency direction, external I/O, or test substitution justifies it.
   - When a deepening candidate has two or more viable interface shapes, load the Interface Design Method from `references/architecture-deepening-lens.md` (Design It Twice) and pick by leverage and locality before editing.
   - When you decide not to apply a reported refactor, record the load-bearing reason; if it is likely to recur, offer an ADR via `workflows/adr.md` so the rejection is not re-litigated.
   - Prefer move, merge, inline, or clarify existing seams before adding new abstractions.
   - Use ports/adapters or anti-corruption layers only when the report evidence shows real volatility, boundary pressure, external dependency pressure, model leakage, or at least two real adapters such as production plus test.
   - Do not turn a local code-quality concern into an architecture migration; route broad new design, VSA migration, new service boundaries, or unclear ownership to `workflows/spec-driven.md`.
9. Preserve behavior:
   - Characterize current behavior before moving code with tests, static checks, import graphs, source inspection, or artifact snapshots.
   - Keep public contracts stable unless the audit finding explicitly requires contract change.
   - Update tests, docs, and imports only where required by the architecture fix.
10. Use agent orchestration only when it improves signal. Dispatch per `references/agent-orchestration.md`:

> **Dispatch: builder** — see `skills/agents/builder/SKILL.md`
> - trigger: large/high-risk finding, disjoint implementation slice, or explicit subagent request
> - scope: one isolated architecture finding with a disjoint write set
> - permissions: write (disjoint write set)
> - inputs: the finding ID, target modules, affected bounded context or seam, current/desired dependency direction, behavior that must stay unchanged, validation assets, rollback path
> - sensors: report's verification suggestion or equivalent deterministic command; static dependency-direction/import-cycle checks
> - output: implementation summary, commands run, test counts, deviations
> - firewall: raw diffs/logs summarized
> - memory: suggest-only; main agent persists reusable architecture patterns

> **Dispatch: verification-agent** — see `skills/agents/verification-agent/SKILL.md`
> - trigger: independent verification of a high-risk or multi-file architecture fix
> - scope: the fixed finding's dependency direction, tests, imports, and report claim closure
> - permissions: read-only
> - inputs: the finding, the applied fix, the verification suggestion, and validation assets
> - sensors: deterministic command (targeted tests, import-cycle check, dependency-direction check) and report claim closure check
> - output: confirmed/disproven closure verdict with evidence
> - firewall: raw test output/logs summarized
> - memory: suggest-only; main agent persists reusable verification recipes
11. Verify each completed finding:
   - If verification found a reusable signal (`ac_gap`, `surviving_mutant`, `spec_precision_gap`, `spec_deviation`, `gate_fail`), record it via `references/lessons.md`:
     `python3 skills/massa-th0th/scripts/lessons.py --root . add --feature "<slug>" --signal "<signal>" --source "<ref>" --text "<one terse lesson>"`
   - Apply the Mandatory Verification Fix Gate from `references/verification-ladder.md`: run the report's Verification Suggestion or an equivalent deterministic command/artifact check for each selected finding or coherent group.
   - A finding cannot be marked `fixed` when a target-relevant command or artifact check exists but was not attempted; if verification cannot run, mark it `blocked`, `deferred`, or `skipped` with an allowed skipped-check reason.
   - Run the report's verification suggestion when available.
   - Add static checks for dependency direction/import cycles when feasible.
   - For domain findings, verify names, ownership, contracts, or tests reflect the intended ubiquitous language without inventing undocumented domain truth.
   - For coupling findings, verify the risky edge was removed, weakened to a contract, moved closer, or explicitly documented as stable.
   - For deepening findings, verify callers/tests use the intended interface and no new hypothetical seam was added without real variation.
   - Run targeted tests or builds affected by moved boundaries.
   - Record command/artifact, result, skipped reason or `none`, highest Verification Ladder level reached, validation assets protected, and residual risk.
12. At completion, persist only durable knowledge:
   - Accepted architecture constraints, new seams, rejected broad refactors, reusable dependency checks, or recurring coupling patterns after scoring with the Importance Calibration System.
   - Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:architecture-fix`, `entity:<entity>`, and one `memory:<tier>` tag.
13. Complete the Evidence Gate from `references/evidence-gate.md`.

## Examples

User asks: "Use architecture-fix to fix the latest architecture audit for the billing boundary."

1. Confirm target focus is `billing boundary`, then read the latest matching `audits/architecture/* architecture-audit.md`.
2. Validate metadata, target focus, freshness, required fields, and current evidence before editing.
3. Extract actionable findings and build a finding-by-finding execution map.
4. Fix one boundary or coupling issue at a time.
5. Verify dependency direction and behavior before moving to the next finding.

User asks: "Fix finding ARCH-2 from audits/architecture/2026-06-06 architecture-audit.md."

1. Read the specified report and only execute `ARCH-2`.
2. Preserve unaffected architecture findings for later.
3. Report evidence for `ARCH-2` closure and residual risks.

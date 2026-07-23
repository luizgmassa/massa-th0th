### Code Quality Fix

Use this workflow only to execute fixes from a code quality audit markdown report.

Do not use this workflow for findings-only SOLID, Clean Code, KISS, YAGNI, DRY, maintainability, or overengineering analysis; route that to `workflows/code-quality/code-quality-audit.md`.

1. Resolve/reuse `workflowSessionId`: `code-quality-fix-[entity]`
2. Load shared references:
   - `references/audit-report-io.md` before any code change
   - `references/lessons.md` to load confirmed project lessons
   - `references/codebase-investigation.md` before changing unfamiliar code
   - `references/verification-ladder.md` before non-trivial edits
   - `references/naming-standards.md` before renaming identifiers, introducing domain vocabulary, or changing public contract names
   - `references/context-firewall.md` before inspecting large diffs, logs, generated reports, or broad search output
   - `references/agent-orchestration.md` only for large/high-risk findings, disjoint implementation slices, or independent verification
3. `recall` -> load project style rules, accepted quality exceptions, testing conventions, prior anti-patterns, and verification recipes for the report target.
4. Select the code quality audit report with execution focus:
   - Establish the report selector, target focus, and optional finding selector before selecting a report. Target focus can be a module, service layer, files/globs, branch comparison, commit range, symbol/class/function, feature/flow, or explicit whole-repo target.
   - If the user gives a path, read that exact markdown file.
   - If the user asks for "latest" or gives no path, require a concrete target focus first; do not run the latest code quality report against an unspecified target.
   - Select the latest `audits/code-quality/<YYYY-MM-DD code-quality-audit>.md` only after target focus is known, using `references/audit-report-io.md`.
   - Stop if no report exists; do not infer findings from conversation history.
   - Validate the report with `references/audit-report-io.md`: workflow, `ProjectId`, `Target`, `Target Focus`, scope, git base/head, required fields, `CQ-` IDs, resolved files or material scope evidence, and current file/line evidence. Stop on invalid, stale, target-drifted, or ambiguous reports before editing.
5. Extract actionable findings:
   - Keep findings with concrete `Rule`, `Current Shape`, `Simplest Safe Transformation`, `Location`, `Evidence`, `Impact`, `Simplest Fix Direction`, and `Verification Suggestion`.
   - Ignore ruled-out candidates, no-finding sections, and `suspect` items unless the user explicitly asks to address suspects.
   - Treat findings that require bounded-context language, dependency direction, strength/distance/volatility, seam placement, adapter design, or module-depth analysis as invalid for code-quality execution unless the report already reclassified them as local CQ cleanup. Route those to `workflows/architecture/architecture-fix.md` or ask the user to rerun architecture-audit.
   - If the user supplied finding IDs, extract only those IDs after validating they exist and match the current target focus.
   - Rank by severity, dependency order, behavior risk, and deletion/simplification payoff.
6. Build a refactoring map before editing:
   - Finding ID -> affected code, quality rule, current behavior contract, validation assets, simplest safe transformation, and expected diff shape.
   - Group duplicate-rule findings only when one small change fixes all of them.
   - Keep unrelated style cleanup out of scope.
7. Size each finding with `references/verification-ladder.md`:
   - Quick: rename, inline, delete unused speculation, extract constant, collapse trivial wrapper, or local parameter-object change.
   - Standard: multi-file consolidation, shared behavior cleanup, public helper contract change, or meaningful test impact; define characterization checks first.
   - Spec-driven: broad redesign, unclear behavior, cross-boundary migration, or user-visible behavior change; pause and route to `workflows/spec-driven.md` or ask for approval.
8. Apply code quality fixing methods:
   - SOLID: separate mixed responsibilities only when the split reduces change risk; replace caller-side type switches with polymorphism or data maps only when new variants are real; preserve base contracts; narrow fat interfaces; inject dependencies when hardcoded concretes block testing or substitution.
   - Clean Code: name domain concepts precisely using `references/naming-standards.md`, replace repeated magic values with named constants, split functions that truly do multiple things, remove code-restating comments, finish or delete stubs, and convert long positional parameter lists to options objects when it improves call-site clarity.
   - KISS: inline shallow helpers, collapse needless layers, choose direct control flow over clever indirection, and remove configuration that hides rather than expresses behavior.
   - YAGNI: delete unused extension points, future hooks, unused options, one-implementation factories, and speculative public APIs when usage evidence is absent.
   - DRY: consolidate duplicated domain rules or transformations into one clear source of truth, but avoid abstractions that make trivial duplication harder to read.
   - AI-slop cleanup: remove generic wrappers, fabricated-looking abstractions, one-call factories, code-restating comments, and unused configurability when current usage evidence does not justify them.
   - Do not introduce ports, adapters, bounded contexts, new service/module boundaries, or VSA-style folder migration to satisfy a code-quality finding.
9. Preserve behavior:
   - Run or identify characterization tests before changing behavior-adjacent code.
   - Do not weaken tests, fixtures, snapshots, types, or public contracts to make cleanup pass.
   - Prefer small reversible edits; verify after each finding or coherent group.
10. Use agent orchestration only when it improves signal. Dispatch per `references/agent-orchestration.md`:

> **Dispatch: builder** — see `skills/agents/builder/SKILL.md`
> - trigger: large/high-risk finding, disjoint implementation slice, or explicit subagent request
> - scope: one isolated code-quality finding or disjoint file group
> - permissions: write (disjoint write set)
> - inputs: the finding ID, smell category (SOLID/Clean Code/KISS/YAGNI/DRY), location, and simplest fix direction
> - sensors: report's verification suggestion or equivalent deterministic command; behavior-preservation check
> - output: implementation summary, commands run, test counts, deviations
> - firewall: raw diffs/logs summarized
> - memory: suggest-only; main agent persists reusable code-quality patterns

> **Dispatch: verification-agent** — see `skills/agents/verification-agent/SKILL.md`
> - trigger: independent verification of a high-risk code-quality fix
> - scope: the fixed finding's behavior preservation, imports, tests, and report claim closure
> - permissions: read-only
> - inputs: the finding, the applied fix, the verification suggestion, and validation assets
> - sensors: deterministic command (behavior-preservation check, import graph, tests) and report claim closure
> - output: confirmed/disproven closure verdict with evidence
> - firewall: raw test output/logs summarized
> - memory: suggest-only; main agent persists reusable verification recipes
   - Main agent owns report parsing, prioritization, memory writes, final synthesis, and Evidence Gate.
11. Verify each completed finding:
   - If verification found a reusable signal (`ac_gap`, `surviving_mutant`, `spec_precision_gap`, `spec_deviation`, `gate_fail`), record it via `references/lessons.md`:
     `python3 skills/massa-th0th/scripts/lessons.py --root . add --feature "<slug>" --signal "<signal>" --source "<ref>" --text "<one terse lesson>"`
   - Apply the Mandatory Verification Fix Gate from `references/verification-ladder.md`: run the report's Verification Suggestion or an equivalent deterministic command/artifact check for each selected finding or coherent group.
   - A finding cannot be marked `fixed` when a target-relevant command or artifact check exists but was not attempted; if verification cannot run, mark it `blocked`, `deferred`, or `skipped` with an allowed skipped-check reason.
   - Run the report's verification suggestion when available.
   - Run targeted tests, type checks, lint/static checks, or import checks relevant to touched files.
   - Perform a focused diff review for touched identifiers and confirm generic names are either replaced with precise domain/role names or justified by narrow conventional scope.
   - Check validation assets were not weakened unless explicitly requested.
   - Record command/artifact, result, skipped reason or `none`, highest Verification Ladder level reached, validation assets protected, and residual risk.
12. At completion, persist only durable knowledge:
   - Repeated anti-patterns, accepted quality exceptions, project-specific refactoring recipes, or reusable checks after scoring with the Importance Calibration System.
   - Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:code-quality-fix`, `entity:<entity>`, and one `memory:<tier>` tag.
13. Complete the Evidence Gate from `references/evidence-gate.md`.

## Examples

User asks: "Use code-quality-fix to fix latest findings for billing services."

1. Confirm target focus is `billing services`, then read the latest matching `audits/code-quality/* code-quality-audit.md`.
2. Validate metadata, target focus, freshness, required fields, and current evidence before editing.
3. Execute confirmed non-suspect findings by severity and behavior risk.
4. Prefer delete/inline/rename/extract before introducing new abstractions.
5. Verify behavior and validation assets after each finding group.

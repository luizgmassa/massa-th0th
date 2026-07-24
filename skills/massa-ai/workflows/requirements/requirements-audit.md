### Requirements Audit

Use this workflow for findings-only review of whether a concrete target matches stated requirements without out-of-scope drift. Accepted targets include modified files, explicit files/globs, commit ranges, branch comparisons, modules/packages, symbols/classes/functions, feature/runtime flows, explicitly requested whole-repo scope, or an implementation scope packet supplied by `workflows/implementation/implementation-audit.md`.

Do not use this workflow for generic correctness bugs, security findings, architecture findings, code quality findings, or test coverage findings. Route correctness bugs to `workflows/bugs/bugs-audit.md` and route the other categories to their dedicated workflows.

This workflow is findings-only. Do not edit code unless the user separately asks for fixes.

1. Resolve/reuse `workflowSessionId`: `requirements-[entity]`
2. Load shared references:
   - `references/codebase-investigation.md`
   - `references/audit-scope.md`
   - `references/audit-report-io.md` before writing the final direct audit report
   - `references/context-firewall.md` before inspecting large diffs, specs, issue text, generated reports, or broad search output
   - `references/synapse-policy.md` when repeated massa-ai searches are expected
   - `references/agent-orchestration.md` only for large scopes, explicit parallel/subagent requests, PR subagent invocation, or independent verification of high-impact findings
3. `recall` -> load prior product decisions, accepted requirements, ADRs, scope constraints, known regressions, project patterns, and accepted exceptions for the target area.
   - Apply the Memory Freshness Gate from `references/audit-scope.md`; recalled exceptions are leads, not proof.
4. Establish the investigation scope before proceeding:
   - Modified files scope: use when the user says modified files, changed files, current changes, uncommitted changes, staged changes, or unstaged changes.
   - Explicit files/globs scope: use when the user names files, directories, or globs.
   - Commit range scope: use when the user provides commits/ranges or asks for commits made by me, my branch commits, or requirement drift introduced by branch commits.
   - Branch comparison scope: use when the user names base/head branches, refs, or a branch diff.
   - Codebase area scope: use when the user names a path, module, package, feature area, user journey, or glob.
   - Symbol/class/function scope: use when the user names public classes, functions, APIs, handlers, or exported surfaces.
   - Feature/flow scope: use when the user names a runtime flow, user journey, or feature area.
   - Whole-repo scope: use only when the user explicitly asks for a whole-repo requirements audit.
   - Implementation parent scope: use only when `workflows/implementation/implementation-audit.md` invokes this workflow with a concrete implementation scope packet.
   - Requirements source scope: use provided prompt text, PR description, issue text, task file, spec, RFC, ADR, acceptance criteria, or README section as the expected behavior source.
   - If the target focus is missing, vague, or too broad, ask for a concrete target from the supported scope types in `references/audit-scope.md`.
   - If requirements source is missing after checking the prompt, PR description, task file, spec, issue text, and repo docs, ask for the requirements source before proceeding.
   - Build the shared scope packet from `references/audit-scope.md` and carry it into the report.
5. For modified files scope:
   - Include staged and unstaged tracked files from the working tree.
   - Include untracked non-generated source, test, fixture, schema, config, and docs files only when they can affect required behavior.
   - Exclude deleted files unless their deletion can break required behavior, imports, exports, routing, migrations, config, tests, packaging, or documentation contracts.
   - Exclude generated, dependency, build, log, cache, temporary, and secret paths per repo rules.
   - Inspect diffs first, then only the surrounding code needed to compare implementation against requirements.
6. For commit range scope:
   - If the user supplied explicit commits or a revision range, use that exact range.
   - If the user asked for commits made by me, resolve author identity from `git config user.email`; if empty, use `git config user.name`.
   - For branch-relative commit scopes, resolve the branch base from the upstream merge-base first, then fall back in order to `origin/main`, `origin/master`, `main`, and `master`.
   - If the user asked for commits made by me, review branch-unique commits authored by the resolved identity.
   - If no explicit range, required author identity, or branch base can be resolved, ask the user for the missing value before proceeding.
   - Inspect changed files and diffs from those commits, then requirements sources, callers, tests, config, schemas, and docs only as needed.
7. For codebase area scope:
   - Require a concrete path, module, package, feature area, or glob.
   - If the target area is missing, ask for it before proceeding.
   - Follow the shared retrieval order from `references/codebase-investigation.md` to find entry points, public API, tests, config, docs, and acceptance criteria.
8. For explicit files/globs, branch comparison, symbol/class/function, feature/flow, or explicitly requested whole-repo scope:
   - Resolve the target with `references/audit-scope.md` and record the resolution method, base/head when relevant, resolved files, exclusions, requirements source, and freshness timestamp.
   - For symbol/class/function targets, inspect definitions, call paths, public contracts, tests, config, docs, and requirement links only as needed.
   - For feature/flow targets, map expected behavior from the requirements source to implementation, tests, docs, and public contracts.
   - If whole-repo scope is requested, map top-level requirement areas first and report skipped depth checks rather than implying exhaustive coverage.
9. For implementation parent scope:
   - Accept the exact scope packet and requirement source from `implementation-audit`.
   - Do not broaden beyond resolved files, surrounding code, public contracts, tests, config, docs, and requirements needed to verify a claim.
   - Return compact findings to the parent implementation audit; do not write broad project memories unless explicitly assigned.
10. Investigation pass. Dispatch `audit-specialist` per `references/agent-orchestration.md` when the scope justifies an isolated read-only subagent:

> **Dispatch: audit-specialist** — see `skills/agents/audit-specialist/SKILL.md`
> - trigger: large scope, explicit parallel/subagent request, PR subagent invocation, or independent verification of high-impact finding
> - scope: the requirements audit target — files, contracts, specs, acceptance criteria
> - permissions: read-only
> - inputs: shared scope packet; `lens: requirements`; requirement source, recalled requirements decisions, accepted exceptions
> - sensors: build requirement checklist from source; trace implementation vs spec; coverage gap, ambiguity, contradiction, implicit-need detection
> - output: findings with requirement gap, location, evidence, severity, confidence, simplest fix direction, verification suggestion
> - firewall: raw diffs/logs/search output summarized, not returned raw
> - memory: suggest-only; main agent persists reusable requirements patterns

    - Build a requirement checklist from the source: must-have behavior, non-goals, acceptance criteria, compatibility constraints, inputs, outputs, and user-visible promises.
   - Compare implementation and tests against each checklist item.
   - Prioritize missing requirements, contradicted requirements, out-of-scope behavior, changed public contracts, compatibility breaks, incomplete edge cases, and docs or tests that misrepresent delivered behavior.
   - For each candidate finding, record the concrete claim, source evidence, affected requirement, impacted flow, provisional severity, and what would disprove it.
11. False-positive pass:
   - Try to disprove every candidate before reporting it.
   - Check requirement wording, accepted scope changes, ADRs, feature flags, compatibility notes, tests, docs, call paths, and user-provided constraints.
   - Drop candidates disproven by evidence, downgrade candidates with partial mitigation, and mark low-confidence findings explicitly.
12. Severity rules (apply the countable threshold first, then the qualitative clause):
   - `critical`: implementation violates a mandatory requirement in a way that blocks release, causes data loss, breaks auth/privacy, OR affects >10 files; otherwise use the qualitative clause below.
   - `high`: missing or contradictory core requirement, significant out-of-scope behavior, public contract break, or major compatibility regression.
   - `medium`: incomplete edge-case requirement, unclear acceptance gap, recoverable behavior mismatch (<=10 affected files), missing required docs/test coverage around a requirement, or scoped regression.
   - `low`: minor requirement ambiguity, wording mismatch, low-impact out-of-scope behavior, incomplete evidence, or weakly supported concern.
13. Final report:
   - Findings first, ordered by severity: `critical`, `high`, `medium`, `low`.
   - Each finding must use `REQ-<N>` and include the canonical fields from `references/audit-report-io.md`: severity, confidence, requirement source, requirement ID or quote, requirement gap type, file/line, evidence, impact, simplest fix direction, and verification suggestion.
   - If no requirements findings are found, say that clearly and list scope checked, requirement source used, and skipped checks.
   - Include ruled-out candidates when they were plausible enough to matter.
   - Include scope checked, deterministic evidence or skipped-check notes, memory outcome, and residual risk.
   - Include the Verification/Test Fidelity Checklist from `references/audit-report-io.md`; tie every `REQ-*` finding or no-finding claim to deterministic sensors, commands/artifacts, results, validation assets, or skipped-check reasons. Model judgment alone cannot satisfy verification/testing all-clear.
   - For direct top-level invocation, use the Plan Mode save rule and canonical report contract from `references/audit-report-io.md` for `audits/requirements/<YYYY-MM-DD requirements-audit>.md`.
   - For implementation audit child invocation, return compact findings to the parent unless the parent explicitly requests saved audit artifacts.
14. Persist only durable knowledge:
   - Do not persist one-off findings.
   - Persist durable requirements decisions, accepted scope constraints, repeated requirement-drift patterns, or reusable verification recipes after scoring with the Importance Calibration System.
   - Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:requirements-audit`, `entity:<entity>`, and one `memory:<tier>` tag.
15. Complete the Evidence Gate from `references/evidence-gate.md`.

## Examples

User asks: "Check modified files against the task requirements."

1. Use `workflowSessionId=requirements-modified-files`.
2. Resolve requirements from the prompt, task file, issue, PR description, or provided spec.
3. Scope to staged, unstaged, and relevant untracked files.
4. Report missing requirements and out-of-scope drift by severity.

User asks: "Audit this PR against its description."

1. Use `workflowSessionId=requirements-pr`.
2. Scope to the PR diff and use the PR description as the requirements source.
3. Return compact findings to the parent implementation audit when invoked as a subagent.

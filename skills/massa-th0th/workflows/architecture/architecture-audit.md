### Architecture Audit

Use this workflow for findings-only audit of domain boundaries, bounded contexts, DDD strategic design, coupling, dependency health, architecture review, deepening opportunities, seams, adapters, module depth, and architecture-focused refactor planning in a concrete target: modified files, explicit files/globs, commit ranges, branch comparisons, modules/packages, symbols/classes/functions, feature/runtime flows, explicitly requested whole-repo scope, or an implementation scope packet supplied by `workflows/implementation/implementation-audit.md`.

Do not use this workflow for plain SOLID, Clean Code, KISS, YAGNI, DRY, or code smell scans; use `workflows/code-quality/code-quality-audit.md` for those.

This workflow is findings-only. Do not edit code unless the user separately asks for fixes.

1. Resolve/reuse `workflowSessionId`: `architecture-[entity]`
2. Load shared references:
   - `references/codebase-investigation.md`
   - `references/audit-scope.md`
   - `references/architecture-lenses.md`
   - `references/architecture-domain-lens.md` only when scope includes bounded contexts, subdomains, ubiquitous language, cohesion, or integration pattern claims
   - `references/architecture-coupling-lens.md` only when scope includes dependencies, imports, service calls, shared schemas/models, persistence reach-through, co-change, or contract leakage
   - `references/architecture-deepening-lens.md` only when scope includes module depth, seams, adapters, deletion tests, locality, testability, or AI-navigability
   - `references/audit-report-io.md` before writing the final direct audit report
   - `references/context-firewall.md` before inspecting large diffs, dependency graphs, generated reports, or broad search output
   - `references/synapse-policy.md` when repeated th0th searches are expected
   - `references/agent-orchestration.md` only for large scopes, explicit parallel/subagent requests, PR subagent invocation, isolated audit slices, or independent verification of high-impact findings
3. `th0th_recall` -> load ADRs, architecture decisions, known boundaries, coupling patterns, accepted exceptions, project constraints, and prior rejected refactors for the target area.
   - Apply the Memory Freshness Gate from `references/audit-scope.md`; recalled exceptions are leads, not proof.
4. Establish the investigation scope before proceeding:
   - Modified files scope: use when the user says modified files, changed files, current changes, uncommitted changes, staged changes, or unstaged changes.
   - Explicit files/globs scope: use when the user names files, directories, or globs.
   - Commit range scope: use when the user provides commits/ranges or asks for commits made by me, my branch commits, or architecture issues introduced by branch commits.
   - Branch comparison scope: use when the user names base/head branches, refs, or a branch diff.
   - Codebase area scope: use when the user names a path, module, package, bounded context, feature area, architecture question, or glob.
   - Symbol/class/function scope: use when the user names exported surfaces, classes, functions, adapters, interfaces, or dependency edges.
   - Feature/flow scope: use when the user names a runtime flow or cross-module feature.
   - Whole-repo scope: use only when the user explicitly asks for a whole-repo architecture audit.
   - Implementation parent scope: use only when `workflows/implementation/implementation-audit.md` invokes this workflow with a concrete implementation scope packet.
   - If the target focus is missing, vague, or too broad, ask for a concrete target from the supported scope types in `references/audit-scope.md`.
   - Build the shared scope packet from `references/audit-scope.md` and carry it into the report.
5. For modified files scope:
   - Include staged and unstaged tracked files from the working tree.
   - Include untracked non-generated source, test, fixture, schema, config, and docs files only when they can affect architecture contracts or module boundaries.
   - Exclude deleted files unless their deletion can break imports, exports, routing, migrations, config, tests, packaging, or architecture contracts.
   - Exclude generated, dependency, build, log, cache, temporary, and secret paths per repo rules.
   - Inspect diffs first, then only the surrounding code needed to understand architecture behavior.
6. For commit range scope:
   - If the user supplied explicit commits or a revision range, use that exact range.
   - If the user asked for commits made by me, resolve author identity from `git config user.email`; if empty, use `git config user.name`.
   - For branch-relative commit scopes, resolve the branch base from the upstream merge-base first, then fall back in order to `origin/main`, `origin/master`, `main`, and `master`.
   - If the user asked for commits made by me, review branch-unique commits authored by the resolved identity.
   - If no explicit range, required author identity, or branch base can be resolved, ask the user for the missing value before proceeding.
   - Inspect changed files and diffs from those commits, then exported surfaces, references, dependency direction, tests, config, and ADRs only as needed.
7. For codebase area scope:
   - Require a concrete path, module, package, feature area, architecture question, or glob.
   - If the target area is missing, ask for it before proceeding.
   - Follow the shared retrieval order from `references/codebase-investigation.md` to find target modules, entry points, exported surfaces, references, semantic hotspots, tests, and adjacent config.
   - If scope is broad, map only top-level modules first and ask or recommend a narrower second pass.
8. For explicit files/globs, branch comparison, symbol/class/function, feature/flow, or explicitly requested whole-repo scope:
   - Resolve the target with `references/audit-scope.md` and record the resolution method, base/head when relevant, resolved files, exclusions, and freshness timestamp.
   - For symbol/class/function targets, verify definitions, references, dependency direction, exported surfaces, callers, tests, and ADRs only as needed for architecture claims.
   - For feature/flow targets, map entry points through main transformations, contracts, and side effects before applying architecture lenses.
   - If whole-repo scope is requested, map top-level modules first and report skipped depth checks rather than pretending exhaustive coverage.
9. For implementation parent scope:
   - Accept the exact scope packet from `implementation-audit`; do not broaden beyond resolved files, surrounding code, exported surfaces, references, config, tests, and ADRs needed to verify an architecture claim.
   - Return compact findings to the parent implementation audit; do not write broad project memories unless explicitly assigned.
10. Investigation pass:
   - Apply the smallest relevant lens set from `references/architecture-lenses.md` and load detail references only when their evidence is needed:
     - Domain lens: subdomains, bounded contexts, ubiquitous language, cohesion score, colliding concepts, cross-domain ownership, and integration pattern fit.
     - Coupling lens: dependency graph, knowledge direction, integration strength, distance, volatility, balance table result, and contract health.
     - Deepening lens: module/interface/seam/adapter vocabulary, shallow modules, deletion test, dependency category, locality, leverage, and interface-as-test-surface evidence.
   - Use `th0th_search_definitions` and `th0th_get_references` to verify exported surfaces and dependency direction where needed.
   - Capture positive architecture patterns when they materially disprove a concern, such as versioned contracts, anti-corruption layers, cohesive local coupling, or a deep interface that concentrates tests.
   - For each candidate finding, record the concrete claim, source evidence, lens-specific evidence, impacted boundary or module, provisional severity, tradeoff, simplest sufficient direction, and what would disprove it.
11. False-positive pass:
   - Try to disprove every candidate before reporting it.
   - Check ADRs, accepted exceptions, current domain docs, dependency direction, call paths, tests, package boundaries, framework constraints, git history when cheap, and prior rejected refactors.
   - Treat recalled memories and standalone skill heuristics as leads, not proof.
   - Do not report domain truth inferred only from code names as fact; mark it `suspect` or report the evidence gap.
   - Do not report strong coupling as a defect when strength is local, stable, or cohesive and no change friction is shown.
   - Do not recommend ports/adapters, service extraction, VSA migration, or new seams unless evidence shows real variation, volatility, external dependency pressure, or boundary friction.
   - Drop candidates disproven by evidence, downgrade candidates with partial mitigation, and mark judgment-heavy conclusions as `suspect`.
   - When you reject a refactor candidate, record its load-bearing reason in ruled-out candidates; if it is likely to be re-proposed, offer an ADR via `workflows/adr.md` so the rejection is not re-litigated next audit.
12. Use agent orchestration only when it improves signal. Dispatch per `references/agent-orchestration.md`:

> **Dispatch: architecture-specialist** — see `skills/agents/architecture-specialist/SKILL.md`
> - trigger: large scope, explicit parallel/subagent request, PR subagent invocation, isolated audit slice, or independent verification of high-impact finding
> - scope: exact files/modules/boundaries in the audit target
> - permissions: read-only
> - inputs: shared scope packet; lens sub-mode (`domain` for bounded-context mapping, `coupling` for dependency-graph/strength/distance/volatility, `deepening` for module-depth opportunities); recalled ADRs and rejected refactors
> - sensors: `th0th_search_definitions` / `th0th_get_references` for exported surfaces and dependency direction; source inspection against current files
> - output: findings with lens-specific evidence, provisional severity, tradeoff, and what would disprove it
> - firewall: raw dependency graphs, generated reports, and broad search output summarized, not returned raw
> - memory: suggest-only; main agent persists accepted constraints/rejected refactors

> **Dispatch: verification-agent** — see `skills/agents/verification-agent/SKILL.md`
> - trigger: independent verification of a high-impact architecture finding
> - scope: the specific finding's claimed evidence and affected boundary/module
> - permissions: read-only
> - inputs: the candidate finding, its source evidence, ADRs, accepted exceptions, and the verification suggestion
> - sensors: deterministic command or artifact check that would falsify the finding
> - output: confirmed/disproven verdict with evidence; skipped-check reason if the sensor cannot run
> - firewall: raw logs/snapshots summarized
> - memory: suggest-only; main agent persists reusable verification recipes
13. Severity rules (apply the countable threshold first, then the qualitative clause):
   - `critical`: architecture issue likely causes data loss, auth/privacy break, production outage, irreversible corruption, OR affects >10 files; otherwise use the qualitative clause below.
   - `high`: strong coupling with high volatility, boundary violation, dependency inversion break, or shallow module design likely to cause major change friction or regression.
   - `medium`: meaningful but recoverable coupling, unclear boundary, missing seam, duplicated architecture rule, or module-depth issue with localized impact (<=10 affected files, recoverable).
   - `low`: architecture hardening opportunity, low-impact naming/layering issue, incomplete evidence, or weakly supported concern.
14. Final report:
   - Findings first, ordered by severity.
   - Each finding must use `ARCH-<N>` and include the canonical fields from `references/audit-report-io.md`: lens, boundary/module, tradeoff, dependency direction when relevant, severity, confidence, file/module, concrete evidence, impact, simplest sufficient fix, and verification suggestion.
   - Mark uncertain or judgment-heavy conclusions as `suspect`.
   - Do not relitigate ADR-backed decisions unless current evidence shows real friction worth reopening.
   - Prefer merge, inline, move, or clarify-seam recommendations before adding new abstractions.
   - Include lens-specific evidence in existing fields: domain findings should name language/cohesion/integration evidence; coupling findings should name strength/distance/volatility and dependency direction; deepening findings should name interface complexity, deletion-test result, dependency category, and test-surface impact.
   - If no architecture findings are found, say that clearly and list scope checked plus skipped checks.
   - Include ruled-out candidates when they were plausible enough to matter.
   - Include scope checked, deterministic evidence or skipped-check notes, memory outcome, and residual risk.
   - Include the Verification/Test Fidelity Checklist from `references/audit-report-io.md`; tie every `ARCH-*` finding or no-finding claim to deterministic sensors, commands/artifacts, results, validation assets, or skipped-check reasons. Model judgment alone cannot satisfy verification/testing all-clear.
   - For direct top-level invocation, use the Plan Mode save rule and canonical report contract from `references/audit-report-io.md` for `audits/architecture/<YYYY-MM-DD architecture-audit>.md`.
   - For implementation audit child invocation, return compact findings to the parent unless the parent explicitly requests saved audit artifacts.
15. Persist only durable knowledge:
   - Persist accepted architecture constraints, repeated coupling patterns, accepted exceptions, rejected refactors, or reusable verification recipes.
   - Do not persist every one-off finding.
   - Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:architecture-audit`, `entity:<entity>`, and one `memory:<tier>` tag.
16. Complete the Evidence Gate from `references/evidence-gate.md`.

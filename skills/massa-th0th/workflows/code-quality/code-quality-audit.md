### Code Quality Audit

Use this workflow for findings-only audit of SOLID, Clean Code, KISS, YAGNI, DRY, maintainability, overengineering, code smell, or violations-check issues in a concrete target: modified files, explicit files/globs, commit ranges, branch comparisons, modules/packages, symbols/classes/functions, feature/runtime flows, explicitly requested whole-repo scope, or an implementation scope packet supplied by `workflows/implementation/implementation-audit.md`.

Do not use this workflow for domain boundaries, bounded contexts, coupling analysis, module depth, seams, adapters, or architecture refactor opportunities. Route those to `workflows/architecture/architecture-audit.md`. Keep local pass-through wrappers, unused speculation, vague names, duplicate literals, and simple overengineering here when the finding does not require architecture-lens evidence.

This workflow is findings-only. Do not edit code unless the user separately asks for fixes.

1. Resolve/reuse `workflowSessionId`: `quality-[entity]`
2. Load shared references:
   - `references/codebase-investigation.md`
   - `references/audit-scope.md`
   - `references/audit-report-io.md` before writing the final direct audit report
   - `references/context-firewall.md` before inspecting large diffs, logs, snapshots, generated reports, or broad search output
   - `references/mobile-context.md` when scope includes Android Jetpack Compose or KMP Compose Multiplatform files, source sets, compiler reports, UI tests, screenshot tests, or runtime evidence
   - `references/naming-standards.md` when evaluating generic names, domain vocabulary, public contract names, or rename recommendations
   - `references/synapse-policy.md` when repeated th0th searches are expected
   - `references/agent-orchestration.md` only for large scopes, explicit parallel/subagent requests, PR subagent invocation, or independent verification of high-impact findings
3. `th0th_recall` -> load project style rules, ADRs, prior quality decisions, accepted extension points, repeated anti-patterns, and accepted exceptions for the target area.
   - Apply the Memory Freshness Gate from `references/audit-scope.md`; recalled exceptions are leads, not proof.
4. Establish the investigation scope before proceeding:
   - Modified files scope: use when the user says modified files, changed files, current changes, uncommitted changes, staged changes, or unstaged changes.
   - Explicit files/globs scope: use when the user names files, directories, or globs.
   - Commit range scope: use when the user provides commits/ranges or asks for commits made by me, my branch commits, or quality issues introduced by branch commits.
   - Branch comparison scope: use when the user names base/head branches, refs, or a branch diff.
   - Codebase area scope: use when the user names a path, module, package, feature area, service layer, or glob.
   - Symbol/class/function scope: use when the user names public classes, functions, interfaces, helpers, or exported surfaces.
   - Feature/flow scope: use when the user names a runtime flow or feature area.
   - Whole-repo scope: use only when the user explicitly asks for a whole-repo code quality audit.
   - Implementation parent scope: use only when `workflows/implementation/implementation-audit.md` invokes this workflow with a concrete implementation scope packet.
   - If the target focus is missing, vague, or too broad, ask for a concrete target from the supported scope types in `references/audit-scope.md`.
   - Build the shared scope packet from `references/audit-scope.md` and carry it into the report.
5. For modified files scope:
   - Include staged and unstaged tracked files from the working tree.
   - Include untracked non-generated source, test, fixture, schema, config, and docs files only when they can affect maintainability, validation behavior, or public contracts.
   - Exclude deleted files unless their deletion can break imports, exports, routing, migrations, config, tests, or packaging.
   - Exclude generated, dependency, build, log, cache, temporary, and secret paths per repo rules.
   - Inspect diffs first, then only the surrounding code needed to understand quality claims.
6. For commit range scope:
   - If the user supplied explicit commits or a revision range, use that exact range.
   - If the user asked for commits made by me, resolve author identity from `git config user.email`; if empty, use `git config user.name`.
   - For branch-relative commit scopes, resolve the branch base from the upstream merge-base first, then fall back in order to `origin/main`, `origin/master`, `main`, and `master`.
   - If the user asked for commits made by me, review branch-unique commits authored by the resolved identity.
   - If no explicit range, required author identity, or branch base can be resolved, ask the user for the missing value before proceeding.
   - Inspect changed files and diffs from those commits, then surrounding code, callers, tests, config, and public API only as needed.
7. For codebase area scope:
   - Require a concrete path, module, package, feature area, or glob.
   - If the target area is missing, ask for it before proceeding.
   - Follow the shared retrieval order from `references/codebase-investigation.md` to find target modules, semantic hotspots, public API, tests, and adjacent config.
8. For explicit files/globs, branch comparison, symbol/class/function, feature/flow, or explicitly requested whole-repo scope:
   - Resolve the target with `references/audit-scope.md` and record the resolution method, base/head when relevant, resolved files, exclusions, and freshness timestamp.
   - For symbol/class/function targets, inspect definitions, references, call sites, tests, and current usage evidence before reporting quality claims.
   - For feature/flow targets, map the main code path only as far as needed to identify local maintainability or overengineering issues.
   - If whole-repo scope is requested, report sampled/top-level coverage and skipped deep checks instead of implying exhaustive review.
9. For implementation parent scope:
   - Accept the exact scope packet from `implementation-audit`; do not broaden beyond resolved files, surrounding code, public API, tests, config, and project patterns needed to verify a quality claim.
   - Return compact findings to the parent implementation audit; do not write broad project memories unless explicitly assigned.
10. Input rules:
   - SOLID inputs: non-test source files only.
   - Clean Code inputs: test and non-test source files.
   - KISS/YAGNI/DRY inputs: test and non-test source files, plus docs/config only when they define behavior or public contracts.
   - Architecture boundary guard:
     - Keep local quality issues in this workflow when the fix is delete, inline, rename, extract a constant, collapse a trivial wrapper, simplify control flow, or consolidate duplicated local rules.
     - Route to `workflows/architecture/architecture-audit.md` when the claim needs bounded-context language, dependency direction, strength/distance/volatility, module depth, seam placement, adapter reality, or cross-domain ownership evidence.
     - If unsure, report as `suspect` only when concrete local maintainability evidence exists; otherwise recommend an architecture-audit follow-up instead of forcing a CQ finding.
11. Decide whether to use agent orchestration:
   - Load it only for large PRs, codebase-wide audits, explicit parallel/subagent requests, or independent verification of judgment-heavy findings.
   - Keep the audit local for small scopes, unresolved user intent, tightly coupled code without clear owners, or platforms that do not permit subagents.
   - The main agent still owns scope, memory recall, static leads, synthesis, final report, persistence, and Evidence Gate.
   - If delegating, use bounded read-only slices with exact scope and output contracts. Quality-lens slices may include `solid-auditor` for non-test source, `clean-code-auditor` for test and non-test source, and `simplicity-auditor` for KISS/YAGNI.
   - Do not delegate every check by default; avoid duplicate source reading when one main-agent pass is cheaper.
   - Subagents may suggest memory content, but the main agent decides what durable knowledge to persist.
12. Gather deterministic leads with static scans where useful:
   - Type-tag branches: `switch`, `case`, `if/else if`, discriminant fields such as `type`, `kind`, `variant`, `mode`.
   - Concrete construction: `new [A-Z]` inside class or service bodies.
   - Half-finished surfaces: `TODO`, `implement later`, exported stubs, `return null`, empty method bodies.
   - Comments: lines starting with code-restating comments.
   - Magic values: repeated strings, event names, timeouts, numeric thresholds, status codes.
   - Generic names: `data`, `info`, `result`, `value`, `temp`, `manager`, `handler`, `helper` without useful qualification, using `references/naming-standards.md` to filter conventional short-scope or framework-required names.
   - Long parameter lists: more than 3-4 positional parameters.
   - Needlessly indirect code: pass-through wrappers, one-use abstractions, helper layers with no behavior, factories/builders that only hide one constructor call.
   - Speculative surfaces: unused options, future-oriented hooks, extension points with one implementation, exported APIs with no evidence of use.
   - Complexity without payoff: deep nesting, miniature state machines, or polymorphism where a direct branch or data map would preserve clarity.
   - AI-slop surfaces: generic abstractions with no domain vocabulary, fabricated-looking type names, unnecessary factories/builders, wrappers around one call, comments that narrate obvious code, and broad configurability not supported by current requirements.
   - Android/KMP Compose recomposition leads: `@Composable`, `remember`, `rememberSaveable`, `derivedStateOf`, `LaunchedEffect`, `DisposableEffect`, `SideEffect`, `produceState`, `snapshotFlow`, `mutableStateOf`, `SnapshotStateList`, stability annotations/config, Compose compiler reports, Compose UI tests, and screenshot tests.
13. Investigation pass:
   - Use summary/enriched search, symbol tools, and targeted file reads to inspect target modules, semantic hotspots, public classes, interfaces, functions, and exported API surface.
   - Apply SOLID checks to non-test source only:
     - Single Responsibility: flag classes/modules with distinct concern groups, such as validation plus persistence or formatting plus dispatch.
     - Open/Closed: flag caller-side switches or if/else chains on type tags where adding a variant requires modifying existing files.
     - Liskov: flag subtypes that throw where the base does not, ignore required methods, or narrow the base contract.
     - Interface Segregation: flag interfaces that force implementors to define unused methods.
     - Dependency Inversion: flag hardcoded `new ConcreteType()` inside class bodies where abstraction or injection would be natural.
   - Apply Clean Code checks to test and non-test source:
     - Magic values: meaningful bare literals should be named constants, especially repeated strings, timeouts, thresholds, and event names.
     - Function does more than one thing: if accurate description needs "and", recommend splitting.
     - Unqualified generic names: flag vague names without domain or role qualification.
     - What-comments: flag comments that restate code; keep only why comments for constraints, workarounds, or non-obvious invariants.
     - Half-finished surfaces: flag exported TODOs, stubs, placeholder returns, and "implement later" code.
     - Long parameter lists: flag more than 3-4 positional parameters; suggest an options object.
   - Apply KISS/YAGNI/DRY checks:
     - KISS: flag abstractions, layers, indirection, or control flow that increase cognitive load without clearly improving readability, correctness, or constraint handling. Call out premature generalization, deep call chains, excessive configuration, and clever patterns that obscure intent. Prefer straightforward, explicit code that a new reader can follow end-to-end. Simplify by inlining trivial abstractions, collapsing unnecessary layers, and choosing boring solutions unless complexity is justified (e.g., real variability, hard constraints, or measured bottlenecks).
     - YAGNI: flag speculative features, extension points, and generic infrastructure that have no concrete caller, requirement, or near-term use. Call out “just in case” hooks, over-parameterization, unused toggles, and frameworks introduced ahead of need. Prefer implementing only what current use cases demand, with code structured so it can evolve when real requirements appear. Defer generalization until duplication or constraints make it necessary, and remove dead or unused paths aggressively.
     - DRY: flag duplicated logic, data transformations, or domain rules that appear in multiple places without a strong reason (e.g., performance isolation or explicit decoupling). Highlight copy-paste patterns, parallel conditionals, and repeated constants that increase maintenance cost or risk of inconsistency. Recommend consolidation into a single source of truth when it improves clarity and reduces bugs, but avoid over-abstraction that harms readability or introduces indirection for trivial reuse.
     - Prefer delete, inline, or merge recommendations over replacement abstractions when simpler code preserves behavior.
     - Require usage evidence before calling a surface unnecessary; if evidence is incomplete, mark the item `suspect`.
     - Do not recommend ports, adapters, bounded contexts, new service/module boundaries, or VSA migration from this workflow; hand those to architecture-audit.
   - For Android Jetpack Compose and KMP Compose Multiplatform code, apply recomposition quality checks from `references/mobile-context.md`:
     - Excessive recomposition risk: unstable parameters, mutable collections or mutable models crossing composable boundaries, expensive work in composition, unremembered lambdas/objects, inappropriate `derivedStateOf`, broad state reads, and backwards writes after state reads.
     - Missing recomposition or stale UI risk: non-observable mutation, missing or wrong `remember`/effect keys, stale captured lambdas that need `rememberUpdatedState`, incorrect stability annotations, and risky stability configuration entries that can make UX updates fail to happen.
     - Keep these as `CQ-*` findings only when concrete source evidence ties the pattern to UX jank, stale UI, broken interaction feedback, accessibility/state restoration risk, or maintainability cost.
     - Mark semantic recomposition claims as `suspect` unless supported by Compose compiler stability/skippability reports, existing Compose UI tests, screenshot tests, benchmark/runtime traces, or a clear deterministic static source pattern.
     - Verification suggestions should name the cheapest available sensor: Compose compiler metrics/reports, focused Compose UI test, screenshot/golden test, instrumentation/emulator check, or static lint/build command.
   - For each candidate finding, record the concrete claim, source evidence, impacted maintainability or change-risk flow, provisional severity, and what would disprove it.
14. False-positive pass:
   - Try to disprove every candidate before reporting it.
   - Check framework-required signatures, public SDK or plugin surfaces, ADR-backed extension points, test fixtures/builders, harmless local literals, intentionally tiny adapters, usage evidence, and accepted exceptions.
   - Drop candidates disproven by evidence, downgrade candidates with partial mitigation, and mark judgment-heavy items as `suspect`.
15. Severity rules (apply the countable threshold first, then the qualitative clause):
   - `critical`: quality issue likely causes production outage, data loss, auth/privacy break, OR affects >10 files; otherwise use the qualitative clause below.
   - `high`: strong SOLID/Clean Code/KISS/YAGNI/DRY violation with high change volatility likely to cause major regression, repeated bugs, or high-cost change friction.
   - `medium`: real maintainability issue, speculative surface, duplicated rule, weak naming/comment pattern, or avoidable complexity with localized impact (<=10 affected files).
   - `low`: minor hardening opportunity, low-impact cleanup, incomplete evidence, or weakly supported concern.
16. Final report:
   - Findings first, ordered by severity.
   - Each finding must use `CQ-<N>` and include the canonical fields from `references/audit-report-io.md`: rule, current shape, simplest safe transformation, severity, confidence, file/line, concrete evidence, impact, simplest sufficient fix, and verification suggestion.
   - For Android/KMP Compose recomposition findings, include whether the risk is excessive recomposition or missing/stale recomposition, the affected composable or state boundary, UX impact, confidence, and the deterministic sensor that would prove or disprove the claim.
   - Mark judgment-heavy items as `suspect` instead of fact.
   - Avoid false positives for framework-required signatures, public SDK or plugin surfaces, ADR-backed extension points, test fixtures/builders, harmless local literals, and intentionally tiny adapters.
   - If a candidate turns on domain language, coupling dimensions, or seam placement, do not force it into `CQ-<N>`; list it as skipped architecture scope or recommend `architecture-audit`.
   - If no findings, say what scope was checked and which checks were skipped.
   - Include ruled-out candidates when they were plausible enough to matter.
   - Include scope checked, deterministic evidence or skipped-check notes, memory outcome, and residual risk.
   - Include the Verification/Test Fidelity Checklist from `references/audit-report-io.md`; tie every `CQ-*` finding or no-finding claim to deterministic sensors, commands/artifacts, results, validation assets, or skipped-check reasons. Model judgment alone cannot satisfy verification/testing all-clear.
   - For direct top-level invocation, use the Plan Mode save rule and canonical report contract from `references/audit-report-io.md` for `audits/code-quality/<YYYY-MM-DD code-quality-audit>.md`.
   - For implementation audit child invocation, return compact findings to the parent unless the parent explicitly requests saved audit artifacts.
17. Persist only durable knowledge:
   - Do not persist one-off findings.
   - Persist repeated anti-patterns, project-specific quality rules, accepted exceptions, or repeated overengineering patterns via `th0th_remember` after scoring with the Importance Calibration System.
   - Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:code-quality-audit`, `entity:<entity>`, and one `memory:<tier>` tag.
18. Complete the Evidence Gate from `references/evidence-gate.md`.

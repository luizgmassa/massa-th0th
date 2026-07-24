### Security Audit

Use this workflow for findings-only security review in a concrete target: modified files, explicit files/globs, commit ranges, branch comparisons, modules/packages, symbols/classes/functions, feature/runtime flows, explicitly requested whole-repo scope, or an implementation scope packet supplied by `workflows/implementation/implementation-audit.md`.

Do not use this workflow for generic correctness bugs; route those to `workflows/bugs/bugs-audit.md`. Do not use it for broad architecture, code quality, requirements, or test coverage audits; route those to their dedicated workflows.

This workflow is findings-only. Do not edit code unless the user separately asks for fixes.

1. Resolve/reuse `workflowSessionId`: `security-[entity]`
2. Load shared references:
   - `references/codebase-investigation.md`
   - `references/audit-scope.md`
   - `references/audit-report-io.md` before writing the final direct audit report
   - `references/mobile-context.md` when the scope touches KMP, iOS, Android, native bridges, mobile permissions, secure storage, biometrics, deep links, push/background behavior, local persistence, offline queues, logs/crash privacy, or backend-mobile contracts
   - `references/context-firewall.md` before inspecting large diffs, logs, snapshots, generated reports, or broad search output
   - `references/synapse-policy.md` when repeated massa-ai searches are expected
   - `references/agent-orchestration.md` only for large scopes, explicit parallel/subagent requests, PR subagent invocation, or independent verification of high-impact findings
3. `recall` -> load prior security decisions, auth boundaries, validation rules, known regressions, project constraints, ADRs, fragile flows, and accepted exceptions for the target area.
   - Apply the Memory Freshness Gate from `references/audit-scope.md`; recalled exceptions are leads, not proof.
4. Establish the investigation scope before proceeding:
   - Modified files scope: use when the user says modified files, changed files, current changes, uncommitted changes, staged changes, or unstaged changes.
   - Explicit files/globs scope: use when the user names files, directories, or globs.
   - Commit range scope: use when the user provides commits/ranges or asks for commits made by me, my branch commits, or security issues introduced by branch commits.
   - Branch comparison scope: use when the user names base/head branches, refs, or a branch diff.
   - Codebase area scope: use when the user names a path, module, package, feature area, trust boundary, or glob.
   - Symbol/class/function scope: use when the user names handlers, middleware, validators, policies, classes, functions, or exported surfaces.
   - Feature/flow scope: use when the user names a runtime flow, user journey, auth path, or data boundary.
   - Whole-repo scope: use only when the user explicitly asks for a whole-repo security audit.
   - Implementation parent scope: use only when `workflows/implementation/implementation-audit.md` invokes this workflow with a concrete implementation scope packet.
   - If the target focus is missing, vague, or too broad, ask for a concrete target from the supported scope types in `references/audit-scope.md`.
   - Build the shared scope packet from `references/audit-scope.md` and carry it into the report.
5. For modified files scope:
   - Include staged and unstaged tracked files from the working tree.
   - Include untracked non-generated source, test, fixture, schema, config, and docs files only when they can affect runtime or validation behavior.
   - Exclude deleted files unless their deletion can break imports, exports, routing, migrations, config, tests, packaging, secrets handling, or policy enforcement.
   - Exclude generated, dependency, build, log, cache, temporary, and secret paths per repo rules.
   - Inspect diffs first, then only the surrounding code needed to understand security behavior.
6. For commit range scope:
   - If the user supplied explicit commits or a revision range, use that exact range.
   - If the user asked for commits made by me, resolve author identity from `git config user.email`; if empty, use `git config user.name`.
   - For branch-relative commit scopes, resolve the branch base from the upstream merge-base first, then fall back in order to `origin/main`, `origin/master`, `main`, and `master`.
   - If the user asked for commits made by me, review branch-unique commits authored by the resolved identity.
   - If no explicit range, required author identity, or branch base can be resolved, ask the user for the missing value before proceeding.
   - Inspect changed files and diffs from those commits, then auth boundaries, callers, tests, config, schemas, and policy definitions only as needed.
7. For codebase area scope:
   - Require a concrete path, module, package, feature area, or glob.
   - If the target area is missing, ask for it before proceeding.
   - Follow the shared retrieval order from `references/codebase-investigation.md` to find entry points, trust boundaries, policy checks, validators, tests, and adjacent config.
8. For explicit files/globs, branch comparison, symbol/class/function, feature/flow, or explicitly requested whole-repo scope:
   - Resolve the target with `references/audit-scope.md` and record the resolution method, base/head when relevant, resolved files, exclusions, and freshness timestamp.
   - For symbol/class/function targets, inspect definitions, call paths, trust boundaries, validators, policies, tests, config, and schemas only as needed.
   - For feature/flow targets, trace untrusted input, identity, authorization, validation, persistence, side effects, and logs through the named flow.
   - If whole-repo scope is requested, map major trust boundaries first and report skipped depth checks rather than implying exhaustive review.
9. For implementation parent scope:
   - Accept the exact scope packet from `implementation-audit`; do not broaden beyond resolved files, surrounding code, called auth/validation helpers, config, schemas, and tests needed to verify a security claim.
   - Return compact findings to the parent implementation audit; do not write broad project memories unless explicitly assigned.
10. Investigation pass. Dispatch `audit-specialist` per `references/agent-orchestration.md` when the scope justifies an isolated read-only subagent:

> **Dispatch: audit-specialist** — see `skills/agents/audit-specialist/SKILL.md`
> - trigger: large scope, explicit parallel/subagent request, PR subagent invocation, or independent verification of high-impact finding
> - scope: the security audit target — files, trust boundaries, auth paths, validators
> - permissions: read-only
> - inputs: shared scope packet; `lens: security`; recalled security decisions, auth boundaries, validation rules, accepted exceptions
> - sensors: trace untrusted input -> validation -> authorization -> transformation -> persistence; authn/authz, object ownership, tenant isolation, input validation, secret handling, injection risks
> - output: findings with security boundary, asset, trigger/exploit path, severity, confidence, evidence, simplest fix direction, verification suggestion
> - firewall: raw diffs/logs/search output summarized, not returned raw
> - memory: suggest-only; main agent persists reusable security patterns

    - Trace untrusted input -> validation -> authorization -> transformation -> persistence or side effect.
   - Check authn/authz, object ownership, tenant isolation, input validation, output encoding, secret handling, cryptography use, SSRF/path traversal/injection risks, logging privacy, dependency/config exposure, and security-sensitive tests.
   - For mobile scopes, check secure storage/keychain/keystore use, permission states, deep links and auth guards, push token handling, biometrics, local DB/cache and offline queues, logs/crash reports/screenshots, native bridge payload trust, and backend-mobile contract skew from `references/mobile-context.md`.
   - For each candidate finding, record the concrete claim, source evidence, impacted asset or boundary, likely trigger, provisional severity, and what would disprove it.
11. False-positive pass:
   - Try to disprove every candidate before reporting it.
   - Check guards, framework defaults, policy layers, middleware order, type checks, tests, feature flags, call paths, existing invariants, ADRs, and accepted exceptions.
   - Use official docs or web research only when current external API, framework, or security behavior matters.
   - Drop candidates disproven by evidence, downgrade candidates with partial mitigation, and mark low-confidence findings explicitly.
12. Severity rules (apply the countable threshold first, then the qualitative clause):
   - `critical`: likely auth bypass, privilege escalation, data exfiltration, secret exposure, remote code execution, tenant break, irreversible data corruption, OR affects >10 files; otherwise use the qualitative clause below.
   - `high`: likely missing authorization, injection risk, sensitive data leak, broken security boundary, unsafe deserialization, or severe config exposure.
   - `medium`: real edge-flow security bug, incomplete validation, privacy leak with limited scope (<=10 affected files), weak cryptographic/config practice with plausible exploitation, or meaningful test gap around security logic.
   - `low`: defensive hardening opportunity, low-impact information exposure, incomplete evidence, or weakly supported concern.
13. Final report:
   - Findings first, ordered by severity: `critical`, `high`, `medium`, `low`.
   - Each finding must use `SEC-<N>` and include the canonical fields from `references/audit-report-io.md`: severity, confidence, file/line, evidence, security boundary, asset, trigger or exploit path, negative test direction, simplest fix direction, and verification suggestion.
   - If no security findings are found, say that clearly and list scope checked plus skipped checks.
   - Include ruled-out candidates when they were plausible enough to matter.
   - Include scope checked, deterministic evidence or skipped-check notes, memory outcome, and residual risk.
   - Include the Verification/Test Fidelity Checklist from `references/audit-report-io.md`; tie every `SEC-*` finding or no-finding claim to deterministic sensors, commands/artifacts, results, validation assets, or skipped-check reasons. Model judgment alone cannot satisfy verification/testing all-clear.
   - For direct top-level invocation, use the Plan Mode save rule and canonical report contract from `references/audit-report-io.md` for `audits/security/<YYYY-MM-DD security-audit>.md`.
   - For implementation audit child invocation, return compact findings to the parent unless the parent explicitly requests saved audit artifacts.
14. Persist only durable knowledge:
   - Do not persist one-off findings.
   - Persist repeated security patterns, project-specific security boundaries, accepted exceptions, or reusable verification recipes after scoring with the Importance Calibration System.
   - Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:security-audit`, `entity:<entity>`, and one `memory:<tier>` tag.
15. Complete the Evidence Gate from `references/evidence-gate.md`.

## Examples

User asks: "Audit modified files for security issues."

1. Use `workflowSessionId=security-modified-files`.
2. Scope to staged, unstaged, and relevant untracked files; exclude generated/dependency/build/log/cache/secret paths.
3. Inspect diffs first, then auth, validation, secret handling, config, and tests around the changed code.
4. Run a false-positive pass before reporting findings.

User asks: "Audit src/auth for security risks."

1. Use `workflowSessionId=security-auth`.
2. Scope to `src/auth` and adjacent policy, middleware, config, schema, and tests needed to verify claims.
3. Report findings by severity with confidence, evidence, impact, and verification suggestions.

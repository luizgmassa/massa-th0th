### Security Fix

Use this workflow only to execute fixes from a security audit markdown report.

Do not use this workflow for findings-only security review; route that to `workflows/security/security-audit.md`. Do not use it for generic correctness fixes unless the security report identifies the correctness issue as part of an exploitable path.

1. Resolve/reuse `workflowSessionId`: `security-fix-[entity]`
2. Load shared references:
   - `references/audit-report-io.md` before any code change
   - `references/lessons.md` to load confirmed project lessons
   - `references/codebase-investigation.md` before changing unfamiliar security boundaries
   - `references/mobile-context.md` when the report target touches KMP, iOS, Android, native bridges, mobile permissions, secure storage, biometrics, deep links, push/background behavior, local persistence, offline queues, logs/crash privacy, or backend-mobile contracts
   - `references/verification-ladder.md` before non-trivial edits
   - `references/context-firewall.md` before inspecting large diffs, logs, generated reports, or broad search output
   - `references/agent-orchestration.md` only for large/high-risk findings, disjoint implementation slices, or independent verification
3. `th0th_recall` -> load auth boundaries, tenant rules, validation conventions, secret-handling policies, accepted exceptions, prior incidents, and verification recipes for the report target.
4. Select the security audit report with execution focus:
   - Establish the report selector, target focus, and optional finding selector before selecting a report. Target focus can be a trust boundary, route, module, flow, files/globs, branch comparison, commit range, symbol/class/function, or explicit whole-repo target.
   - If the user gives a path, read that exact markdown file.
   - If the user asks for "latest" or gives no path, require a concrete target focus first; do not run the latest security report against an unspecified target.
   - Select the latest `audits/security/<YYYY-MM-DD security-audit>.md` only after target focus is known, using `references/audit-report-io.md`.
   - Stop if no report exists; do not infer findings from conversation history.
   - Validate the report with `references/audit-report-io.md`: workflow, `ProjectId`, `Target`, `Target Focus`, scope, git base/head, required fields, `SEC-` IDs, resolved files or material scope evidence, and current file/line evidence. Stop on invalid, stale, target-drifted, or ambiguous reports before editing.
5. Extract actionable findings:
   - Keep findings with concrete `Security Boundary`, `Asset`, `Location`, `Evidence`, exploit path or trigger, `Negative Test Direction`, `Simplest Fix Direction`, and `Verification Suggestion`.
   - Ignore ruled-out candidates, no-finding sections, and low-confidence hardening ideas unless the user explicitly asks to include them.
   - If the user supplied finding IDs, extract only those IDs after validating they exist and match the current target focus.
   - Rank by exploitability, severity, affected asset, dependency order, and regression risk.
6. Build a threat-model fix map before editing:
   - Finding ID -> attacker or misuse path, trust boundary, missing/weak guard, data asset, required invariant, negative test, and rollback path.
   - Identify whether the fix belongs in authentication, authorization, ownership/tenant isolation, validation, output encoding, persistence, logging, crypto, config, or tests.
   - For mobile findings, identify whether the fix belongs in secure storage, permission handling, deep-link routing, push/background token handling, biometric fallback, local persistence/offline queue, logs/crash privacy, native bridge payload validation, or backend-mobile contract hardening.
7. Size each finding with `references/verification-ladder.md`:
   - Quick: local guard, schema validation, log redaction, config hardening, or focused negative test.
   - Standard: policy-layer change, middleware ordering, ownership rule, public API validation, data-access guard, or multi-file regression coverage; define verification recipe first.
   - Spec-driven: security model redesign, role model change, tenant model migration, crypto migration, or behavior change needing stakeholder approval; pause and route to `workflows/spec-driven.md` or ask for approval.
8. Apply security fixing methods:
   - Authentication: fail closed on missing/invalid identity, preserve session/token invariants, and avoid bypass paths.
   - Authorization: enforce permission checks at stable boundaries, verify object ownership and tenant isolation, and deny by default.
   - Validation: validate untrusted input before transformation or persistence; prefer schema or framework validators over ad hoc checks.
   - Output and privacy: encode or sanitize outputs, redact secrets and sensitive personal data from logs/errors, and avoid leaking existence of protected resources.
   - Injection and traversal: parameterize queries, constrain paths/URLs, validate protocols/hosts, and avoid unsafe deserialization or dynamic execution.
   - Secrets and crypto: remove hardcoded secrets, use safe config sources, avoid weak algorithms, and preserve key/credential rotation paths.
   - Mobile trust boundaries: preserve platform parity, fail closed on denied/restricted permissions when security-sensitive, validate native bridge payloads before trust, redact local logs/crash artifacts, and protect tokens or personal data in secure storage and offline queues.
9. Preserve security intent with tests:
   - Add or update negative tests for the exploit path when feasible.
   - Include positive tests for allowed behavior so the fix does not over-block legitimate use.
   - Do not weaken existing security assertions to make tests pass.
10. Use agent orchestration only when it improves signal. Dispatch per `references/agent-orchestration.md`:

> **Dispatch: builder** — see `skills/agents/builder/SKILL.md`
> - trigger: large/high-risk finding, disjoint implementation slice, or explicit subagent request
> - scope: one isolated security finding with a disjoint write set
> - permissions: write (disjoint write set)
> - inputs: the finding ID, impacted asset/boundary, exploit path, current guards, and simplest fix direction
> - sensors: report's verification suggestion or equivalent deterministic command; negative tests that attempt to disprove the fix
> - output: implementation summary, commands run, test counts, deviations
> - firewall: raw diffs/logs summarized
> - memory: suggest-only; main agent persists reusable security patterns

> **Dispatch: verification-agent** — see `skills/agents/verification-agent/SKILL.md`
> - trigger: independent verification of a high-risk security fix
> - scope: the fixed finding's guard restoration, middleware order, redaction, and report claim closure
> - permissions: read-only
> - inputs: the finding, the applied fix, the verification suggestion, and validation assets
> - sensors: deterministic command (negative tests, middleware-order inspection, redaction check) and report claim closure
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
   - Run targeted tests for negative and positive paths, plus lint/type/build checks relevant to touched files.
   - Inspect logs/config/errors when the finding involves data exposure.
   - Record command/artifact, result, skipped reason or `none`, highest Verification Ladder level reached, validation assets protected, and residual risk.
12. At completion, persist only durable knowledge:
   - Security boundary decisions, accepted exceptions, reusable exploit-path tests, or incident-prevention patterns after scoring with the Importance Calibration System.
   - Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:security-fix`, `entity:<entity>`, and one `memory:<tier>` tag.
13. Complete the Evidence Gate from `references/evidence-gate.md`.

## Examples

User asks: "Use security-fix to fix latest audit findings for user routes."

1. Confirm target focus is `user routes`, then read the latest matching `audits/security/* security-audit.md`.
2. Validate metadata, target focus, freshness, required fields, and current evidence before editing.
3. Fix critical/high exploit paths first.
4. Add negative tests for denied access, invalid input, or redacted output.
5. Run deterministic tests and report residual security risk.

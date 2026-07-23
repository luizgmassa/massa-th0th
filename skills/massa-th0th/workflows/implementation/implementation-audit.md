### Implementation Audit

Use this workflow for a findings-only multi-lens audit of a concrete implementation target: modified files, explicit files/globs, commit ranges, branch comparisons or PR diffs, modules/packages, symbols/classes/functions, feature/runtime flows, or an explicitly requested whole-repository sample.

Do not use this parent workflow when the user wants only one audit lens; route directly to that lens. Do not edit code. This workflow resolves one shared implementation scope packet, dispatches selected child lenses, and saves one durable report for `workflows/implementation/implementation-fix.md`.

1. Resolve/reuse `workflowSessionId`: `implementation-audit-[entity]`.
2. Load shared references:
   - `references/audit-scope.md` for target resolution, implementation scope packets, exclusions, and freshness.
   - `references/agent-orchestration.md` for modular read-only audit roles and capability packets.
   - `references/audit-report-io.md` before producing the report.
   - `references/context-firewall.md` before large diffs, logs, snapshots, generated reports, or broad searches.
   - `references/synapse-policy.md` when repeated th0th searches are expected.
3. `th0th_recall` -> load current architectural decisions, known regressions, security boundaries, requirements decisions, testing conventions, accepted exceptions, and project constraints. Apply the Memory Freshness Gate from `references/audit-scope.md`; memory is a lead, not proof.
4. Establish one concrete implementation target before analysis:
   - Accept modified files, explicit files/globs, commits/ranges, branch or PR comparisons, modules/packages, symbols/classes/functions, features/flows, or explicit whole-repository scope.
   - If the target is absent or ambiguous, ask for it. Never default to the whole repository.
   - Resolve the target using `references/audit-scope.md` and build one immutable implementation scope packet containing scope type, target focus, resolution method, base/head when relevant, resolved files, diff source when relevant, exclusions, requirements source, and freshness timestamp.
   - Pass the exact packet to every child lens. Child lenses may inspect surrounding code only to prove a concrete claim and must not silently broaden the target.
5. Resolve requirements source before lens dispatch:
   - At workflow start, resolve whether Requirements lens is in scope: broad/full audit, explicitly named Requirements lens, or requirement-fidelity claim in the user request.
   - If Requirements lens is in scope and no requirements source was provided or discovered from the prompt, PR description, task/spec file, issue text, or repository docs, ask the user for a requirements source before launching child lenses.
   - Accepted requirements sources are Jira or Confluence link/key via Atlassian MCP when callable, pasted requirements text, or attached/local file path.
   - If interactive input or Atlassian MCP is unavailable, mark Requirements `not evaluated: missing source` with skipped-check reason `needs-credentials`, `tool-missing`, or `not-applicable` as appropriate.
   - Never report a Requirements all-clear without a requirements source.
6. Select audit lenses:
   - If the user names lenses, run only those lenses.
   - For a broad/full audit, run Correctness, Architecture, Code Quality, Security, and Tests. Run Requirements only when a requirements source is available.
   - Supported lenses: Correctness -> `workflows/bugs/bugs-audit.md`; Architecture -> `workflows/architecture/architecture-audit.md`; Code Quality -> `workflows/code-quality/code-quality-audit.md`; Security -> `workflows/security/security-audit.md`; Requirements -> `workflows/requirements/requirements-audit.md`; Tests -> `workflows/tests/tests-audit.md`.
   - When a broad audit lacks requirements, ask for a source when interactive and not forbidden; otherwise mark Requirements `not evaluated: missing source`. Never report a requirements all-clear without a source.
7. Establish child contracts and dispatch `audit-specialist` per lens through `references/agent-orchestration.md`:

> **Dispatch: audit-specialist** — see `skills/agents/audit-specialist/SKILL.md`
> - trigger: broad/full audit requiring multiple lenses, or explicit multi-lens request
> - scope: one lens per dispatch against the shared implementation scope packet (Correctness/Architecture/Code Quality/Security/Requirements/Tests)
> - permissions: read-only
> - inputs: exact `projectId`, parent `workflowSessionId`, child workflow, lens name, shared scope packet, resolved files/diff summary, relevant recalled facts, allowed surrounding-code depth, deterministic sensors, context-firewall limits, and output contract
> - sensors: target-relevant deterministic commands (tests, builds, lint, type checks, static checks, import checks) per lens
> - output: `Status`, `Scope checked`, `Evidence`, `Findings`, `Verification/Test Fidelity Checklist`, `Risks and skipped checks`, and `Exact next step`
> - firewall: raw diffs/logs/search output summarized, not returned raw
> - memory: suggest-only; children must not persist broad project memory unless assigned

    - Repeated-search children receive isolated Synapse sessions. Durable child tags retain the parent session and workflow-specific session.
8. Use deterministic sensors when target-relevant commands are expected to finish in <=5 minutes and need no network, destructive action, production credential, or unapproved external service: tests, builds, lint, type checks, static checks, import checks, or focused runtime commands. Record skipped commands with one reason enum: `too-expensive`, `needs-network`, `needs-credentials`, `destructive-risk`, `outside-scope`, `tool-missing`, or `not-applicable`. Model judgment alone is not completion evidence.
9. Check whether SonarQube MCP is available and useful for the implementation scope:
   - Detect callable SonarQube MCP tools at runtime, such as project discovery, issue search, file/snippet analysis, advanced code analysis, duplicated-file search, component measures, security hotspots, guidelines, or quality gate status.
   - If SonarQube MCP is unavailable, no project key can be resolved, required credentials/configuration are missing, or the target files are outside the configured SonarQube project, record `SonarQube MCP: not evaluated` with the skipped-check reason and continue normal lens synthesis.
   - If available, use `references/context-firewall.md` and pass only the immutable implementation scope packet, resolved files, branch/PR identifiers, project key, and minimal file contents or paths required by the selected SonarQube tools.
   - Wait for SonarQube MCP execution to finish when a tool starts analysis, capture quality gate status when available, and summarize raw issues/measures/hotspots instead of copying raw tool output into the report.
   - Normalize actionable SonarQube results into only these implementation audit areas: Architecture, Correctness/Bugs, Code Quality, Security, and Tests. Do not create a Requirements finding from SonarQube output.
   - Preserve Sonar issue key, rule key, tool name, severity/impact, file/line, quality gate condition, and evidence summary inside the normalized finding.
   - Use normal source-qualified implementation IDs after normalization, such as `Architecture/ARCH-1`, `Correctness/BUG-1`, `Code Quality/CQ-1`, `Security/SEC-1`, or `Tests/TST-1`; do not invent `SONAR-*` executable finding IDs.
   - Keep unmapped, duplicate, low-context, or out-of-scope SonarQube results in Scope And Evidence or skipped checks, not in Findings or Execution Handoff.
10. Synthesize one result:
   - Start with a lens coverage matrix using `run`, `not evaluated`, `skipped`, or `failed`.
   - Include SonarQube MCP as evidence in the coverage matrix or Scope And Evidence, with quality gate status when available.
   - Preserve each child lens Verification/Test Fidelity Checklist from `references/audit-report-io.md` and summarize checklist proof in the parent lens coverage matrix, Scope And Evidence, and Execution Handoff.
   - Tie every source-qualified finding or no-finding claim to deterministic sensors, commands/artifacts, results, validation assets, or skipped-check reasons. Model judgment alone cannot satisfy verification/testing all-clear.
   - Deduplicate findings by root cause and order them `critical`, `high`, `medium`, then `low`.
   - Preserve source lens, original ID, confidence, location, evidence, impact, smallest fix direction, and verification suggestion.
   - Use source-qualified finding IDs of the form `Area/PREFIX-N` (e.g., `Correctness/BUG-1`, `Architecture/ARCH-1`, `Code Quality/CQ-1`, `Security/SEC-2`, `Requirements/REQ-1`, `Tests/TST-1`). The Area ties each finding to its source lens so traceability survives the broader non-PR-diff scope; the full discipline and area/prefix table live in `references/audit-report-io.md` (Source-Qualified Finding IDs).
   - If no findings remain, state the exact scope and lenses checked, skipped checks, and any missing requirements coverage.
11. Save or propose the canonical implementation audit report:
   - Default mode: write `audits/implementation/<YYYY-MM-DD implementation-audit.md>` under the target project root. Create the directory when absent and never silently overwrite a different run.
   - Plan Mode: return the proposed path and complete report without writing files.
   - Required metadata: `Workflow: implementation-audit`, `ProjectId`, `WorkflowSessionId`, `Target`, `Target Focus`, `Scope`, `Git Base`, `Git Head`, `Source Evidence Timestamp`, and `Requirements Source` or `n/a`.
   - Required sections: lens coverage matrix, findings, ruled-out candidates when relevant, scope and evidence, Verification/Test Fidelity Checklist, execution handoff, skipped checks, and residual risk.
   - The execution handoff lists ordered source-qualified IDs, dependencies, likely affected files, validation assets, verification commands, and cautions for `implementation-fix`.
   - Sonar-derived findings enter the execution handoff only after normalization to one of the supported source lens IDs and with enough evidence for `implementation-fix` to revalidate from the saved markdown report.
12. Persist only durable repeated patterns, approved architecture/requirements interpretations, or accepted exceptions after Importance Calibration. Use `workflow:implementation-audit` and the required project/session/entity/memory tags. Do not persist one-off findings, raw SonarQube output, or raw child output.
13. Complete `references/evidence-gate.md`.

## Examples

User asks: "Run a full implementation audit on my modified files."

1. Resolve staged, unstaged, and relevant untracked files into one modified-files scope packet.
2. Run all supported lenses except Requirements when no requirement source exists.
3. Save one implementation report with source-qualified findings and an execution handoff.

User asks: "Audit commits abc123..def456 for correctness and tests."

1. Resolve the exact commit range and changed files.
2. Run only Correctness and Tests against the shared packet.
3. Save the report under `audits/implementation/`.

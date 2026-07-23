# Audit Report I/O

Use this reference from audit workflows before writing reports and from execution workflows before report-driven changes.

## Report Paths

Direct single-lens audits save under the target project root:

```text
audits/<workflow>/<YYYY-MM-DD <workflow>-audit>.md
```

Supported single-lens workflow directories are `architecture`, `code-quality`, `security`, `requirements`, `tests`, and `bugs`.

```text
audits/architecture/2026-06-15 architecture-audit.md
audits/code-quality/2026-06-15 code-quality-audit.md
audits/security/2026-06-15 security-audit.md
audits/requirements/2026-06-15 requirements-audit.md
audits/tests/2026-06-15 tests-audit.md
audits/bugs/2026-06-15 bugs-audit.md
```

Parent implementation audits, mobile Figma audits, and Maestro audits use dedicated paths:

```text
audits/implementation/<YYYY-MM-DD implementation-audit.md>
audits/mobile-figma/<YYYY-MM-DD mobile-figma-audit.md>
audits/maestro/<YYYY-MM-DD maestro-audit.md>
```

Use the local current date. Create the required directory when missing. Do not silently overwrite a different run; ask the user or choose a deterministic suffix and state the deviation. Suffix rule: use `-2`, `-3`, etc. for same-day same-target collisions in one session; use `-<HHMMSS>` only when existing files do not reveal a stable sequence.

## Report Schema v2 Determinism

Apply these rules to every saved audit report and every execution workflow that consumes one:

- Drift invalidates a finding when the file is missing, the evidence line changed, base/head changed, resolved files no longer match the target, or the finding cannot be revalidated from current source.
- Ruled-out candidates are included only when their pre-disproof severity was `high` or `critical`, or confidence was `medium` or `high`.
- Low-confidence suspects stay in Scope And Evidence unless the user explicitly asks to investigate them.
- A report selector without workflow, target, target focus, scope, base/head or `n/a`, evidence timestamp, material files/evidence, commands/searches, skipped checks, and residual risk is invalid input for execution.

Child lenses invoked by implementation audit return compact findings to the parent unless explicitly asked to save independent reports.

## Verification/Test Fidelity Checklist

Every audit report and every compact child-lens result must include a Verification/Test Fidelity Checklist. The checklist is the proof layer for findings, no-finding conclusions, skipped checks, and execution handoff readiness.

Required checklist fields:

| Item | Required Evidence |
|---|---|
| Deterministic sensor | Exact command, static scan, artifact inspection, runtime/render sensor, or `not available` with reason |
| Result | `pass`, `fail`, `not run`, or `not applicable` |
| Coverage target | Finding ID, no-finding claim, requirement, behavior, surface, file, or validation asset covered |
| Validation assets protected | Tests, specs, fixtures, snapshots, benchmarks, public contracts, generated baselines, or `none` |
| Skipped-check reason | `none`, `too-expensive`, `needs-network`, `needs-credentials`, `destructive-risk`, `outside-scope`, `tool-missing`, or `not-applicable` |
| Execution handoff | Verification command/artifact and validation assets to re-run for every actionable finding |

Model judgment alone cannot satisfy the Verification/Test Fidelity Checklist. If no deterministic sensor exists, the report must state the missing sensor and residual risk instead of implying verification/testing all-clear.

Child lenses invoked by implementation audit return this checklist to the parent. Parent implementation reports preserve child checklist evidence in the lens coverage matrix, Scope And Evidence, and Execution Handoff.

## Plan Mode Save Rule

In Plan Mode, do not write report files. Return the proposed canonical path and complete report content.

In Default mode, write the canonical report unless acting as a child lens returning compact findings to implementation audit.

## Single-Lens Report Contract

```md
# <Workflow> Audit

Date: <YYYY-MM-DD>
Workflow: architecture | code-quality | security | requirements | tests | bugs
ProjectId: <projectId>
WorkflowSessionId: <workflowSessionId>
Target: <target>
Target Focus: <path, module, branch comparison, commits, symbol, feature, flow, changed-file set, or prompt target>
Scope: <modified files | explicit files/globs | commit range | branch comparison | codebase area | symbol/class/function | feature/flow | PR diff>
Git Base: <sha/ref or n/a>
Git Head: <sha/ref, working-tree, or n/a>
Source Evidence Timestamp: <YYYY-MM-DD HH:MM local time, or unavailable>
Requirements Source: <requirements-only, when applicable or n/a>

## Findings

### <PREFIX-N>: <short title>

Severity: critical | high | medium | low
Confidence: high | medium | low
Location: <path:line or module>
Evidence: <concrete source evidence>
Impact: <risk or cost>
Simplest Fix Direction: <smallest sufficient change>
Verification Suggestion: <deterministic command, test, or artifact check>

## Ruled-Out Candidates

<Plausible candidates disproved by evidence, or "None">

## Scope And Evidence

<Files, commands, searches, skipped checks, and residual risk>

## Verification/Test Fidelity Checklist

| Item | Evidence |
|---|---|
| Deterministic sensor | <command, static scan, artifact inspection, runtime/render sensor, or not available with reason> |
| Result | <pass, fail, not run, or not applicable> |
| Coverage target | <finding ID, no-finding claim, requirement, behavior, surface, file, or validation asset> |
| Validation assets protected | <tests, specs, fixtures, snapshots, benchmarks, public contracts, generated baselines, or none> |
| Skipped-check reason | <none or allowed skipped-check reason> |
| Execution handoff | <verification command/artifact and validation assets for every actionable finding> |

## Execution Handoff

<Ordered actionable IDs, dependencies, validation assets, verification, and cautions>
```

Single-lens finding prefixes:

| Workflow | Prefix |
|---|---|
| Code Quality | `CQ-` |
| Architecture | `ARCH-` |
| Security | `SEC-` |
| Requirements | `REQ-` |
| Tests | `TST-` |
| Bugs | `BUG-` |

## Coupling Finding Extension

Architecture findings that report coupling carry these extra fields so the
three-dimensional verdict is reproducible, not scattered prose:

- Coupling Dimensions: `S=<High|Low> D=<High|Low> V=<High|Low>`
- Balance Score: `<0 | 1>` — from `BALANCE = (S XOR D) OR (NOT V)`
- Maintenance Effort: `<0 | 1>` — from `MAINTENANCE_EFFORT = S * D * V`
- Connascence: `<Name | Type | Meaning | Position | Algorithm>`
- Symmetric: `<yes | no>` — duplicated rule with no import edge

Record all five even when the edge is healthy; the Balance Score is the
prioritization signal handed off to `architecture-fix`.

## Implementation Audit Report Contract

```md
# Implementation Audit

Date: <YYYY-MM-DD>
Workflow: implementation-audit
ProjectId: <projectId>
WorkflowSessionId: <implementation-audit-[entity]>
Target: <implementation target>
Target Focus: <modified files, files/globs, commits, branch/PR comparison, module, symbol, feature, flow, or whole repository>
Scope: <scope type from audit-scope.md>
Git Base: <sha/ref or n/a>
Git Head: <sha/ref, working-tree, or n/a>
Source Evidence Timestamp: <YYYY-MM-DD HH:MM local time, or unavailable>
Requirements Source: <source description or n/a>

## Lens Coverage Matrix

| Lens | Status | Scope Checked | Evidence | Skipped Check Reason |
|---|---|---|---|---|

## Findings

### <Source Lens>/<Original ID>: <short title>

Severity: critical | high | medium | low
Confidence: high | medium | low
Source Lens: Correctness | Architecture | Code Quality | Security | Requirements | Tests
Original Finding ID: BUG-1 | ARCH-1 | CQ-1 | SEC-1 | REQ-1 | TST-1
Location: <path:line or module>
Evidence: <concrete source evidence>
Impact: <risk or cost>
Simplest Fix Direction: <smallest sufficient change>
Verification Suggestion: <deterministic command, test, or artifact check>

## Ruled-Out Candidates

<Plausible candidates disproved by evidence, or "None">

## Scope And Evidence

<Immutable implementation scope packet, commands, searches, skipped checks, and residual risk>

## Verification/Test Fidelity Checklist

| Item | Evidence |
|---|---|
| Deterministic sensor | <child lens command, static scan, artifact inspection, runtime/render sensor, or not available with reason> |
| Result | <pass, fail, not run, or not applicable> |
| Coverage target | <source-qualified finding ID, no-finding claim, requirement, behavior, file, or validation asset> |
| Validation assets protected | <tests, specs, fixtures, snapshots, benchmarks, public contracts, generated baselines, or none> |
| Skipped-check reason | <none or allowed skipped-check reason> |
| Execution handoff | <verification command/artifact and validation assets for every actionable finding> |

## Execution Handoff

<Ordered source-qualified IDs, dependencies, likely files, validation assets, verification commands, and cautions>
```

### Source-Qualified Finding IDs

Every implementation-audit finding carries a **source-qualified ID** of the form `<Area>/<PREFIX>-<N>`. The Area qualifies which source lens produced the finding; the `PREFIX-N` keeps ordering within that area. This discipline is mandatory because implementation-audit spans a broader scope than a single PR diff, so the source lens must survive into execution for traceability and revalidation.

Canonical area/prefix pairs:

| Area | Prefix | Example |
|---|---|---|
| Correctness | `BUG-` | `Correctness/BUG-1` |
| Architecture | `ARCH-` | `Architecture/ARCH-1` |
| Code Quality | `CQ-` | `Code Quality/CQ-1` |
| Security | `SEC-` | `Security/SEC-2` |
| Requirements | `REQ-` | `Requirements/REQ-1` |
| Tests | `TST-` | `Tests/TST-1` |

Rules:

- The `<Area>` segment must match one of the supported source lenses above; do not invent new areas or use bare `PREFIX-N` IDs in implementation reports.
- The `<PREFIX>` must match the lens's single-lens prefix; do not mix (e.g., never `Security/BUG-1`).
- Preserve the same source-qualified ID verbatim from audit through `implementation-fix` execution and the closure matrix.
- SonarQube-derived findings must normalize to one of these source-qualified IDs before entering Findings or Execution Handoff; raw `SONAR-*` output is evidence only.

This `audit-report-io.md` section is the canonical home for the source-qualified ID discipline. `implementation-audit.md` and `implementation-fix.md` restate the `Area/PREFIX-N` requirement and point here rather than duplicating the table.

## Mobile Figma Report Contract

```md
# Mobile Figma Audit

Date: <YYYY-MM-DD>
Workflow: mobile-figma-audit
ProjectId: <projectId>
WorkflowSessionId: <mobile-figma-audit-[entity]>
Target: <mobile UI target>
Target Focus: <feature, files, screen, classes/views/composables, commits, branch comparison, or modified files>
Scope: <scope type from audit-scope.md>
Git Base: <sha/ref or n/a>
Git Head: <sha/ref, working-tree, or n/a>
Source Evidence Timestamp: <YYYY-MM-DD HH:MM local time>
Repository Classification: Android | iOS | KMP | monorepo/mixed
Figma Source: <URL, file key, or desktop selection>
Figma Evidence Timestamp: <YYYY-MM-DD HH:MM local time>
Requirements Source: <source description or n/a>

## Target Surface Matrix

| Surface ID | Module/Source Set | UI Stack | Detection Evidence | Figma Node | Runtime Targets | Status |
|---|---|---|---|---|---|---|

Supported UI stacks: Android Views XML, Android Jetpack Compose, iOS UIKit, iOS SwiftUI, and KMP Compose Multiplatform. Mixed KMP reports add applicable native host/source-set rows instead of labeling every Compose surface as shared.

## Platform Comparison Configurations

### <Surface ID>

<Fixed stack-specific viewport/device, density or display scale, orientation, OS/API, traits/theme, locale, text scaling, safe-area/inset assumptions, build variant/scheme, and content state>

## Capability Matrix

| Surface ID | Capability | Status | Evidence | Limitation |
|---|---|---|---|---|

## Comparison Matrix

| ID | Surface ID | Element/State | Property/Constraint | Figma Value | Resolved Implementation Value | Runtime Evidence | Evidence Class | Status | Confidence | Fix Direction |
|---|---|---|---|---|---|---|---|---|---|---|

## Findings

### MFM-<N>: <short title>

Severity: critical | high | medium | low
Confidence: high | medium | low
Surface ID: <surface ID from Target Surface Matrix>
UI Stack: Android Views XML | Android Jetpack Compose | iOS UIKit | iOS SwiftUI | KMP Compose Multiplatform
Module/Source Set: <module and source-set evidence>
Element/State: <element and state>
Property/Constraint: <property or behavior>
Figma Value: <resolved design value>
Resolved Implementation Value: <resource/token/asset chain and final value>
Runtime Evidence: <measurement, artifact, or unavailable>
Evidence Class: deterministic-source | deterministic-runtime | inferential-visual | missing
Platform Configuration: <surface configuration used>
Location: <path:line or module>
Impact: <visual, interaction, accessibility, or maintenance impact>
Simplest Fix Direction: <smallest sufficient change>
Verification Suggestion: <deterministic sensor and optional Maestro reproduction>

## Constraint Deviations

<Documented accessibility, platform, localization, system UI, or product deviations>

## Not Evaluated

<Rows and capabilities lacking safe or sufficient evidence>

## Scope And Evidence

<Figma packet and surface mappings, target modules/source sets, per-surface files/resources, render sensors, optional Maestro metadata/artifacts, skipped checks, and residual risk>

## Verification/Test Fidelity Checklist

| Item | Evidence |
|---|---|
| Deterministic sensor | <Figma MCP evidence, source value resolution, static render check, screenshot/runtime sensor, Maestro artifact, or not available with reason> |
| Result | <pass, fail, not run, or not applicable> |
| Coverage target | <MFM ID, no-finding claim, surface ID, comparison row, behavior, file, or validation asset> |
| Validation assets protected | <screenshot tests, previews, fixtures, snapshots, test tags/selectors, resources, public contracts, or none> |
| Skipped-check reason | <none or allowed skipped-check reason> |
| Execution handoff | <verification command/artifact, platform configuration, and validation assets for every actionable mismatch> |

## Execution Handoff

<Ordered MFM IDs and surface IDs, shared/platform root fixes, likely files, protected validation assets, configurations, verification, and Maestro reproduction packets when present>
```

Only `MISMATCH` comparison rows become `MFM-*` findings. `CONSTRAINT DEVIATION` and `NOT EVALUATED` rows are never silently promoted to executable findings.

## Maestro Audit Report Contract

```md
# Maestro Audit

Date: <YYYY-MM-DD>
Workflow: maestro-audit
ProjectId: <projectId>
WorkflowSessionId: <maestro-audit-[entity]>
Target: <Maestro target>
Target Focus: <flow root, suite, tag, app/module, platform, commit range, branch comparison, or modified files>
Scope: <scope type from audit-scope.md>
Git Base: <sha/ref or n/a>
Git Head: <sha/ref, working-tree, or n/a>
Source Evidence Timestamp: <YYYY-MM-DD HH:MM local time, or unavailable>
Scenario Source: <Jira/Confluence, local file, prompt text, explored/inferred behavior, or n/a>
Maestro CLI: <version/help result or unavailable with reason>
Device/Emulator Readiness: <command/result or unavailable with reason>

## Flow Inventory

| Flow ID | Path | Suite/Tag | Platform | Setup/Teardown | Scenario Source | Status |
|---|---|---|---|---|---|---|

## Maestro Run Matrix

| Flow ID | Command | Exit Status | Result | JUnit Report | Artifact Directory | Device/Platform | Skipped-Check Reason |
|---|---|---|---|---|---|---|---|

## Scenario Coverage Matrix

| Scenario ID | Source | Expected Behavior | Covered Flow ID | Evidence | Gap |
|---|---|---|---|---|---|

## Findings

### MST-<N>: <short title>

Severity: critical | high | medium | low
Confidence: high | medium | low
Flow/Subflow: <flow ID and path>
Scenario Source: <source identifier>
Location: <path:line or module>
Evidence: <concrete source, report, or artifact evidence>
Impacted Journey: <user journey or release smoke path>
Flake Or Coverage Risk: <risk class and impact>
Simplest Fix Direction: <smallest sufficient Maestro flow, fixture, setup, teardown, or test-data change>
Verification Suggestion: <Maestro command, JUnit report check, artifact inspection, or static check>

## Ruled-Out Candidates

<Plausible candidates disproved by evidence, or "None">

## Scope And Evidence

<Flow roots, scenario sources, commands/searches, exit statuses, JUnit reports, artifact directories, skipped checks, validation assets, and residual risk>

## Verification/Test Fidelity Checklist

| Item | Evidence |
|---|---|
| Deterministic sensor | <Maestro command, JUnit report, artifact inspection, static YAML/config scan, or not available with reason> |
| Result | <pass, fail, not run, or not applicable> |
| Coverage target | <MST ID, no-finding claim, scenario, flow, behavior, file, or validation asset> |
| Validation assets protected | <flows, subflows, fixtures, setup/teardown, test data, snapshots, CI report consumers, or none> |
| Skipped-check reason | <none or allowed skipped-check reason> |
| Execution handoff | <verification command/artifact and validation assets for every actionable MST finding> |

## Execution Handoff

<Ordered MST IDs, dependencies, likely files, protected validation assets, verification commands, artifact expectations, and cautions>
```

Only executable flow, fixture, setup/teardown, test-data, or directly scoped Maestro CI/report issues become `MST-*` findings. App bugs, product behavior gaps, backend defects, and unclear requirements must route to `debug`, `feature`, or `requirements-audit` instead of `maestro-fix`.

## Required Finding Fields

All findings require severity, confidence, location, concrete evidence, impact, smallest fix direction, and verification suggestion. Workflow-specific fields are mandatory:

| Workflow | Required Extra Fields |
|---|---|
| Code Quality | `Rule`, `Current Shape`, `Simplest Safe Transformation` |
| Architecture | `Lens`, `Boundary/Module`, `Tradeoff`, `Dependency Direction` when relevant |
| Security | `Security Boundary`, `Asset`, `Trigger or Exploit Path`, `Negative Test Direction` |
| Requirements | `Requirement Source`, `Requirement ID or Quote`, `Requirement Gap Type` |
| Tests | `Impacted Behavior`, `Regression Risk`, `Simplest Test Direction`, `Deterministic Sensor` |
| Bugs | `Bug Class`, `Impacted Flow`, `Trigger or Repro Path`, `Root Cause Hypothesis`, `Regression Risk` |
| Mobile Figma | `Surface ID`, `UI Stack`, `Module/Source Set`, `Element/State`, `Property/Constraint`, `Figma Value`, `Resolved Implementation Value`, `Runtime Evidence`, `Evidence Class`, `Platform Configuration` |
| Maestro | `Flow/Subflow`, `Scenario Source`, `Impacted Journey`, `Flake Or Coverage Risk` |

If a required field is unknown, write `Unknown` and explain the evidence gap. Execution treats unknown required fields as a stop condition unless the user explicitly accepts the risk after revalidation.

## Freshness Metadata

Every report must include project, workflow, target, target focus, scope, git base/head or `n/a`, source evidence timestamp, material files/evidence, commands/searches, skipped checks, and residual risk.

Implementation reports must preserve the exact parent scope packet and source-qualified findings. Mobile Figma reports must also preserve repository classification, Target Surface Matrix, Figma identity/mappings/timestamp, per-surface platform configurations, capability matrix, complete comparison matrix, and optional Maestro reproduction metadata. Maestro reports must preserve scenario source, flow inventory, Maestro run matrix, JUnit report path, artifact directory, device/emulator readiness, and execution handoff for `MST-*` findings.

When implementation-audit uses SonarQube MCP, preserve the MCP availability result, project key or skipped-check reason, quality gate status when available, tool names used, and summarized issue/security-hotspot/measure evidence in Scope And Evidence. Sonar-derived findings are executable only after they are normalized to existing source-qualified IDs for Architecture, Correctness/Bugs, Code Quality, Security, or Tests; unmapped SonarQube output remains evidence only and does not enter Execution Handoff.

## Execution Report Input

Execution workflows read a saved markdown report before changing code. Establish:

- Report selector: exact path, `latest`, or omitted.
- Target focus: module, flow, files/globs, branch comparison, commit range, PR target, symbol/class/function, feature/screen, modified files, or explicit whole-repository target.
- Finding selector: optional workflow IDs or source-qualified implementation IDs.

If a path is supplied, use it and validate it against any stated focus. For `latest` or omitted paths, require a concrete focus before selecting from the matching directory.

Select the latest matching report by:

1. Highest `YYYY-MM-DD` parsed from matching filenames.
2. Most recent mtime as tie-breaker.
3. Lexicographically last path if still tied.

Specialized selection rules:

- `implementation-fix` selects only `audits/implementation/* implementation-audit.md` with `Workflow: implementation-audit`.
- `mobile-figma-fix` selects only `audits/mobile-figma/* mobile-figma-audit.md` with `Workflow: mobile-figma-audit`.
- `maestro-fix` selects only `audits/maestro/* maestro-audit.md` with `Workflow: maestro-audit`.
- Single-lens execution selects only its matching workflow directory and metadata.

Before editing:

- Verify workflow, project, target, target focus, scope, base/head, and resolved files match the current request.
- Reinspect each finding's current location and evidence. Stop or re-audit when schema v2 drift rules invalidate any selected finding.
- Verify every finding has common and workflow-specific fields plus the correct ID form.
- For implementation reports, require source-qualified IDs and child-lens fields.
- For mobile Figma reports, re-read the Figma node and reject stale design/source/configuration evidence.
- Ignore ruled-out candidates, skipped checks, no-finding summaries, `NOT EVALUATED` rows, constraint deviations, and low-confidence suspects unless the user explicitly changes scope after revalidation.
- Build verification from report suggestions plus current project sensors.

Do not execute from chat summaries, inline comments, screenshots alone, or remembered audit content. The saved markdown report is the source of truth.

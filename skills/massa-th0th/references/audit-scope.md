# Audit Scope

Use this reference from audit workflows, implementation audit, bug finder, mobile Figma, and execution workflows before inspecting changed code or selecting an audit report.

## Scope Packets

Every audit scope must produce a compact scope packet before analysis:

```text
Scope Type: <modified files | explicit files/globs | commit range | branch comparison | codebase area | symbol/class/function | feature/flow | PR diff>
Target Focus: <path, module, branch comparison, commits, symbol, feature, flow, PR, changed-file set, or prompt target>
Resolution Method: <commands, tools, or user-supplied packet used to resolve scope>
Git Base: <sha/ref or n/a>
Git Head: <sha/ref or working-tree>
Resolved Files: <explicit list or pointer to summarized list>
Diff Source: <command, PR URL, supplied diff, or user-provided file set>
Excluded Paths: <generated/dependency/build/log/cache/temp/secret paths removed>
Requirements Source: <requirements-only, when applicable>
Freshness Checked At: <YYYY-MM-DD HH:MM local time, or unavailable>
```

Pass the same packet to child audit lenses. Child workflows must not silently recompute a different base or broaden scope beyond the packet.

## Target Intake Rules

Direct audit workflows require a concrete target focus before analysis. Accepted targets include modified files, explicit files or globs, commit hashes or commit ranges, branch comparisons, modules/packages, feature areas, classes/functions/symbols, runtime flows, or an explicitly requested whole-repo audit.

If the target is missing, vague, or too broad to inspect without guessing, stop and ask for a target focus. Do not default to a whole-repo audit. Whole-repo audits are valid only when the user explicitly asks for the whole repository and accepts the broader cost and lower precision.

Requirements audits also require a requirements source: prompt text, spec, issue/task, PR description, ADR/RFC, acceptance criteria, README/docs section, or another explicit source of expected behavior. If no requirements source can be found from the prompt or supplied context, stop and ask for it.

Execution workflows require both a report selector and a target focus before editing:

- Exact audit report path plus optional finding IDs is preferred.
- If the user asks for "latest" or omits a report path, first confirm a target focus such as module, flow, files, branch comparison, commit range, or PR target.
- Select the latest report only from the matching workflow directory, then verify report metadata matches the target focus before editing.
- If report target, scope, base/head, resolved files, or current evidence drift from the user's target focus, stop before editing unless the user explicitly accepts the risk.

## Audit Budgets

Use these default budgets unless the user explicitly expands scope:

| Scope size | Files / LOC / modules | Default context depth | Delegation trigger |
|---|---|---|---|
| Small | <=3 files, <=200 changed LOC, one module | touched lines plus direct callers/callees only | no delegation unless user requests it |
| Medium | 4-10 files or <=500 changed LOC in one ownership area | one-hop references, tests, config, and public surfaces | delegate only for independent verification or high/critical candidate findings |
| Large | >10 files, >500 changed LOC, >2 modules, whole-repo, or cross-boundary scope | top-level map first, then one-hop depth for selected high-risk entry points | delegation only when explicit request, >=2 disjoint slices, or high/critical findings exist |

Whole-repo audits start with top-level mapping and central entry points. They must report skipped depth checks instead of implying exhaustive line-by-line coverage.

## Scope Resolution

Use the smallest scope type that matches the user's target:

- Modified files: staged, unstaged, and relevant untracked files in the working tree. Use `working-tree` as head and record the status/diff commands used.
- Explicit files/globs: user-provided paths or globs. Resolve to concrete files; ask if nothing matches or if the glob expands beyond the intended target.
- Commit range: user-provided commit hash, commit list, or revision range. Record the exact range, base/head when available, changed files, and diff command.
- Branch comparison: user-provided base/head branch or ref comparison. Resolve base/head with the branch diff rules below and record changed files.
- Codebase area: module, package, directory, service, bounded context, or feature area. Resolve entry points, exported surfaces, tests, config, and adjacent docs only as needed.
- Symbol/class/function: locate definitions and references with th0th symbol
  tools, targeted enriched search, or focused fallback; use `read_file`
  for exact ranges and include defining files, callers, tests, and configs
  needed to verify claims.
- Feature/flow: map entry points through main transformations and side effects; ask for a narrower flow when the feature spans too many unrelated surfaces.
- Implementation parent scope: accept the exact packet supplied by `workflows/implementation/implementation-audit.md`, including PR diff when that is the selected scope type; child lenses must not broaden it without parent approval.

## Branch, Commit, And PR Diff Resolution

Use this order:

1. Explicit user-provided commit range, branch/PR base and head, diff, or changed-file set.
2. Upstream merge-base for the active branch.
3. Fallback bases in order: `origin/main`, `origin/master`, `main`, `master`.

Stop and ask when no base can be resolved, multiple plausible bases exist, commit/branch syntax is invalid, or the working tree/branch state makes the target ambiguous. Do not invent a base. Record the selected base/head in the scope packet and in any saved audit report.

## File Inclusion

Include files that can affect the audited behavior, including source, tests, fixtures, schemas, migrations, config, docs, and packaging metadata when they define behavior or public contracts.

Exclude generated, dependency, build, log, cache, temporary, and secret paths according to repo rules. Deleted files stay in scope only when their removal can break imports, exports, routing, migrations, config, tests, packaging, docs, policies, or public contracts.

Inspect diffs first when a diff exists. For non-diff scopes, inspect the resolved entry points first. Read surrounding code only to prove or disprove a concrete candidate finding.

## Memory Freshness Gate

Recalled memories, accepted exceptions, prior ADR interpretations, and previous audit decisions are leads, not proof.

Before suppressing or downgrading a finding because of memory:

- Confirm the memory is not tagged `stale` and is not superseded by `stale-replaces:*`.
- Corroborate it against current code, current ADRs/specs, or the current audit report evidence.
- Check whether newer code, requirements, or incidents invalidate the exception.
- If corroboration is missing, keep the candidate alive as `suspect` or report the evidence gap instead of treating memory as authoritative.

## Context Firewall

Summarize large diffs, logs, generated reports, snapshots, and broad search output before using them in the main context. Keep raw verbose output out of child-agent and final-report payloads unless a short excerpt is necessary as evidence.

When an audit requires repeated th0th searches, use the shared Synapse policy.
Each parallel audit lens receives an isolated `synapseSessionId`; all lenses
retain the parent/child durable `workflowSessionId` tags and the same scope
packet.

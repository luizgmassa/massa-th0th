### Spec-Driven

Use this workflow for explicit spec-driven requests and broad, ambiguous, migration-heavy, cross-boundary, public-contract, or long-running delivery that needs requirements-through-verification control. Ordinary localized fixes and clear small features stay in `debug`, `feature`, `refactor`, or `general` unless the user explicitly requests this workflow.

## TLC v3 Flow

Run the integrated TLC Spec-Driven v3 flow:

`Specify -> (Design) -> (Tasks) -> Execute`

- `Specify` and `Execute` are always required.
- Validation is the mandatory final Execute gate, not a separate optional phase.
- `Design` is included for Large/Complex work and whenever architecture, interfaces, data model, migration, security/privacy, public contract, or reusable pattern decisions exist.
- `Tasks` is included for Large/Complex work and whenever execution has more than 3 obvious linear steps or has dependency, branch, join, parallelism, or sequencing complexity.
- Large/Complex work must include full requirement IDs, the implicit-requirement sweep, design approach tradeoffs, a task breakdown, and final validation.
- If a skipped phase becomes necessary later, stop, create or revise the phase artifact, record the safety-valve reason, and resume from the updated contract.

## Execution Contract — Non-Negotiable

Holds for every task, even if reference files are not opened:

1. Tests derive from the spec's acceptance criteria and assert spec-defined outcomes — they never mirror the implementation.
2. The gate must pass (tests pass) before a task is done — the test runner decides, not self-assessment.
3. One atomic commit per task. Never batch tasks; never weaken, skip, or delete tests to make them pass.
4. After the last task, a fresh verification-agent always runs automatically (author ≠ verifier) — spec-anchored outcome check plus discrimination sensor. Never optional, never prompted.

## Auto-Sizing

Complexity determines depth, not a fixed pipeline. Assess scope first, apply only what is needed:

| Scope | What | Specify | Design | Tasks | Execute |
| --- | --- | --- | --- | --- | --- |
| Small | ≤3 files, one sentence | One-liner inline | Skip | Skip | Implement + verify inline |
| Medium | Clear feature, <10 tasks | Brief spec | Skip — inline | Skip — implicit | Implement + verify |
| Large | >10 tasks OR multi-component feature | Full spec + requirement IDs | Architecture + components | Full breakdown + deps | Implement + verify per task |
| Complex | Ambiguity or new domain (unfamiliar vocabulary, no prior pattern) | Full spec + discuss gray areas | Research + architecture | Breakdown + phase plan | Implement + interactive UAT |

A "phase" is a group of tasks sharing a dependency boundary or a checkpoint commit — it is distinct from a single task or atomic step. The sub-agent offer fires when a formal `tasks.md` packs into more than one task-budgeted batch (> ~8 tasks).

- Specify and Execute are always required.
- Design is skipped when straightforward (no architectural decisions, no new patterns).
- Tasks is skipped when ≤3 obvious steps (implicit in Execute).
- Discuss runs inside Specify when gray areas or any implicit-requirement dimension is present (persistence/state, external calls, auth, payments, concurrency, state transitions).
- Interactive UAT runs inside Execute only for user-facing features with complex behavior.

## Quick Mode Guardrails

Quick mode is the Small/auto-sized path: a single change touching **max 3 files** with no new dependency and no design decision. It is the fast lane, not a parallel pipeline — it still closes requirements and runs the Execute gate.

Enter Quick mode only when **all** hold:

- The change touches max 3 files.
- No new dependency is introduced.
- No design decision is required (no architecture, interface, data model, migration, security/privacy, or public-contract choice).

Exit Quick mode immediately — run the full Specify → (Design) → (Tasks) → Execute pipeline — when **any** of these appears mid-task:

- A new dependency.
- Any design decision surfaces.
- The change grows past max 3 files.

Promote to a feature when **5+ quick tasks** accumulate in one area: that signal means the work has hidden coupling and belongs in a tracked feature with full requirements, not a string of quick fixes. Record the promotion in `.specs/project/STATE.md` and open the feature under `.specs/features/<slug>/`.

Quick artifacts live under `.specs/quick/NNN-slug/` with a `TASK.md` (one-line intent + acceptance) and a `SUMMARY.md` (files changed + gate evidence). See `references/spec-driven/artifact-store.md` for templates. Quick tasks are listed in the STATE.md Quick Tasks table (see `references/spec-driven/memory.md`).

## Workflow

1. Resolve/reuse `projectId` and `workflowSessionId`: `spec-[entity]`.
2. Restore context before planning:
   - `recall` for exact-session continuity, durable decisions, rejected approaches, patterns, blockers, and handoffs.
   - Load `references/spec-driven/artifact-store.md` before reading or writing feature registry, state, handoff, phase artifacts, validation reports, or lessons.
   - Load `references/synapse-policy.md` when two or more related searches are expected.
   - Load `references/context-firewall.md` before broad source inspection, generated reports, external research, or verbose tool output.
   - Keep the loaded context budget under the `references/spec-driven/context-limits.md` target; summarize or narrow before loading bulky artifacts.
   - Use `references/spec-driven/code-analysis.md` when source inspection needs structural search or tool fallback.
   - Load current canonical artifacts from `.specs/` files: `.specs/project/FEATURES.json`, `.specs/project/STATE.md`, `.specs/HANDOFF.md`, existing `.specs/features/<slug>/` phase artifacts, lessons, and project source. Current repository source and approved `.specs/` artifacts override stale memory, old handoff notes, external summaries, debug exports, or unapproved generated plans.
   - `search` only counts as codebase evidence when it is fresh for the current repository path and commit/worktree state, or when the result is confirmed against source files read in this session.
   - Load confirmed project lessons through `references/lessons.md` when `.specs/lessons.json` exists:
     `python3 skills/massa-th0th/scripts/lessons.py --root . list --status confirmed`
3. Run `Specify` with `references/spec-driven/specify.md`.
   - Capture stable requirement IDs, testable acceptance criteria, edge cases, and explicit out-of-scope items.
   - Run `references/spec-driven/discuss.md` inside Specify when gray areas, implicit requirements, persistence/state, external calls, auth, payments, concurrency, or state transitions affect behavior.
   - For Android, iOS, or KMP Compose Multiplatform UI work, load `references/mobile-context.md` and run the optional design-source gate: ask for one or more Figma links, node IDs, a readable desktop selection, supplied screenshots, or explicit `none`; record `Figma Source: none by user choice` when declined. Screenshots are context-only unless paired with structured Figma evidence. For unsupported targets, record the source as outside mobile Figma scope and do not run mobile Figma.
   - Apply the Requirement Closure Gate: every open requirement question is resolved with the user or recorded as an accepted assumption before execution begins.
4. Decide whether `Design` is required. If yes, run `references/spec-driven/design.md`; if no, record why the skip is valid. When Design is skipped and a design concern appears later, stop and create `design.md` before continuing.
5. Decide whether `Tasks` is required. If yes, run `references/spec-driven/tasks.md`; if no, list the inline atomic execution steps before editing. If the inline list reveals more than 5 steps or complex dependencies, stop and create `tasks.md` — the Tasks phase was wrongly skipped (safety valve).
6. Run `Execute` with `references/spec-driven/execute.md`.
   - Load `references/spec-driven/coding-principles.md` before implementation.
   - Use the Test Coverage Matrix and Gate Check Commands from `tasks.md`, or state their inline equivalents when Tasks was skipped.
   - Ask the MCP and skill question in Tasks or inline Execute when tool choice can change correctness or verification.
   - If a formal `tasks.md` packs into more than one task-budgeted batch (> ~8 tasks), present the sub-agent offer from `references/spec-driven/sub-agents.md` before starting Execute. Offer-then-confirm — never auto-spawn; the user must accept before any sub-agent is dispatched. One worker per batch (~7 tasks, whole phases): each batch worker executes all its tasks in order (implement → gate → atomic commit), then reports a compact summary (tasks done, commit hashes, test counts, deviations). Workers never spawn further sub-agents.
   - Implement one atomic step or approved task at a time.
   - For long-running task sequences, create a checkpoint via `create_checkpoint` at task boundaries with `taskId`, `description`, `progressPercent`, `currentStep`, `nextAction`, `fileChanges`, and `checkpointType: "manual"` so progress is resumable after interruption.
   - If resuming after interruption, call `list_checkpoints` with the `taskId` and `restore_checkpoint` to recover task state before continuing. If `create_checkpoint` is unavailable (e.g. `task_checkpoints` table missing), continue with `.specs/` artifact state as the fallback.
   - Use per-task commits when the environment and user permissions allow commits; otherwise record the skipped reason.
   - Keep validation assets protected.
   - Update logical feature artifacts in `.specs/features/<slug>/` and `.specs/project/STATE.md` after meaningful progress.
    - Finish Execute by running `references/spec-driven/validate.md`. Dispatch `verification-agent` (author ≠ verifier) per `references/agent-orchestration.md`; the verification-agent always runs automatically and writes `.specs/features/<slug>/validation.md`. Without subagents, run the standalone fresh-eyes fallback in `validate.md`.

> **Dispatch: verification-agent** — see `skills/agents/verification-agent/SKILL.md`
> - trigger: spec-driven Execute final gate; author ≠ verifier independence required
> - scope: the feature's git diff surface, test files, and spec ACs
> - permissions: read-only
> - inputs: `spec.md` (ACs = source of truth), `references/spec-driven/validate.md` as operating checklist, commit range, test files in scope
> - sensors: (1) spec-anchored outcome check — each test's asserted value matches the spec-defined expected outcome; (2) discrimination sensor — injects behavior-level faults in scratch state, confirms tests kill them, discards mutations; surviving mutants become fix tasks
> - output: `.specs/features/<slug>/validation.md` (PASS/FAIL, per-AC evidence, sensor result, diff range); compact verdict + ranked gap list; gaps become fix tasks
> - firewall: raw diffs/logs/test output summarized; mutations run in scratch state only
> - memory: suggest-only; main agent persists validation outcomes

    - The verification-agent re-derives coverage independently using evidence-or-zero and does not inherit the author's mental model.
   - The fix → re-verify loop is capped at 3 iterations before escalating to `Blocked`.
   - Distill lesson signals through `references/lessons.md` when validation produces grounded reusable failures.
7. Update `.specs/project/STATE.md`, `.specs/HANDOFF.md`, and `references/spec-driven/memory.md` records for decisions, blockers, handoff, and completion evidence.
8. When the user asks to split planning and implementation across clean chats, route save-progress requests to `workflows/restart-save.md` and clean-chat resume requests to `workflows/restart-load.md`; keep this workflow as the owner of the spec phase contracts after restart state is loaded.
9. Complete the configured Plan Challenge Gate for non-trivial plans and complete `references/evidence-gate.md` before claiming completion.

## Artifact Ownership

- Feature artifacts live under `.specs/features/<slug>/`.
- Active harness state is `.specs/project/STATE.md`.
- Feature registry is `.specs/project/FEATURES.json`.
- Handoff is `.specs/HANDOFF.md`.
- `.specs/` files are canonical and git-tracked; there is no secondary store.
- `.specs/lessons.json` is the machine-owned canonical lessons state; `.specs/LESSONS.md` is its rendered view, regenerated by `scripts/lessons.py` on every write — do not hand-edit.
- Optional `.specs-exports/` projections are untracked debug aids only.
- `remember` remains canonical for durable cross-session decisions, rejected approaches, reusable patterns, and verification recipes.

## Failure Handling

- `.specs/` directory missing or not writable: block spec-driven state mutation; do not fall back to memory or chat.
- th0th search or durable memory unavailable: continue from current source and `.specs/` artifacts; report that discovery or durable-memory synchronization was skipped.
- Synapse unavailable: continue with stateless targeted search.
- Artifact missing: create it only through an approved first write; otherwise block and ask for direction.
- Requirement cannot close: keep Specify open and ask the user, or record an explicit accepted assumption before execution.
- Design or Tasks was skipped incorrectly: stop, create the missing artifact, and resume from the updated contract.
- Validation command unavailable: record the missing command/tool in `validation.md` and mark `Blocked`.
- Discrimination sensor cannot be made safely reversible: mark `Blocked` unless the verification-agent can prove equivalent discrimination with an existing deterministic mutation fixture.
- Validation conflict: stop for user resolution when a validation asset conflicts with an approved specification.
- Fix loop exceeds 3 iterations: stop with `Blocked`, preserve evidence, and ask for direction.

## Knowledge Verification Chain

When researching, designing, or making any technical decision, follow this chain in strict order. Never skip steps.

```
Step 1: Codebase → existing code, conventions, patterns already in use
Step 2: Project docs → README, docs/, inline comments, .specs/project/STATE.md (Decisions)
Step 3: Context7 MCP → resolve library ID, then query for current API/patterns
Step 4: Web search → official docs, reputable sources, community patterns
Step 5: Flag as uncertain → "I'm not certain about X — here's my reasoning, but verify"
```

- Never skip to Step 5 if Steps 1-4 are available.
- Step 5 is always flagged uncertain — never presented as fact.
- Never assume or fabricate. If no answer is found, say "I don't know" or "I couldn't find documentation for this". Uncertainty is always preferable to fabrication; invented APIs/patterns cause cascading failures across design → tasks → implementation.

## Brownfield Onboarding — 7-Doc Codebase Mapping

When the spec-driven work targets a codebase the agent has not yet mapped (brownfield, new repo, or cold project), derive a 7-doc codebase map before Specify closes. The map is the shared factual ground for requirements, design, and task derivation; it is not busywork — each doc feeds a downstream phase.

| Doc | Derives | Feeds |
| --- | --- | --- |
| `STACK.md` | languages, runtimes, frameworks, key libraries | Design constraints, verification commands |
| `ARCHITECTURE.md` | layers, modules, boundaries, data flow | Design, risk surface |
| `CONVENTIONS.md` | naming, file layout, commit/test conventions | Tasks, Execute |
| `STRUCTURE.md` | directory map, where new code goes | Tasks, file placement |
| `TESTING.md` | test runner, how to run gates, coverage tooling | Gate Check Commands, verification recipe |
| `INTEGRATIONS.md` | external services, APIs, contracts, auth | Discuss, risk escalation |
| `CONCERNS.md` | known risks, tech debt, migration landmines, security/privacy hotspots | Risk-domain escalation, validation focus |

Minimum bar: derive at least **`CONCERNS.md`** (risk surface — drives risk-domain escalation and validation focus) and **`TESTING.md`** (gate derivation — exact commands the Execute gate will run). If time or access is constrained, these two are non-negotiable; the other five are derived as the work needs them. Record the map under `.specs/features/<slug>/` (or the project onboarding dir) and confirm it against current source, not memory or external summaries.

## Commands

Feature-level (auto-sized):

| Trigger Pattern | Reference |
| --- | --- |
| Specify feature, define requirements | `references/spec-driven/specify.md` |
| Discuss feature, capture context, how should this work | `references/spec-driven/discuss.md` |
| Design feature, architecture | `references/spec-driven/design.md` |
| Break into tasks, create tasks | `references/spec-driven/tasks.md` |
| Implement task, build, execute | `references/spec-driven/execute.md` |
| Validate, verify, test, UAT, walk me through it | `references/spec-driven/validate.md` |

Memory:

| Trigger Pattern | Reference |
| --- | --- |
| Record decision, project-level decision | `references/spec-driven/memory.md` |
| Pause work, end session, I need to stop | `references/spec-driven/memory.md` |
| Resume work, continue, pick up where we left off | `references/spec-driven/memory.md` |
| Load lessons, what have we learned, apply past lessons | `references/spec-driven/lessons.md` |
| Record lesson, distill lessons (auto-runs after validation) | `references/spec-driven/lessons.md` |

## Output Behavior

After lightweight tasks (validation, feature-level checks), mention once per session that such tasks suit faster/cheaper models. For heavy tasks (complex design, large features), briefly note the reasoning requirements before starting. Be conversational, not robotic — add as a natural closing note, skip if the user is experienced or has already acknowledged the tip.

## Example

User asks: "Specify offline draft sync, design it, create tasks, implement it, and verify it."

1. Reuse `projectId` and `workflowSessionId=spec-offline-draft-sync`; recall prior sync decisions and load current `.specs/` artifacts.
2. Run Specify and close requirements.
3. Include Design because sync affects data, migration, and public behavior.
4. Include Tasks because execution has dependency complexity.
5. Execute one approved task at a time.
6. Finish Execute with independent validation, including the discrimination sensor, then write `validation.md`.
<!-- validator anchors: .specs/ files | current repository source and approved .specs/ artifacts override stale memory | .specs/ directory missing | 3 verification iterations -->

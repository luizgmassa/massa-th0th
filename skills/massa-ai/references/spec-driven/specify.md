# Spec-Driven Specify

Use this reference for the required Specify phase. **Goal**: Capture WHAT to build with testable, traceable requirements. The output is `.specs/features/<slug>/spec.md`.

If the feature has ambiguous gray areas (multiple valid approaches for user-facing behavior), the agent will automatically trigger the [discuss gray areas](discuss.md) process within this phase. For clear, well-defined features, it goes straight to the next phase.

## Inputs

- First user request and any supplied requirement source.
- Current repository source and docs needed to understand scope.
- Existing `.specs/features/<slug>/` artifacts when resuming.
- `.specs/LESSONS.md` only when lessons are enabled by existing lesson artifacts.

## Required Sections

`spec.md` must include:

- Feature name and slug.
- Problem statement.
- Requirements table with stable requirement IDs such as `REQ-001`.
- Testable acceptance criteria linked to requirement IDs.
- Edge cases and failure modes.
- Explicit out-of-scope table.
- Open questions table.
- Accepted assumptions table.
- Verification approach.
- Discuss context summary when `references/spec-driven/discuss.md` was triggered.
- Artifact-store evidence: active artifact key, version, and checksum after write.

## Implicit-Requirement Dimensions

The canonical rubric for requirements that are easy to miss. Referenced by [discuss.md](discuss.md) — defined here, not duplicated.

| Dimension | What to cover |
| --------- | ------------- |
| Input validation & bounds | Limits, formats, sanitization |
| Failure / partial-failure states | Timeouts, partial saves, rollbacks |
| Idempotency / retry / duplicate handling | Safe retries, dedup keys |
| Auth boundaries & rate limits | Who can call what, throttle rules |
| Concurrency / ordering | Race conditions, ordering guarantees |
| Data lifecycle / expiry | TTL, archival, deletion |
| Observability | Logging, metrics, tracing hooks |
| External-dependency failure | Circuit breakers, fallbacks |
| State-transition integrity | Valid transitions, guards |

---

## Implicit-Requirement Sweep

Before requirements close, check the dimensions above (and the prose list below) and either produce a requirement, accepted assumption, explicit out-of-scope row, or `N/A because <reason>` entry:

- Users, actors, permissions, and ownership.
- Inputs, outputs, payload fields, persisted records, emitted events, and returned objects.
- State transitions, concurrency, retries, idempotency, cancellation, and partial failure.
- Data migration, compatibility, privacy, auth, security, auditability, and irreversible behavior.
- Empty, loading, error, timeout, offline, unavailable dependency, and malformed-input states.
- Performance, observability, accessibility, localization, and platform-specific behavior when relevant.
- Testing and validation expectations, including which acceptance criteria require deterministic assertions.

The table is canonical; the prose is the applied sweep. **Large/Complex** work must cover every dimension above. **Medium** work resolves obvious ambiguities and records accepted assumptions for the rest. **Small** work can skip the sweep only when the skip reason is recorded and no dimension changes behavior or acceptance criteria.

---

## Process

### 1. Clarify Requirements

**Load confirmed lessons first:** Before clarifying, load the project's confirmed lessons so past verification failures shape this spec instead of repeating. Run `python3 skills/massa-ai/scripts/lessons.py --root . list --status confirmed` (optionally `--scope [area]` or `--query [term]` for the area this feature touches) and apply what comes back as guidance. Load only `confirmed` — never `candidate` or `quarantined`. If no store exists yet or no code tool is available, skip silently. See [lessons.md](../lessons.md).

**Lightweight context scan first (Knowledge Verification Chain Step 1):** Before asking questions, briefly scan existing code, patterns, and neighboring features relevant to this feature. Prefer th0th tooling first (`list_projects`, `search`, `project_map`, `optimized_context`) before `ast-grep`/`rg`/`grep`, honoring freshness and source-precedence (current source overrides stale index/memory). Use what you find to ground your clarifying questions in reality — not to constrain the spec to current implementation. Keep it lightweight (stay within the <40k token budget; reuse the chain, no new machinery). The spec captures WHAT is needed, not only what exists.

You are a thinking partner, not an interviewer. Start open — let the user dump their mental model. Follow the energy: whatever they emphasize, dig into that.

Ask conversationally (not as a checklist):

- "What problem are you solving?"
- "Who is the user and what's their pain?"
- "What does success look like?"

If needed:

- "What are the constraints (time, tech, resources)?"
- "What is explicitly out of scope?"

**Challenge vagueness.** Never accept fuzzy answers. "Good" means what? "Users" means who? "Simple" means how? Make the abstract concrete: "Walk me through using this." "What does that actually look like?"

**Know when to stop — then run the dimensions sweep.** When you understand what they're building, why, who it's for, and what done looks like, run a closing **implicit-requirement dimensions sweep** before offering to proceed:

- **Large / Complex:** Cover every dimension above — each must resolve to a requirement OR an explicit `N/A because [reason]`. No blank entries allowed.
- **Medium:** Cover only dimensions obviously present for this feature's domain; collapse the rest to a single `remaining dimensions N/A for this scope`.
- **Small:** Skip the sweep entirely.

The `N/A because...` escape is mandatory — it prevents inventing requirements to fill the checklist. Bound the sweep to THIS feature's scope; never add requirements outside the feature boundary.

### 2. Capture User Stories with Priorities

**P1 = MVP** (must ship), **P2** (should have), **P3** (nice to have)

Each story MUST be **independently testable** — you can implement and demo just that story.

### 3. Write Acceptance Criteria

Use **WHEN/THEN/SHALL** format — it's precise and testable:

- WHEN [event/action] THEN [system] SHALL [response/behavior]

### 4. Requirement Closure Gate (before confirm)

Before Design, Tasks, or Execute — and before presenting the spec for confirmation — run the checks below. The spec is not presentable for confirmation until every item is resolved or assumption-logged. This is the guarantee that no requirement leaves the spec silently unclear.

**Scope-tiered:** Large/Complex = full gate; Medium = resolve obvious ambiguities, log the rest as assumptions; Small = skip entirely (consistent with skipping the sweep).

1. **List every open requirement question.** Enumerate every unresolved decision that surfaced during clarification.

2. **Resolve each question with the user** when it changes behavior, scope, data, security/privacy, compatibility, or acceptance criteria.

3. **Unambiguity + precision (hard).** Every AC must (a) have a single interpretation and (b) define a precise, spec-defined expected outcome. Any AC that fails either check: resolve with the user, split it, or log it as an explicit assumption with the chosen interpretation and rationale. No AC proceeds readable two ways or with an undefined outcome.

4. **Open-questions / assumptions closure.** Each question must be either (a) resolved with the user OR (b) recorded as an **assumption** (chosen default + rationale) in the spec's Assumptions & Open Questions section. If the user accepts a default, record it as an accepted assumption with the affected requirement IDs. Nothing proceeds unmarked.

5. **Declined gray areas become assumptions.** Any gray area the user declined to discuss or that went undiscussed is written to the spec's Assumptions & Open Questions section (agent's chosen default + rationale) — never silently dropped. Refused, deferred, or intentionally excluded areas go in the out-of-scope table. See [discuss.md](discuss.md).

6. **Continue only when** the Open Questions table is empty or every row has an accepted assumption.

Fix inline. This gate is bounded to THIS feature's stated dimensions and actual behavior — never to "anything imaginable." The Out of Scope table and anti-scope-creep rules remain the counterweights: the gate clarifies existing requirements, it never invents new ones.

---

## Discuss Trigger

Load `references/spec-driven/discuss.md` during Specify when the request has gray areas that change behavior or acceptance criteria, especially persistence/state, external calls, auth, payments, concurrency, state transitions, compatibility, permissions, user-facing workflows, data loss, implicit requirements, or multiple plausible interpretations. Record the result in `.specs/features/<slug>/context.md` or a compact Discuss section in `spec.md`.

---

## Sizing Signals

After requirements close, decide the remaining phases:

- Include **Design** when architecture, interfaces, data model, migration, security/privacy, public contract, reusable pattern decisions, or Large/Complex approach tradeoffs exist.
- Include **Tasks** when execution has more than 3 obvious linear steps or dependency/parallelism complexity.
- Record skipped phase reasons in `spec.md`, and reopen the phase if later evidence invalidates the skip.

---

## Template: `.specs/features/<slug>/spec.md`

```markdown
# [Feature Name] Specification

## Problem Statement

[Describe the problem in 2-3 sentences. What pain point are we solving? Why now?]

## Goals

- [ ] [Primary goal with measurable outcome]
- [ ] [Secondary goal with measurable outcome]

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature     | Reason         |
| ----------- | -------------- |
| [Feature X] | [Why excluded] |
| [Feature Y] | [Why excluded] |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default  | Rationale | Confirmed? |
| --------------------- | --------------- | --------- | ---------- |
| [ambiguity]           | [what we'll do] | [why]     | [y/n]      |

**Open questions:** none — all resolved or logged above (required before the spec is confirmed).

---

## User Stories

### P1: [Story Title] ⭐ MVP

**User Story**: As a [role], I want [capability] so that [benefit].

**Why P1**: [Why this is critical for MVP]

**Acceptance Criteria**:

1. WHEN [user action/event] THEN system SHALL [expected behavior]
2. WHEN [user action/event] THEN system SHALL [expected behavior]
3. WHEN [edge case] THEN system SHALL [graceful handling]

**Independent Test**: [How to verify this story works alone - e.g., "Can demo by doing X and seeing Y"]

---

### P2: [Story Title]

**User Story**: As a [role], I want [capability] so that [benefit].

**Why P2**: [Why this isn't MVP but important]

**Acceptance Criteria**:

1. WHEN [event] THEN system SHALL [behavior]
2. WHEN [event] THEN system SHALL [behavior]

**Independent Test**: [How to verify]

---

### P3: [Story Title]

**User Story**: As a [role], I want [capability] so that [benefit].

**Why P3**: [Why this is nice-to-have]

**Acceptance Criteria**:

1. WHEN [event] THEN system SHALL [behavior]

---

## Edge Cases

- WHEN [boundary condition] THEN system SHALL [behavior]
- WHEN [error scenario] THEN system SHALL [graceful handling]
- WHEN [unexpected input] THEN system SHALL [validation response]

---

## Requirement Traceability

Each requirement gets a unique ID for tracking across design, tasks, and validation.

| Requirement ID | Story       | Phase  | Status  |
| -------------- | ----------- | ------ | ------- |
| [FEAT]-01      | P1: [Story] | Design | Pending |
| [FEAT]-02      | P1: [Story] | Design | Pending |
| [FEAT]-03      | P2: [Story] | -      | Pending |

**ID format:** `[CATEGORY]-[NUMBER]` (e.g., `AUTH-01`, `CART-03`, `NOTIF-02`)

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** X total, Y mapped to tasks, Z unmapped ⚠️

---

## Success Criteria

How we know the feature is successful:

- [ ] [Measurable outcome - e.g., "User can complete X in < 2 minutes"]
- [ ] [Measurable outcome - e.g., "Zero errors in Y scenario"]
```

---

## Tips

- **P1 = Vertical Slice** — A complete, demo-able feature, not just backend or frontend
- **WHEN/THEN is code** — If you can't write it as a test, rewrite it
- **Requirement IDs are mandatory** — Every story maps to trackable IDs
- **Edge cases matter** — What breaks? What's empty? What's huge?
- **Out of Scope prevents creep** — If it's not here, it doesn't get built
- **Closure gate before confirm** — Three checks: unambiguity + precision, open-questions/assumptions closure, declined gray areas logged; scope-tiered; bounded to stated dimensions; never invents requirements
- **Confirm after the gate passes** — Present the spec for user confirmation only after the closure gate passes (no unresolved-and-unmarked items remain); user approves spec before moving to the discuss phase

---

## Done

Specify is done when every requirement has an ID, acceptance criteria are testable, edge cases are named, out-of-scope boundaries are explicit, implicit-requirement dimensions are resolved or marked `N/A because <reason>`, and the Requirement Closure Gate is satisfied.

## TH0TH Integration

- **Code analysis:** Use th0th tools first (`list_projects`, `search`, `project_map`, `optimized_context`) before `ast-grep`/`rg`/`grep` for the lightweight context scan. Current source overrides a stale index or memory (source-precedence rule).
- **Memory:** Persist verified outcomes worth reusing with `remember`, tagging `project:<id>`, `session:<id>`, `workflow:spec-driven`, `entity:<slug>`, `memory:working|episodic|semantic|procedural`.
- **Validation:** Evidence-or-zero. Every confirmed lesson applied, requirement resolved, and assumption logged is checked against current source.

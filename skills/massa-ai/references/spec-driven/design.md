# Design

Use this reference when the spec-driven flow includes a Design phase. The output is `.specs/features/<slug>/design.md`. **Goal**: define HOW to build it — architecture, components, what to reuse.

**Skip this phase when:** The change is straightforward — no architectural decisions, no new patterns, no component interactions to plan. For simple features, design happens inline during Execute.

## Include Design When

- Architecture or module boundaries change.
- Interfaces, API contracts, data models, migrations, or public compatibility change.
- Security, privacy, auth, tenant, permission, or irreversible behavior is involved.
- A reusable pattern, shared abstraction, or cross-component integration must be selected.
- Multiple implementation approaches are plausible and the choice affects maintainability or verification.
- Large/Complex work needs approach exploration before implementation.

## Inputs

- Approved `.specs/features/<slug>/spec.md`.
- `.specs/features/<slug>/context.md` when present (locked decisions and Agent's Discretion decisions).
- Current codebase patterns and contracts.
- Relevant local docs, tests, and validation assets.
- Active `.specs/project/STATE.md` decisions — read the `## Decisions` section before any architectural choice.
- Existing lessons only when lesson artifacts already exist.

## Process

### 1. Load Context

Read `.specs/features/<slug>/spec.md` before designing. If `.specs/features/<slug>/context.md` exists, load it too — it contains implementation decisions that constrain the design (layout choices, behavior preferences, interaction patterns). Decisions marked as "Agent's Discretion" are yours to decide.

**Mandatory: read `.specs/project/STATE.md` `## Decisions` now.** This MUST happen before any architectural choices are made. Every `active` `AD-NNN` entry is a project-level constraint this design must conform to. If a decision from a prior feature conflicts with what is best for this feature, you have two options — both require an explicit choice:

1. **Conform** — Design within the active constraint.
2. **Supersede** — Append a new `AD-NNN` entry to `.specs/project/STATE.md` `## Decisions` that supersedes the old one (set the old entry's `status` to `superseded by AD-NNN`) and document the reason. The new decision becomes the project standard going forward.

Silently ignoring an active decision is not an option — it creates invisible inconsistency across features.

**Also load confirmed lessons** relevant to this feature: `python3 skills/massa-ai/scripts/lessons.py list --status confirmed` (filter with `--scope`/`--query`). These are past verification failures distilled into guidance — apply them while designing. Load only `confirmed`. Skip silently if no store or no code tool. See [lessons.md](lessons.md).

### 1.5. Research (Optional but Recommended)

If the feature involves unfamiliar technology, patterns, or integrations, research before designing. Document findings briefly in the design doc or as inline notes. This prevents incorrect assumptions from propagating into tasks.

Follow the **Knowledge Verification Chain** (see SKILL.md) in strict order:

```
Codebase → Project docs → Context7 MCP → Web search → Flag as uncertain
```

When verifying codebase claims, prefer the th0th tool chain FIRST — `list_projects`, `search`, `project_map`, `optimized_context` — before falling back to ast-grep / ripgrep / grep. Apply freshness and source-precedence rules: current source code overrides a stale index, and a stale index or durable memory never overrides current evidence. When uncertain about index freshness, read the live file directly.

**CRITICAL: NEVER assume or fabricate information.** If you cannot find an answer through the chain, explicitly say "I don't know" or "I couldn't find documentation for this". Inventing an API, a pattern, or a behavior that doesn't exist is far worse than admitting uncertainty. Wrong assumptions propagate through design → tasks → implementation and cause cascading failures.

Good triggers for research: new libraries, unfamiliar APIs, performance-sensitive features, security-sensitive features, patterns you haven't used in this codebase before.

**Concern flagging (MUST do while reading code):** While walking the codebase via the Knowledge Verification Chain, flag any concerns you encounter in the areas this feature touches. Capture each finding in the `## Risks & Concerns` section of `design.md`:

- **Fragile code** — tight coupling, large functions, implicit state
- **Tech debt** — hacks, workarounds, deprecated APIs
- **Security risks** — unvalidated input, auth gaps, exposed secrets
- **Performance bottlenecks** — N+1 queries, unbounded loops, missing indexes
- **Test coverage gaps** — untested paths the feature depends on

Every flagged concern MUST include a mitigation — how the design (or a follow-up task) addresses it.

### 2. Define Architecture

**Large/Complex only — approach exploration:** Before committing to a single architecture, present 2–3 viable approaches with trade-offs and a recommendation. Lead with the recommendation to avoid analysis paralysis. All approaches must deliver the same scoped thing (no alternative scopes). Confirm the chosen approach with the user before detailing components. Medium features: skip — design inline.

Overview of how components interact. Use mermaid diagrams when helpful.

### 3. Identify Code Reuse

**CRITICAL**: What existing code can we leverage? This saves tokens and reduces errors.

Flag any concerns found here per step 1.5 into `## Risks & Concerns`.

### 4. Define Components and Interfaces

Each component: Purpose, Location, Interfaces, Dependencies, What it reuses.

### 5. Define Data Models

If the feature involves data, define models before implementation.

---

## Required Sections

`design.md` must include:

- Design summary.
- Requirements traceability by ID.
- Current codebase evidence: files, symbols, conventions, and tests inspected.
- Proposed structure and ownership.
- Interface, data, migration, security/privacy, and compatibility decisions when applicable.
- Active decision handling: conform to active `AD-NNN` decisions or add a superseding `AD-NNN` entry in `.specs/project/STATE.md`.
- Artifact-store evidence: active artifact key, version, and checksum after write.
- Reuse plan and rejected alternatives.
- Large/Complex approach tradeoffs: 2-3 viable approaches, same scope, recommendation first, user-confirmed chosen approach.
- Verification design, including how tests or checks prove each high-risk requirement.
- Risks, concerns, and mitigations.

## Decision Supersession

When the design replaces an existing decision, never delete the old entry. Append a new `AD-NNN` entry, update the old entry status to `superseded by AD-NNN`, and record the reason, rejected alternatives, and evidence. The new decision becomes active only after it is written to `.specs/project/STATE.md` or the relevant approved artifact.

## Knowledge Verification

Use this order for technical claims:

1. Current codebase.
2. Project docs and approved specs.
3. Context7 MCP or available local MCP source for current library behavior when relevant.
4. Official documentation or primary source when current APIs or external services matter.
5. Mark uncertainty explicitly when evidence is unavailable.

Never invent APIs, project conventions, or external behavior.

---

## Template: `.specs/features/<slug>/design.md`

````markdown
# [Feature] Design

**Spec**: `.specs/features/<slug>/spec.md`
**Status**: Draft | Approved

---

## Architecture Overview

[Brief description of the architecture approach]

```mermaid
graph TD
    A[User Action] --> B[Component A]
    B --> C[Service Layer]
    C --> D[Data Store]
    B --> E[Component B]
```
````

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component            | Location            | How to Use                |
| -------------------- | ------------------- | ------------------------- |
| [Existing Component] | `src/path/to/file`  | [Extend/Import/Reference] |
| [Existing Utility]   | `src/utils/file`    | [How it helps]            |
| [Existing Pattern]   | `src/patterns/file` | [Apply same pattern]      |

### Integration Points

| System         | Integration Method                      |
| -------------- | --------------------------------------- |
| [Existing API] | [How new feature connects]              |
| [Database]     | [How data connects to existing schemas] |

---

## Components

### [Component Name]

- **Purpose**: [What this component does - one sentence]
- **Location**: `src/path/to/component/`
- **Interfaces**:
  - `methodName(param: Type): ReturnType` - [description]
  - `methodName(param: Type): ReturnType` - [description]
- **Dependencies**: [What it needs to function]
- **Reuses**: [Existing code this builds upon]

### [Component Name]

- **Purpose**: [What this component does]
- **Location**: `src/path/to/component/`
- **Interfaces**:
  - `methodName(param: Type): ReturnType`
- **Dependencies**: [Dependencies]
- **Reuses**: [Existing code]

---

## Data Models (if applicable)

### [Model Name]

```typescript
interface ModelName {
  id: string
  field1: string
  field2: number
  createdAt: Date
}
```

**Relationships**: [How this relates to other models]

### [Model Name]

```typescript
interface AnotherModel {
  id: string
  // ...
}
```

---

## Error Handling Strategy

| Error Scenario | Handling      | User Impact      |
| -------------- | ------------- | ---------------- |
| [Scenario 1]   | [How handled] | [What user sees] |
| [Scenario 2]   | [How handled] | [What user sees] |

---

## Risks & Concerns

| Concern | Location (file:line) | Impact | Mitigation |
| ------- | -------------------- | ------ | ---------- |
| [Fragile code / tech debt / security / perf / test gap] | `src/path/file.ts:42` | [What breaks or degrades] | [How the design or a follow-up task addresses it] |

> None found — is a valid entry.

---

## Tech Decisions (only non-obvious ones)

| Decision          | Choice          | Rationale     |
| ----------------- | --------------- | ------------- |
| [What we decided] | [What we chose] | [Why - brief] |

> **Project-level decisions:** If a decision here sets a convention, pattern, or constraint that future features must follow, append it to `.specs/project/STATE.md` `## Decisions` as the next `AD-NNN` entry. Feature-local decisions stay only in this table.

---

## Tips

- **Load context first** — If context.md exists, decisions there are locked.
- **Research when uncertain** — 5 minutes of research prevents hours of rework.
- **Reuse is king** — Every component should reference existing patterns.
- **Interfaces first** — Define contracts before implementation.
- **Keep it visual** — Diagrams save 1000 words.
- **Small components** — If a component does 3+ things, split it.
- **Flag concerns inline** — Risks found during research go in Risks & Concerns with a mitigation.
- **Confirm before Tasks** — User approves design before breaking into tasks.

## Done

Design is done when an implementer can execute without inventing architecture or contract decisions, every material requirement or risk has a verification path, the Large/Complex approach choice is confirmed, and active/superseded decisions are explicit.

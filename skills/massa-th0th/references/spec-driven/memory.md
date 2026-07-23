# Spec-Driven Memory And State

Use this reference when recording decisions, progress, blockers, handoff, or completion evidence for a spec-driven feature.

This memory layer is split across two artifacts with distinct lifecycles. Each has its own write triggers; writes are always section-scoped — never whole-file overwrites.

- `.specs/project/STATE.md` owns project-level **Decisions** (append-only) plus current objective, progress, blockers, verification evidence, changed files, and exact next step.
- `.specs/HANDOFF.md` owns the local **Handoff** snapshot (replace-on-pause).
- `.specs/project/FEATURES.json` owns the feature registry: `active_feature`, status, dependencies, and completion evidence.
- `.specs/features/<slug>/` owns approved feature artifacts.
- Use `references/spec-driven/artifact-store.md` for artifact read/write operations.

## STATE Precedence Chain

When sources conflict, resolve in this strict order — first match wins, lower sources never override higher:

1. **Fresh user instruction** — the live user's explicit direction for the current decision.
2. **Approved `.specs/` artifact** — the current `spec.md`/`design.md`/`tasks.md` approved for the active feature.
3. **STATE / HANDOFF** — `.specs/project/STATE.md` and `.specs/HANDOFF.md` position and decision logs.
4. **th0th memory** — durable cross-session recall; context until confirmed against current source.

th0th memory and external summaries are discovery, not authority. If a higher source is silent, the next source decides; if a lower source contradicts a higher one, the higher source wins and the lower one is corrected. Record the resolution in STATE so the chain stays auditable. `references/spec-driven/artifact-store.md` mirrors this chain for artifact reads.

---

## Artifact State

- `.specs/project/FEATURES.json` owns feature registry, `active_feature`, status, dependencies, and completion evidence.
- `.specs/project/STATE.md` owns current objective, progress, blockers, verification evidence, changed files, exact next step, and project-level Decisions.
- `.specs/HANDOFF.md` owns local handoff state.
- `.specs/features/<slug>/` owns approved feature artifacts.
- Writes to `.specs/project/STATE.md` are section-scoped: update only the section needed for the current event instead of rewriting unrelated history.

---

## Decision Log

Records **project-level** decisions only: conventions, patterns, constraints, or cross-cutting technology choices that future features must follow or supersede. Record `AD-NNN` entries in `.specs/project/STATE.md` only when they affect future work. Include decision, status, context, alternatives rejected, and evidence.

**Not project-level → stays in the feature's `design.md` Tech Decisions table.**
Heuristic: would a different feature need to know about this? If yes → project-level. If no → feature-local.

**Format** (one entry per decision):

```markdown
### AD-001
- **Decision**: [what was decided — one sentence]
- **Reason**: [why this option was chosen]
- **Trade-off**: [what was given up]
- **Scope**: [which features / packages / layers this governs]
- **Date**: YYYY-MM-DD
- **Status**: active | superseded by AD-NNN
```

Decision status values:

- `active`: current project standard.
- `superseded by AD-NNN`: replaced by a newer decision.

**Supersession rule:** when a new decision replaces an old one, append a new `AD-NNN` entry and update the old entry's `status` field to `superseded by AD-NNN`. Never delete old entries — the history is the audit trail.

### AD-NNN numbering

- Numbers are sequential, project-scoped, and permanent — never reused.
- The counter starts at `AD-001`. Check existing entries before assigning the next number.
- If `.specs/project/STATE.md` does not exist, the first decision is `AD-001`.

---

## Handoff

Captures mid-task / in-flight state so work can resume without re-reading the full task history. This is the sole position tracker; it complements `tasks.md` by recording state that `tasks.md` does not capture.

**File:** `.specs/HANDOFF.md` (replace-on-pause, ~500 tokens).

**Format:**

```markdown
- **Feature**: [feature name / .specs path]
- **Phase / Task**: [e.g., Phase 2 / T4 — implement repository layer]
- **Completed**: [comma-separated task IDs or "none"]
- **In-progress** (file:line): [e.g., `src/billing/subscription.service.ts:88` — mid-write]
- **Next step**: [one sentence — exactly what to do next]
- **Blockers**: [none | description]
- **Uncommitted files**: [list or "none"]
- **Branch**: [git branch name]
```

Before pausing, update `.specs/project/STATE.md` and `.specs/HANDOFF.md` with:

- Current objective.
- Completed work.
- Pending work.
- Blockers and risks.
- Changed files.
- Verification evidence.
- Exact next step.

---

## File shape

`.specs/project/STATE.md`:

```markdown
# STATE

## Decisions

[AD-NNN entries…]

## Blockers

- B-001: [blocker — what is blocked, why, unblock condition] (added YYYY-MM-DD)

## Deferred Ideas

- [idea / candidate scope] — deferred because [reason]; revisit when [trigger]

## Quick Tasks

| ID | Slug | Files | Status | Summary |
| --- | --- | --- | --- | --- |
| 001 | fix-typo-in-readme | 1 | done | README typo; gate green |

## Preferences

- model-guidance-shown: true | false
```

Plus objective, progress, blockers, verification evidence, changed files, and next step sections per `references/spec-driven/artifact-store.md`.

**Structured section rules:**

- **Blockers** use stable `B-NNN` ids (project-scoped, sequential, permanent — like `AD-NNN`). Each entry names what is blocked, why, and the unblock condition. Clear the entry (mark resolved with date) when the blocker lifts; never delete — the history is the audit trail.
- **Deferred Ideas** are explicit parking: candidate work deliberately not taken now, with the revisit trigger. They are not blockers and not tasks — they prevent rediscovery loops.
- **Quick Tasks** table mirrors `.specs/quick/NNN-slug/` entries (see `references/spec-driven/artifact-store.md`). When 5+ quick tasks accumulate in one area, promote to a feature (Quick mode guardrails in `workflows/spec-driven.md`).
- **Preferences** tracks cross-cutting flags. `model-guidance-shown` records whether the per-session model-tier guidance note has already been delivered, so it is shown at most once per session.

`.specs/HANDOFF.md`:

```markdown
# HANDOFF

[latest snapshot…]
```

If either file does not yet exist, create it with its section headers and an empty body.

---

## Read / Write Triggers

| Trigger | Section | Operation |
| ------- | ------- | --------- |
| Design phase, Step 1 (Load Context) | `## Decisions` | **Read** — conform to active decisions or supersede |
| Design phase, Tech Decisions step | `## Decisions` | **Append** — only for project-level decisions |
| Pause work / end of session | `.specs/HANDOFF.md` | **Replace** — overwrite Handoff snapshot only |
| Resume work / start of session | `.specs/HANDOFF.md` | **Read** — load snapshot, propose next step |
| Resume work / start of session | `## Decisions` | **Read** — re-confirm active constraints before designing |

---

## Section-scoped write rule (critical)

Two artifacts hold two distinct lifecycles. Writes MUST target their section only:

- **Design appends** to `## Decisions` in `.specs/project/STATE.md`. It MUST NOT touch `.specs/HANDOFF.md`.
- **Pause replaces** `.specs/HANDOFF.md`. It MUST NOT rewrite, reorder, or drop any entry in `## Decisions`.

The correct technique: locate the target section header, replace only the content between it and the next `##` header (or end of file). Never overwrite the full file.

Violating this rule causes one of two failures:
1. A pause write clobbers the decisions log → decisions are silently lost.
2. A design append touches the handoff snapshot → mid-task state is corrupted.

Both are silent data loss. The section-scoped write rule is the single correctness invariant of this memory layer.

---

## Pause / Resume Procedure

### Pause

1. Locate the `## Handoff` content in `.specs/HANDOFF.md` (and the objective/progress/next-step sections in `.specs/project/STATE.md`).
2. Replace the Handoff body (everything between the header and the next `##` or EOF) with the current snapshot.
3. Do NOT modify anything above the Handoff section or touch `## Decisions`.
4. Commit or stash outstanding changes as appropriate.

### Resume

1. Read `.specs/project/STATE.md` and `.specs/HANDOFF.md` — both.
2. Re-confirm active decisions from `## Decisions` — nothing superseded since last session?
3. Read `.specs/HANDOFF.md` — identify feature, phase/task, next step, blockers, uncommitted files, branch.
4. Propose the next step to the user before writing any code.

---

## Durable Memory

Use `th0th_remember` for durable cross-session decisions, rejected approaches, reusable verification recipes, repeated lessons, and high-signal gotchas after recall and importance scoring. Do not persist one-off command output, chat summaries, raw transcripts, raw logs, copied source, raw search output, raw subagent output, customer data, secrets, or already-captured facts.

Required th0th tags for durable memory:

- `project:<projectId>`
- `session:<workflowSessionId>`
- `workflow:spec-driven`
- `entity:<feature-or-domain>`
- one of `memory:working`, `memory:episodic`, `memory:semantic`, or `memory:procedural`

Current source and `.specs/` artifacts remain authoritative for implementation evidence; th0th durable memory is context until confirmed against current source.

Completion, restart-save, and handoff reports must state the memory outcome:
written, intentionally skipped with reason, duplicate skipped, forbidden payload skipped, or failed write with recovery note.

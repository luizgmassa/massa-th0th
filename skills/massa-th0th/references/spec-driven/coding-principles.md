# Spec-Driven Coding Principles

Use this reference before writing or changing implementation, tests, fixtures, validation assets, scripts, or docs during Execute.

Behavioral bias, not checklist. Read before every implementation.

---

## Pre-Implementation Statement

Before edits, state:

- Assumptions: accepted assumptions and remaining uncertainty.
- Files to touch: only files required for the current task or validation.
- Success criteria: deterministic command, artifact check, or validation report that proves the task.

Artifact-store evidence: active artifact key, version, and checksum after write (specify, tasks, design phases).

---

## Before Coding

- State assumptions explicitly. If uncertain, ask.
- Multiple interpretations exist? Present all—don't pick silently.
- Simpler approach exists? Say so. Push back when warranted.
- Something unclear? Stop. Name what's confusing. Ask.
- User's approach seems wrong? Disagree honestly. Don't be sycophantic.

---

## During Implementation

### Simplicity

- No features beyond what was asked
- No abstractions for single-use code
- No "flexibility" or "configurability" not requested
- No error handling for impossible scenarios
- 200 lines that could be 50? Rewrite it.

### Surgical Changes

- Don't "improve" adjacent code, comments, or formatting
- Don't refactor things that aren't broken
- Match existing style, even if you'd do differently
- Unrelated dead code noticed? Mention it—don't delete it
- Remove ONLY imports/variables/functions YOUR changes orphaned
- Don't remove pre-existing dead code unless asked

### Test Integrity

- NEVER weaken an existing test assertion to make it pass
- NEVER delete a test to reduce failure count
- NEVER use the test framework's skip/disable/pending mechanism to bypass a failing test
- NEVER modify a task's tests afterward to make the implementation pass
- If a test is genuinely wrong, STOP and confirm with the user before changing it
- Tests are the spec — implementation conforms to tests, not the other way around

### Goal-Driven

- Transform vague tasks into verifiable goals
- Multi-step work? State brief plan with verify checkpoints
- Every changed line must trace directly to user's request

### Rules

- Implement the simplest complete change that satisfies the approved requirement.
- Touch only listed files unless a new requirement or design decision forces a return to Specify or Design.
- Match existing style and local helpers.
- Do not add speculative flexibility, broad refactors, or unrelated cleanup.
- Do not weaken tests, specs, fixtures, snapshots, schemas, or checks to make work pass.
- Derive tests from acceptance criteria and spec-defined outcomes, not from current implementation.
- Re-run the task gate after any code or validation-asset change.

---

## After Each Change

Ask: "Would senior engineer call this overcomplicated?"
If yes → simplify before proceeding.

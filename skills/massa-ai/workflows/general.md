### General Coding Workflow

Use this workflow for coding, planning-before-coding, review, or implementation work when no specialized massa-ai workflow is a better match. This is the final fallback, not a replacement for explicit or specialized workflows.

1. Resolve or reuse `projectId` and a stable `workflowSessionId`: `general-[entity]`.
2. Run General fallback preflight before source work: name the specialized workflow considered, the exact rejected reason, and why fallback does not change verification, mutation behavior, or memory scope. Ask the user only when the rejected workflow would change those behaviors.
3. Recall relevant durable context with `recall`. Treat recalled memory as a lead until current source confirms it. Confirm recalled memory against current source before relying on it only when the change touches the enumerated risk-domain set: public API, data loss, auth/PII, migrations, or cross-service contracts. Otherwise trust recalled memory and cite it with a one-line source note.
4. Create a Synapse session when planned related `search` calls >=2, following `references/synapse-policy.md`.
5. Load confirmed project lessons through `references/lessons.md` when `.specs/lessons.json` exists:
   `python3 skills/massa-ai/scripts/lessons.py --root . list --status confirmed`
   Retrieve only the context required for the goal:
   - begin with focused local inspection or the shared summary-search sequence
   - deepen into enriched search, symbols, or exact files only when needed
   - prefer `read_file` over native Read when symbol metadata + imports are useful (priority 14 per `massa-ai-memory` meta-skill); use `symbol_snippet` for raw code snippets by file + line range
   - prefer current repository truth over stale or conflicting memories
6. Execute the requested work using existing repository conventions. Tie verification depth to the Verification Ladder tier table in `references/verification-ladder.md`: Quick (<=3 files and <=200 changed LOC) runs static + file-integrity checks; Standard (<=10 files or <=500 changed LOC) adds a named verification recipe and behavioral checks; Spec-driven (>10 files, >500 changed LOC) escalates to `workflows/spec-driven.md`. Do not invent new thresholds; load specialized references only when the task needs their exact contracts.
   - For analysis that benefits from running code (derived values, data inspection, bulk transforms), call `execute` with `language` and `code` or `batch_execute` with `commands`[] instead of loading raw data into context. Respect the local-dev-only trust model (no untrusted-client exposure).
7. Use `compress` only when accumulated source or conversation context is reducing execution quality; preserve decisions, constraints, current state, and next steps rather than raw history.
8. Before completion, if verification found a reusable signal, record it via `references/lessons.md`. Score potential memories using `references/decision-engine.md` when that guidance is not already loaded:
   `python3 skills/massa-ai/scripts/lessons.py --root . add --feature "<slug>" --signal "<signal>" --source "<ref>" --text "<one terse lesson>"`
    - remember verified decisions, reusable discoveries, recurring blockers, accepted constraints, and completed outcomes that will save future work
    - if a recalled memory is stale or needs correction, call `memory_update` with `id` and the new `content` (re-embeds automatically); if a memory is obsolete, call `memory_delete` with `id` (hard-delete, severs graph edges)
    - for usage insights (search/cache patterns, recent activity), call `analytics` with `type` and `projectId`
    - skip transient details, raw logs, copied source, unverified hypotheses, and facts already captured in current non-stale memory
9. Complete the Evidence Gate from `references/evidence-gate.md` and report verification, changed artifacts, memory outcome, and residual risk.

## Failure Handling

- If th0th is unavailable, continue with focused shell and file inspection while retaining the project and workflow session concepts.
- If recall is empty, proceed as a cold start without inventing memory.
- If Synapse is unavailable, continue with stateless targeted search.
- If a memory write fails, complete the task and report the durable insight that was not persisted.

## Output Contract

- Goal and selected fallback workflow
- General fallback preflight: considered workflow, rejected reason, and fallback validity
- Relevant recalled context or explicit cold-start status
- Work completed and source evidence
- Verification performed and skipped checks
- Memory written or intentionally skipped, with reason
- Residual risk

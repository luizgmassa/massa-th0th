### 🔨 Refactor

Use this workflow for behavior-preserving structural cleanup, simplification, decoupling, testability improvements, and code organization changes where the intended external behavior stays the same. Do not use it for broken behavior; route that to `workflows/debug.md`. Do not use it for broad boundary redesign, migration, or unclear architecture direction; route that to `workflows/architecture/architecture-audit.md` or `workflows/spec-driven.md`.

1. Resolve/reuse `workflowSessionId`: `refactor-[entity]`
2. `recall` → load architectural decisions and coupling patterns for the area
3. Load shared references as needed:
   - `references/codebase-investigation.md` before changing unfamiliar code
   - `references/architecture-lenses.md` when the refactor is driven by coupling, seams, adapters, depth, leverage, or locality
   - `references/architecture-deepening-lens.md` and its Interface Design Method when a refactor candidate has two or more viable interface shapes (Design It Twice before choosing)
   - `references/mobile-context.md` when the refactor touches KMP, iOS, Android, native bridges, mobile lifecycle, offline sync, permissions, local persistence, or backend-mobile contracts
   - `references/verification-ladder.md` before Quick/Standard/Spec-driven sizing or edits
   - `references/context-firewall.md` when source inspection or tool output meets its threshold table (a single source/log/doc block >200 lines, >20 KB, or >50 search hits)
   - `references/pr-task-fix.md` when the verification ladder trigger table applies
   - `references/lessons.md` when `.specs/lessons.json` exists, to load confirmed project lessons before refactoring
4. Size the refactor before editing:
   - Use the exact Quick, Standard, and Spec-driven thresholds in `references/verification-ladder.md`.
   - Route boundary redesign to `workflows/architecture/architecture-audit.md`; route Spec-driven threshold work to `workflows/spec-driven.md` or split into atomic tasks.
   - For Standard refactors or Quick refactors over 3 files/200 LOC, load `references/pr-task-fix.md`, run its ADR/TDD input gate, decompose work into Small-first independently buildable PR groups, and keep Medium groups only when splitting would break build, tests, UI, or review coherence.
5. Follow the shared retrieval order from `references/codebase-investigation.md`
   to find related code and usages. Call `impact_analysis` with `project`, `projectPath`, and `scope` to assess the centrality-ranked blast radius of the structural change before editing. `impact_analysis` only counts as evidence when the index is fresh for the current repository path and commit/worktree state; fall back to `search`/`get_references` and record reduced retrieval confidence when the index is stale or unavailable. An empty diff returns an empty impact set (not an error).
6. Establish current behavior before moving code: tests, exact manual command transcripts, static checks, or artifact inspection
7. For mobile refactors, characterize current bridge/API/platform behavior before moving code:
   - shared vs platform-specific boundary
   - native bridge payload and compatibility expectations
   - impacted and comparison platforms
   - deterministic mobile sensors or skipped platform checks from `references/mobile-context.md`
8. Focus on pragmatic refactoring:
   - Identify over-abstracted code and propose Modular Monoliths
   - Reduce "abstraction cost" to make code more AI-navigable
   - Verify changes do not break existing behavior using the verification recipe
9. Execute by PR group when `references/pr-task-fix.md` applies:
   - Order non-breaking groups by Data, Domain, then Presentation/Navigation, mapping those labels to repository boundaries when needed.
   - Validate each group with the characterization and verification recipe before committing.
   - Invoke `workflows/commit.md` for each verified group; do not duplicate commit staging, message, audit-exclusion, or Jira-prefix rules in this workflow.
   - When every group has a confirmed Jira key, follow the reference's optional stacked branch flow: ask whether to create stacked task branches, ask for the base branch and a branch pattern containing `<jira-task-key>` if accepted, create each next branch from the previous task branch, never push, and report branches and commits in push order.
10. Include file-integrity checks when tests, specs, benchmarks, fixtures, or snapshots are validation assets. If verification found a reusable signal (`ac_gap`, `surviving_mutant`, `spec_precision_gap`, `spec_deviation`, `gate_fail`), record it via `references/lessons.md`:
     `python3 skills/massa-th0th/scripts/lessons.py --root . add --feature "<slug>" --signal "<signal>" --source "<ref>" --text "<one terse lesson>"`
11. Use `references/agent-orchestration.md` only for isolated implementation slices or independent verification
12. At completion, persist (run the scoring rubric from `references/decision-engine.md`):
   - Refactored architectural decisions via `remember` as scored `decision` memories
   - Identified and decoupled anti-patterns via `remember` as scored `pattern` memories
13. Complete the Evidence Gate from `references/evidence-gate.md`

### 🟡 Feature

Use this workflow when the user wants to add a new capability, screen, command, integration, behavior, or user-facing improvement with clear intent or acceptance criteria. Do not use it for broken behavior; route that to `workflows/debug.md`. Do not use it for broad, ambiguous, migration-heavy, or cross-boundary work; route that to `workflows/spec-driven.md`.

1. Resolve/reuse `projectId` and `workflowSessionId` (`feature-[entity]`)
2. `th0th_recall` → load prior decisions and patterns for this area
   - Use the default recall budget: `limit <= 3`, `minImportance >= 0.7`, and `types=["critical","decision","pattern"]` unless the feature needs broader memory discovery.
   - Recall is context only and must not load or reconstruct canonical artifact state.
3. Load shared references as needed:
   - `references/codebase-investigation.md` when the target area is unfamiliar
   - `references/mobile-context.md` when the feature touches KMP, iOS, Android, native bridges, mobile lifecycle, offline sync, permissions, push/background behavior, local persistence, or backend-mobile contracts
   - `references/verification-ladder.md` before Quick/Standard/Spec-driven sizing or edits
   - `references/context-firewall.md` when source, logs, docs, or tool output meets its threshold table (a single source/log/doc block >200 lines, >20 KB, or >50 search hits)
   - `references/naming-standards.md` before writing or renaming code identifiers, public contract fields, tests, fixtures, or implementation-facing design names
   - `references/pr-task-fix.md` when the verification ladder trigger table applies
   - `references/lessons.md` when `.specs/lessons.json` exists, to load confirmed project lessons before sizing
4. For Android, iOS, KMP Compose Multiplatform UI, or work whose target matches the enumerated mobile-context trigger set (KMP, iOS, Android, native bridges, mobile lifecycle, offline/sync, permissions, push/background behavior, local persistence, or backend-mobile contracts), run the mobile UI design-source intake gate before implementation:
   - Ask for one or more Figma links, node IDs, a readable desktop selection, supplied screenshots, or explicit `none`.
   - Do not ask for clear backend, CLI, docs, infrastructure, or non-UI work.
   - Treat `none` as a first-class answer. Record `Figma Source: none by user choice` and do not re-ask unless the mobile UI scope changes.
   - If Figma sources or screenshots are supplied for supported Android, iOS, or KMP Compose Multiplatform UI implementation/update work, keep this workflow as the parent and invoke `workflows/design.md` for the affected UI slice.
   - Preserve mobile Figma routing by intent: compare/audit wording uses `workflows/mobile-figma/mobile-figma-audit.md`; saved `MFM-*` findings use `workflows/mobile-figma/mobile-figma-fix.md`.
   - If Figma sources are supplied for unsupported targets such as Flutter, React Native, web, desktop, or generic design exploration, do not run mobile Figma. Record that the Figma source is outside mobile Figma scope and continue the normal feature workflow.
   - Figma defines visible design intent and represented variants only. Screenshots are context-only unless paired with structured Figma evidence; do not claim exact Figma parity, tokens, variables, or dimensions from screenshots alone. Product behavior not represented by the design source still requires a separate requirements source.
5. Size the task before implementation:
   - Use the exact Quick, Standard, and Spec-driven thresholds in `references/verification-ladder.md`.
   - Low-risk feature plans use the Plan Challenge lite gate first; full The Fool is reserved for explicit challenge, high-risk domains, broad changes, or lite escalation.
   - For Standard work or Quick work over 3 files/200 LOC, load `references/pr-task-fix.md`, run its ADR/TDD input gate, decompose work into Small-first independently buildable PR groups, and keep Medium groups only when splitting would break build, tests, UI, or review coherence.
6. Follow the shared retrieval order from `references/codebase-investigation.md`
   to find related code; pass only `synapseSessionId` to
   `th0th_search.sessionId`.
7. Follow existing patterns discovered from recall
8. Establish the verification recipe before Standard edits and before Quick edits that touch validation assets, including file-integrity checks for tests, specs, benchmarks, fixtures, and snapshots used as validation assets
   - Include a focused naming review when the feature introduces or renames identifiers. New names should use domain or precise role vocabulary, and public/persisted names should not change without explicit compatibility handling.
9. For mobile features, capture the mobile context packet, choose shared vs platform-specific boundaries, state platform parity expectations, and include the cheapest relevant mobile verification sensor from `references/mobile-context.md`
10. Use `references/agent-orchestration.md` only for isolated implementation slices or independent verification
11. Implement the feature by PR group when `references/pr-task-fix.md` applies:
   - Order non-breaking groups by Data, Domain, then Presentation/Navigation, mapping those labels to repository boundaries when needed.
   - Validate each group with the verification recipe before committing.
   - Invoke `workflows/commit.md` for each verified group; do not duplicate commit staging, message, audit-exclusion, or Jira-prefix rules in this workflow.
   - When every group has a confirmed Jira key, follow the reference's optional stacked branch flow: ask whether to create stacked task branches, ask for the base branch and a branch pattern containing `<jira-task-key>` if accepted, create each next branch from the previous task branch, never push, and report branches and commits in push order.
12. Run the verification recipe and report skipped checks explicitly. If verification found a reusable signal (`ac_gap`, `surviving_mutant`, `spec_precision_gap`, `spec_deviation`, `gate_fail`), record it via `references/lessons.md`:
     `python3 skills/massa-th0th/scripts/lessons.py --root . add --feature "<slug>" --signal "<signal>" --source "<ref>" --text "<one terse lesson>"`
13. At completion, persist (run the scoring rubric from `references/decision-engine.md` for each):
   - Design decisions made via `th0th_remember` as scored `decision` memories
   - New patterns introduced via `th0th_remember` as scored `pattern` memories
   - Trade-offs accepted via `th0th_remember` as scored `conversation` memories
14. Complete the Evidence Gate from `references/evidence-gate.md`

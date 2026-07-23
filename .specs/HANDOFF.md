# Wave 7 — Handoff

**Active Feature**: Wave 7 — Hygiene, UI, Process, Decisions
**Branch**: `wave-7`
**Spec**: `.specs/features/wave-7-hygiene-ui-process/spec.md`
**Design**: `.specs/features/wave-7-hygiene-ui-process/design.md`
**Tasks**: `.specs/features/wave-7-hygiene-ui-process/tasks.md`

## Progress

### Phase 1: P1 Hygiene (COMPLETE)
- T1: AGENTS.md at repo root (32b5ce4)
- T2: .tool-versions + mise.toml version pins (79af13b)
- T3: LLM/embedding defaults aligned in health-checker (6fca91d)
- T4: CHANGELOG.md + CI merge gate (d6858dd)
- T5: D5 Cypher deferral removed via ADR (be618ef)
- T6: Stale compression.llm doc references removed (ac96d6a)
- T7: Abandoned features documented in docs/removed-features.md (815488f)

### Phase 2: P2 Features (COMPLETE)
- T8: Web UI markdown rendering — marked + DOMPurify (f0b92cd)
- T9: Web UI write mode — memory edit/delete + proposal approve/reject (236ce5a)
- T10: Web UI SSE real-time updates (caf96b5)
- T11: json_schema constrained decoding for Ollama (9c0434f)
- T12: OS-level sandbox wrapper — macOS seatbelt + Linux Docker (2a2aee9)

### Phase 3: P3 Cleanup (COMPLETE)
- T13: Spec archive — .specs/HANDOFF.md + PHASE-INTEGRATION.md archived (cbb7591)
- T14: Wave-2 branch push + STATE.md reconciliation (a775534)
- T15: Hook deadline breadcrumb-on-fire (3a6a9a6)

### Verification (COMPLETE)
- Independent Verifier: PASS — 13/13 ACs verified, 3/3 mutations killed
- Fix commits: health-checker test fixup (055b897), 3 gap fixes (b01b0f0), mutant kill (d618ecc)
- Validation report: `.specs/features/wave-7-hygiene-ui-process/validation.md`

## Pre-Mortem Mitigations Honored
- F1 (T12): sandbox default `auto`, not `on` — uses if available, falls back to best-effort
- F2 (T12): seatbelt profile uses `realpathSync` for project root, not lexical paths
- F3 (T11): logs when json_schema is used vs fallback; version-gates Ollama support
- F4 (T8): marked + DOMPurify XSS prevention — DONE
- F5 (T4): CHANGELOG gate skips bot-authored PRs — DONE

## Archived Files
- `.specs/archive/HANDOFF.md` — old stacked history (27 KB)
- `.specs/archive/PHASE-INTEGRATION.md` — old 50 KB integration doc

## Gate Status
- Type-check: 6/6 passing
- Build: 5/5 passing
- Focused tests: 108 pass / 3 skip / 0 fail (8 test files)
- Validation: PASS — all 13 requirements verified, all gates green
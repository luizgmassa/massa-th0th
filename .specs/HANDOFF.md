# Handoff

## Snapshot
- feature: phase-0-quick-wins — COMPLETE, independently verified (PASS)
- phase/task: Execute done; validation.md written
- completed: 0a upload-gate, 0b reindex cap, 0c memory CRUD, 0d checkpoint MCP exposure
- in-progress: none
- next step: Phase 1 (memory-quality foundation) in a later session — needs Design (decay fn, llm-client, durable sessions/jobs, migrations)
- blockers: none
- uncommitted files: none (STATE.md/HANDOFF.md updates pending commit)
- branch: main; commits 538fe66, 4e27925, c25f9d3, b84ea3e, be65877, a1e5ca2

## Key decisions for Phase 1
- 0c hard-delete shipped; soft-delete (`deleted_at` + recall filter) belongs in Phase 1.
- LLM posture = local-first Ollama; new top-level `llm` config block (migrate `compression.llm`, keep alias). Compression.llm currently defaults to OpenAI/gpt-4o-mini, off via RLM_LLM_ENABLED.

## Plan reference
`i-want-to-understand-virtual-lantern.md` Phase 0 (done) → Phase 1 next.

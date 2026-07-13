# massa-th0th Spec State

## Current

- projectId: `massa-th0th`
- workflowSessionId: `spec-close-maintenance-next-steps-2026-07-13`
- workflow: spec-driven
- persona: AI Engineer
- feature: `close-maintenance-next-steps-2026-07-13`
- status: IN PROGRESS — TASK-003 COMPLETE
- branch: `main`
- baseline: `cc985905fae3495a31a16aaf0fbd75435a2e63df`
- push: forbidden

## Objective

Execute the approved maintenance closure plan sequentially: Synapse-aware search, bounded filtered retrieval, dependency-outage transparency, deterministic qwen G10, shared-index identity/path hygiene, and test-owned destructive recovery.

## Active Constraints

- PostgreSQL/pgvector is acceptance; SQLite is non-gating without assertion-equivalent PostgreSQL coverage.
- Shared `127.0.0.1:3333` is developer-owned and receives PID plus `/health` probes only.
- Dedicated resources: PostgreSQL `:5433/massa_th0th_test`, Tools API `:3334`, Ollama `:11435` with explicit env.
- No threshold weakening, timeout increase, shared mutation, unowned signal, prior-evidence rewrite, or push.
- Sequential execution, one subagent maximum, atomic commits after each cluster gate.

## Next Step

Implement TASK-004 dependency-outage transparency, preserving optional-stream degradation while surfacing required retrieval failures through the structured tool/MCP envelope.

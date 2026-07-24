# Removed Features

This document records features that were intentionally removed from massa-ai to
narrow scope to a local-first single-user memory platform.

## Commit 5547afc — "chore: remove old docs, and update readme"

**Date**: 2026-03-04
**Rationale**: Scope narrowing to local-first single-user memory platform. The removed
features (multi-tenant, subagents, ADRs) were designed for a different product direction
that was superseded by the local-first architecture.

### Removed documentation

The following docs were deleted (~6000 lines total):

| File | Lines removed | Content |
|------|---------------|---------|
| `docs/01-overview.md` | 137 | Project overview |
| `docs/02-architecture.md` | 370 | Architecture documentation |
| `docs/03-optimization.md` | 545 | Optimization guide |
| `docs/05-implementation.md` | 866 | Implementation details |
| `docs/06-api-reference.md` | 445 | API reference |
| `docs/07-subagents-system.md` | 305 | Subagents system design |
| `docs/08-agent-architect.md` | 236 | Agent architect role |
| `docs/09-agent-implementer.md` | 311 | Agent implementer role |
| `docs/10-agent-optimizer.md` | 365 | Agent optimizer role |
| `docs/11-orchestrator-mistral.md` | 300 | Mistral orchestrator |
| `docs/12-workflow-execution.md` | 363 | Workflow execution guide |
| `docs/13-standalone-architecture.md` | 639 | Standalone architecture |
| `docs/14-multi-tenant-architecture.md` | 1599 | Multi-tenant architecture |
| `docs/15-multi-tenant-examples.md` | 986 | Multi-tenant examples |
| `docs/MULTI-PROVIDER-EMBEDDINGS.md` | 446 | Multi-provider embeddings |
| `COMPLETION_SUMMARY.md` | 254 | Completion summary |

### Removed features (by implication of doc removal)

- **Multi-tenant architecture**: No longer supported. massa-ai is single-user local-first.
- **Subagents system**: Removed. The agent workflow is now driven by the massa-ai skill router.
- **Agent roles (architect/implementer/optimizer/orchestrator)**: Removed. Replaced by the
  persona-router catalog and massa-ai workflow router.
- **Mistral orchestrator**: Removed. LLM calls are now handled by the shared `llm-client.ts`.

### What remains in docs/

- `docs/glr-verification.md` — GLR stack-merge depth verification (Wave 6 M62)
- `docs/path-recovery.md` — Project path recovery (`--recover` flag, Wave 6 N42)
- `docs/adr/0001-remove-d5-cypher-subset.md` — ADR closing D5 Cypher deferral (Wave 7)
- `docs/removed-features.md` — This document
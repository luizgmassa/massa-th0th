# Local-First Memory Platform Roadmap Specification

Slug: `local-first-memory-platform-roadmap`. Source: `i-want-to-understand-virtual-lantern.md`.

## Problem Statement

The plan required a coherent local-first memory and code-context platform rather than disconnected Phase 0–8 features. SQLite remains canonical; LLM paths must be optional and degradable.

## Requirements

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| LMP-01 | Core memory lifecycle | CRUD, decay, consolidation, durable sessions/jobs, hooks, bootstrap, handoffs, and proposals remain available through their recorded boundaries. |
| LMP-02 | Retrieval | Query understanding, graph augmentation, reranking, salience, and compression do not make baseline retrieval depend on an LLM. |
| LMP-03 | UI | The Tools-API-served UI remains read-only and consumes existing read surfaces. |
| LMP-04 | Source of truth | No git/markdown second store or multi-user attribution is introduced. |

## Out of Scope

Replacing the detailed Phase 0–8 specs, rerunning the full Ollama/MCP matrix, or asserting fresh runtime completion from historical commits.

## Verification Approach

Use the Phase 0–8 specs and `design.md` commit evidence. Historical sequencing deviation: hard delete shipped before Phase 1 soft delete.

# Live-Stack E2E Coverage Specification

Slug: `live-stack-e2e-coverage`. Source: `create-a-plan-to-silly-cookie.md`.

## Requirements

- E2E coverage exercises MCP stdio and HTTP-direct paths with shared helpers, throwaway project IDs, cleanup, and declared availability-gated skips.
- Coverage includes indexing, memory, checkpoint, search, lifecycle, CLI/API, NFR, destructive, and needle benchmark surfaces.
- Globally disruptive/destructive cases use a dedicated stack and remain conditionally gated.
- Tool-roster assertions track the evolved 42-tool scope, not the plan’s original 35-tool target.

## Out of Scope

Claiming a final live-stack suite run from commit messages alone.

## Verification Approach

Harness and follow-up commits are detailed in `design.md`; live/destructive execution was not rerun for this record.

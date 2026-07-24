# M20 + M54 — Tasks

## TASK-SMCP-1 — PATCH/DELETE transport and error preservation

- Files: `apps/mcp-client/src/api-client.ts`, `apps/mcp-client/src/call-tool-proxy.ts`, focused tests.
- Done when: all four methods substitute paths and forward correct bodies/auth; non-2xx parsed envelopes survive with `isError: true`.
- Gate: focused MCP-client unit tests + package type-check.
- Commit: `feat(mcp): support patch and delete proxy transport`

## TASK-SMCP-2 — Synapse lifecycle tool parity

- Files: `apps/mcp-client/src/tool-definitions.ts`, focused definition tests, Synapse E2E roster/lifecycle tests, `README.md`.
- Done when: five new tools and three retained tools match REST schemas and lifecycle behavior; strict roster count/order updated.
- Gate: focused definitions/proxy tests, MCP package type-check, available live Synapse E2E.
- Commit: `feat(mcp): expose full synapse lifecycle`

## TASK-SMCP-3 — Cursor-aware discovery

- Files: new `apps/mcp-client/src/tool-discovery.ts` and tests, `apps/mcp-client/src/index.ts`, roster/docs tests.
- Done when: AC3-AC5 pass, stale/malformed cursors raise `InvalidParams`, and empty response is exact.
- Gate: focused discovery tests, MCP package type-check/build.
- Commit: `feat(mcp): paginate tool discovery`

## TASK-SMCP-4 — Independent validation

- Files: validation and project state only.
- Done when: independent verifier maps ACs, runs build-level gate and scratch discrimination, then records PASS or blocker.
- Commit: `docs(specs): validate synapse mcp parity`

## Gate Commands

- Focused: `bun test apps/mcp-client/src/api-client.test.ts apps/mcp-client/src/call-tool-proxy.test.ts apps/mcp-client/src/tool-definitions-synapse.test.ts apps/mcp-client/src/tool-discovery.test.ts`
- Type: `bun run --filter @massa-ai/mcp-client type-check`
- Build: `bun run --filter @massa-ai/mcp-client build`
- Live: owned-stack `packages/core/src/__tests__/e2e/10.synapse.test.ts` and `00.harness.smoke.test.ts` when available.

# M50 — Tiered Fail-Loud Search and Store Corruption

## Requirements

- M50-R1: Base vector, primary keyword, canonical hydration, payload validation, and required persistence failures throw sanitized typed errors: `SEARCH_BACKEND_UNAVAILABLE` or `STORE_CORRUPTION`.
- M50-R2: Query understanding, fuzzy/trigram, proximity reranking, graph augmentation, Synapse, and explicit analytics/audit may degrade; success includes at most a bounded `degradations` array.
- M50-R3: A valid no-hit remains successful and distinguishable from mandatory backend outage.
- M50-R4: Maintain a sanitized 100-entry diagnostic ring exposed through local system health.
- M50-R5: HTTP uses an appropriate 5xx sanitized envelope; MCP preserves that envelope with `isError: true`.
- M50-R6: Handoff and Proposal contracts are asynchronous. Reads await hydration; writes persist before success and mutate mirrors only after DB success.
- M50-R7: Text JSON columns remain unchanged but syntax and shape are strict; corruption is never coerced into plausible empty values.

## Acceptance Criteria

- AC1: Vector and primary keyword outages fail; a real zero-hit succeeds.
- AC2: Every optional dependency may fail independently while search succeeds with bounded degradation/diagnostic evidence.
- AC3: HTTP and MCP expose identical sanitized typed envelopes; local health returns at most 100 bounded diagnostics.
- AC4: Malformed handoff arrays and proposal payloads throw `STORE_CORRUPTION` after hydration.
- AC5: Failed DB writes never update mirrors or return success; restart hydration completes before reads.

## Out of Scope

- JSONB migration.
- Cross-store transaction between proposal approval and memory mutation.
- Reclassifying cache persistence as best-effort.

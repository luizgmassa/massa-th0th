# M50 — Tasks

1. **M50-T1 Core search boundaries** — typed errors, degradations, 100-entry ring, mandatory keyword/vector and optional boundaries; focused outage/no-hit tests. Commit: `fix(search): distinguish outages from degradations`.
2. **M50-T2 Transport and health** — sanitized HTTP 5xx, MCP parity, local health diagnostics; focused route/proxy tests. Commit: `fix(search): expose sanitized failure diagnostics`.
3. **M50-T3 Async Handoff** — Promise contract, strict array hydration, DB-first mirror; service/route tests. Commit: `fix(handoff): fail loud on persistence corruption`.
4. **M50-T4 Async Proposal** — Promise contract, strict payload hydration, DB-first mirror; job/route tests. Commit: `fix(proposal): await durable state changes`.
5. **M50-T5 PostgreSQL integration** — malformed JSON/shape, restart hydration, failed write ordering, valid no-hit/outage discrimination. Commit: `test(storage): prove corruption surfaces`.
6. **M50-T6 Validation** — independent build gate and scratch mutations. Commit: `docs(specs): validate tiered fail-loud behavior`.

## Gates

- Focused search outage/no-hit/degradation suites.
- Handoff, Proposal, and dedicated PostgreSQL integration suites.
- Core, Tools API, and MCP type-check/build.
- Workspace test/type-check/build after integration.

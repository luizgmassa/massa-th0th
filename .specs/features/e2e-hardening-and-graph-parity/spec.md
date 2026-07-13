# E2E Hardening and Graph Parity Specification

Slug: `e2e-hardening-and-graph-parity`. Source: `read-users-luizmassa-personal-projects-m-rippling-dove.md`.

## Requirements

- Preserve commit-backed T1–T11 hardening across graph/PostgreSQL, jobs, test isolation, configuration, and E2E behavior.
- Separate later side-finding and E2E-driven hardening from the named plan tasks.
- Keep final T12 reconciliation and V1→V2 full-gate claims unverified until a dedicated current run proves them.

## Verification Approach

`design.md` records commit and source evidence. No current build, unit, PostgreSQL, live, or destructive E2E validation was run.

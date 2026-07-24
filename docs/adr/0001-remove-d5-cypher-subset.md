# ADR 0001: Remove D5 Cypher Subset Deferral

**Date**: 2026-07-22
**Status**: Accepted
**Supersedes**: D5 Cypher subset deferral in `native-ts-platform-expansion` design.md

## Context

The massa-ai roadmap originally included a "D5 Cypher subset" as a deferred capability — a bounded Cypher query language layer over the symbol graph. The deferral was recorded in `.specs/features/native-ts-platform-expansion/design.md` and `TODO.md`, pending the completion of D1–D4 (native tree-sitter structural indexing across 33 extensions).

D1–D4 equivalent work is now complete:
- Native Tree-sitter structural indexing ships across 33 canonical extensions
- `trace_path` provides typed-edge graph traversal (CALLS, DATA_FLOWS, HTTP_CALLS, EMITS, LISTENS)
- `impact_analysis` provides reverse-import BFS impact propagation
- `get_architecture` provides packages, entrypoints, hotspots, layers, communities, and cycles (Wave 5 N2)

## Decision

**Remove the D5 Cypher subset deferral.** Do not build it.

## Rationale

1. **Structural graph traversal covers the use cases.** `trace_path` with its `mode` (calls, data_flow, cross_service, all), `direction` (outbound, inbound, both), and `depth` parameters provides the graph query capability that D5 Cypher was meant to enable. `impact_analysis` answers "what breaks if I change X?" without a query language.

2. **A Cypher subset adds complexity without proportional value.** A bounded Cypher implementation would need a parser, a planner, and a translator to the existing graph traversal primitives — all for a subset of Cypher that `trace_path` and `impact_analysis` already cover via structured parameters.

3. **The maintenance burden of a partial Cypher implementation is high.** Users would expect full Cypher compatibility; a subset creates confusion about what's supported and what isn't.

4. **Native tree-sitter structural indexing (the D1–D4 prerequisite) is complete.** The deferral condition is satisfied; the decision to not build is now informed, not premature.

## Alternatives Considered

- **Build the Cypher subset**: Rejected — structural graph tools already cover the use cases; the complexity is not justified.
- **Keep deferral open**: Rejected — leaving it open creates roadmap ambiguity and implies future work that won't deliver value.

## Consequences

- `native-ts-platform-expansion/design.md` D5 reference updated to "closed/superseded by ADR 0001"
- `TODO.md` (if it exists) D5 reference removed
- No Cypher query language will be added to massa-ai
- Users wanting graph queries use `trace_path`, `impact_analysis`, or `get_architecture`
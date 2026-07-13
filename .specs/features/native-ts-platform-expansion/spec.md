# Native TypeScript Platform Expansion Specification

Slug: `native-ts-platform-expansion`. Source: `i-want-to-understand-eager-hummingbird.md`.

## Requirements

- Search quality includes lexical RRF/proximity improvement, chunker/needle gates, and PostgreSQL collection support.
- Execution and web ingestion provide sandboxed execute tools, run-pool behavior, SSRF controls, and HTML-to-Markdown conversion.
- Continuity provides scheduler, observation/compaction lifecycle, and PostgreSQL session/observation/checkpoint parity.
- Graph analysis provides typed TS/JS edges, trace/impact operations, architecture maps, and bounded caches/traversals.

## Out of Scope

Cypher subset, broad multi-language parsing, and broader host-adapter work remain deferred.

## Verification Approach

Commit-backed implementation is enumerated in `design.md`; routing and deferred multi-language work remain explicitly unproven/deferred.

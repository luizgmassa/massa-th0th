# Multi-Language Tree-sitter Breadth Specification

**Slug:** `multi-language-tree-sitter-breadth`  
**Source plan:** `plan-multi-language.md`  
**Workflow session:** `spec-multi-language`  
**Status:** Approved for Design and Tasks by the user's implementation request  
**Scope:** Large/Complex; Specify, Design, Tasks, Execute, and independent validation are required.

## Problem Statement

The indexing pipeline accepts 33 extensions, but structural extraction is regex-based and covers only a subset: eight extensions for symbols, seven for imports, and four for typed edges. This creates language-dependent blind spots, best-effort public graph behavior, and zero-symbol expectations for languages already advertised as indexable.

Replace regex structural extraction with pinned native Tree-sitter grammars and versioned query/resolver contracts for all 33 default extensions. Semantic chunking, embeddings, ranking, and search behavior remain unchanged; TypeScript and JavaScript remain the compatibility and performance baselines.

## Goals

- [ ] Every default extension maps exactly once to an auditable structural-language manifest entry.
- [ ] Native grammars install, load, and parse reproducibly on the supported Bun/macOS arm64 target before breadth work proceeds.
- [ ] Structural symbols, imports, references, diagnostics, FQNs, and graph generations have explicit versioned contracts.
- [ ] All required per-language capabilities have deterministic positive and negative fixtures.
- [ ] Graph generation changes preserve an old active graph until a complete pending generation activates atomically.
- [ ] TS/JS throughput and RSS remain within the approved regression limits.

## Requirements

| ID | Priority | Requirement |
| --- | --- | --- |
| MLTS-001 | P1 | `LanguageManifestEntry` SHALL exhaustively map the 33 unique extensions in `DEFAULT_ALLOWED_EXTENSIONS` to language/dialect, pinned grammar artifact and version, query-pack version, resolver version, capability tier, and mixed-language policy. |
| MLTS-002 | P1 | A frozen native feasibility gate SHALL verify provenance, license, lifecycle scripts, ABI, arm64 linkage, clean-cache installation, load, and parse for every required grammar on the declared exact Bun/macOS arm64 target. The runtime identity SHALL include the upstream `tree-sitter@0.25.0` SRI plus the exact repository patch SHA-256. |
| MLTS-003 | P1 | Service liveness SHALL remain independent from parser/indexing readiness; required grammar absence or ABI incompatibility SHALL fail parser readiness before indexing without misreporting unrelated APIs as dead. |
| MLTS-004 | P1 | A bounded parser pool SHALL serialize each parser instance, key leases by language/dialect, delete every created cursor before idempotently deleting its tree in `finally`, and expose deterministic exhaustion/failure behavior. The checksummed binding patch SHALL reject Tree, SyntaxNode, Query, incremental old-tree, and TreeCursor operations after deletion instead of dereferencing freed native state. SyntaxNode and TreeCursor SHALL bind non-writable/non-configurable owner identity; cursor reset/resetTo SHALL accept only nodes/cursors from that same tree and marshal reset nodes explicitly. The 100-cycle stress SHALL call `Bun.gc(true)` after every cycle and SHALL fail if median RSS for cycles 81-100 exceeds cycles 21-40 by more than 16 MiB. |
| MLTS-005 | P1 | Normalized symbols SHALL support `module`, `namespace`, `class`, `interface`, `trait`, `enum`, `function`, `method`, `constructor`, `property`, `field`, `variable`, `constant`, `type`, `type_parameter`, `export`, `heading`, and `key`. |
| MLTS-006 | P1 | A versioned FQN codec SHALL preserve unique top-level `file#name` inputs and encode nested/overloaded symbols as `file#qualified.name~kind~<signature-hash>`, with canonical signature serialization, collision handling, aliases, parsing, display names, and explicit ambiguity candidates. |
| MLTS-007 | P1 | A canonical `SourceSpan` SHALL define UTF-8 byte offsets, zero-based rows/columns, end-exclusive ranges, BOM/CRLF/tab handling, host-child remapping, generation attribution, and snippet round-trip behavior. |
| MLTS-008 | P1 | Manifest capability tiers SHALL condition query-pack behavior and fixtures: Structure covers declarations/docs; Dependencies adds imports/modules and syntax-only type/inheritance edges; Flow adds calls, bare-identifier data flow, and applicable specialized edges. Unsupported capabilities SHALL emit no invented structure. |
| MLTS-009 | P1 | Edge extraction SHALL apply the approved uniform rules for `call`, `data_flow`, `type_ref`, `extend`, `implement`, `import`, `http_call`, `emit`, and `listen`, including negative false-positive cases and defined unresolved-edge payloads. |
| MLTS-010 | P1 | Structural graph data SHALL be versioned by a unique generation attempt ID and a separate structural fingerprint covering runtime ABI, grammar artifacts, query packs, resolvers, taxonomy, and FQN schema. |
| MLTS-011 | P1 | Structural rebuilds SHALL build beside the active graph under a database-backed per-project lease, immutable input snapshot, and compare-and-swap activation. Files, definitions, references, imports, centrality, diagnostics, and active counts SHALL share generation ownership. |
| MLTS-012 | P1 | A generation SHALL activate only after every required file completes grammar load, query, resolution, and persistence. Recovered syntax errors MAY retain valid structure with diagnostics; hard failures SHALL block activation. Incremental hard failures SHALL retain last-known-good structure and mark it stale. |
| MLTS-013 | P1 | Structural activation, full active-generation counts, active/pending swap, and terminal job visibility SHALL occur synchronously in that order. Semantic vector and keyword indexes SHALL retain their existing lifecycle. |
| MLTS-014 | P1 | TS/JS query packs SHALL pass characterization for decorators, methods, nesting, overloads, imports, and specialized edges before regex extraction is removed; `smartChunk` output and semantic-search contracts SHALL remain unchanged. |
| MLTS-015 | P1 | Query packs and deterministic syntax/build-metadata resolvers SHALL cover TS/JS/TSX/JSX, Vue, Python, Ruby, PHP, Lua, C/C++, Go, Rust, Zig, Java, Kotlin/KTS, Scala, C#, Swift, Dart, Elixir/EXS, Erlang, Clojure, OCaml, Haskell, Markdown, JSON, YAML/YML according to manifest tiers. |
| MLTS-016 | P1 | Vue scripts and templates plus Markdown headings/fences SHALL support embedded parsing to two levels, stable scope FQNs, host coordinate remapping, unknown-language fallback to plain chunks, and duplicate suppression. |
| MLTS-017 | P1 | Per-file parser metadata SHALL persist language, grammar version, query/resolver versions, parser status, error count, generation, and last-known-good/stale state. Detailed diagnostic ranges SHALL be bounded to ten per file. |
| MLTS-018 | P1 | `ParserDiagnosticsSummary` SHALL appear consistently in durable index-job status and project-map HTTP/MCP results with counts by language, recovered errors, hard failures, stale files, and active generation identity. |
| MLTS-019 | P1 | Unknown user-configured allowed extensions outside the default manifest SHALL remain semantic-only, report `unsupported_structural_language`, avoid regex fallback, and not fail required-grammar readiness. |
| MLTS-020 | P1 | macOS arm64 source, built `dist`, and packed-package installs SHALL pass native link/load/parse/disposal smoke tests. The core tarball SHALL bundle the exact patched `tree-sitter` dependency, including its generated arm64 addon, so packed consumers cannot resolve an unpatched runtime. The publish manifest SHALL contain semver rather than workspace-only internal dependencies. Lifecycle scripts SHALL be enabled only through explicit `trustedDependencies`. |
| MLTS-021 | P1 | CI SHALL pin the selected Bun version and verify a macOS arm64 native smoke plus database migration/backfill, focused units, type-check, build, and owned sequential indexing/graph/NFR E2E gates. Existing non-macOS and Docker jobs SHALL remain unchanged by this feature. |
| MLTS-022 | P1 | `bench:parser` SHALL compare the candidate with commit `5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03` using one frozen corpus/checksum, exact Bun/host, parser-only scope, five warmups, ten isolated measurements, declared variance handling, RSS semantics, and 100 explicit-disposal/forced-GC iterations. TS/JS throughput SHALL regress no more than 25% and RSS no more than 50%. |
| MLTS-023 | P1 | Active docs, examples, fixtures, API schemas, MCP definitions, and compatibility notes SHALL describe graph schema v2, automatic structural rebuild, temporary old-generation visibility, diagnostics, supported capability tiers, and legacy ambiguity behavior. |

## Acceptance Criteria

1. **AC-001 / MLTS-001,019:** WHEN manifest exhaustiveness runs THEN it SHALL report exactly the same 33 unique extensions as `DEFAULT_ALLOWED_EXTENSIONS`, no extras, and explicit semantic-only behavior for a configured unknown extension.
2. **AC-002 / MLTS-002,003,020,021:** WHEN the frozen macOS arm64 target performs a clean install/startup smoke THEN every required grammar SHALL load and parse, Mach-O arm64 linkage SHALL be recorded, and a removed/incompatible grammar SHALL make parser readiness fail while `/health` remains live.
3. **AC-003 / MLTS-004:** WHEN concurrent parse requests exceed pool capacity THEN parser instances SHALL never overlap, leases SHALL settle deterministically, every cursor SHALL be deleted before its tree in `finally`, double deletion SHALL be harmless, owner substitution and cross-tree cursor reset/resetTo SHALL fail without changing identity, same-tree resets SHALL preserve position, every post-delete operation SHALL throw deterministically, and the 100-cycle forced-GC stress SHALL keep the cycles 81-100 median RSS within 16 MiB of the cycles 21-40 median.
4. **AC-004 / MLTS-005,006,007:** WHEN nested, overloaded, Unicode, CRLF, BOM, tabbed, and signature-collision fixtures are parsed THEN normalized kinds, FQNs, aliases, spans, display names, and ambiguity candidates SHALL match golden expected values.
5. **AC-005 / MLTS-008,009,015:** WHEN every language golden runs THEN each manifest-required capability SHALL meet its declared recall/precision floor, forbidden false positives SHALL be zero, unsupported capabilities SHALL emit nothing, and unresolved edges SHALL match the defined payload.
6. **AC-006 / MLTS-010,011,012,013:** WHEN a structural fingerprint changes THEN a pending generation SHALL build beside the active graph; same-project competing rebuilds SHALL serialize across processes; failed, interrupted, stale-snapshot, or lease-lost builds SHALL not replace active rows; a complete CAS activation SHALL switch all graph-derived tables and full counts before the job becomes terminal.
7. **AC-007 / MLTS-012,017,018:** WHEN malformed syntax is recoverable THEN valid structure SHALL remain and recovered diagnostics SHALL aggregate; WHEN grammar/query/infrastructure/persistence fails THEN activation SHALL block or the incremental file SHALL retain last-known-good rows with visible stale diagnostics.
8. **AC-008 / MLTS-014:** WHEN TS/JS characterization compares regex baseline and Tree-sitter candidate THEN every approved difference SHALL be recorded, required parity fixtures SHALL pass, and `smartChunk` plus semantic-search regression tests SHALL remain unchanged.
9. **AC-009 / MLTS-016:** WHEN Vue/Markdown embedded fixtures include declared/unknown languages, repeated fences, Unicode, malformed blocks, and recursion beyond two levels THEN remapped spans, stable scope FQNs, dedupe, fallback, and diagnostics SHALL match goldens.
10. **AC-010 / MLTS-006,018,023:** WHEN a modern or legacy FQN is sent through PostgreSQL-backed definition/reference/trace, HTTP, and MCP surfaces THEN all transports SHALL return the same unique result or the same explicit ambiguity candidate payload.
11. **AC-011 / MLTS-017,018:** WHEN more than ten detailed errors exist in one file THEN persistence/status SHALL retain exact aggregate counts but expose at most ten ranges for that file.
12. **AC-012 / MLTS-021,022:** WHEN final gates run THEN focused parser/query tests, core unit tests, type-check, build, owned sequential E2E, macOS arm64 native package checks, and the frozen benchmark SHALL pass their exact thresholds with no unexplained skips.

## User Stories

### P1: Reliable polyglot structural search

As an agent or developer indexing a supported repository, I want every advertised default language to produce capability-appropriate structure so that definition, reference, project-map, and impact queries do not silently depend on file language.

**Independent test:** Index the polyglot fixture and assert each extension's manifest tier and transport-visible results.

### P1: Safe structural upgrades

As an operator, I want structural schema/parser upgrades to build beside the active graph and cut over atomically so that failed upgrades never erase usable graph data.

**Independent test:** Inject interruption, stale snapshot, lease loss, and query-pack failure while querying the same project; old graph remains visible until complete CAS activation.

### P1: Auditable native runtime

As a maintainer, I want pinned grammar/runtime artifacts and explicit readiness diagnostics so native packaging failures are caught before indexing and can be reproduced across supported targets.

**Independent test:** Clean-cache macOS arm64 native smoke plus a removed-grammar negative sensor.

## Edge Cases and Failure Modes

- Duplicate extension or missing manifest entry blocks the manifest gate.
- User-configured extension absent from the manifest remains semantic-only with a structured diagnostic.
- `.h` defaults to C unless importer/build metadata proves C++.
- Recoverable grammar errors retain valid nodes; grammar/query/ABI/persistence failures are hard failures.
- Pending generations never leak into active reads, centrality, counts, diagnostics, or MCP/HTTP aggregates.
- Deleted source files disappear from the next complete generation.
- Concurrent processes, retries, lease expiry, cancellation, and stale snapshots cannot activate out of order.
- Hash collisions return explicit ambiguity; they never overwrite a definition.
- UTF-8 multibyte text, emoji, BOM, CRLF, tabs, and nested host offsets round-trip to the original snippet.
- Unknown Markdown fence language stays a plain chunk; embedded recursion stops after two levels.
- More than ten diagnostic ranges remain bounded without losing aggregate counts.
- The supported macOS arm64 runtime missing required native artifacts fails parser readiness before accepting indexing work.

## Implicit-Requirement Sweep

| Dimension | Resolution |
| --- | --- |
| Input validation & bounds | MLTS-001,004,016,017,019 define manifest exhaustiveness, bounded pools, two embedded levels, ten diagnostic details, and semantic-only unknown extensions. |
| Failure / partial failure | MLTS-003,012,017 distinguish liveness, recoverable syntax, hard failure, blocked activation, and last-known-good stale results. |
| Idempotency / retry / duplicates | MLTS-006,010,011,012 define generation attempts/fingerprints, retry/CAS behavior, FQN collisions, and duplicate suppression. |
| Auth boundaries & rate limits | N/A because existing API auth/rate-limit behavior is unchanged; no new unauthenticated route is introduced. |
| Concurrency / ordering | MLTS-004,011,013 require parser serialization, DB-backed project serialization, snapshot/CAS, and synchronous terminal ordering. |
| Data lifecycle / expiry | Failed pending rows are deleted; active graph remains until replacement; detailed diagnostics are bounded; no raw CST is persisted. |
| Observability | MLTS-003,017,018,021 require readiness, per-file metadata, summaries, job/project-map transport parity, and CI linkage evidence. |
| External-dependency failure | MLTS-002,003,020 make missing/ABI-incompatible grammars a pre-index readiness failure and audit native supply-chain behavior. |
| State-transition integrity | Generation states are pending -> active or pending -> failed/cleaned; CAS, lease ownership, and synchronous job ordering guard transitions. |
| Users, permissions, ownership | Existing authenticated API/MCP callers and operators remain actors; no ownership model changes. |
| Migration & compatibility | MLTS-006,010,011,013,018,023 cover backfill, versioned FQNs, old-generation visibility, and transport compatibility. |
| Privacy & security | No new user data class; native dependency provenance, licenses, integrity, and lifecycle scripts are mandatory. |
| Accessibility & localization | N/A because this is a backend indexing contract with no UI or localized content. |
| Platform behavior | Exact Bun, macOS release, and arm64 target are frozen by MLTS-002/020/021; other platforms are excluded. |
| Performance | MLTS-004,022 define bounded resources, native-retention stress, and deterministic throughput/RSS limits. |

## Assumptions and Decisions

| Assumption / decision | Chosen default | Rationale | Confirmed? | Affects |
| --- | --- | --- | --- | --- |
| Supplied plan scope | Implement all 33 current default extensions | Explicit user source and implementation request | Yes, user source | All |
| Technical approach | Native Tree-sitter with pinned grammar artifacts and repository-owned query/resolver packs | Explicit source plan; WASM or runtime downloads violate scope | Yes, user source | MLTS-001-005,008-009,015 |
| Serious plan-challenge findings | Add DB lease/snapshot/CAS, generation completeness, FQN codec, SourceSpan, conditional tiers, and frozen benchmark | Prevents data loss, false success, and unreproducible acceptance without expanding the requested outcome | Accepted workflow revision | MLTS-006-013,022 |
| Unknown custom extensions | Semantic-only plus `unsupported_structural_language` | Default manifest promises only the canonical 33; preserves custom semantic indexing without hidden regex fallback | Accepted conservative default | MLTS-019 |
| Old-generation visibility | Structural graph only; vector/keyword lifecycle unchanged | Source plan excludes semantic-search changes | Yes, user source | MLTS-011-014 |
| Grammar readiness impact | Indexing readiness fails; service liveness and unrelated memory/search APIs remain available | Avoids turning one native grammar fault into a whole-service false outage | Accepted conservative default | MLTS-003 |
| Compiler/LSP resolution | Out of scope; deterministic syntax/build-metadata resolution only | Explicit source plan | Yes, user source | MLTS-008-009,015 |

| Supported native platform | macOS arm64 only | Explicit user scope override on 2026-07-13 | Yes, user instruction | MLTS-002,020-021 |
| Native tree lifetime | Apply one checksummed source-and-packaging patch adding idempotent cursor/tree deletion, stale-object guards, immutable node/cursor owner identity, and generated-addon inclusion; dispose cursor-before-tree in `finally`; prove bounded retention with a no-delete discrimination control and forced-GC/RSS stress | Stock `tree-sitter@0.25.0` has no public disposal API and measured approximately 1 MiB RSS growth per repeated 32 KiB parse after forced GC; mutable owner substitution was independently shown to SIGSEGV; the patched explicit-delete prototype remained bounded | Yes, TASK-002 binding audit, crash review, and measured prototype | MLTS-002,004,020,022 |

**Open questions:** none. Native package viability on macOS arm64 is a blocking execution measurement, not an unresolved product requirement; failure follows the plan's no-fallback blocker.

## Out of Scope

| Exclusion | Reason |
| --- | --- |
| Compiler or LSP type resolution | Explicit source-plan boundary. |
| Runtime grammar downloads | Native artifacts must be frozen and available at startup. |
| Raw CST persistence | Persist normalized structure/diagnostics only. |
| Semantic chunking, embeddings, ranking, or search-algorithm changes | `smartChunk` and semantic behavior are compatibility boundaries. |
| Structural support for arbitrary custom extensions | Custom extensions outside the canonical manifest remain semantic-only. |
| New auth, rate-limit, or UI behavior | Not required for structural indexing breadth. |
| Unbounded embedded-language recursion | Maximum depth is two. |
| Lowering performance gates or accepting unexplained skips | Verification contract is fixed. |
| Linux, Alpine, Docker-native packaging, and non-arm64 targets | Explicit user scope override; do not implement or add gates for them. |

## Verification Approach

- Manifest/capability/provenance matrix with exact packages, versions, licenses, lifecycle scripts, ABI, target linkage, and load/parse evidence.
- Characterization tests written from this specification, not from implementation internals.
- Per-language golden fixtures for required/forbidden/unsupported capabilities and unresolved edges.
- PostgreSQL migration/backfill, active-generation filters, DB lease/snapshot/CAS, activation ordering, rollback, retry, deletion, and stale-result tests.
- HTTP/MCP transport parity for symbol kinds, FQNs, ambiguity, diagnostics, and project-map/index status.
- macOS arm64 clean install plus source, built-dist, and packed-package native smoke.
- Frozen parser-only benchmark and expanded independent discrimination sensor mutations.
- Final author-independent verifier maps every AC to exact assertions and kills behavior-level mutants.

## Phase Decisions

- **Design:** required because this changes architecture, public contracts, native packaging, database schema, migration, concurrency, and compatibility.
- **Tasks:** required because execution has more than three phases, dependency joins, platform gates, and independent slices.
- **Discuss:** triggered and resolved in `context.md` from the supplied plan plus accepted conservative defaults; no hidden requirement question remains.

## Artifact Store Evidence

- Active key: `.specs/features/multi-language-tree-sitter-breadth/spec.md`
- Version: 2 (macOS arm64-only scope override)
- Checksum: recorded in `gate-manifest.md` after artifact freeze.

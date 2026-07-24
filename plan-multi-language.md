
# Multi-Language Tree-sitter Breadth

## Summary

Replace regex structural parsing with native tree-sitter across all 33 extensions in DEFAULT_ALLOWED_EXTENSIONS.

Semantic chunking, embeddings, ranking, and search behavior remain unchanged and TS/JS remain compatibility/performance baselines. Structural indexing gains syntax-based symbols, imports,
references, and graph edges across supported languages.

Feature artifacts will live under .specs/features/multi-language-tree-sitter-breadth/. Design and Tasks phases are required.

## Contracts and Public Interfaces

- Add exhaustive LanguageManifestEntry registry mapping every extension to language/dialect, pinned grammar package, query-pack version, resolver version, capabilities, and mixed-language
  policy.

- `security.allowedExtensions` entries outside the default 33-entry manifest remain semantic-chunk/search inputs only. They receive an explicit `unsupported_structural_language` diagnostic,
  do not block parser readiness, and never fall back to regex structure extraction.

- Cover:
    - TS/JS/TSX/JSX, Vue
    - Python, Ruby, PHP, Lua
    - C/C++, Go, Rust, Zig
    - Java, Kotlin/KTS, Scala, C#, Swift, Dart
    - Elixir/EXS, Erlang, Clojure, OCaml, Haskell
    - Markdown, JSON, YAML/YML

- Expand normalized symbol kinds additively: module, namespace, class, interface, trait, enum, function, method, constructor, property, field, variable, constant, type, type_parameter,
  export, heading, and key.

- Preserve existing collision-free top-level file#name FQNs. Nested or overloaded symbols use file#qualified.name~kind~<signature-hash>. Legacy file#name input resolves when unique and
  returns explicit ambiguity candidates otherwise.

- Define a versioned FQN codec before migration. It owns canonical signature serialization, hash algorithm and length, collision handling, parsing, display names, legacy aliases, and the
  ambiguity response shared by PostgreSQL, HTTP, MCP, trace, definition, and reference consumers.

- Define edge rules uniformly:
    - call: invocation nodes, excluding declarations and specialized duplicates.
    - data_flow: bare identifier arguments with parameter position.
    - type_ref, extend, implement, and import: corresponding grammar constructs.
    - http_call: URL-literal calls or current normalized HTTP-client vocabulary.
    - emit: terminal call name emit.
    - listen: on, once, addListener, addEventListener, off, or removeListener.

- Add ParserDiagnosticsSummary to index status and project-map responses, including counts by language and recovered-error totals. Persist language, grammar version, query/resolver version,
  parser status, and error count per file; retain at most ten detailed diagnostic ranges per file in bounded events/logs.

- Compiler/LSP type resolution, runtime grammar downloads, raw CST persistence, and semantic-search changes remain out of scope.

- Define one byte-accurate SourceSpan contract for host and embedded trees: UTF-8 byte offsets, zero-based rows/columns, end-exclusive ranges, BOM/CRLF/tab handling, host-child remapping,
  generation attribution, and snippet round-trip behavior. Persist lines where current APIs require them, but derive them from the canonical span.

- Capability support is cohort-gated. Every extension declares a minimum syntax-only capability tier, required positive and negative fixtures, unresolved-edge behavior, and explicit
  unsupported capabilities. Deterministic resolution means deterministic syntax/build-metadata resolution only; compiler/LSP resolution remains excluded.

- Named capability tiers are measurable and conditional: Structure requires declarations/documentation; Dependencies adds imports/modules and syntax-only type/inheritance edges; Flow adds
  calls, bare-identifier data flow, and applicable specialized edges. Query packs and golden fixtures implement only manifest-required capabilities. Each supported capability has explicit
  fixture recall/precision floors, zero tolerance for forbidden false positives, and a defined unresolved-edge payload; unsupported capabilities never receive placeholder edges.

## Implementation Plan

1. Specification and native feasibility gate
    - Create approved spec, context, design, capability matrix, tasks, and registry/state artifacts.
    - Produce a 33-extension matrix marking each symbol and edge capability required, forbidden, or unsupported with rationale.
    - Pin tree-sitter and vetted grammar packages. Prove clean frozen installation plus load-and-parse for every grammar on Bun/macOS arm64.
    - Standardize on repository-declared Bun 1.2.0 if it passes; otherwise use the lowest exact Bun 1.3.x release passing macOS arm64. Block without fallback if neither passes.
    - Audit package provenance, licenses, lifecycle scripts, ABI, arm64 linkage, and clean-cache reproducibility.
    - Freeze the exact Bun, lockfile, grammar artifact, macOS release, and arm64 target. Other operating systems and CPU architectures are outside this implementation.
    - Split service liveness from parser readiness. Missing or ABI-incompatible grammars fail parser/indexing readiness without making unrelated health and memory APIs appear dead.
    - Prove one vertical slice per resolver/language cohort, including correctness and false-positive floors, before expanding the cohort to every listed extension.

2. Native dependencies and parser runtime
    - Add only lifecycle-script packages to Bun trustedDependencies.
    - Prove native-link/load behavior for source, built dist, and the packed package on macOS arm64. Do not change Docker or non-macOS packaging.
    - Implement a bounded parser pool keyed by language/dialect. The repository-owned, checksummed `tree-sitter@0.25.0` source-and-packaging patch adds idempotent `TreeCursor.delete()` and `Tree.delete()` with stale-object guards, immutable node/cursor owner identity, same-tree-only cursor reset/resetTo, and generated-addon inclusion. Cursors are deleted before trees in `finally`; parser instances are never used concurrently.
    - Validate every grammar at API startup. Missing or ABI-incompatible grammars fail readiness before indexing begins.

3. Versioned structural-index migration
    - Add graph-generation identity to symbol files, definitions, references, imports, centrality, and diagnostics, plus active/pending generation fields on workspaces. A unique generation ID
      identifies one rebuild attempt; its generation fingerprint identifies the structural contract and may be shared by retries.
    - Generation fingerprint includes tree-sitter ABI/runtime, grammar versions, query packs, resolvers, taxonomy, and FQN schema.
    - Build changed generations beside the active graph. Queries continue reading the old generation until a transaction activates the completed generation; failure deletes pending rows and
      retains the old graph.

    - A generation is complete only when every required discovered file has a successful grammar load, query-pack execution, resolution, and persistence outcome. Recovered syntax errors may
      retain partial valid structure with diagnostics; parser, query, ABI, infrastructure, or persistence failures block activation. Incremental parse failure retains that file's
      last-known-good active structure and reports it as stale instead of replacing it with empty rows.

    - Separate structural-generation rebuilds from semantic/vector/keyword reindexing. Acquire a database-backed per-project lease/advisory lock, bind the rebuild to an immutable input
      snapshot, and activate with compare-and-swap. Block or reconcile content deltas written after the snapshot so a pending generation cannot overwrite newer structure.
    - Old-generation visibility applies to structural graph queries only; semantic vector and keyword indexes keep their existing update lifecycle. Activation, full active-generation counts,
      active/pending swap, and terminal index-job visibility occur synchronously in that order, never through a later EventBus side effect.
    - Serialize same-project generation rebuilds across processes. Test interruption, retry, lease loss, concurrent requests, stale snapshot activation, stale-edge deletion, centrality
      filtering, and legacy FQN ambiguity.
    - Content-only incremental updates remain transactional per file inside the active generation.

4. Shared extraction engine and TS/JS characterization
    - Add declarative QueryPack execution, normalized symbol/edge models, documentation capture, and language-aware resolution interfaces.
    - Port TS/JS first and characterize approved differences from the regex parser, including decorators, methods, nesting, overloads, imports, and current specialized edges.
    - Keep smartChunk unchanged. Remove regex extraction only after characterization and graph parity tests pass.

5. Language-family query packs
    - Implement independently testable packs for:
        - Python/Ruby/PHP/Lua
        - C/C++/Go/Rust/Zig
        - Java/Kotlin/Scala/C#/Swift/Dart
        - Elixir/Erlang/Clojure/OCaml/Haskell
        - Vue/Markdown/JSON/YAML

    - Each pack includes declaration captures, documentation, imports/modules, calls, data flow, inheritance/type references, specialized edge predicates, and deterministic source resolution.
      These extractors are enabled only where the manifest capability tier requires them; unsupported capabilities emit no invented structure.
    - .h uses C unless project evidence identifies C++ through an importer or compilation metadata.
    - Vue parses script blocks using declared lang, defaulting to JavaScript; template component references become type_ref edges.
    - Markdown emits hierarchical heading symbols and parses recognized fenced languages. JSON/YAML emit qualified key symbols without invented calls/imports.
    - Embedded parsing is limited to two levels. Child ranges are remapped to host byte/line coordinates; FQNs include stable block/fence scope. Unknown fence languages remain plain chunks.
      Duplicate nodes use (kind, qualified name, host range, target) suppression.
    - SourceSpan goldens cover Unicode and emoji before embedded blocks, CRLF, BOMs, tabs, malformed edits, repeated fences, byte/line derivation, and host snippet round trips.

6. Pipeline, API, and documentation integration
    - Route Parse and Resolve through the manifest/query-pack engine and retain existing Load-stage transaction boundaries.
    - Update PostgreSQL migration, repositories, controllers, MCP definitions, docs, examples, and project-map aggregation for graph schema v2 and diagnostics.
    - Update the polyglot fixture and remove the existing expectation that Go, Rust, and Markdown always produce zero symbols.
    - Preserve legacy symbol-name and kind queries where unambiguous; document automatic graph rebuild and temporary old-generation visibility.

7. Rollout and verification
    - Update CI with a macOS arm64 native smoke job. Record runtime architecture and linkage; leave Linux, Alpine, Docker, and other CPU targets unchanged and outside this implementation.
    - Add bench:parser comparing candidate against baseline commit 5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03 on the same host and exact Bun version: five warmups, ten isolated measurements,
      median throughput, peak/steady-state RSS, and a 100-iteration explicit tree-disposal/forced-GC stress run. After `Bun.gc(true)` on each cycle, the median RSS for cycles 81-100 must not exceed cycles 21-40 by more than 16 MiB.

    - Freeze the benchmark corpus manifest and SHA-256, with file count, byte count, size distribution, and TS/JS/language mix. Measure parser/query-pack work only, one fresh process per isolated
      measurement, using the same corpus and disabled semantic/DB work for baseline and candidate. Sample peak and post-GC steady-state RSS with one documented platform method; retry only one
      outlier run when a declared variance threshold is exceeded, and retain both original and retry evidence.

    - Gate TS/JS throughput at no worse than 25% and RSS at no worse than 50%; record broad-language measurements without weakening these limits.
    - Execute one atomic commit per task. Because execution exceeds three phases, offer phase-worker subagents before Execute and dispatch only with user approval.

## Test Plan

- Manifest exhaustiveness: all 33 extensions map exactly once; no extra or missing entries.
- Clean install/startup: every native grammar loads and parses on each supported runtime; missing or incompatible grammar prevents readiness.
- Per-language golden fixtures: every capability required by that extension's manifest tier, plus forbidden/unsupported negative cases and unresolved-edge expectations.
- Mixed languages: Vue and Markdown nested parsing, unknown tags, malformed blocks, coordinate remapping, recursion limit, duplicate suppression, diagnostics attribution, and cursor/tree disposal.
- Graph identity: nested symbols, overloads, signature changes, collision-free legacy FQNs, and explicit ambiguous legacy inputs.
- FQN codec: canonical signature/hash fixtures, forced hash collisions, alias migration, trace/display parsing, and identical ambiguity payloads across PostgreSQL, HTTP, and MCP.
- Generation migration: automatic invalidation, old-generation visibility, DB lease ownership, immutable snapshot/CAS activation, delta race handling, interruption rollback, retry, concurrent
  reindexing, centrality/diagnostic generation filtering, and stale-row cleanup.
- Generation completeness: recovered syntax errors preserve valid structure, required-file hard failures block activation, incremental hard failures retain last-known-good rows, and stale-result
  diagnostics remain visible until a successful replacement.
- Diagnostics: recovered syntax errors retain valid structure and surface consistent PostgreSQL, HTTP, and MCP summaries.
- Source spans: UTF-8 byte offsets, Unicode/emoji, CRLF, BOM, tabs, embedded remapping, dedupe stability, and snippet round trips.
- Regression gates:
    - Focused tree-sitter/query-pack unit tests.
    - bun run --filter @massa-ai/core test:unit
    - bun run type-check
    - bun run build
    - Owned-stack sequential 02.indexing, 09.symbol-graph, and 15.nfr E2E tests.
    - macOS arm64 source, built-dist, and packed-package native load checks.
    - Parser throughput/RSS benchmark.

- Independent verifier mutates one query capture, generation fingerprint, grammar dependency, coordinate offset, and legacy-FQN resolver; tests must kill every mutation.

## Assumptions and Evidence

- “All 31” is corrected to all 33 extensions actually present in current source.
- Tree-sitter recovery is used for malformed source, but packaged grammar absence is fatal. Tree-sitter requires a language grammar and is designed to retain useful structure in erroneous
  source (official parser documentation (https://tree-sitter.github.io/node-tree-sitter/index.html), Tree-sitter overview (https://tree-sitter.github.io/tree-sitter/)).

- Native lifecycle scripts are explicitly allowlisted through Bun trustedDependencies, not globally enabled (Bun lifecycle documentation (https://bun.sh/docs/pm/lifecycle)).
- Plan Challenge: full pre-mortem completed; capability, native-compatibility, generation-migration, mixed-language-coordinate, and benchmark contracts were strengthened.
- Platform scope was explicitly narrowed by the user to macOS arm64; Linux, Alpine, Docker-native packaging, and other CPU architectures are not implementation targets.

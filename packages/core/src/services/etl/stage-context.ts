/**
 * ETL Stage Context & Shared Types
 *
 * Contracts shared across all 4 ETL stages:
 *   discover → parse → resolve → load
 *
 * Each stage receives an EtlStageContext for progress reporting
 * and passes its output as the next stage's input.
 */

import type { Chunk } from "../search/smart-chunker.js";
import type {
  NormalizedStructure,
  ParseDiagnostic,
  SourceSpan,
  StructuralEdgeKind,
  StructuralSymbolKind,
} from "../structural/types.js";
import type { GraphGenerationLease } from "../../data/graph-generation/graph-generation-contract.js";
import type { HeaderLanguageEvidence } from "../structural/language-manifest.js";
import type { FileCursor, ManagedRunLease } from "../../data/managed-runs/managed-run-contract.js";
import type {
  ActiveGraphDiagnostics,
  ParserDiagnosticsSummary,
} from "@massa-ai/shared";

// ─── Event types ─────────────────────────────────────────────────────────────

export type EtlStage = "discover" | "parse" | "resolve" | "load";

export interface EtlEvent {
  type:
    | "stage_start"
    | "stage_end"
    | "file_processed"
    | "file_error"
    | "progress";
  stage: EtlStage;
  payload: Record<string, unknown>;
  timestamp: number;
}

// ─── Stage context ────────────────────────────────────────────────────────────

export interface EtlStageContext {
  projectId: string;
  projectPath: string;
  jobId: string;
  graphGenerationLease?: GraphGenerationLease;
  /**
   * Wave 5 FR-09 / FR-10: managed_runs lease for this run. Present when the
   * caller (IndexProjectTool or auto-reindex) acquired the lease; the Load
   * stage uses it to persist a FileCursor after each file-batch commits so
   * a kill/restart resumes from the next file.
   */
  managedRunLease?: ManagedRunLease;
  abortSignal?: AbortSignal;
  structuralHeaderEvidenceByFile?: Readonly<Record<string, HeaderLanguageEvidence>>;
  /**
   * Wave 5 FR-10: persisted FileCursor from the previous run. When present,
   * the Discover stage skips files at-or-before the cursor (already-applied)
   * so a kill/restart resumes from the next file. Set by the pipeline from
   * {@link ManagedRunRepository.getActive} → file_cursor before stage 1.
   */
  resumeCursor?: FileCursor;
  /** Hook for emitting progress events to the EventBus. */
  emit: (event: EtlEvent) => void;
}

// ─── Stage data shapes ────────────────────────────────────────────────────────

/** Output of Discover stage / Input of Parse stage */
export interface DiscoveredFile {
  absolutePath: string;
  relativePath: string;
  mtime: number;
  size: number;
  contentHash: string; // SHA-256 of raw content
  /** Immutable UTF-8 content captured during discovery for this generation. */
  snapshotContent?: string;
  /** True when content hash matches stored hash → skip parse/load. */
  needsReparse: boolean;
}

/** A raw symbol extracted by the Parse stage before FQN resolution. */
export interface RawSymbol {
  kind: StructuralSymbolKind;
  name: string;
  /** Filled by Resolve stage: '{relativePath}#{name}' */
  fqn?: string;
  lineStart: number;
  lineEnd: number;
  exported: boolean;
  docComment?: string;
  span?: SourceSpan;
}

/** A raw import statement before path resolution. */
export interface RawImport {
  specifier: string; // e.g. '../services/search'
  names: string[]; // e.g. ['SearchController', 'default']
  isTypeOnly: boolean;
  form?: "esm_import" | "esm_re_export" | "commonjs_require" | "dynamic_import" |
    "python_import" | "ruby_require" | "php_use" | "lua_require" |
    "c_include" | "cpp_include" | "go_import" | "rust_use" | "zig_import" |
    "java_import" | "java_static_import" | "kotlin_import" | "scala_import" | "csharp_using" | "swift_import" | "dart_import" |
    "elixir_alias" | "elixir_import" | "elixir_require" | "elixir_use" | "erlang_import" |
    "clojure_require" | "clojure_import" | "ocaml_open" | "ocaml_include" | "ocaml_module_alias" | "haskell_import";
  span?: SourceSpan;
  bindings?: readonly Readonly<{
    imported: string;
    local: string;
    typeOnly: boolean;
    arity?: number;
  }>[];
}

/**
 * A raw typed structural edge extracted by the Parse stage (D1).
 *
 * These are TS/JS best-effort call/control-flow edges resolved to FQNs in the
 * Resolve stage and persisted as `symbol_references` rows with the new typed
 * `ref_kind` values + `meta` JSON metadata.
 *
 * Edge types:
 *   - call       : A() calls B() — caller → callee
 *   - data_flow  : a value flows source → call-arg → callee-param (param binding)
 *   - http_call  : fetch/axios/http/GraphQL/tRPC call site → route/URL/service
 *   - emit       : emitter.emit('event', ...) — event producer
 *   - listen     : emitter.on('event', ...) — event consumer
 */
export type RawEdgeKind = StructuralEdgeKind;

export interface RawEdge {
  kind: RawEdgeKind;
  /** 1-based line where the edge originates. */
  line: number;
  /** The callee/target symbol name (e.g. 'fetch', 'bar', 'on'). */
  symbolName: string;
  /** Best-effort caller symbol (enclosing function/method name). */
  callerSymbol?: string;
  /** Typed-edge metadata. Resolved target_fqn is filled by Resolve stage. */
  meta?: Record<string, unknown>;
  span?: SourceSpan;
  sourceFqn?: string;
}

/** Output of Parse stage / Input of Resolve stage */
export interface ParsedFile {
  file: DiscoveredFile;
  chunks: Chunk[]; // from smart-chunker, used by Load stage
  symbols: RawSymbol[];
  rawImports: RawImport[];
  rawEdges: RawEdge[]; // typed structural edges (D1)
  /** Immutable native-query result retained after Tree-sitter objects are deleted. */
  structure?: NormalizedStructure;
  structuralDiagnostics?: readonly ParseDiagnostic[];
  structuralDiagnosticCount?: number;
  structuralRecovered?: boolean;
}

/** A resolved import with the concrete file path (or null if external). */
export interface ResolvedImport {
  raw: RawImport;
  resolvedPath: string | null; // relative project path
  external: boolean;
}

/** A typed structural edge with its target FQN resolved where possible. */
export interface ResolvedEdge extends RawEdge {
  /** '{relativePath}#{symbolName}' if the callee/target was resolved, else undefined. */
  targetFqn?: string;
}

/** Output of Resolve stage / Input of Load stage */
export interface ResolvedFile extends ParsedFile {
  resolvedImports: ResolvedImport[];
  resolvedEdges: ResolvedEdge[];
}

// ─── Pipeline result ──────────────────────────────────────────────────────────

export interface EtlResult extends ActiveGraphDiagnostics<string> {
  filesDiscovered: number;
  filesIndexed: number;
  filesSkipped: number; // fingerprint cache hits
  chunksIndexed: number;
  symbolsIndexed: number;
  errors: number;
  durationMs: number;
  stageTimings: Record<EtlStage, number>;
}

export type { ParserDiagnosticsSummary } from "@massa-ai/shared";

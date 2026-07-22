/**
 * symbol-repo-types.ts — domain types for SymbolRepositoryPg (N31 split T06)
 *
 * All interfaces/types that were inlined in symbol-repository-pg.ts L19-219.
 * The barrel re-exports them so importers see no change.
 */

import type { StructuralFqnCandidate } from "../../services/structural/fqn-codec.js";

export type SymbolKind =
  | "module"
  | "namespace"
  | "class"
  | "interface"
  | "trait"
  | "enum"
  | "function"
  | "method"
  | "constructor"
  | "property"
  | "field"
  | "variable"
  | "constant"
  | "type"
  | "type_parameter"
  | "export"
  | "heading"
  | "key";

export type RefKind =
  | "call"
  | "type_ref"
  | "import"
  | "extend"
  | "implement"
  // Typed structural edges (D1) — TS/JS best-effort extraction
  | "data_flow"
  | "http_call"
  | "emit"
  | "listen";

export type WorkspaceStatus = "pending" | "indexing" | "indexed" | "error";

export interface SymbolFileRow {
  project_id: string;
  relative_path: string;
  content_hash: string;
  mtime: number;
  size: number;
  indexed_at: number;
  symbol_count: number;
  chunk_count: number;
  generation_id?: string;
  language?: string;
  dialect?: string;
  grammar_version?: string;
  query_pack_version?: string;
  resolver_version?: string;
  parser_status?: "legacy" | "ok" | "recovered" | "unsupported" | "failed";
  parser_error_count?: number;
  diagnostics?: readonly Record<string, unknown>[];
  is_stale?: boolean;
  last_known_good_generation_id?: string;
  last_successful_at?: number;
}

export interface SymbolDefinition {
  id: string; // fqn: 'relative/path.ts#Name'
  project_id: string;
  file_path: string;
  name: string;
  kind: SymbolKind;
  line_start: number;
  line_end: number;
  exported: boolean;
  doc_comment?: string;
  indexed_at: number;
  qualified_name?: string;
  canonical_signature?: string;
  signature_hash?: string;
  legacy_fqn?: string;
  source_span?: Record<string, unknown>;
}

export interface SymbolReference {
  id?: number;
  project_id: string;
  from_file: string;
  from_line: number;
  symbol_name: string;
  target_fqn?: string;
  ref_kind: RefKind;
  /** Typed-edge metadata (D1): stored natively as JSONB in PG. */
  meta?: Record<string, unknown> | null;
  source_span?: Record<string, unknown>;
}

export interface SymbolImport {
  id?: number;
  project_id: string;
  from_file: string;
  to_file?: string;
  specifier: string;
  imported_names: string[];
  is_external: boolean;
  is_type_only: boolean;
}

export interface CentralityEntry {
  project_id: string;
  file_path: string;
  score: number;
  updated_at: number;
}

export interface WorkspaceRow {
  project_id: string;
  project_path: string;
  display_name?: string;
  status: WorkspaceStatus;
  last_indexed_at?: number;
  last_error?: string;
  files_count: number;
  chunks_count: number;
  symbols_count: number;
  created_at: number;
  updated_at: number;
}

/**
 * All graph-backed inputs needed by project_map, captured from one active
 * generation while the workspace row is share-locked in one transaction.
 */
export interface ProjectMapGraphSnapshot {
  workspace: WorkspaceRow;
  generationId: string | null;
  counts: {
    files: number;
    definitions: number;
    references: number;
    imports: number;
    centrality: number;
  };
  diagnostics: {
    recovered: number;
    hardFailures: number;
    staleFiles: number;
    errors: number;
  };
  languages: Record<string, number>;
  topCentralFiles: CentralityEntry[];
  symbolsByKind: Record<string, number>;
  filesByLanguage: Record<string, number>;
  recentFiles: Array<{ filePath: string; indexedAt: number | null }>;
  edgesByKind: Record<string, number>;
  architecture: {
    files: string[];
    importEdges: Array<{ from_file: string; to_file?: string }>;
    definitions: SymbolDefinition[];
    httpEdges: SymbolReference[];
    /**
     * CALL-kind references (Wave 5 FR-02 / N2). Populated from
     * `symbol_references WHERE ref_kind='call'` rows; consumed by the
     * `cycles` aspect in {@link computeArchitectureMap} via Tarjan SCC.
     * Bounded by `callEdgeBudget` (default 400_000) — over the budget, rows
     * are simply truncated (the cycles result sets `cycles_truncated=true`).
     */
    callEdges: SymbolReference[];
    centrality: Map<string, number>;
  };
}

export interface ProjectMapSnapshotOptions {
  centralityLimit?: number;
  recentLimit?: number;
  /**
   * Wave 5 (FR-02 / N2): hard cap on CALL-kind reference rows read for the
   * architecture snapshot's `callEdges` slot. Default 400_000 — over the
   * budget, rows are truncated and the `cycles` aspect surfaces
   * `cycles_truncated=true`. The cap matches the iterative Tarjan edge budget
   * (AD-W5-017) so the SCC detector never receives more edges than it can
   * process within the RSS guard.
   */
  callEdgeBudget?: number;
  /** @internal Deterministic concurrency sensor used by DB-backed tests. */
  afterGenerationCaptured?: (generationId: string | null) => void | Promise<void>;
}

export interface ActiveGenerationScope {
  projectId: string;
  generationId: string;
}

export interface GenerationFileWrite {
  file: SymbolFileRow;
  definitions: readonly SymbolDefinition[];
  references: readonly SymbolReference[];
  imports: readonly SymbolImport[];
}

export type DefinitionFqnResolution =
  | { found: true; ambiguous: false; definition: SymbolDefinition }
  | { found: false; ambiguous: false; fqn: string; candidates: readonly [] }
  | { found: false; ambiguous: false; legacyFqn: string; candidates: readonly [] }
  | {
      found: false;
      ambiguous: true;
      legacyFqn: string;
      candidates: readonly StructuralFqnCandidate[];
    };

export type WorkspaceUpsertInput = Omit<WorkspaceRow, "created_at" | "updated_at"> & { created_at?: number };
export type WorkspaceStatusUpdateOptions = {
  lastError?: string | null; lastIndexedAt?: number;
  filesCount?: number; chunksCount?: number; symbolsCount?: number;
};
export type ProjectMapAggregatesResult = {
  symbolsByKind: Record<string, number>;
  filesByLanguage: Record<string, number>;
  recentFiles: Array<{ filePath: string; indexedAt: number | null }>;
};
export type ActiveGraphSnapshot = {
  generationId: string;
  counts: { files: number; definitions: number; references: number; imports: number; centrality: number };
  diagnostics: { recovered: number; hardFailures: number; staleFiles: number; errors: number };
  languages: Record<string, number>;
};
export type MarkFileStaleInput = {
  lastKnownGoodGenerationId: string;
  diagnostics: readonly Record<string, unknown>[];
  parserErrorCount: number;
};
export type FindEdgesOptions = {
  types?: RefKind[]; fromSymbol?: string; toSymbol?: string; fromFile?: string;
  direction?: "outgoing" | "incoming" | "both"; limit?: number;
};
export type ListDefinitionsOptions = {
  search?: string; kind?: string[]; file?: string; exportedOnly?: boolean; limit?: number;
};
export type ListAllDefinitionsOptions = { kind?: string[]; exportedOnly?: boolean };
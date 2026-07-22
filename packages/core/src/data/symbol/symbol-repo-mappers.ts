/**
 * symbol-repo-mappers.ts — Raw row types + map functions (N31 split T07)
 *
 * WsRaw/FileRaw/DefRaw/RefRaw/ImpRaw + mapWs/mapFile/mapDef/mapRef/mapImp.
 * These translate the raw $queryRaw row shapes into the domain types
 * from symbol-repo-types.ts.
 */

import type {
  SymbolFileRow,
  SymbolDefinition,
  SymbolReference,
  SymbolImport,
  CentralityEntry,
  WorkspaceRow,
  WorkspaceStatus,
  SymbolKind,
  RefKind,
} from "./symbol-repo-types.js";

export interface WsRaw {
  project_id: string;
  project_path: string;
  display_name: string | null;
  status: string;
  last_indexed_at: Date | null;
  last_error: string | null;
  files_count: number;
  chunks_count: number;
  symbols_count: number;
  created_at: Date;
  updated_at: Date;
}

export function mapWs(ws: WsRaw): WorkspaceRow {
  return {
    project_id: ws.project_id,
    project_path: ws.project_path,
    display_name: ws.display_name ?? undefined,
    status: ws.status as WorkspaceStatus,
    last_indexed_at: ws.last_indexed_at?.getTime(),
    last_error: ws.last_error ?? undefined,
    files_count: Number(ws.files_count),
    chunks_count: Number(ws.chunks_count),
    symbols_count: Number(ws.symbols_count),
    created_at: ws.created_at.getTime(),
    updated_at: ws.updated_at.getTime(),
  };
}

export interface FileRaw {
  project_id: string;
  generation_id: string;
  relative_path: string;
  content_hash: string;
  mtime: bigint;
  size: number;
  indexed_at: Date;
  symbol_count: number;
  chunk_count: number;
  language: string | null;
  dialect: string | null;
  grammar_version: string | null;
  query_pack_version: string | null;
  resolver_version: string | null;
  parser_status: SymbolFileRow["parser_status"];
  parser_error_count: number;
  diagnostics: Record<string, unknown>[];
  is_stale: boolean;
  last_known_good_generation_id: string | null;
  last_successful_at: Date | null;
}

export function mapFile(f: FileRaw): SymbolFileRow {
  return {
    project_id: f.project_id,
    relative_path: f.relative_path,
    content_hash: f.content_hash,
    mtime: Number(f.mtime),
    size: Number(f.size),
    indexed_at: f.indexed_at.getTime(),
    symbol_count: Number(f.symbol_count),
    chunk_count: Number(f.chunk_count),
    generation_id: f.generation_id,
    language: f.language ?? undefined,
    dialect: f.dialect ?? undefined,
    grammar_version: f.grammar_version ?? undefined,
    query_pack_version: f.query_pack_version ?? undefined,
    resolver_version: f.resolver_version ?? undefined,
    parser_status: f.parser_status,
    parser_error_count: Number(f.parser_error_count),
    diagnostics: Array.isArray(f.diagnostics) ? f.diagnostics : [],
    is_stale: Boolean(f.is_stale),
    last_known_good_generation_id: f.last_known_good_generation_id ?? undefined,
    last_successful_at: f.last_successful_at?.getTime(),
  };
}

export interface DefRaw {
  id: string;
  project_id: string;
  file_path: string;
  name: string;
  kind: string;
  line_start: number;
  line_end: number;
  exported: boolean;
  doc_comment: string | null;
  indexed_at: Date;
  qualified_name: string;
  canonical_signature: string | null;
  signature_hash: string | null;
  legacy_fqn: string;
  source_span: Record<string, unknown> | null;
}

export function mapDef(d: DefRaw): SymbolDefinition {
  return {
    id: d.id,
    project_id: d.project_id,
    file_path: d.file_path,
    name: d.name,
    kind: d.kind as SymbolKind,
    line_start: Number(d.line_start),
    line_end: Number(d.line_end),
    exported: Boolean(d.exported),
    doc_comment: d.doc_comment ?? undefined,
    indexed_at: d.indexed_at.getTime(),
    qualified_name: d.qualified_name,
    canonical_signature: d.canonical_signature ?? undefined,
    signature_hash: d.signature_hash ?? undefined,
    legacy_fqn: d.legacy_fqn,
    source_span: d.source_span ?? undefined,
  };
}

export interface RefRaw {
  id: number;
  project_id: string;
  from_file: string;
  from_line: number;
  symbol_name: string;
  target_fqn: string | null;
  ref_kind: string;
  meta: Record<string, unknown> | null;
  source_span: Record<string, unknown> | null;
}

export function mapRef(r: RefRaw): SymbolReference {
  return {
    id: Number(r.id),
    project_id: r.project_id,
    from_file: r.from_file,
    from_line: Number(r.from_line),
    symbol_name: r.symbol_name,
    target_fqn: r.target_fqn ?? undefined,
    ref_kind: r.ref_kind as RefKind,
    meta: r.meta ?? null,
    source_span: r.source_span ?? undefined,
  };
}

export interface ImpRaw {
  id: number;
  project_id: string;
  from_file: string;
  to_file: string | null;
  specifier: string;
  imported_names: string[];
  is_external: boolean;
  is_type_only: boolean;
}

export function mapImp(i: ImpRaw): SymbolImport {
  return {
    id: Number(i.id),
    project_id: i.project_id,
    from_file: i.from_file,
    to_file: i.to_file ?? undefined,
    specifier: i.specifier,
    imported_names: Array.isArray(i.imported_names) ? i.imported_names : [],
    is_external: Boolean(i.is_external),
    is_type_only: Boolean(i.is_type_only),
  };
}
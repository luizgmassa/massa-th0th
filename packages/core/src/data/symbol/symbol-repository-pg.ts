/**
 * Symbol Repository - PostgreSQL Implementation
 *
 * All queries use raw SQL via $queryRaw / $executeRaw to avoid the
 * Prisma 7.7.0 + Bun ORM bug (isObjectEnumValue is not a function).
 */

import { createHash } from "node:crypto";
import { logger } from "@massa-th0th/shared";
import { getPrismaClient } from "../../services/query/prisma-client.js";
import {
  parseStructuralFqn,
  type StructuralFqnCandidate,
} from "../../services/structural/fqn-codec.js";
import type { GraphGenerationLease } from "../graph-generation/graph-generation-contract.js";

// ─── Domain types (re-exported from symbol-repo-types.ts — N31 T06) ─────────
export type {
  SymbolKind,
  RefKind,
  WorkspaceStatus,
  SymbolFileRow,
  SymbolDefinition,
  SymbolReference,
  SymbolImport,
  CentralityEntry,
  WorkspaceRow,
  ProjectMapGraphSnapshot,
  ProjectMapSnapshotOptions,
  ActiveGenerationScope,
  GenerationFileWrite,
  DefinitionFqnResolution,
} from "./symbol-repo-types.js";
import type {
  SymbolKind,
  RefKind,
  WorkspaceStatus,
  SymbolFileRow,
  SymbolDefinition,
  SymbolReference,
  SymbolImport,
  CentralityEntry,
  WorkspaceRow,
  ProjectMapGraphSnapshot,
  ProjectMapSnapshotOptions,
  ActiveGenerationScope,
  GenerationFileWrite,
  DefinitionFqnResolution,
} from "./symbol-repo-types.js";

type TransactionClient = Parameters<
  Parameters<ReturnType<typeof getPrismaClient>["$transaction"]>[0]
>[0];

function definitionIdentityColumns(def: SymbolDefinition): {
  qualifiedName: string;
  canonicalSignature: string | null;
  signatureHash: string | null;
  legacyFqn: string;
  sourceSpan: Record<string, unknown> | null;
} {
  const legacyFqn = def.legacy_fqn ?? `${def.file_path}#${def.name}`;
  let parsedModern: Extract<ReturnType<typeof parseStructuralFqn>, { format: "qualified" }> | null = null;
  try {
    const parsed = parseStructuralFqn(def.id);
    if (
      parsed.format === "qualified" &&
      parsed.file === def.file_path &&
      parsed.kind === def.kind &&
      parsed.qualifiedName.split(".").at(-1) === def.name
    ) {
      parsedModern = parsed;
    }
  } catch {
    // Pre-codec legacy rows retain their compatibility fields without
    // fabricating qualified identity material.
  }
  return {
    qualifiedName: def.qualified_name ?? parsedModern?.qualifiedName ?? def.name,
    canonicalSignature: def.canonical_signature ?? null,
    signatureHash: def.signature_hash ?? parsedModern?.signatureHash ?? null,
    legacyFqn,
    sourceSpan: def.source_span ?? null,
  };
}

function generationDefinitionIdentityColumns(def: SymbolDefinition): ReturnType<typeof definitionIdentityColumns> {
  const identity = definitionIdentityColumns(def);
  const parsed = parseStructuralFqn(def.id);
  if (parsed.file !== def.file_path) throw new TypeError(`definition_fqn_file_mismatch:${def.id}`);
  const expectedLegacyFqn = `${def.file_path}#${def.name}`;
  if (identity.legacyFqn !== expectedLegacyFqn) {
    throw new TypeError(`definition_legacy_fqn_mismatch:${def.id}`);
  }
  if (parsed.format === "simple") {
    if (parsed.name !== def.name) throw new TypeError(`definition_fqn_name_mismatch:${def.id}`);
    if (def.qualified_name !== undefined && def.qualified_name !== def.name) {
      throw new TypeError(`definition_fqn_qualified_name_mismatch:${def.id}`);
    }
    if ((def.canonical_signature === undefined) !== (def.signature_hash === undefined)) {
      throw new TypeError(`definition_simple_signature_pair_mismatch:${def.id}`);
    }
    if (def.canonical_signature !== undefined && def.signature_hash !== undefined) {
      const digest = createHash("sha256").update(def.canonical_signature, "utf8").digest("hex");
      if (digest !== def.signature_hash) throw new TypeError(`definition_fqn_signature_mismatch:${def.id}`);
    }
    return { ...identity, qualifiedName: def.name };
  }
  if (parsed.kind !== def.kind) throw new TypeError(`definition_fqn_kind_mismatch:${def.id}`);
  if (parsed.qualifiedName.split(".").at(-1) !== def.name) {
    throw new TypeError(`definition_fqn_name_mismatch:${def.id}`);
  }
  if (def.qualified_name !== undefined && def.qualified_name !== parsed.qualifiedName) {
    throw new TypeError(`definition_fqn_qualified_name_mismatch:${def.id}`);
  }
  if (def.signature_hash !== undefined && def.signature_hash !== parsed.signatureHash) {
    throw new TypeError(`definition_fqn_signature_hash_mismatch:${def.id}`);
  }
  if (def.canonical_signature !== undefined) {
    const digest = createHash("sha256").update(def.canonical_signature, "utf8").digest("hex");
    if (digest !== parsed.signatureHash) throw new TypeError(`definition_fqn_signature_mismatch:${def.id}`);
  }
  return {
    ...identity,
    qualifiedName: parsed.qualifiedName,
    signatureHash: parsed.signatureHash,
  };
}

function referenceSourceSpan(ref: SymbolReference): Record<string, unknown> | null {
  const candidate = ref.source_span ?? ref.meta?.sourceSpan;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const span = candidate as Record<string, unknown>;
  const start = span.start as Record<string, unknown> | undefined;
  const end = span.end as Record<string, unknown> | undefined;
  const integers = [span.startByte, span.endByte, start?.row, start?.column, end?.row, end?.column];
  if (!integers.every((value) => Number.isInteger(value) && (value as number) >= 0)) return null;
  if ((span.endByte as number) < (span.startByte as number)) return null;
  return span;
}

// ─── Raw row types returned by $queryRaw ─────────────────────────────────────

interface WsRaw {
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

function mapWs(ws: WsRaw): WorkspaceRow {
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

interface FileRaw {
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

function mapFile(f: FileRaw): SymbolFileRow {
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

interface DefRaw {
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

function mapDef(d: DefRaw): SymbolDefinition {
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

interface RefRaw {
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

function mapRef(r: RefRaw): SymbolReference {
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

interface ImpRaw {
  id: number;
  project_id: string;
  from_file: string;
  to_file: string | null;
  specifier: string;
  imported_names: string[];
  is_external: boolean;
  is_type_only: boolean;
}

function mapImp(i: ImpRaw): SymbolImport {
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

interface GenerationWriteLockRow {
  id: string;
  status: string;
  expected_active_id: string | null;
  lease_token: string | null;
  lease_expires_at: Date | null;
  fingerprint: string;
  input_snapshot_hash: string;
  expected_files_count: number;
  pending_graph_generation_id: string | null;
  graph_lease_token: string | null;
  graph_lease_expires_at: Date | null;
  active_graph_generation_id: string | null;
  live: boolean;
}

async function lockOwnedPendingGeneration(
  tx: TransactionClient,
  lease: GraphGenerationLease,
): Promise<boolean> {
  // Lock only the generation row. T11 activation locks workspace then waits on
  // this row, so it cannot cut over while a file transaction is committing.
  // Taking the workspace lock after this lock would invert T11's order.
  const generations = await tx.$queryRaw<Array<Omit<GenerationWriteLockRow,
    "pending_graph_generation_id" | "graph_lease_token" | "graph_lease_expires_at" |
    "active_graph_generation_id" | "live">>>`
    SELECT id, status, expected_active_id, lease_token, lease_expires_at,
           fingerprint, input_snapshot_hash, expected_files_count
    FROM graph_generations
    WHERE project_id = ${lease.projectId} AND id = ${lease.generationId}
    FOR UPDATE
  `;
  const generation = generations[0];
  if (!generation) return false;
  const workspaces = await tx.$queryRaw<Array<{
    pending_graph_generation_id: string | null;
    graph_lease_token: string | null;
    graph_lease_expires_at: Date | null;
    active_graph_generation_id: string | null;
    live: boolean;
  }>>`
    SELECT pending_graph_generation_id, graph_lease_token, graph_lease_expires_at,
           active_graph_generation_id,
           (graph_lease_expires_at > clock_timestamp()
             AND ${generation.lease_expires_at}::timestamp > clock_timestamp()) AS live
    FROM workspaces WHERE project_id = ${lease.projectId}
  `;
  const workspace = workspaces[0];
  return Boolean(
    workspace && workspace.live && generation.status === "pending" &&
    workspace.pending_graph_generation_id === lease.generationId &&
    workspace.graph_lease_token === lease.leaseToken &&
    generation.lease_token === lease.leaseToken &&
    workspace.active_graph_generation_id === lease.expectedActiveGenerationId &&
    generation.expected_active_id === lease.expectedActiveGenerationId &&
    generation.fingerprint === lease.fingerprint &&
    generation.input_snapshot_hash === lease.inputSnapshotHash &&
    Number(generation.expected_files_count) === lease.expectedFilesCount
  );
}

async function lockActiveGenerations(
  tx: TransactionClient,
  projectIds: readonly string[],
): Promise<Map<string, string>> {
  const generations = new Map<string, string>();
  for (const projectId of [...new Set(projectIds)].sort()) {
    const rows = await tx.$queryRaw<Array<{ active_graph_generation_id: string | null }>>`
      SELECT active_graph_generation_id FROM workspaces
      WHERE project_id = ${projectId} FOR UPDATE
    `;
    const generationId = rows[0]?.active_graph_generation_id;
    if (!generationId) throw new Error(`active_graph_generation_missing:${projectId}`);
    generations.set(projectId, generationId);
  }
  return generations;
}

function validateGenerationFileWrite(input: GenerationFileWrite, lease: GraphGenerationLease): void {
  const { file } = input;
  if (file.project_id !== lease.projectId || !file.relative_path) {
    throw new TypeError("generation file must belong to the leased project and have a path");
  }
  if (!Number.isInteger(file.parser_error_count ?? 0) || (file.parser_error_count ?? 0) < 0) {
    throw new RangeError("parser_error_count must be a non-negative integer");
  }
  if ((file.diagnostics?.length ?? 0) > 10) throw new RangeError("diagnostics must contain at most 10 entries");
  for (const definition of input.definitions) {
    if (definition.project_id !== lease.projectId || definition.file_path !== file.relative_path) {
      throw new TypeError("definition must belong to the generation file");
    }
  }
  for (const reference of input.references) {
    if (reference.project_id !== lease.projectId || reference.from_file !== file.relative_path) {
      throw new TypeError("reference must originate from the generation file");
    }
  }
  for (const imported of input.imports) {
    if (imported.project_id !== lease.projectId || imported.from_file !== file.relative_path) {
      throw new TypeError("import must originate from the generation file");
    }
  }
}

function definitionCandidate(definition: SymbolDefinition): StructuralFqnCandidate {
  let signatureHash = definition.signature_hash;
  if (!signatureHash) {
    const parsed = parseStructuralFqn(definition.id);
    if (parsed.format === "qualified") signatureHash = parsed.signatureHash;
  }
  if (!signatureHash) throw new Error(`ambiguous_definition_identity_incomplete:${definition.id}`);
  const qualifiedName = definition.qualified_name ?? definition.name;
  return Object.freeze({
    fqn: definition.id,
    file: definition.file_path,
    name: definition.name,
    displayName: qualifiedName,
    qualifiedName,
    kind: definition.kind,
    signatureHash,
  });
}

function compareDefinitionCandidates(left: StructuralFqnCandidate, right: StructuralFqnCandidate): number {
  return left.file.localeCompare(right.file) ||
    left.qualifiedName.localeCompare(right.qualifiedName) ||
    left.kind.localeCompare(right.kind) ||
    left.signatureHash.localeCompare(right.signatureHash);
}

// ─── Repository ──────────────────────────────────────────────────────────────

export class SymbolRepositoryPg {
  private static instance: SymbolRepositoryPg | null = null;

  private constructor() {
    logger.info("SymbolRepositoryPg initialized (PostgreSQL)");
  }

  static getInstance(): SymbolRepositoryPg {
    if (!SymbolRepositoryPg.instance) {
      SymbolRepositoryPg.instance = new SymbolRepositoryPg();
    }
    return SymbolRepositoryPg.instance;
  }

  // ─── Workspace operations ─────────────────────────────────────────────────

  async upsertWorkspace(
    ws: Omit<WorkspaceRow, "created_at" | "updated_at"> & {
      created_at?: number;
    },
  ): Promise<void> {
    const lastIndexedAt = ws.last_indexed_at
      ? new Date(ws.last_indexed_at)
      : null;
    const p = getPrismaClient();
    await p.$transaction(async (tx) => {
      await tx.$executeRaw`
      INSERT INTO workspaces (project_id, project_path, display_name, status, last_indexed_at, last_error, files_count, chunks_count, symbols_count, created_at, updated_at)
      VALUES (
        ${ws.project_id}, ${ws.project_path}, ${ws.display_name ?? null},
        ${ws.status}, ${lastIndexedAt}, ${ws.last_error ?? null},
        ${ws.files_count}, ${ws.chunks_count}, ${ws.symbols_count},
        NOW(), NOW()
      )
      ON CONFLICT (project_id) DO UPDATE SET
        project_path    = EXCLUDED.project_path,
        display_name    = EXCLUDED.display_name,
        status          = EXCLUDED.status,
        last_indexed_at = EXCLUDED.last_indexed_at,
        last_error      = EXCLUDED.last_error,
        files_count     = EXCLUDED.files_count,
        chunks_count    = EXCLUDED.chunks_count,
        symbols_count   = EXCLUDED.symbols_count,
        updated_at      = NOW()
    `;
    // Transitional bridge for workspaces first created after the generation
    // migration. T12 replaces this legacy generation with the coordinator.
      await tx.$executeRaw`
      WITH locked_workspace AS (
        SELECT project_id, project_path
        FROM workspaces
        WHERE project_id = ${ws.project_id}
        FOR UPDATE
      ), inserted AS (
        INSERT INTO graph_generations (
          id, project_id, status, fingerprint, input_snapshot_hash,
          expected_files_count, completed_files_count, started_at, completed_at, activated_at
        )
        SELECT
          'legacy-' || md5(project_id), project_id, 'active', 'legacy:v1',
          'md5:' || md5(project_path || E'\n'), 0, 0, NOW(), NOW(), NOW()
        FROM locked_workspace
        WHERE NOT EXISTS (
          SELECT 1 FROM workspaces current_workspace
          WHERE current_workspace.project_id = locked_workspace.project_id
            AND current_workspace.active_graph_generation_id IS NOT NULL
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id, project_id
      ), active_generation AS (
        SELECT id, project_id FROM inserted
        UNION ALL
        SELECT generation.id, generation.project_id
        FROM graph_generations generation
        JOIN locked_workspace ON locked_workspace.project_id = generation.project_id
        WHERE generation.id = 'legacy-' || md5(generation.project_id)
      )
      UPDATE workspaces current_workspace
      SET active_graph_generation_id = generation.id
      FROM active_generation generation
      WHERE current_workspace.project_id = ${ws.project_id}
        AND current_workspace.active_graph_generation_id IS NULL
        AND generation.id = 'legacy-' || md5(current_workspace.project_id)
        AND generation.project_id = current_workspace.project_id
      `;
    });
  }

  async updateWorkspaceStatus(
    projectId: string,
    status: WorkspaceStatus,
    opts?:
      | {
          lastError?: string | null;
          lastIndexedAt?: number;
          filesCount?: number;
          chunksCount?: number;
          symbolsCount?: number;
        }
      | string,
  ): Promise<void> {
    const lastError =
      typeof opts === "string" ? opts : (opts?.lastError ?? null);
    const filesCount = typeof opts === "object" ? opts?.filesCount : undefined;
    const chunksCount =
      typeof opts === "object" ? opts?.chunksCount : undefined;
    const symbolsCount =
      typeof opts === "object" ? opts?.symbolsCount : undefined;
    const lastIndexedAt =
      typeof opts === "object" && opts?.lastIndexedAt
        ? new Date(opts.lastIndexedAt)
        : status === "indexed"
          ? new Date()
          : undefined;

    const p = getPrismaClient();
    await p.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE workspaces SET
          status          = ${status},
          last_error      = ${lastError},
          last_indexed_at = ${lastIndexedAt ?? null},
          files_count     = COALESCE(${filesCount ?? null}, files_count),
          chunks_count    = COALESCE(${chunksCount ?? null}, chunks_count),
          symbols_count   = COALESCE(${symbolsCount ?? null}, symbols_count),
          updated_at      = NOW()
        WHERE project_id = ${projectId}
      `;
      if (status !== "indexed") return;
      await tx.$executeRaw`
        WITH active_counts AS (
          SELECT
            w.project_id,
            w.active_graph_generation_id AS generation_id,
            (SELECT count(*)::integer FROM symbol_files f WHERE f.project_id = w.project_id AND f.generation_id = w.active_graph_generation_id) AS files_count,
            (SELECT count(*)::integer FROM symbol_definitions d WHERE d.project_id = w.project_id AND d.generation_id = w.active_graph_generation_id) AS definitions_count,
            (SELECT count(*)::integer FROM symbol_references r WHERE r.project_id = w.project_id AND r.generation_id = w.active_graph_generation_id) AS references_count,
            (SELECT count(*)::integer FROM symbol_imports i WHERE i.project_id = w.project_id AND i.generation_id = w.active_graph_generation_id) AS imports_count,
            (SELECT count(*)::integer FROM symbol_centrality c WHERE c.project_id = w.project_id AND c.generation_id = w.active_graph_generation_id) AS centrality_count,
            (SELECT COALESCE(sum(f.parser_error_count), 0)::integer FROM symbol_files f WHERE f.project_id = w.project_id AND f.generation_id = w.active_graph_generation_id) AS diagnostics_count,
            (SELECT count(*)::integer FROM symbol_files f WHERE f.project_id = w.project_id AND f.generation_id = w.active_graph_generation_id AND f.parser_status = 'recovered') AS recovered_count,
            (SELECT count(*)::integer FROM symbol_files f WHERE f.project_id = w.project_id AND f.generation_id = w.active_graph_generation_id AND f.parser_status = 'failed') AS hard_failures_count,
            (SELECT count(*)::integer FROM symbol_files f WHERE f.project_id = w.project_id AND f.generation_id = w.active_graph_generation_id AND f.is_stale) AS stale_files_count
          FROM workspaces w
          WHERE w.project_id = ${projectId} AND w.active_graph_generation_id IS NOT NULL
          FOR UPDATE
        ), updated_generation AS (
          UPDATE graph_generations g SET
            expected_files_count = c.files_count,
            completed_files_count = c.files_count,
            files_count = c.files_count,
            definitions_count = c.definitions_count,
            references_count = c.references_count,
            imports_count = c.imports_count,
            centrality_count = c.centrality_count,
            diagnostics_count = c.diagnostics_count,
            recovered_count = c.recovered_count,
            hard_failures_count = c.hard_failures_count,
            stale_files_count = c.stale_files_count,
            completed_at = COALESCE(g.completed_at, NOW())
          FROM active_counts c
          WHERE g.project_id = c.project_id AND g.id = c.generation_id
          RETURNING g.id
        )
        UPDATE workspaces w SET
          active_files_count = c.files_count,
          active_definitions_count = c.definitions_count,
          active_references_count = c.references_count,
          active_imports_count = c.imports_count,
          active_centrality_count = c.centrality_count,
          active_diagnostics_count = c.diagnostics_count,
          active_recovered_count = c.recovered_count,
          active_hard_failures_count = c.hard_failures_count,
          active_stale_files_count = c.stale_files_count
        FROM active_counts c
        WHERE w.project_id = c.project_id AND EXISTS (SELECT 1 FROM updated_generation)
      `;
    });
  }

  async getWorkspace(projectId: string): Promise<WorkspaceRow | null> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<WsRaw[]>`
      SELECT * FROM workspaces WHERE project_id = ${projectId} LIMIT 1
    `;
    return rows.length > 0 ? mapWs(rows[0]) : null;
  }

  async listWorkspaces(): Promise<WorkspaceRow[]> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<WsRaw[]>`
      SELECT * FROM workspaces ORDER BY updated_at DESC
    `;
    return rows.map(mapWs);
  }

  async deleteWorkspace(projectId: string): Promise<void> {
    const p = getPrismaClient();
    await p.$executeRaw`DELETE FROM workspaces WHERE project_id = ${projectId}`;
  }

  // ─── File operations ───────────────────────────────────────────────────────

  async upsertFile(file: SymbolFileRow): Promise<void> {
    const p = getPrismaClient();
    await p.$executeRaw`
      INSERT INTO symbol_files (project_id, generation_id, relative_path, content_hash, mtime, size, indexed_at, symbol_count, chunk_count)
      VALUES (${file.project_id}, (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${file.project_id}), ${file.relative_path}, ${file.content_hash}, ${BigInt(Math.trunc(file.mtime))}, ${file.size}, ${new Date(file.indexed_at)}, ${file.symbol_count}, ${file.chunk_count})
      ON CONFLICT (project_id, generation_id, relative_path) DO UPDATE SET
        content_hash = EXCLUDED.content_hash,
        mtime        = EXCLUDED.mtime,
        size         = EXCLUDED.size,
        indexed_at   = EXCLUDED.indexed_at,
        symbol_count = EXCLUDED.symbol_count,
        chunk_count  = EXCLUDED.chunk_count
    `;
  }

  async getFile(
    projectId: string,
    relativePath: string,
  ): Promise<SymbolFileRow | null> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<FileRaw[]>`
      SELECT * FROM symbol_files WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
        AND relative_path = ${relativePath} LIMIT 1
    `;
    return rows.length > 0 ? mapFile(rows[0]) : null;
  }

  // ─── Definition operations ─────────────────────────────────────────────────

  async upsertDefinition(def: SymbolDefinition): Promise<void> {
    const p = getPrismaClient();
    const identity = definitionIdentityColumns(def);
    await p.$executeRaw`
      INSERT INTO symbol_definitions (id, project_id, generation_id, file_path, name, kind, line_start, line_end, exported, doc_comment, indexed_at, qualified_name, canonical_signature, signature_hash, legacy_fqn, source_span)
      VALUES (${def.id}, ${def.project_id}, (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${def.project_id}), ${def.file_path}, ${def.name}, ${def.kind}, ${def.line_start}, ${def.line_end}, ${def.exported}, ${def.doc_comment ?? null}, ${new Date(def.indexed_at)}, ${identity.qualifiedName}, ${identity.canonicalSignature}, ${identity.signatureHash}, ${identity.legacyFqn}, ${identity.sourceSpan}::jsonb)
      ON CONFLICT (project_id, generation_id, id) DO UPDATE SET
        file_path   = EXCLUDED.file_path,
        name        = EXCLUDED.name,
        kind        = EXCLUDED.kind,
        line_start  = EXCLUDED.line_start,
        line_end    = EXCLUDED.line_end,
        exported    = EXCLUDED.exported,
        doc_comment = EXCLUDED.doc_comment,
        indexed_at  = EXCLUDED.indexed_at,
        qualified_name = EXCLUDED.qualified_name,
        canonical_signature = EXCLUDED.canonical_signature,
        signature_hash = EXCLUDED.signature_hash,
        legacy_fqn = EXCLUDED.legacy_fqn,
        source_span = EXCLUDED.source_span
    `;
  }

  async deleteDefinitionsByFile(
    projectId: string,
    filePath: string,
  ): Promise<number> {
    const p = getPrismaClient();
    await p.$executeRaw`DELETE FROM symbol_definitions WHERE project_id = ${projectId} AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId}) AND file_path = ${filePath}`;
    return 0; // count not needed by callers
  }

  async searchDefinitions(
    projectId: string,
    query?: string,
    kinds?: SymbolKind[],
    exportedOnly?: boolean,
    limit: number = 20,
    filePath?: string,
  ): Promise<SymbolDefinition[]> {
    const p = getPrismaClient();
    // Build dynamic WHERE clauses via raw SQL. Each optional filter uses the
    // same null-guard idiom (mirrors the PostgreSQL listDefinitions reference impl).
    const kindList = kinds && kinds.length > 0 ? kinds : null;
    const rows = await p.$queryRaw<DefRaw[]>`
      SELECT * FROM symbol_definitions
      WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
        AND (${query ?? null}::text IS NULL OR name ILIKE ${"%" + (query ?? "") + "%"})
        AND (${kindList}::text[] IS NULL OR kind = ANY(${kindList}::text[]))
        AND (${exportedOnly ?? false} = false OR exported = true)
        AND (${filePath ?? null}::text IS NULL OR file_path = ${filePath ?? ""})
      ORDER BY name ASC
      LIMIT ${limit}
    `;
    return rows.map(mapDef);
  }

  /**
   * Pre-LIMIT total count for {@link searchDefinitions} (N4 correctness bundle).
   *
   * Returns the true number of matching definitions BEFORE the SQL `LIMIT`
   * clamps the result page, so the tool layer can emit `definitions_total`
   * alongside `definitions_shown` and `definitions_omitted` (spec AC 4, WAVE4-N4).
   *
   * Spec note: AC 4 allows `COUNT(*) OVER()` OR a separate `SELECT COUNT(*)`
   * (2 round trips). The separate-count path is chosen here for query-plan
   * clarity — the window function regresses latency on large workspaces per
   * the pre-mortem finding. The >100k sentinel cap is handled by the caller
   * (see T10) via a cheap ceiling check, NOT here, so this method stays exact.
   *
   * Uses the exact same WHERE clauses as {@link searchDefinitions} so the
   * count and the displayed list share one code path (N4 invariant: the total
   * MUST be computed on the same code path as the displayed list).
   */
  async countDefinitions(
    projectId: string,
    query?: string,
    kinds?: SymbolKind[],
    exportedOnly?: boolean,
    filePath?: string,
  ): Promise<number> {
    const p = getPrismaClient();
    const kindList = kinds && kinds.length > 0 ? kinds : null;
    const rows = await p.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM symbol_definitions
      WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
        AND (${query ?? null}::text IS NULL OR name ILIKE ${"%" + (query ?? "") + "%"})
        AND (${kindList}::text[] IS NULL OR kind = ANY(${kindList}::text[]))
        AND (${exportedOnly ?? false} = false OR exported = true)
        AND (${filePath ?? null}::text IS NULL OR file_path = ${filePath ?? ""})
    `;
    return rows.length > 0 ? Number(rows[0].count) : 0;
  }

  async getDefinition(
    projectId: string,
    fqn: string,
  ): Promise<SymbolDefinition | null> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<DefRaw[]>`
      SELECT * FROM symbol_definitions WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
        AND id = ${fqn} LIMIT 1
    `;
    return rows.length > 0 ? mapDef(rows[0]) : null;
  }

  // ─── Reference operations ──────────────────────────────────────────────────

  async insertReference(ref: SymbolReference): Promise<void> {
    const p = getPrismaClient();
    const sourceSpan = referenceSourceSpan(ref);
    await p.$executeRaw`
      INSERT INTO symbol_references (project_id, generation_id, from_file, from_line, symbol_name, target_fqn, ref_kind, meta, source_span)
      VALUES (${ref.project_id}, (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${ref.project_id}), ${ref.from_file}, ${ref.from_line}, ${ref.symbol_name}, ${ref.target_fqn ?? null}, ${ref.ref_kind}, ${ref.meta ?? null}::jsonb, ${sourceSpan}::jsonb)
    `;
  }

  async deleteReferencesByFile(
    projectId: string,
    filePath: string,
  ): Promise<number> {
    const p = getPrismaClient();
    await p.$executeRaw`DELETE FROM symbol_references WHERE project_id = ${projectId} AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId}) AND from_file = ${filePath}`;
    return 0;
  }

  async getReferences(
    projectId: string,
    symbolName: string,
    limit: number = 50,
  ): Promise<SymbolReference[]> {
    const p = getPrismaClient();
    const suffix = `#${symbolName}`;
    const rows = await p.$queryRaw<RefRaw[]>`
      SELECT * FROM symbol_references
      WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
        AND (symbol_name = ${symbolName} OR target_fqn LIKE ${"%" + suffix})
      ORDER BY from_file ASC, from_line ASC
      LIMIT ${limit}
    `;
    return rows.map(mapRef);
  }

  // ─── Import operations ─────────────────────────────────────────────────────

  async insertImport(imp: SymbolImport): Promise<void> {
    const p = getPrismaClient();
    await p.$executeRaw`
      INSERT INTO symbol_imports (project_id, generation_id, from_file, to_file, specifier, imported_names, is_external, is_type_only)
      VALUES (${imp.project_id}, (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${imp.project_id}), ${imp.from_file}, ${imp.to_file ?? null}, ${imp.specifier}, ${imp.imported_names}, ${imp.is_external}, ${imp.is_type_only})
    `;
  }

  async deleteImportsByFile(
    projectId: string,
    filePath: string,
  ): Promise<number> {
    const p = getPrismaClient();
    await p.$executeRaw`DELETE FROM symbol_imports WHERE project_id = ${projectId} AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId}) AND from_file = ${filePath}`;
    return 0;
  }

  async getImportsFrom(
    projectId: string,
    filePath: string,
  ): Promise<SymbolImport[]> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<ImpRaw[]>`
      SELECT * FROM symbol_imports WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
        AND from_file = ${filePath}
    `;
    return rows.map(mapImp);
  }

  // ─── Centrality operations ─────────────────────────────────────────────────

  async upsertCentrality(entry: CentralityEntry): Promise<void> {
    const p = getPrismaClient();
    await p.$executeRaw`
      INSERT INTO symbol_centrality (project_id, generation_id, file_path, score, updated_at)
      VALUES (${entry.project_id}, (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${entry.project_id}), ${entry.file_path}, ${entry.score}, ${new Date(entry.updated_at)})
      ON CONFLICT (project_id, generation_id, file_path) DO UPDATE SET
        score      = EXCLUDED.score,
        updated_at = EXCLUDED.updated_at
    `;
  }

  async getTopCentralFiles(
    projectId: string,
    limit: number = 20,
  ): Promise<CentralityEntry[]> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<
      {
        project_id: string;
        file_path: string;
        score: number;
        updated_at: Date;
      }[]
    >`
      SELECT * FROM symbol_centrality WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
        ORDER BY score DESC LIMIT ${limit}
    `;
    return rows.map((r) => ({
      project_id: r.project_id,
      file_path: r.file_path,
      score: Number(r.score),
      updated_at: r.updated_at.getTime(),
    }));
  }

  /**
   * Aggregates used to build a project map in a single round trip:
   * symbols grouped by kind, files grouped by extension, and the most
   * recently indexed files (absolute timestamp for the caller to format).
   */
  async getProjectMapAggregates(
    projectId: string,
    recentLimit: number = 10,
  ): Promise<{
    symbolsByKind: Record<string, number>;
    filesByLanguage: Record<string, number>;
    recentFiles: Array<{ filePath: string; indexedAt: number | null }>;
  }> {
    const [kindRows, langRows, recentRows] = await getPrismaClient().$transaction(async (tx) => {
      const scopes = await tx.$queryRaw<Array<{ generation_id: string | null }>>`
        SELECT active_graph_generation_id AS generation_id FROM workspaces
        WHERE project_id = ${projectId} FOR SHARE
      `;
      const generationId = scopes[0]?.generation_id;
      if (!generationId) return [[], [], []] as [
        { kind: string; count: bigint }[],
        { ext: string | null; count: bigint }[],
        { relative_path: string; indexed_at: Date }[],
      ];
      const kindRows = await tx.$queryRaw<{ kind: string; count: bigint }[]>`
        SELECT kind, COUNT(*)::bigint AS count
        FROM symbol_definitions
        WHERE project_id = ${projectId}
          AND generation_id = ${generationId}
        GROUP BY kind
        ORDER BY count DESC
      `;
      // Postgres-native extension extraction; NULLIF avoids treating files
      // without a dot as extension "" (they fall under "other").
      const langRows = await tx.$queryRaw<{ ext: string | null; count: bigint }[]>`
        SELECT LOWER(NULLIF(SUBSTRING(relative_path FROM '\\.([^./\\\\]+)$'), '')) AS ext,
               COUNT(*)::bigint AS count
        FROM symbol_files
        WHERE project_id = ${projectId}
          AND generation_id = ${generationId}
        GROUP BY ext
        ORDER BY count DESC
      `;
      const recentRows = await tx.$queryRaw<{ relative_path: string; indexed_at: Date }[]>`
        SELECT relative_path, indexed_at
        FROM symbol_files
        WHERE project_id = ${projectId}
          AND generation_id = ${generationId}
        ORDER BY indexed_at DESC
        LIMIT ${recentLimit}
      `;
      return [kindRows, langRows, recentRows] as const;
    });

    const symbolsByKind: Record<string, number> = {};
    for (const row of kindRows) symbolsByKind[row.kind] = Number(row.count);

    const filesByLanguage: Record<string, number> = {};
    for (const row of langRows) {
      const key = row.ext ?? "other";
      filesByLanguage[key] = Number(row.count);
    }

    const recentFiles = recentRows.map((r) => ({
      filePath: r.relative_path,
      indexedAt: r.indexed_at ? r.indexed_at.getTime() : null,
    }));

    return { symbolsByKind, filesByLanguage, recentFiles };
  }

  /**
   * Capture every graph-backed project-map input from one active generation.
   * The workspace share lock prevents activation from changing the pointer
   * until all reads finish; every query is additionally scoped by the captured
   * generation id so pending rows can never leak into the response.
   */
  async getProjectMapSnapshot(
    projectId: string,
    opts: ProjectMapSnapshotOptions = {},
  ): Promise<ProjectMapGraphSnapshot | null> {
    const centralityLimit = opts.centralityLimit ?? 20;
    const recentLimit = opts.recentLimit ?? 10;
    // Wave 5 FR-02 / N2: CALL-edge budget. Matches the iterative Tarjan edge
    // budget (AD-W5-017) so the SCC detector never receives more edges than
    // it can process within the RSS guard. Over the budget, rows are
    // truncated and the `cycles` aspect surfaces `cycles_truncated=true`.
    const callEdgeBudget = opts.callEdgeBudget ?? 400_000;

    return getPrismaClient().$transaction(async (tx) => {
      const workspaceRows = await tx.$queryRaw<Array<WsRaw & { active_graph_generation_id: string | null }>>`
        SELECT * FROM workspaces WHERE project_id = ${projectId} FOR SHARE
      `;
      const workspaceRow = workspaceRows[0];
      if (!workspaceRow) return null;

      const generationId = workspaceRow.active_graph_generation_id;
      await opts.afterGenerationCaptured?.(generationId);

      const empty: ProjectMapGraphSnapshot = {
        workspace: mapWs(workspaceRow),
        generationId: null,
        counts: { files: 0, definitions: 0, references: 0, imports: 0, centrality: 0 },
        diagnostics: { recovered: 0, hardFailures: 0, staleFiles: 0, errors: 0 },
        languages: {},
        topCentralFiles: [],
        symbolsByKind: {},
        filesByLanguage: {},
        recentFiles: [],
        edgesByKind: {},
        architecture: {
          files: [], importEdges: [], definitions: [], httpEdges: [], callEdges: [], centrality: new Map(),
        },
      };
      if (!generationId) return empty;

      const fileRows = await tx.$queryRaw<Array<{
        relative_path: string;
        indexed_at: Date | null;
        language: string | null;
        parser_status: string;
        parser_error_count: number;
        is_stale: boolean;
      }>>`
        SELECT relative_path, indexed_at, language, parser_status,
               parser_error_count, is_stale
        FROM symbol_files
        WHERE project_id = ${projectId} AND generation_id = ${generationId}
      `;
      const kindRows = await tx.$queryRaw<Array<{ kind: string; count: bigint }>>`
        SELECT kind, COUNT(*)::bigint AS count
        FROM symbol_definitions
        WHERE project_id = ${projectId} AND generation_id = ${generationId}
        GROUP BY kind
      `;
      const definitionRows = await tx.$queryRaw<DefRaw[]>`
        SELECT * FROM symbol_definitions
        WHERE project_id = ${projectId} AND generation_id = ${generationId}
        ORDER BY file_path, line_start, id
        LIMIT 1000
      `;
      const importRows = await tx.$queryRaw<Array<{ from_file: string; to_file: string | null }>>`
        SELECT from_file, to_file FROM symbol_imports
        WHERE project_id = ${projectId} AND generation_id = ${generationId}
      `;
      const edgeRows = await tx.$queryRaw<Array<{ ref_kind: string; count: bigint }>>`
        SELECT ref_kind, COUNT(*)::bigint AS count
        FROM symbol_references
        WHERE project_id = ${projectId} AND generation_id = ${generationId}
        GROUP BY ref_kind
      `;
      const httpRows = await tx.$queryRaw<RefRaw[]>`
        SELECT * FROM symbol_references
        WHERE project_id = ${projectId} AND generation_id = ${generationId}
          AND ref_kind = 'http_call'
        ORDER BY from_file, from_line
        LIMIT 200
      `;
      // Wave 5 FR-02 / N2: CALL-kind edges drive the `cycles` aspect (Tarjan
      // SCC). Bounded by `callEdgeBudget` (default 400_000); over the budget,
      // the rows are truncated and `cycles_truncated=true` is surfaced. The
      // budget matches the iterative Tarjan edge ceiling (AD-W5-017) so the
      // SCC detector never overflows the JS stack under the RSS guard.
      const callRows = await tx.$queryRaw<RefRaw[]>`
        SELECT * FROM symbol_references
        WHERE project_id = ${projectId} AND generation_id = ${generationId}
          AND ref_kind = 'call'
        ORDER BY from_file, from_line
        LIMIT ${callEdgeBudget}
      `;
      const centralityRows = await tx.$queryRaw<Array<{
        file_path: string;
        score: number;
        updated_at: Date;
      }>>`
        SELECT file_path, score, updated_at FROM symbol_centrality
        WHERE project_id = ${projectId} AND generation_id = ${generationId}
      `;

      const symbolsByKind: Record<string, number> = {};
      let definitionCount = 0;
      for (const row of kindRows) {
        const count = Number(row.count);
        symbolsByKind[row.kind] = count;
        definitionCount += count;
      }

      const edgesByKind: Record<string, number> = {};
      let referenceCount = 0;
      for (const row of edgeRows) {
        const count = Number(row.count);
        edgesByKind[row.ref_kind] = count;
        referenceCount += count;
      }

      const languages: Record<string, number> = {};
      const filesByLanguage: Record<string, number> = {};
      let recovered = 0;
      let hardFailures = 0;
      let staleFiles = 0;
      let errors = 0;
      for (const row of fileRows) {
        const language = row.language ?? "unknown";
        languages[language] = (languages[language] ?? 0) + 1;
        const extension = row.relative_path.match(/\.([^./\\]+)$/)?.[1]?.toLowerCase() ?? "other";
        filesByLanguage[extension] = (filesByLanguage[extension] ?? 0) + 1;
        if (row.parser_status === "recovered") recovered++;
        if (row.parser_status === "failed" || row.parser_status === "unsupported") hardFailures++;
        if (row.is_stale) staleFiles++;
        errors += Number(row.parser_error_count);
      }

      const centrality = new Map<string, number>();
      const centralEntries = centralityRows.map((row) => {
        const score = Number(row.score);
        centrality.set(row.file_path, score);
        return {
          project_id: projectId,
          file_path: row.file_path,
          score,
          updated_at: row.updated_at.getTime(),
        } satisfies CentralityEntry;
      });
      centralEntries.sort((left, right) => right.score - left.score || left.file_path.localeCompare(right.file_path));

      const recentFiles = fileRows
        .map((row) => ({ filePath: row.relative_path, indexedAt: row.indexed_at?.getTime() ?? null }))
        .sort((left, right) => (right.indexedAt ?? 0) - (left.indexedAt ?? 0) || left.filePath.localeCompare(right.filePath))
        .slice(0, recentLimit);

      return {
        workspace: mapWs(workspaceRow),
        generationId,
        counts: {
          files: fileRows.length,
          definitions: definitionCount,
          references: referenceCount,
          imports: importRows.length,
          centrality: centralityRows.length,
        },
        diagnostics: { recovered, hardFailures, staleFiles, errors },
        languages,
        topCentralFiles: centralEntries.slice(0, centralityLimit),
        symbolsByKind,
        filesByLanguage,
        recentFiles,
        edgesByKind,
        architecture: {
          files: fileRows.map((row) => row.relative_path),
          importEdges: importRows.map((row) => ({
            from_file: row.from_file,
            ...(row.to_file ? { to_file: row.to_file } : {}),
          })),
          definitions: definitionRows.map(mapDef),
          httpEdges: httpRows.map(mapRef),
          callEdges: callRows.map(mapRef),
          centrality,
        },
      };
    });
  }

  async getCentrality(projectId: string): Promise<Map<string, number>> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<{ file_path: string; score: number }[]>`
      SELECT file_path, score FROM symbol_centrality WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
    `;
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.file_path, Number(r.score));
    return map;
  }

  // ─── Batch operations ──────────────────────────────────────────────────────

  async batchUpsertDefinitions(defs: SymbolDefinition[]): Promise<void> {
    if (defs.length === 0) return;
    const p = getPrismaClient();
    await p.$transaction(async (tx) => {
      const generationByProject = await lockActiveGenerations(tx, defs.map((def) => def.project_id));
      for (const def of defs) {
        const generationId = generationByProject.get(def.project_id)!;
        const identity = definitionIdentityColumns(def);
        await tx.$executeRaw`
          INSERT INTO symbol_definitions (id, project_id, generation_id, file_path, name, kind, line_start, line_end, exported, doc_comment, indexed_at, qualified_name, canonical_signature, signature_hash, legacy_fqn, source_span)
          VALUES (${def.id}, ${def.project_id}, ${generationId}, ${def.file_path}, ${def.name}, ${def.kind}, ${def.line_start}, ${def.line_end}, ${def.exported}, ${def.doc_comment ?? null}, ${new Date(def.indexed_at)}, ${identity.qualifiedName}, ${identity.canonicalSignature}, ${identity.signatureHash}, ${identity.legacyFqn}, ${identity.sourceSpan}::jsonb)
          ON CONFLICT (project_id, generation_id, id) DO UPDATE SET
            file_path   = EXCLUDED.file_path,
            name        = EXCLUDED.name,
            kind        = EXCLUDED.kind,
            line_start  = EXCLUDED.line_start,
            line_end    = EXCLUDED.line_end,
            exported    = EXCLUDED.exported,
            doc_comment = EXCLUDED.doc_comment,
            indexed_at  = EXCLUDED.indexed_at,
            qualified_name = EXCLUDED.qualified_name,
            canonical_signature = EXCLUDED.canonical_signature,
            signature_hash = EXCLUDED.signature_hash,
            legacy_fqn = EXCLUDED.legacy_fqn,
            source_span = EXCLUDED.source_span
        `;
      }
    });
  }

  async batchInsertReferences(refs: SymbolReference[]): Promise<void> {
    if (refs.length === 0) return;
    const p = getPrismaClient();
    await p.$transaction(async (tx) => {
      const generationByProject = await lockActiveGenerations(tx, refs.map((ref) => ref.project_id));
      for (const ref of refs) {
        const generationId = generationByProject.get(ref.project_id)!;
        const sourceSpan = referenceSourceSpan(ref);
        await tx.$executeRaw`
          INSERT INTO symbol_references (project_id, generation_id, from_file, from_line, symbol_name, target_fqn, ref_kind, meta, source_span)
          VALUES (${ref.project_id}, ${generationId}, ${ref.from_file}, ${ref.from_line}, ${ref.symbol_name}, ${ref.target_fqn ?? null}, ${ref.ref_kind}, ${ref.meta ?? null}::jsonb, ${sourceSpan}::jsonb)
        `;
      }
    });
  }

  async batchInsertImports(imports: SymbolImport[]): Promise<void> {
    if (imports.length === 0) return;
    const p = getPrismaClient();
    await p.$transaction(async (tx) => {
      const generationByProject = await lockActiveGenerations(tx, imports.map((item) => item.project_id));
      for (const imp of imports) {
        const generationId = generationByProject.get(imp.project_id)!;
        await tx.$executeRaw`
          INSERT INTO symbol_imports (project_id, generation_id, from_file, to_file, specifier, imported_names, is_external, is_type_only)
          VALUES (${imp.project_id}, ${generationId}, ${imp.from_file}, ${imp.to_file ?? null}, ${imp.specifier}, ${imp.imported_names}, ${imp.is_external}, ${imp.is_type_only})
        `;
      }
    });
  }

  // ── Generation-scoped writes ─────────────────────────────────────────────

  async copyFileGeneration(
    lease: GraphGenerationLease,
    sourceGenerationId: string,
    filePath: string,
  ): Promise<{ status: "copied" | "missing" | "lease_lost" }> {
    return getPrismaClient().$transaction(async (tx) => {
      if (!await lockOwnedPendingGeneration(tx, lease)) return { status: "lease_lost" as const };
      if (lease.expectedActiveGenerationId !== sourceGenerationId) return { status: "lease_lost" as const };
      const inserted = await tx.$executeRaw`
        INSERT INTO symbol_files (
          project_id, generation_id, relative_path, content_hash, mtime, size, indexed_at,
          symbol_count, chunk_count, language, dialect, grammar_version, query_pack_version,
          resolver_version, parser_status, parser_error_count, diagnostics, is_stale,
          last_known_good_generation_id, last_successful_at
        ) SELECT project_id, ${lease.generationId}, relative_path, content_hash, mtime, size, indexed_at,
          symbol_count, chunk_count, language, dialect, grammar_version, query_pack_version,
          resolver_version, parser_status, parser_error_count, diagnostics, is_stale,
          last_known_good_generation_id, last_successful_at
        FROM symbol_files WHERE project_id = ${lease.projectId}
          AND generation_id = ${sourceGenerationId} AND relative_path = ${filePath}
      `;
      if (inserted !== 1) return { status: "missing" as const };
      await tx.$executeRaw`INSERT INTO symbol_definitions (id,project_id,generation_id,file_path,name,kind,line_start,line_end,exported,doc_comment,indexed_at,qualified_name,canonical_signature,signature_hash,legacy_fqn,source_span) SELECT id,project_id,${lease.generationId},file_path,name,kind,line_start,line_end,exported,doc_comment,indexed_at,qualified_name,canonical_signature,signature_hash,legacy_fqn,source_span FROM symbol_definitions WHERE project_id=${lease.projectId} AND generation_id=${sourceGenerationId} AND file_path=${filePath}`;
      await tx.$executeRaw`INSERT INTO symbol_references (project_id,generation_id,from_file,from_line,symbol_name,target_fqn,ref_kind,meta,source_span) SELECT project_id,${lease.generationId},from_file,from_line,symbol_name,target_fqn,ref_kind,meta,source_span FROM symbol_references WHERE project_id=${lease.projectId} AND generation_id=${sourceGenerationId} AND from_file=${filePath}`;
      await tx.$executeRaw`INSERT INTO symbol_imports (project_id,generation_id,from_file,to_file,specifier,imported_names,is_external,is_type_only) SELECT project_id,${lease.generationId},from_file,to_file,specifier,imported_names,is_external,is_type_only FROM symbol_imports WHERE project_id=${lease.projectId} AND generation_id=${sourceGenerationId} AND from_file=${filePath}`;
      await tx.$executeRaw`INSERT INTO symbol_centrality (project_id,generation_id,file_path,score,updated_at) SELECT project_id,${lease.generationId},file_path,score,updated_at FROM symbol_centrality WHERE project_id=${lease.projectId} AND generation_id=${sourceGenerationId} AND file_path=${filePath}`;
      return { status: "copied" as const };
    });
  }

  async writeFileGeneration(
    input: { lease: GraphGenerationLease } & GenerationFileWrite,
  ): Promise<{ status: "written" | "lease_lost" }> {
    validateGenerationFileWrite(input, input.lease);
    return getPrismaClient().$transaction(async (tx) => {
      if (!await lockOwnedPendingGeneration(tx, input.lease)) return { status: "lease_lost" as const };

      const { lease, file, definitions, references, imports } = input;
      const oldRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM symbol_definitions
        WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId}
          AND file_path = ${file.relative_path}
      `;
      const retainedIds = new Set(definitions.map((definition) => definition.id));
      const removedIds = oldRows.map((row) => row.id).filter((id) => !retainedIds.has(id));

      await tx.$executeRaw`DELETE FROM symbol_references WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND from_file = ${file.relative_path}`;
      if (removedIds.length > 0) {
        await tx.$executeRaw`DELETE FROM symbol_references WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND target_fqn = ANY(${removedIds}::text[])`;
      }
      await tx.$executeRaw`DELETE FROM symbol_imports WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND from_file = ${file.relative_path}`;
      await tx.$executeRaw`DELETE FROM symbol_centrality WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND file_path = ${file.relative_path}`;
      await tx.$executeRaw`DELETE FROM symbol_definitions WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND file_path = ${file.relative_path}`;

      const diagnostics = file.diagnostics ?? [];
      const diagnosticsJson = JSON.stringify(diagnostics);
      const parserStatus = file.parser_status ?? "ok";
      const successful = parserStatus === "ok" || parserStatus === "recovered";
      await tx.$executeRaw`
        INSERT INTO symbol_files (
          project_id, generation_id, relative_path, content_hash, mtime, size, indexed_at,
          symbol_count, chunk_count, language, dialect, grammar_version, query_pack_version,
          resolver_version, parser_status, parser_error_count, diagnostics, is_stale,
          last_known_good_generation_id, last_successful_at
        ) VALUES (
          ${lease.projectId}, ${lease.generationId}, ${file.relative_path}, ${file.content_hash},
          ${BigInt(Math.trunc(file.mtime))}, ${file.size}, ${new Date(file.indexed_at)},
          ${file.symbol_count}, ${file.chunk_count}, ${file.language ?? null}, ${file.dialect ?? null},
          ${file.grammar_version ?? null}, ${file.query_pack_version ?? null},
          ${file.resolver_version ?? null}, ${parserStatus}, ${file.parser_error_count ?? 0},
          ${diagnosticsJson}::jsonb, ${file.is_stale ?? false},
          ${file.last_known_good_generation_id ?? (successful ? lease.generationId : null)},
          ${file.last_successful_at ? new Date(file.last_successful_at) : (successful ? new Date(file.indexed_at) : null)}
        )
        ON CONFLICT (project_id, generation_id, relative_path) DO UPDATE SET
          content_hash = EXCLUDED.content_hash, mtime = EXCLUDED.mtime, size = EXCLUDED.size,
          indexed_at = EXCLUDED.indexed_at, symbol_count = EXCLUDED.symbol_count,
          chunk_count = EXCLUDED.chunk_count, language = EXCLUDED.language, dialect = EXCLUDED.dialect,
          grammar_version = EXCLUDED.grammar_version, query_pack_version = EXCLUDED.query_pack_version,
          resolver_version = EXCLUDED.resolver_version, parser_status = EXCLUDED.parser_status,
          parser_error_count = EXCLUDED.parser_error_count, diagnostics = EXCLUDED.diagnostics,
          is_stale = EXCLUDED.is_stale,
          last_known_good_generation_id = EXCLUDED.last_known_good_generation_id,
          last_successful_at = EXCLUDED.last_successful_at
      `;

      for (const definition of definitions) {
        const identity = generationDefinitionIdentityColumns(definition);
        await tx.$executeRaw`
          INSERT INTO symbol_definitions (id, project_id, generation_id, file_path, name, kind, line_start, line_end, exported, doc_comment, indexed_at, qualified_name, canonical_signature, signature_hash, legacy_fqn, source_span)
          VALUES (${definition.id}, ${lease.projectId}, ${lease.generationId}, ${file.relative_path}, ${definition.name}, ${definition.kind}, ${definition.line_start}, ${definition.line_end}, ${definition.exported}, ${definition.doc_comment ?? null}, ${new Date(definition.indexed_at)}, ${identity.qualifiedName}, ${identity.canonicalSignature}, ${identity.signatureHash}, ${identity.legacyFqn}, ${identity.sourceSpan}::jsonb)
        `;
      }
      for (const reference of references) {
        const sourceSpan = referenceSourceSpan(reference);
        await tx.$executeRaw`
          INSERT INTO symbol_references (project_id, generation_id, from_file, from_line, symbol_name, target_fqn, ref_kind, meta, source_span)
          VALUES (${lease.projectId}, ${lease.generationId}, ${file.relative_path}, ${reference.from_line}, ${reference.symbol_name}, ${reference.target_fqn ?? null}, ${reference.ref_kind}, ${reference.meta ?? null}::jsonb, ${sourceSpan}::jsonb)
        `;
      }
      for (const imported of imports) {
        await tx.$executeRaw`
          INSERT INTO symbol_imports (project_id, generation_id, from_file, to_file, specifier, imported_names, is_external, is_type_only)
          VALUES (${lease.projectId}, ${lease.generationId}, ${file.relative_path}, ${imported.to_file ?? null}, ${imported.specifier}, ${imported.imported_names}, ${imported.is_external}, ${imported.is_type_only})
        `;
      }
      return { status: "written" as const };
    });
  }

  async deleteFileGeneration(
    lease: GraphGenerationLease,
    filePath: string,
  ): Promise<{ status: "deleted" | "lease_lost" }> {
    if (!filePath) throw new TypeError("filePath must not be empty");
    return getPrismaClient().$transaction(async (tx) => {
      if (!await lockOwnedPendingGeneration(tx, lease)) return { status: "lease_lost" as const };
      const ids = (await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM symbol_definitions WHERE project_id = ${lease.projectId}
          AND generation_id = ${lease.generationId} AND file_path = ${filePath}
      `).map((row) => row.id);
      await tx.$executeRaw`DELETE FROM symbol_references WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND from_file = ${filePath}`;
      if (ids.length > 0) {
        await tx.$executeRaw`DELETE FROM symbol_references WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND target_fqn = ANY(${ids}::text[])`;
      }
      await tx.$executeRaw`DELETE FROM symbol_imports WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND (from_file = ${filePath} OR to_file = ${filePath})`;
      await tx.$executeRaw`DELETE FROM symbol_centrality WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND file_path = ${filePath}`;
      await tx.$executeRaw`DELETE FROM symbol_definitions WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND file_path = ${filePath}`;
      await tx.$executeRaw`DELETE FROM symbol_files WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND relative_path = ${filePath}`;
      return { status: "deleted" as const };
    });
  }

  async markFileStaleGeneration(
    lease: GraphGenerationLease,
    filePath: string,
    input: {
      lastKnownGoodGenerationId: string;
      diagnostics: readonly Record<string, unknown>[];
      parserErrorCount: number;
    },
  ): Promise<{ status: "stale" | "lease_lost" }> {
    if (!filePath || input.diagnostics.length > 10 || !Number.isInteger(input.parserErrorCount) || input.parserErrorCount < 0) {
      throw new TypeError("invalid stale file metadata");
    }
    return getPrismaClient().$transaction(async (tx) => {
      if (!await lockOwnedPendingGeneration(tx, lease)) return { status: "lease_lost" as const };
      const active = await tx.$queryRaw<Array<{ active_graph_generation_id: string | null }>>`
        SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${lease.projectId}
      `;
      if (active[0]?.active_graph_generation_id !== input.lastKnownGoodGenerationId) return { status: "lease_lost" as const };
      const diagnosticsJson = JSON.stringify(input.diagnostics);

      const oldIds = (await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM symbol_definitions WHERE project_id = ${lease.projectId}
          AND generation_id = ${lease.generationId} AND file_path = ${filePath}
      `).map((row) => row.id);
      const retainedIds = new Set((await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM symbol_definitions WHERE project_id = ${lease.projectId}
          AND generation_id = ${input.lastKnownGoodGenerationId} AND file_path = ${filePath}
      `).map((row) => row.id));
      const removedIds = oldIds.filter((id) => !retainedIds.has(id));

      await tx.$executeRaw`DELETE FROM symbol_references WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND from_file = ${filePath}`;
      if (removedIds.length > 0) {
        await tx.$executeRaw`DELETE FROM symbol_references WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND target_fqn = ANY(${removedIds}::text[])`;
      }
      await tx.$executeRaw`DELETE FROM symbol_imports WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND from_file = ${filePath}`;
      await tx.$executeRaw`DELETE FROM symbol_centrality WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND file_path = ${filePath}`;
      await tx.$executeRaw`DELETE FROM symbol_definitions WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND file_path = ${filePath}`;
      await tx.$executeRaw`DELETE FROM symbol_files WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId} AND relative_path = ${filePath}`;

      const inserted = await tx.$executeRaw`
        INSERT INTO symbol_files (
          project_id, generation_id, relative_path, content_hash, mtime, size, indexed_at,
          symbol_count, chunk_count, language, dialect, grammar_version, query_pack_version,
          resolver_version, parser_status, parser_error_count, diagnostics, is_stale,
          last_known_good_generation_id, last_successful_at
        )
        SELECT project_id, ${lease.generationId}, relative_path, content_hash, mtime, size, clock_timestamp(),
          symbol_count, chunk_count, language, dialect, grammar_version, query_pack_version,
          resolver_version, 'failed', ${input.parserErrorCount}, ${diagnosticsJson}::jsonb, true,
          ${input.lastKnownGoodGenerationId}, last_successful_at
        FROM symbol_files WHERE project_id = ${lease.projectId}
          AND generation_id = ${input.lastKnownGoodGenerationId} AND relative_path = ${filePath}
      `;
      if (inserted !== 1) throw new Error(`last_known_good_file_missing:${filePath}`);
      await tx.$executeRaw`
        INSERT INTO symbol_definitions (id, project_id, generation_id, file_path, name, kind, line_start, line_end, exported, doc_comment, indexed_at, qualified_name, canonical_signature, signature_hash, legacy_fqn, source_span)
        SELECT id, project_id, ${lease.generationId}, file_path, name, kind, line_start, line_end, exported, doc_comment, indexed_at, qualified_name, canonical_signature, signature_hash, legacy_fqn, source_span
        FROM symbol_definitions WHERE project_id = ${lease.projectId} AND generation_id = ${input.lastKnownGoodGenerationId} AND file_path = ${filePath}
      `;
      await tx.$executeRaw`
        INSERT INTO symbol_references (project_id, generation_id, from_file, from_line, symbol_name, target_fqn, ref_kind, meta, source_span)
        SELECT project_id, ${lease.generationId}, from_file, from_line, symbol_name, target_fqn, ref_kind, meta, source_span
        FROM symbol_references WHERE project_id = ${lease.projectId} AND generation_id = ${input.lastKnownGoodGenerationId} AND from_file = ${filePath}
      `;
      await tx.$executeRaw`
        INSERT INTO symbol_imports (project_id, generation_id, from_file, to_file, specifier, imported_names, is_external, is_type_only)
        SELECT project_id, ${lease.generationId}, from_file, to_file, specifier, imported_names, is_external, is_type_only
        FROM symbol_imports WHERE project_id = ${lease.projectId} AND generation_id = ${input.lastKnownGoodGenerationId} AND from_file = ${filePath}
      `;
      await tx.$executeRaw`
        INSERT INTO symbol_centrality (project_id, generation_id, file_path, score, updated_at)
        SELECT project_id, ${lease.generationId}, file_path, score, clock_timestamp()
        FROM symbol_centrality WHERE project_id = ${lease.projectId} AND generation_id = ${input.lastKnownGoodGenerationId} AND file_path = ${filePath}
      `;
      return { status: "stale" as const };
    });
  }

  async updateCentralityGeneration(
    lease: GraphGenerationLease,
    entries: readonly { filePath: string; score: number }[],
  ): Promise<{ status: "written" | "lease_lost" }> {
    if (entries.some((entry) => !entry.filePath || !Number.isFinite(entry.score))) {
      throw new TypeError("centrality entries require a path and finite score");
    }
    return getPrismaClient().$transaction(async (tx) => {
      if (!await lockOwnedPendingGeneration(tx, lease)) return { status: "lease_lost" as const };
      await tx.$executeRaw`DELETE FROM symbol_centrality WHERE project_id = ${lease.projectId} AND generation_id = ${lease.generationId}`;
      for (const entry of entries) {
        await tx.$executeRaw`
          INSERT INTO symbol_centrality (project_id, generation_id, file_path, score, updated_at)
          VALUES (${lease.projectId}, ${lease.generationId}, ${entry.filePath}, ${entry.score}, clock_timestamp())
        `;
      }
      return { status: "written" as const };
    });
  }

  // ── High-level composite operations ──────────────────────────────────────

  async writeFileSymbols(
    projectId: string,
    filePath: string,
    defs: SymbolDefinition[],
    refs: SymbolReference[],
    imports: SymbolImport[],
  ): Promise<void> {
    const now = new Date();

    await getPrismaClient().$transaction(async (tx) => {
      const generations = await tx.$queryRaw<Array<{ active_graph_generation_id: string }>>`
        SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId} FOR UPDATE
      `;
      const generationId = generations[0]?.active_graph_generation_id;
      if (!generationId) throw new Error(`active_graph_generation_missing:${projectId}`);

      const oldIds = (await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM symbol_definitions WHERE project_id = ${projectId}
          AND generation_id = ${generationId} AND file_path = ${filePath}
      `).map((row) => row.id);
      const retainedIds = new Set(defs.map((definition) => definition.id));
      const removedIds = oldIds.filter((id) => !retainedIds.has(id));
      await tx.$executeRaw`DELETE FROM symbol_references WHERE project_id = ${projectId} AND generation_id = ${generationId} AND from_file = ${filePath}`;
      if (removedIds.length > 0) {
        await tx.$executeRaw`DELETE FROM symbol_references WHERE project_id = ${projectId} AND generation_id = ${generationId} AND target_fqn = ANY(${removedIds}::text[])`;
      }
      await tx.$executeRaw`DELETE FROM symbol_imports WHERE project_id = ${projectId} AND generation_id = ${generationId} AND from_file = ${filePath}`;
      await tx.$executeRaw`DELETE FROM symbol_definitions WHERE project_id = ${projectId} AND generation_id = ${generationId} AND file_path = ${filePath}`;

      for (const def of defs) {
        const identity = definitionIdentityColumns(def);
        await tx.$executeRaw`
          INSERT INTO symbol_definitions (id, project_id, generation_id, file_path, name, kind, line_start, line_end, exported, doc_comment, indexed_at, qualified_name, canonical_signature, signature_hash, legacy_fqn, source_span)
          VALUES (${def.id}, ${projectId}, ${generationId}, ${filePath}, ${def.name}, ${def.kind}, ${def.line_start}, ${def.line_end}, ${def.exported}, ${def.doc_comment ?? null}, ${now}, ${identity.qualifiedName}, ${identity.canonicalSignature}, ${identity.signatureHash}, ${identity.legacyFqn}, ${identity.sourceSpan}::jsonb)
          ON CONFLICT (project_id, generation_id, id) DO UPDATE SET
            file_path   = EXCLUDED.file_path,
            name        = EXCLUDED.name,
            kind        = EXCLUDED.kind,
            line_start  = EXCLUDED.line_start,
            line_end    = EXCLUDED.line_end,
            exported    = EXCLUDED.exported,
            doc_comment = EXCLUDED.doc_comment,
            indexed_at  = EXCLUDED.indexed_at,
            qualified_name = EXCLUDED.qualified_name,
            canonical_signature = EXCLUDED.canonical_signature,
            signature_hash = EXCLUDED.signature_hash,
            legacy_fqn = EXCLUDED.legacy_fqn,
            source_span = EXCLUDED.source_span
        `;
      }

      for (const ref of refs) {
        const sourceSpan = referenceSourceSpan(ref);
        await tx.$executeRaw`
          INSERT INTO symbol_references (project_id, generation_id, from_file, from_line, symbol_name, target_fqn, ref_kind, meta, source_span)
          VALUES (${projectId}, ${generationId}, ${filePath}, ${ref.from_line}, ${ref.symbol_name}, ${ref.target_fqn ?? null}, ${ref.ref_kind}, ${ref.meta ?? null}::jsonb, ${sourceSpan}::jsonb)
        `;
      }

      for (const imp of imports) {
        await tx.$executeRaw`
          INSERT INTO symbol_imports (project_id, generation_id, from_file, to_file, specifier, imported_names, is_external, is_type_only)
          VALUES (${projectId}, ${generationId}, ${filePath}, ${imp.to_file ?? null}, ${imp.specifier}, ${imp.imported_names}, ${imp.is_external}, ${imp.is_type_only})
        `;
      }
    });
  }

  async clearProject(projectId: string): Promise<void> {
    const p = getPrismaClient();
    await p.$executeRaw`DELETE FROM workspaces WHERE project_id = ${projectId}`;
  }

  // ── Query helpers ────────────────────────────────────────────────────────

  async getActiveGenerationScope(projectId: string): Promise<ActiveGenerationScope | null> {
    const rows = await getPrismaClient().$queryRaw<Array<{ generation_id: string | null }>>`
      SELECT active_graph_generation_id AS generation_id
      FROM workspaces WHERE project_id = ${projectId}
    `;
    const generationId = rows[0]?.generation_id;
    return generationId ? { projectId, generationId } : null;
  }

  async resolveDefinitionFqn(
    projectId: string,
    fqn: string,
  ): Promise<DefinitionFqnResolution> {
    // Inputs without a file separator are valid misses, never substring name
    // searches. Inputs that claim to be FQNs must satisfy the shared codec.
    if (fqn.includes("#")) parseStructuralFqn(fqn);
    else return { found: false, ambiguous: false, fqn, candidates: [] };

    return getPrismaClient().$transaction(async (tx) => {
      const scopes = await tx.$queryRaw<Array<{ generation_id: string }>>`
        SELECT generation.id AS generation_id
        FROM workspaces workspace
        JOIN graph_generations generation
          ON generation.project_id = workspace.project_id
         AND generation.id = workspace.active_graph_generation_id
        WHERE workspace.project_id = ${projectId} AND generation.status = 'active'
        FOR SHARE OF generation
      `;
      const generationId = scopes[0]?.generation_id;
      if (!generationId) return { found: false, ambiguous: false, fqn, candidates: [] } as const;

      const exact = await tx.$queryRaw<DefRaw[]>`
        SELECT * FROM symbol_definitions WHERE project_id = ${projectId}
          AND generation_id = ${generationId} AND id = ${fqn} LIMIT 1
      `;
      if (exact[0]) return { found: true, ambiguous: false, definition: mapDef(exact[0]) } as const;

      const aliases = (await tx.$queryRaw<DefRaw[]>`
        SELECT * FROM symbol_definitions WHERE project_id = ${projectId}
          AND generation_id = ${generationId} AND legacy_fqn = ${fqn}
      `).map(mapDef);
      if (aliases.length === 1) {
        return { found: true, ambiguous: false, definition: aliases[0]! } as const;
      }
      if (aliases.length === 0) {
        return { found: false, ambiguous: false, legacyFqn: fqn, candidates: [] } as const;
      }
      return {
        found: false,
        ambiguous: true,
        legacyFqn: fqn,
        candidates: Object.freeze(aliases.map(definitionCandidate).sort(compareDefinitionCandidates)),
      } as const;
    });
  }

  async getActiveGraphSnapshot(projectId: string): Promise<{
    generationId: string;
    counts: { files: number; definitions: number; references: number; imports: number; centrality: number };
    diagnostics: { recovered: number; hardFailures: number; staleFiles: number; errors: number };
    languages: Record<string, number>;
  } | null> {
    const rows = await getPrismaClient().$queryRaw<Array<{
      generation_id: string;
      files: number;
      definitions: number;
      references: number;
      imports: number;
      centrality: number;
      recovered: number;
      hard_failures: number;
      stale_files: number;
      errors: number;
      languages: Record<string, number> | null;
    }>>`
      SELECT w.active_graph_generation_id AS generation_id,
        (SELECT count(*)::integer FROM symbol_files f WHERE f.project_id = w.project_id AND f.generation_id = w.active_graph_generation_id) AS files,
        (SELECT count(*)::integer FROM symbol_definitions d WHERE d.project_id = w.project_id AND d.generation_id = w.active_graph_generation_id) AS definitions,
        (SELECT count(*)::integer FROM symbol_references r WHERE r.project_id = w.project_id AND r.generation_id = w.active_graph_generation_id) AS references,
        (SELECT count(*)::integer FROM symbol_imports i WHERE i.project_id = w.project_id AND i.generation_id = w.active_graph_generation_id) AS imports,
        (SELECT count(*)::integer FROM symbol_centrality c WHERE c.project_id = w.project_id AND c.generation_id = w.active_graph_generation_id) AS centrality,
        (SELECT count(*)::integer FROM symbol_files f WHERE f.project_id = w.project_id AND f.generation_id = w.active_graph_generation_id AND f.parser_status = 'recovered') AS recovered,
        (SELECT count(*)::integer FROM symbol_files f WHERE f.project_id = w.project_id AND f.generation_id = w.active_graph_generation_id AND f.parser_status IN ('failed','unsupported')) AS hard_failures,
        (SELECT count(*)::integer FROM symbol_files f WHERE f.project_id = w.project_id AND f.generation_id = w.active_graph_generation_id AND f.is_stale) AS stale_files,
        (SELECT COALESCE(sum(f.parser_error_count), 0)::integer FROM symbol_files f WHERE f.project_id = w.project_id AND f.generation_id = w.active_graph_generation_id) AS errors,
        (SELECT COALESCE(jsonb_object_agg(x.language, x.count), '{}'::jsonb) FROM (
          SELECT COALESCE(f.language, 'unknown') AS language, count(*)::integer AS count
          FROM symbol_files f WHERE f.project_id = w.project_id AND f.generation_id = w.active_graph_generation_id
          GROUP BY COALESCE(f.language, 'unknown')
        ) x) AS languages
      FROM workspaces w WHERE w.project_id = ${projectId} AND w.active_graph_generation_id IS NOT NULL
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      generationId: row.generation_id,
      counts: {
        files: Number(row.files), definitions: Number(row.definitions),
        references: Number(row.references), imports: Number(row.imports),
        centrality: Number(row.centrality),
      },
      diagnostics: {
        recovered: Number(row.recovered), hardFailures: Number(row.hard_failures),
        staleFiles: Number(row.stale_files), errors: Number(row.errors),
      },
      languages: row.languages ?? {},
    };
  }

  async findDefinitionsByName(
    projectId: string,
    name: string,
  ): Promise<SymbolDefinition[]> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<DefRaw[]>`
      SELECT * FROM symbol_definitions WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
        AND name = ${name} ORDER BY file_path, qualified_name, id
    `;
    return rows.map(mapDef);
  }

  async findDefinitionByFqn(
    projectId: string,
    fqn: string,
  ): Promise<SymbolDefinition | null> {
    return this.getDefinition(projectId, fqn);
  }

  /** All file paths for a project (used by centrality / hasData checks). */
  async allFiles(projectId: string): Promise<string[]> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<{ relative_path: string }[]>`
      SELECT relative_path FROM symbol_files WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
    `;
    return rows.map((r) => r.relative_path);
  }

  /** All import edges for a project (used by PageRank). */
  async allImportEdges(projectId: string): Promise<SymbolImport[]> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<ImpRaw[]>`
      SELECT * FROM symbol_imports WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
    `;
    return rows.map(mapImp);
  }

  /**
   * Wave 5 FR-05 / N3 — Multi-source reverse-import BFS via a single recursive
   * CTE (additive, behind `MASSA_TH0TH_IMPACT_BFS_CTE=true`).
   *
   * Anchor = changed files at hop 0. Recursive step walks the REVERSE import
   * graph (`si.to_file = current → si.from_file` is an importer) up to `depth`
   * hops. `MIN(hop)` collapses cycles / multi-path arrivals so each file appears
   * once at its shortest distance. Result capped at `maxImpacted`.
   *
   * NULL guard (AD-W5-018 / FR-24): the anchor drops `NULL` seeds
   * (`WHERE file_id IS NOT NULL`) so a NULL in the changed-seed does not
   * silently re-walk the whole graph; the recursive step also skips
   * `si.from_file IS NULL`. Parity vs the TS path is scoped to "same FQN set;
   * depths may differ ≤1 hop on cyclic graphs" (AD-W5-018).
   *
   * Returns `{ file, hop }[]` (FQN resolution happens in the service). Pure
   * single-CTE: no per-FQN follow-up queries.
   */
  async runBfsCteImpact(
    projectId: string,
    changedFiles: string[],
    opts: { depth: number; maxImpacted: number },
  ): Promise<{ file: string; hop: number }[]> {
    const p = getPrismaClient();
    const depth = Math.max(0, Math.min(4, opts.depth));
    const maxImpacted = Math.max(1, Math.min(1000, opts.maxImpacted));
    if (changedFiles.length === 0) return [];

    // Prisma $queryRaw with an array param: pass as a JS array → PG text[].
    // The active generation is resolved inline so the CTE joins on the same
    // generation_id the rest of the snapshot uses.
    const rows = await p.$queryRaw<{ file: string; hop: number }[]>`
      WITH RECURSIVE bfs AS (
        SELECT file_id, 0 AS hop, ARRAY[file_id] AS visited
        FROM unnest(${changedFiles}::text[]) AS seed(file_id)
        WHERE file_id IS NOT NULL
        UNION ALL
        SELECT si.from_file, b.hop + 1, b.visited || si.from_file
        FROM bfs b
        JOIN symbol_imports si
          ON si.to_file = b.file_id
         AND si.project_id = ${projectId}
         AND si.generation_id = (
           SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId}
         )
        WHERE b.hop < ${depth}
          AND si.from_file IS NOT NULL
          AND si.from_file <> b.file_id
          AND NOT si.from_file = ANY(b.visited)
      )
      SELECT file_id AS file, MIN(hop) AS hop
      FROM bfs
      WHERE file_id IS NOT NULL
      GROUP BY file_id
      ORDER BY hop ASC, file_id ASC
      LIMIT ${maxImpacted}
    `;
    return rows.map((r) => ({ file: r.file, hop: Number(r.hop) }));
  }

  /** Imports originating from a specific file (alias for getImportsFrom). */
  async findDependencies(
    projectId: string,
    fromFile: string,
  ): Promise<SymbolImport[]> {
    return this.getImportsFrom(projectId, fromFile);
  }

  /** Reverse-import query: files that import `filePath` (PG parity with PostgreSQL). */
  async findImporters(
    projectId: string,
    filePath: string,
  ): Promise<SymbolImport[]> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<ImpRaw[]>`
      SELECT * FROM symbol_imports WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
        AND to_file = ${filePath}
    `;
    return rows.map(mapImp);
  }

  /** References matching by target FQN. */
  async findReferencesByFqn(
    projectId: string,
    fqn: string,
  ): Promise<SymbolReference[]> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<RefRaw[]>`
      SELECT * FROM symbol_references
      WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
        AND target_fqn = ${fqn}
      ORDER BY from_file ASC, from_line ASC
    `;
    return rows.map(mapRef);
  }

  /** References matching by symbol name. */
  async findReferencesByName(
    projectId: string,
    symbolName: string,
  ): Promise<SymbolReference[]> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<RefRaw[]>`
      SELECT * FROM symbol_references
      WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
        AND symbol_name = ${symbolName}
      ORDER BY from_file ASC, from_line ASC
    `;
    return rows.map(mapRef);
  }

  /**
   * Query typed structural edges with optional filtering (D1).
   * Mirrors the PostgreSQL SymbolRepository.findEdges contract.
   */
  async findEdges(
    projectId: string,
    opts: {
      types?: RefKind[];
      fromSymbol?: string;
      toSymbol?: string;
      fromFile?: string;
      direction?: "outgoing" | "incoming" | "both";
      limit?: number;
    } = {},
  ): Promise<SymbolReference[]> {
    const p = getPrismaClient();
    // Build a parameterized query — Prisma raw SQL doesn't expand arrays for IN,
    // so we interpolate placeholders with explicit casts to text.
    const conditions: string[] = [
      `project_id = $1::text`,
      `generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = $1::text)`,
    ];
    const params: unknown[] = [projectId];
    let idx = 2;
    const direction = opts.direction ?? "both";

    if (opts.fromFile) {
      conditions.push(`from_file = $${idx}::text`);
      params.push(opts.fromFile);
      idx++;
    }
    if (opts.toSymbol && (direction === "incoming" || direction === "both")) {
      conditions.push(`target_fqn = $${idx}::text`);
      params.push(opts.toSymbol);
      idx++;
    }
    if (opts.fromSymbol && (direction === "outgoing" || direction === "both")) {
      const [file, name] = opts.fromSymbol.split("#");
      conditions.push(`from_file = $${idx}::text`);
      params.push(file);
      idx++;
      // When a '#Name' segment is present, push the caller-FQN predicate into
      // the query via the meta JSONB column (mirrors PostgreSQL json_extract).
      if (name) {
        conditions.push(`meta->>'callerFqn' = $${idx}::text`);
        params.push(opts.fromSymbol);
        idx++;
      }
    }
    // types IN clause
    if (opts.types && opts.types.length > 0) {
      const placeholders = opts.types.map(() => `$${idx++}::text`).join(",");
      conditions.push(`ref_kind IN (${placeholders})`);
      params.push(...opts.types);
    }

    const limit = opts.limit ?? 200;
    params.push(limit);
    const sql = `SELECT * FROM symbol_references WHERE ${conditions.join(" AND ")} ORDER BY from_file, from_line LIMIT $${idx}::int`;

    const rows = await p.$queryRawUnsafe<RefRaw[]>(sql, ...params);
    return rows.map(mapRef);
  }

  /** Count edges grouped by ref_kind — used by project_map for typed-edge stats. */
  async countEdgesByKind(projectId: string): Promise<Record<string, number>> {
    const p = getPrismaClient();
    const rows = await p.$queryRaw<{ ref_kind: string; count: bigint }[]>`
      SELECT ref_kind, COUNT(*) AS count FROM symbol_references
      WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
      GROUP BY ref_kind
    `;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.ref_kind] = Number(r.count);
    return out;
  }

  /** List definitions with filter options (mirrors PostgreSQL SymbolRepository.listDefinitions). */
  async listDefinitions(
    projectId: string,
    opts: {
      search?: string;
      kind?: string[];
      file?: string;
      exportedOnly?: boolean;
      limit?: number;
    } = {},
  ): Promise<SymbolDefinition[]> {
    return this.searchDefinitions(
      projectId,
      opts.search,
      opts.kind as SymbolKind[] | undefined,
      opts.exportedOnly,
      opts.limit ?? 100,
      opts.file,
    );
  }

  /**
   * Return ALL symbol definitions for a project (no default LIMIT). Capped only
   * by a high safety ceiling (200k) to guard against pathological repos. Used
   * by the resolve-stage project-wide name→FQN map where the default LIMIT 100
   * of {@link listDefinitions} would silently truncate and drop cross-file
   * callees. Mirrors the PostgreSQL {@link SymbolRepository.listAllDefinitions}.
   */
  async listAllDefinitions(
    projectId: string,
    opts: { kind?: string[]; exportedOnly?: boolean } = {},
  ): Promise<SymbolDefinition[]> {
    const SAFETY_CAP = 200000;
    const p = getPrismaClient();
    const kindList = opts.kind && opts.kind.length > 0 ? opts.kind : null;
    const rows = await p.$queryRaw<DefRaw[]>`
      SELECT * FROM symbol_definitions
      WHERE project_id = ${projectId}
        AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
        AND (${kindList}::text[] IS NULL OR kind = ANY(${kindList}::text[]))
        AND (${opts.exportedOnly ?? false} = false OR exported = true)
      LIMIT ${SAFETY_CAP + 1}
    `;
    if (rows.length > SAFETY_CAP) {
      throw new Error(`symbol_definition_safety_cap_exceeded:${SAFETY_CAP}`);
    }
    return rows.map(mapDef);
  }

  /** Batch-update centrality scores computed by PageRank. */
  async updateCentrality(
    projectId: string,
    scores: Map<string, number>,
  ): Promise<void> {
    if (scores.size === 0) return;
    const p = getPrismaClient();
    const now = new Date();
    await p.$transaction(async (tx) => {
      const generationId = (await lockActiveGenerations(tx, [projectId])).get(projectId)!;
      for (const [filePath, score] of scores) {
        await tx.$executeRaw`
          INSERT INTO symbol_centrality (project_id, generation_id, file_path, score, updated_at)
          VALUES (${projectId}, ${generationId}, ${filePath}, ${score}, ${now})
          ON CONFLICT (project_id, generation_id, file_path) DO UPDATE SET
            score      = EXCLUDED.score,
            updated_at = EXCLUDED.updated_at
        `;
      }
    });
  }
}

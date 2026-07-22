/**
 * symbol-repo-generation.ts — generation-scoped writes + lock helpers (N31 T08/T09)
 *
 * Generation-write methods (copyFileGeneration, writeFileGeneration,
 * deleteFileGeneration, markFileStaleGeneration, updateCentralityGeneration,
 * writeFileSymbols) move here in T09. The shared lock + validation helpers
 * (GenerationWriteLockRow, lockOwnedPendingGeneration, lockActiveGenerations,
 * validateGenerationFileWrite, definitionCandidate, compareDefinitionCandidates)
 * live here because they are generation-scoped. T08's queries module imports
 * `lockActiveGenerations` from here.
 */

import { parseStructuralFqn, type StructuralFqnCandidate } from "../../services/structural/fqn-codec.js";
import type { GraphGenerationLease } from "../graph-generation/graph-generation-contract.js";
import { getPrismaClient } from "../../services/query/prisma-client.js";
import type {
  SymbolDefinition,
  SymbolReference,
  SymbolImport,
  GenerationFileWrite,
} from "./symbol-repo-types.js";
import type { TransactionClient } from "./symbol-repo-identity.js";
import {
  definitionIdentityColumns,
  generationDefinitionIdentityColumns,
  referenceSourceSpan,
} from "./symbol-repo-identity.js";

export interface GenerationWriteLockRow {
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

export async function lockOwnedPendingGeneration(
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

export async function lockActiveGenerations(
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

export function validateGenerationFileWrite(input: GenerationFileWrite, lease: GraphGenerationLease): void {
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

export function definitionCandidate(definition: SymbolDefinition): StructuralFqnCandidate {
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

export function compareDefinitionCandidates(left: StructuralFqnCandidate, right: StructuralFqnCandidate): number {
  return left.file.localeCompare(right.file) ||
    left.qualifiedName.localeCompare(right.qualifiedName) ||
    left.kind.localeCompare(right.kind) ||
    left.signatureHash.localeCompare(right.signatureHash);
}

// ── Generation-scoped writes ────────────────────────────────────────────────

export async function copyFileGeneration(
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

export async function writeFileGeneration(
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

export async function deleteFileGeneration(
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

export async function markFileStaleGeneration(
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

export async function updateCentralityGeneration(
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

export async function writeFileSymbols(
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
/**
 * symbol-repo-queries.ts — CRUD methods for SymbolRepositoryPg (N31 split T08)
 *
 * Workspace, file, definition, reference, import, centrality CRUD +
 * batch operations + query helpers (getActiveGenerationScope,
 * getActiveGraphSnapshot, findDefinitionsByName, allFiles, allImportEdges,
 * findImporters, findReferencesByFqn, findReferencesByName, listDefinitions,
 * listAllDefinitions, updateCentrality).
 *
 * M14 delegate pattern: these are free functions (no `this` needed — the
 * methods call `getPrismaClient()` + free helpers, no private fields). The
 * class methods in symbol-repository-pg.ts become 1-line delegates.
 */

import { getPrismaClient } from "../../services/query/prisma-client.js";
import type {
  SymbolKind,
  SymbolFileRow,
  SymbolDefinition,
  SymbolReference,
  SymbolImport,
  CentralityEntry,
  WorkspaceRow,
  ActiveGenerationScope,
} from "./symbol-repo-types.js";
import type {
  WsRaw,
  FileRaw,
  DefRaw,
  RefRaw,
  ImpRaw,
} from "./symbol-repo-mappers.js";
import {
  mapWs,
  mapFile,
  mapDef,
  mapRef,
  mapImp,
} from "./symbol-repo-mappers.js";
import {
  definitionIdentityColumns,
  referenceSourceSpan,
} from "./symbol-repo-identity.js";
import { lockActiveGenerations } from "./symbol-repo-generation.js";

// Workspace upsert + status re-exported from the workspace module (keeps
// this file ≤500 LOC — the two largest workspace methods are pure SQL).
export { upsertWorkspace, updateWorkspaceStatus } from "./symbol-repo-workspace.js";
import { upsertWorkspace, updateWorkspaceStatus } from "./symbol-repo-workspace.js";

// ─── Workspace read operations ──────────────────────────────────────────────

export async function getWorkspace(projectId: string): Promise<WorkspaceRow | null> {
  const p = getPrismaClient();
  const rows = await p.$queryRaw<WsRaw[]>`
    SELECT * FROM workspaces WHERE project_id = ${projectId} LIMIT 1
  `;
  return rows.length > 0 ? mapWs(rows[0]) : null;
}

export async function listWorkspaces(): Promise<WorkspaceRow[]> {
  const p = getPrismaClient();
  const rows = await p.$queryRaw<WsRaw[]>`
    SELECT * FROM workspaces ORDER BY updated_at DESC
  `;
  return rows.map(mapWs);
}

export async function deleteWorkspace(projectId: string): Promise<void> {
  const p = getPrismaClient();
  await p.$executeRaw`DELETE FROM workspaces WHERE project_id = ${projectId}`;
}

// ─── File operations ───────────────────────────────────────────────────────

export async function upsertFile(file: SymbolFileRow): Promise<void> {
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

export async function getFile(
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

export async function upsertDefinition(def: SymbolDefinition): Promise<void> {
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

export async function deleteDefinitionsByFile(
  projectId: string,
  filePath: string,
): Promise<number> {
  const p = getPrismaClient();
  await p.$executeRaw`DELETE FROM symbol_definitions WHERE project_id = ${projectId} AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId}) AND file_path = ${filePath}`;
  return 0;
}

export async function searchDefinitions(
  projectId: string,
  query?: string,
  kinds?: SymbolKind[],
  exportedOnly?: boolean,
  limit: number = 20,
  filePath?: string,
): Promise<SymbolDefinition[]> {
  const p = getPrismaClient();
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

export async function countDefinitions(
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

export async function getDefinition(
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

export async function insertReference(ref: SymbolReference): Promise<void> {
  const p = getPrismaClient();
  const sourceSpan = referenceSourceSpan(ref);
  await p.$executeRaw`
    INSERT INTO symbol_references (project_id, generation_id, from_file, from_line, symbol_name, target_fqn, ref_kind, meta, source_span)
    VALUES (${ref.project_id}, (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${ref.project_id}), ${ref.from_file}, ${ref.from_line}, ${ref.symbol_name}, ${ref.target_fqn ?? null}, ${ref.ref_kind}, ${ref.meta ?? null}::jsonb, ${sourceSpan}::jsonb)
  `;
}

export async function deleteReferencesByFile(
  projectId: string,
  filePath: string,
): Promise<number> {
  const p = getPrismaClient();
  await p.$executeRaw`DELETE FROM symbol_references WHERE project_id = ${projectId} AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId}) AND from_file = ${filePath}`;
  return 0;
}

export async function getReferences(
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

export async function insertImport(imp: SymbolImport): Promise<void> {
  const p = getPrismaClient();
  await p.$executeRaw`
    INSERT INTO symbol_imports (project_id, generation_id, from_file, to_file, specifier, imported_names, is_external, is_type_only)
    VALUES (${imp.project_id}, (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${imp.project_id}), ${imp.from_file}, ${imp.to_file ?? null}, ${imp.specifier}, ${imp.imported_names}, ${imp.is_external}, ${imp.is_type_only})
  `;
}

export async function deleteImportsByFile(
  projectId: string,
  filePath: string,
): Promise<number> {
  const p = getPrismaClient();
  await p.$executeRaw`DELETE FROM symbol_imports WHERE project_id = ${projectId} AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId}) AND from_file = ${filePath}`;
  return 0;
}

export async function getImportsFrom(
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

export async function upsertCentrality(entry: CentralityEntry): Promise<void> {
  const p = getPrismaClient();
  await p.$executeRaw`
    INSERT INTO symbol_centrality (project_id, generation_id, file_path, score, updated_at)
    VALUES (${entry.project_id}, (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${entry.project_id}), ${entry.file_path}, ${entry.score}, ${new Date(entry.updated_at)})
    ON CONFLICT (project_id, generation_id, file_path) DO UPDATE SET
      score      = EXCLUDED.score,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function getTopCentralFiles(
  projectId: string,
  limit: number = 20,
): Promise<CentralityEntry[]> {
  const p = getPrismaClient();
  const rows = await p.$queryRaw<
    { project_id: string; file_path: string; score: number; updated_at: Date }[]
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

export async function getCentrality(projectId: string): Promise<Map<string, number>> {
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

export async function batchUpsertDefinitions(defs: SymbolDefinition[]): Promise<void> {
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

export async function batchInsertReferences(refs: SymbolReference[]): Promise<void> {
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

export async function batchInsertImports(imports: SymbolImport[]): Promise<void> {
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

// ─── Project / generation queries ──────────────────────────────────────────

export async function clearProject(projectId: string): Promise<void> {
  const p = getPrismaClient();
  // graph_generations has ON DELETE CASCADE on workspaces.project_id (migration
  // 20260714170000, line 242), so deleting the workspace row cascade-removes all
  // graph_generations + child symbol tables. An explicit graph_generations DELETE
  // here is redundant and introduces deadlocks on the shared CI DB when concurrent
  // test cleanup runs (Wave 6 regression).
  await p.$executeRaw`DELETE FROM workspaces WHERE project_id = ${projectId}`;
}

export async function getActiveGenerationScope(projectId: string): Promise<ActiveGenerationScope | null> {
  const rows = await getPrismaClient().$queryRaw<Array<{ generation_id: string | null }>>`
    SELECT active_graph_generation_id AS generation_id
    FROM workspaces WHERE project_id = ${projectId}
  `;
  const generationId = rows[0]?.generation_id;
  return generationId ? { projectId, generationId } : null;
}

export async function findDefinitionsByName(
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

export async function findDefinitionByFqn(
  projectId: string,
  fqn: string,
): Promise<SymbolDefinition | null> {
  return getDefinition(projectId, fqn);
}

export async function findDependencies(
  projectId: string,
  fromFile: string,
): Promise<SymbolImport[]> {
  return getImportsFrom(projectId, fromFile);
}

export async function listDefinitions(
  projectId: string,
  opts: {
    search?: string;
    kind?: string[];
    file?: string;
    exportedOnly?: boolean;
    limit?: number;
  } = {},
): Promise<SymbolDefinition[]> {
  return searchDefinitions(
    projectId,
    opts.search,
    opts.kind as SymbolKind[] | undefined,
    opts.exportedOnly,
    opts.limit ?? 100,
    opts.file,
  );
}

export async function listAllDefinitions(
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
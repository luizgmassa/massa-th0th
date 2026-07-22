/**
 * symbol-repo-graph.ts — graph query methods for SymbolRepositoryPg (N31 split T08/T09)
 *
 * Graph query methods (getProjectMapSnapshot, getProjectMapAggregates,
 * findEdges, runBfsCteImpact, countEdgesByKind, resolveDefinitionFqn) move
 * here in T09. getActiveGraphSnapshot is a graph snapshot query, relocated
 * here from symbol-repo-queries.ts to keep queries ≤500 LOC.
 */

import { getPrismaClient } from "../../services/query/prisma-client.js";
import { parseStructuralFqn } from "../../services/structural/fqn-codec.js";
import type {
  SymbolDefinition,
  SymbolImport,
  SymbolReference,
  CentralityEntry,
  RefKind,
  ProjectMapGraphSnapshot,
  ProjectMapSnapshotOptions,
  DefinitionFqnResolution,
} from "./symbol-repo-types.js";
import type { WsRaw, DefRaw, RefRaw, ImpRaw } from "./symbol-repo-mappers.js";
import { mapWs, mapDef, mapRef, mapImp } from "./symbol-repo-mappers.js";
import { lockActiveGenerations, definitionCandidate, compareDefinitionCandidates } from "./symbol-repo-generation.js";

export async function getActiveGraphSnapshot(projectId: string): Promise<{
  generationId: string;
  counts: { files: number; definitions: number; references: number; imports: number; centrality: number };
  diagnostics: { recovered: number; hardFailures: number; staleFiles: number; errors: number };
  languages: Record<string, number>;
} | null> {
  const rows = await getPrismaClient().$queryRaw<Array<{
    generation_id: string;
    files: number; definitions: number; references: number; imports: number; centrality: number;
    recovered: number; hard_failures: number; stale_files: number; errors: number;
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

/** All file paths for a project (used by centrality / hasData checks). */
export async function allFiles(projectId: string): Promise<string[]> {
  const p = getPrismaClient();
  const rows = await p.$queryRaw<{ relative_path: string }[]>`
    SELECT relative_path FROM symbol_files WHERE project_id = ${projectId}
      AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
  `;
  return rows.map((r) => r.relative_path);
}

/** All import edges for a project (used by PageRank). */
export async function allImportEdges(projectId: string): Promise<SymbolImport[]> {
  const p = getPrismaClient();
  const rows = await p.$queryRaw<ImpRaw[]>`
    SELECT * FROM symbol_imports WHERE project_id = ${projectId}
      AND generation_id = (SELECT active_graph_generation_id FROM workspaces WHERE project_id = ${projectId})
  `;
  return rows.map(mapImp);
}

/** Batch-update centrality scores computed by PageRank. */
export async function updateCentrality(
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

/** Reverse-import query: files that import `filePath`. */
export async function findImporters(
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
export async function findReferencesByFqn(
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
export async function findReferencesByName(
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

// ── Project map aggregates + snapshot ───────────────────────────────────────

export async function getProjectMapAggregates(
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

export async function getProjectMapSnapshot(
  projectId: string,
  opts: ProjectMapSnapshotOptions = {},
): Promise<ProjectMapGraphSnapshot | null> {
  const centralityLimit = opts.centralityLimit ?? 20;
  const recentLimit = opts.recentLimit ?? 10;
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

export async function runBfsCteImpact(
  projectId: string,
  changedFiles: string[],
  opts: { depth: number; maxImpacted: number },
): Promise<{ file: string; hop: number }[]> {
  const p = getPrismaClient();
  const depth = Math.max(0, Math.min(4, opts.depth));
  const maxImpacted = Math.max(1, Math.min(1000, opts.maxImpacted));
  if (changedFiles.length === 0) return [];

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

export async function findEdges(
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
    if (name) {
      conditions.push(`meta->>'callerFqn' = $${idx}::text`);
      params.push(opts.fromSymbol);
      idx++;
    }
  }
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

export async function countEdgesByKind(projectId: string): Promise<Record<string, number>> {
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

export async function resolveDefinitionFqn(
  projectId: string,
  fqn: string,
): Promise<DefinitionFqnResolution> {
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
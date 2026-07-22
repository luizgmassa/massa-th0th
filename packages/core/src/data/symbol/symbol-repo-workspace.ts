/**
 * symbol-repo-workspace.ts — workspace upsert/status methods (N31 split T08)
 *
 * Extracted from symbol-repo-queries.ts to keep queries ≤500 LOC. The two
 * largest workspace methods (upsertWorkspace with its legacy-generation
 * bridge, updateWorkspaceStatus with its active-counts recompute) are pure
 * SQL — split out so the main queries module stays navigable.
 */

import { getPrismaClient } from "../../services/query/prisma-client.js";
import type {
  WorkspaceRow,
  WorkspaceStatus,
} from "./symbol-repo-types.js";

export async function upsertWorkspace(
  ws: Omit<WorkspaceRow, "created_at" | "updated_at"> & { created_at?: number },
): Promise<void> {
  const lastIndexedAt = ws.last_indexed_at ? new Date(ws.last_indexed_at) : null;
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

export async function updateWorkspaceStatus(
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
  const lastError = typeof opts === "string" ? opts : (opts?.lastError ?? null);
  const filesCount = typeof opts === "object" ? opts?.filesCount : undefined;
  const chunksCount = typeof opts === "object" ? opts?.chunksCount : undefined;
  const symbolsCount = typeof opts === "object" ? opts?.symbolsCount : undefined;
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
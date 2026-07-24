/**
 * Graph Store — PostgreSQL implementation.
 *
 * CRUD operations for memory edges in the knowledge graph using Prisma ORM.
 * Natively async.
 *
 * Implements the backend-agnostic `IGraphStore` contract (structural gap #14).
 * Method names are normalized to match the PostgreSQL store so `getGraphStore()`
 * can return an `IGraphStore` without backend-specific dispatch.
 */

import { getPrismaClient } from "../query/prisma-client.js";
import {
  MemoryEdge,
  MemoryRelationType,
  logger,
} from "@massa-ai/shared";
import { Prisma } from "../../generated/prisma/index.js";
import type { PrismaClient } from "../../generated/prisma/index.js";
import type { EdgeCreateInput, EdgeFilter, IGraphStore } from "./types.js";

interface RawMemoryEdge {
  id: number;
  from_id: string;
  to_id: string;
  edge_type: string;
  weight: number;
  metadata: unknown | null;
  created_at: Date;
}

function metadataForEdge(edge: EdgeCreateInput): Record<string, unknown> {
  return {
    autoExtracted: edge.autoExtracted ?? false,
    ...(edge.evidence !== undefined ? { evidence: edge.evidence } : {}),
  };
}

function rowToEdge(row: RawMemoryEdge): MemoryEdge {
  const metadata = row.metadata && typeof row.metadata === "object"
    ? row.metadata as Record<string, unknown>
    : {};
  const storedEvidence = metadata.evidence;

  return {
    id: row.id.toString(),
    sourceId: row.from_id,
    targetId: row.to_id,
    relationType: row.edge_type as MemoryRelationType,
    weight: row.weight,
    evidence: typeof storedEvidence === "string"
      ? storedEvidence
      : row.metadata
        ? JSON.stringify(row.metadata)
        : undefined,
    autoExtracted: metadata.autoExtracted === true,
    createdAt: row.created_at,
  };
}

/**
 * Lazily-initialized Prisma client proxy.
 *
 * The original `const prisma = getPrismaClient()` ran at module-eval, which
 * forced every importer of this module (transitively, of graph-store-factory)
 * to construct a Prisma client — and that throws in environments where the
 * PG/Bun-PostgreSQL prisma adapter isn't installed (e.g. PostgreSQL-only test/dev).
 * The Proxy defers construction to first actual use, so merely importing the
 * module is side-effect-free.
 */
const prisma: PrismaClient = new Proxy(
  {} as PrismaClient,
  {
    get(_target, prop) {
      const client = getPrismaClient();
      const value = Reflect.get(client, prop);
      return typeof value === "function" ? value.bind(client) : value;
    },
  },
);

export class GraphStorePg implements IGraphStore {
  private static instance: GraphStorePg | null = null;

  static getInstance(): GraphStorePg {
    if (!GraphStorePg.instance) {
      GraphStorePg.instance = new GraphStorePg();
    }
    return GraphStorePg.instance;
  }

  constructor() {
    logger.info("GraphStorePg initialized (PostgreSQL)");
  }

  // ── CRUD ──────────────────────────────────────────────────────

  /**
   * Create a new edge between two memories.
   * Automatically updates weight if edge already exists.
   *
   * Accepts the canonical `EdgeCreateInput` (single object) so it satisfies
   * `IGraphStore.createEdge` exactly like the PostgreSQL store.
   */
  async createEdge(edge: EdgeCreateInput): Promise<MemoryEdge | null> {
    if (edge.sourceId === edge.targetId) {
      logger.warn("Cannot create self-referencing edge", { sourceId: edge.sourceId });
      return null;
    }

    const weight = edge.weight ?? 1.0;
    const metadata = JSON.stringify(metadataForEdge(edge));
    try {
      const rows = await prisma.$queryRaw<RawMemoryEdge[]>`
        INSERT INTO memory_edges
          (from_id, to_id, edge_type, weight, metadata, created_at, updated_at)
        VALUES
          (${edge.sourceId}, ${edge.targetId}, ${edge.relationType}, ${weight}, ${metadata}::jsonb, NOW(), NOW())
        ON CONFLICT (from_id, to_id, edge_type) DO UPDATE SET
          weight = GREATEST(memory_edges.weight, EXCLUDED.weight),
          metadata = CASE
            WHEN EXCLUDED.metadata ? 'evidence'
            THEN jsonb_set(
              COALESCE(memory_edges.metadata, '{}'::jsonb),
              '{evidence}',
              EXCLUDED.metadata->'evidence',
              true
            )
            ELSE memory_edges.metadata
          END,
          updated_at = NOW()
        RETURNING id, from_id, to_id, edge_type, weight, metadata, created_at
      `;

      return rows[0] ? rowToEdge(rows[0]) : null;
    } catch (error) {
      logger.error("Failed to create edge", error as Error);
      return null;
    }
  }

  /**
   * Get edge by (sourceId, targetId, relationType) triple.
   * IGraphStore-conformant alias; the PG schema stores edges by from/to/type.
   */
  async getEdge(
    sourceId: string,
    targetId: string,
    relationType: MemoryRelationType,
  ): Promise<MemoryEdge | null> {
    const rows = await prisma.$queryRaw<RawMemoryEdge[]>`
      SELECT id, from_id, to_id, edge_type, weight, metadata, created_at
      FROM memory_edges
      WHERE from_id = ${sourceId}
        AND to_id = ${targetId}
        AND edge_type = ${relationType}
      LIMIT 1
    `;

    return rows[0] ? rowToEdge(rows[0]) : null;
  }

  /**
   * Find edges matching filters.
   * Kept as a non-contract helper (contract callers use getAllEdges).
   */
  async findEdges(filter: EdgeFilter): Promise<MemoryEdge[]> {
    const where: any = {};

    if (filter.sourceId) {
      where.fromId = filter.sourceId;
    }

    if (filter.targetId) {
      where.toId = filter.targetId;
    }

    if (filter.relationTypes && filter.relationTypes.length > 0) {
      where.edgeType = { in: filter.relationTypes };
    }

    if (filter.minWeight !== undefined) {
      where.weight = { gte: filter.minWeight };
    }

    const edges = await prisma.memoryEdge.findMany({
      where,
      orderBy: { weight: 'desc' },
      take: filter.limit || 100,
    });

    return edges.map(edge => ({
      id: edge.id.toString(),
      sourceId: edge.fromId,
      targetId: edge.toId,
      relationType: edge.edgeType as MemoryRelationType,
      weight: edge.weight,
      evidence: edge.metadata ? JSON.stringify(edge.metadata) : undefined,
      autoExtracted: false,
      createdAt: edge.createdAt,
    }));
  }

  /**
   * Get all edges from a source memory.
   * Not on the contract; used internally by bfsNeighbors.
   */
  async getOutgoingEdges(sourceId: string, limit: number = 100): Promise<MemoryEdge[]> {
    return this.findEdges({ sourceId, limit });
  }

  /**
   * Get all edges to a target memory.
   */
  async getIncomingEdges(targetId: string, limit: number = 100): Promise<MemoryEdge[]> {
    return this.findEdges({ targetId, limit });
  }

  /**
   * Phase 7c: async BFS over outgoing edges (mirror of GraphStore.bfsNeighbors).
   */
  async bfsNeighbors(seedIds: string[], depth: number): Promise<string[]> {
    const d = Math.max(1, Math.floor(depth));
    const visited = new Set<string>(seedIds);
    const out = new Set<string>();
    let frontier: string[] = seedIds.filter((id) => id != null && id !== "");

    for (let hop = 0; hop < d && frontier.length > 0; hop++) {
      const next: string[] = [];
      for (const id of frontier) {
        try {
          const edges = await this.getOutgoingEdges(id);
          for (const e of edges) {
            const t = e.targetId;
            if (!visited.has(t)) {
              visited.add(t);
              out.add(t);
              next.push(t);
            }
          }
        } catch {
          // Defensive: a single broken seed never aborts the whole BFS.
        }
      }
      frontier = next;
    }
    return [...out];
  }

  /**
   * Get all edges connected to a memory (both incoming and outgoing).
   * IGraphStore-conformant; replaces the legacy `getConnectedEdges` name.
   */
  async getAllEdges(memoryId: string, filter?: EdgeFilter): Promise<MemoryEdge[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`(from_id = ${memoryId} OR to_id = ${memoryId})`,
    ];
    if (filter?.relationTypes?.length) {
      conditions.push(Prisma.sql`edge_type = ANY(${filter.relationTypes}::text[])`);
    }
    if (filter?.minWeight !== undefined) {
      conditions.push(Prisma.sql`weight >= ${filter.minWeight}`);
    }
    if (filter?.autoExtractedOnly) {
      conditions.push(
        Prisma.sql`COALESCE((metadata->>'autoExtracted')::boolean, false) = true`,
      );
    }
    const limit = filter?.limit ?? 50;
    const rows = await prisma.$queryRaw<RawMemoryEdge[]>(Prisma.sql`
      SELECT id, from_id, to_id, edge_type, weight, metadata, created_at
      FROM memory_edges
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY weight DESC, created_at DESC
      LIMIT ${limit}
    `);

    return rows.map(rowToEdge);
  }

  /**
   * Update edge weight (set). IGraphStore-conformant alias for updateEdgeWeight.
   */
  async updateWeight(id: string, weight: number): Promise<boolean> {
    return this.updateEdgeWeight(id, weight);
  }

  /**
   * Legacy alias kept for callers that used the PG-specific name.
   */
  async updateEdgeWeight(id: string, weight: number): Promise<boolean> {
    const numericId = Number.parseInt(id, 10);
    if (!Number.isSafeInteger(numericId)) return false;
    const clamped = Math.max(0, Math.min(1, weight));
    const changed = await prisma.$executeRaw`
      UPDATE memory_edges SET weight = ${clamped}, updated_at = NOW()
      WHERE id = ${numericId}
    `;
    return changed > 0;
  }

  /**
   * Atomically increment edge weight by delta, capped at maxWeight.
   * IGraphStore-conformant; the single UPDATE prevents lost increments when
   * multiple reinforcement calls race.
   */
  async incrementEdgeWeight(
    sourceId: string,
    targetId: string,
    relationType: MemoryRelationType,
    delta: number,
    maxWeight = 1.0,
  ): Promise<boolean> {
    const changed = await prisma.$executeRaw`
      UPDATE memory_edges
      SET weight = LEAST(weight + ${delta}, ${maxWeight}), updated_at = NOW()
      WHERE from_id = ${sourceId}
        AND to_id = ${targetId}
        AND edge_type = ${relationType}
    `;
    return changed > 0;
  }

  /**
   * Delete an edge by ID.
   */
  async deleteEdge(id: string): Promise<boolean> {
    try {
      await prisma.memoryEdge.delete({
        where: { id: parseInt(id) },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete all edges connected to a memory.
   * IGraphStore-conformant alias; replaces the legacy `deleteEdgesByMemory` name.
   */
  async deleteEdgesForMemory(memoryId: string): Promise<number> {
    const result = await prisma.memoryEdge.deleteMany({
      where: {
        OR: [
          { fromId: memoryId },
          { toId: memoryId },
        ],
      },
    });

    return result.count;
  }

  /**
   * Legacy alias kept for callers that used the PG-specific name.
   */
  async deleteEdgesByMemory(memoryId: string): Promise<number> {
    return this.deleteEdgesForMemory(memoryId);
  }

  /**
   * Batch create edges.
   */
  async batchCreateEdges(edges: EdgeCreateInput[]): Promise<number> {
    const results = await Promise.all(
      edges.map(edge => this.createEdge(edge))
    );
    return results.filter((edge) => edge !== null).length;
  }

  // ── Analytics ──────────────────────────────────────────────────

  /**
   * Degree centrality for a memory (in + out + total).
   * IGraphStore-conformant.
   */
  async getDegree(memoryId: string): Promise<{ in: number; out: number; total: number }> {
    const outCount = await prisma.memoryEdge.count({ where: { fromId: memoryId } });
    const inCount = await prisma.memoryEdge.count({ where: { toId: memoryId } });
    return { in: inCount, out: outCount, total: inCount + outCount };
  }

  /**
   * Find memories with the most connections (hub nodes).
   * IGraphStore-conformant. Uses raw grouping since Prisma has no direct
   * UNION+GROUP BY helper; falls back to client-side aggregation over a
   * bounded scan.
   */
  async getHubMemories(limit: number = 10): Promise<{ memoryId: string; degree: number }[]> {
    const edges = await prisma.memoryEdge.findMany({
      select: { fromId: true, toId: true },
      take: 5000,
    });
    const counts = new Map<string, number>();
    for (const e of edges) {
      counts.set(e.fromId, (counts.get(e.fromId) ?? 0) + 1);
      counts.set(e.toId, (counts.get(e.toId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([memoryId, degree]) => ({ memoryId, degree }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, limit);
  }

  /**
   * Get statistics about the graph.
   * IGraphStore-conformant alias for getGraphStats, normalizing the return
   * shape to match the PostgreSQL store (byRelation/autoExtracted/avgWeight).
   */
  async getStats(): Promise<{
    totalEdges: number;
    byRelation: Record<string, number>;
    autoExtracted: number;
    avgWeight: number;
  }> {
    const totals = await prisma.$queryRaw<Array<{
      total: bigint;
      auto_extracted: bigint;
      avg_weight: number | null;
    }>>`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (
          WHERE COALESCE((metadata->>'autoExtracted')::boolean, false) = true
        ) AS auto_extracted,
        AVG(weight) AS avg_weight
      FROM memory_edges
    `;
    const relationRows = await prisma.$queryRaw<Array<{
      edge_type: string;
      count: bigint;
    }>>`
      SELECT edge_type, COUNT(*) AS count
      FROM memory_edges
      GROUP BY edge_type
    `;
    const byRelation: Record<string, number> = {};
    for (const row of relationRows) byRelation[row.edge_type] = Number(row.count);
    const total = totals[0];

    return {
      totalEdges: Number(total?.total ?? 0),
      byRelation,
      autoExtracted: Number(total?.auto_extracted ?? 0),
      avgWeight: Math.round((total?.avg_weight ?? 0) * 100) / 100,
    };
  }

  /**
   * Find paths between two memories (BFS, up to maxDepth)
   */
  async findPaths(
    fromId: string,
    toId: string,
    maxDepth: number = 3
  ): Promise<Array<{ path: string[]; weight: number }>> {
    // For PostgreSQL, we can use recursive CTE
    const result = await prisma.$queryRaw<Array<{ path: string; total_weight: number }>>`
      WITH RECURSIVE paths AS (
        -- Base case: direct edges
        SELECT
          from_id,
          to_id,
          ARRAY[from_id, to_id]::text[] as path,
          weight as total_weight,
          1 as depth
        FROM memory_edges
        WHERE from_id = ${fromId}

        UNION

        -- Recursive case: extend paths
        SELECT
          p.from_id,
          e.to_id,
          p.path || e.to_id,
          p.total_weight * e.weight,
          p.depth + 1
        FROM paths p
        JOIN memory_edges e ON p.to_id = e.from_id
        WHERE e.to_id != ALL(p.path)  -- Avoid cycles
          AND p.depth < ${maxDepth}
      )
      SELECT
        array_to_string(path, ',') as path,
        total_weight
      FROM paths
      WHERE to_id = ${toId}
      ORDER BY total_weight DESC
      LIMIT 10
    `;

    return result.map(row => ({
      path: row.path.split(','),
      weight: row.total_weight,
    }));
  }

  /**
   * Clear all edges (for testing)
   */
  async clear(): Promise<void> {
    await prisma.memoryEdge.deleteMany();
    logger.info("GraphStore cleared");
  }
}

export const graphStorePg = GraphStorePg.getInstance();

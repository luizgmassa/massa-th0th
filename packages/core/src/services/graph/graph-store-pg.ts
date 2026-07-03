/**
 * Graph Store - PostgreSQL Implementation
 *
 * CRUD operations for memory edges in the knowledge graph using Prisma ORM.
 * Async implementation for PostgreSQL.
 */

import { getPrismaClient } from "../query/prisma-client.js";
import {
  MemoryEdge,
  MemoryRelationType,
  logger,
} from "@massa-th0th/shared";
import type { PrismaClient } from "../../generated/prisma/index.js";

/**
 * Lazily-initialized Prisma client proxy.
 *
 * The original `const prisma = getPrismaClient()` ran at module-eval, which
 * forced every importer of this module (transitively, of graph-store-factory)
 * to construct a Prisma client — and that throws in environments where the
 * PG/Bun-SQLite prisma adapter isn't installed (e.g. SQLite-only test/dev).
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

interface EdgeFilter {
  sourceId?: string;
  targetId?: string;
  relationTypes?: MemoryRelationType[];
  minWeight?: number;
  autoExtractedOnly?: boolean;
  limit?: number;
}

export class GraphStorePg {
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
   */
  async createEdge(edge: Omit<MemoryEdge, 'id' | 'createdAt'>): Promise<MemoryEdge> {
    // Parse evidence string to JSON if provided, otherwise null
    let metadataJson = null;
    if (edge.evidence) {
      try {
        metadataJson = JSON.parse(edge.evidence);
      } catch {
        // If parsing fails, store the string as-is in a wrapper object
        metadataJson = { evidence: edge.evidence };
      }
    }
    
    const result = await prisma.memoryEdge.upsert({
      where: {
        fromId_toId_edgeType: {
          fromId: edge.sourceId,
          toId: edge.targetId,
          edgeType: edge.relationType,
        },
      },
      create: {
        fromId: edge.sourceId,
        toId: edge.targetId,
        edgeType: edge.relationType,
        weight: edge.weight || 1.0,
        metadata: metadataJson,
      },
      update: {
        weight: edge.weight || 1.0,
        metadata: metadataJson,
      },
    });

    return {
      id: result.id.toString(),
      sourceId: result.fromId,
      targetId: result.toId,
      relationType: result.edgeType as MemoryRelationType,
      weight: result.weight,
      evidence: result.metadata ? JSON.stringify(result.metadata) : undefined,
      autoExtracted: false, // PostgreSQL doesn't store this field yet
      createdAt: result.createdAt,
    };
  }

  /**
   * Get edge by ID
   */
  async getEdge(id: string): Promise<MemoryEdge | null> {
    const edge = await prisma.memoryEdge.findUnique({
      where: { id: parseInt(id) },
    });

    if (!edge) return null;

    return {
      id: edge.id.toString(),
      sourceId: edge.fromId,
      targetId: edge.toId,
      relationType: edge.edgeType as MemoryRelationType,
      weight: edge.weight,
      evidence: edge.metadata ? JSON.stringify(edge.metadata) : undefined,
      autoExtracted: false,
      createdAt: edge.createdAt,
    };
  }

  /**
   * Find edges matching filters
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
   * Get all edges from a source memory
   */
  async getOutgoingEdges(sourceId: string, limit: number = 100): Promise<MemoryEdge[]> {
    return this.findEdges({ sourceId, limit });
  }

  /**
   * Get all edges to a target memory
   */
  async getIncomingEdges(targetId: string, limit: number = 100): Promise<MemoryEdge[]> {
    return this.findEdges({ targetId, limit });
  }

  /**
   * Phase 7c: async BFS over outgoing edges (mirror of GraphStore.bfsNeighbors,
   * but Pg's getOutgoingEdges is async). See graph-store.ts for semantics.
   */
  async bfsNeighbors(seedIds: string[], depth: number): Promise<string[]> {
    const d = Math.max(1, Math.floor(depth));
    const seeds = new Set(seedIds);
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
   * Get all edges connected to a memory (both incoming and outgoing)
   */
  async getConnectedEdges(memoryId: string, limit: number = 100): Promise<MemoryEdge[]> {
    const edges = await prisma.memoryEdge.findMany({
      where: {
        OR: [
          { fromId: memoryId },
          { toId: memoryId },
        ],
      },
      orderBy: { weight: 'desc' },
      take: limit,
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
   * Update edge weight
   */
  async updateEdgeWeight(id: string, weight: number): Promise<boolean> {
    try {
      await prisma.memoryEdge.update({
        where: { id: parseInt(id) },
        data: { weight },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete an edge
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
   * Delete all edges connected to a memory
   */
  async deleteEdgesByMemory(memoryId: string): Promise<number> {
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
   * Batch create edges
   */
  async batchCreateEdges(edges: Array<Omit<MemoryEdge, 'id' | 'createdAt'>>): Promise<number> {
    const results = await Promise.all(
      edges.map(edge => this.createEdge(edge))
    );
    return results.length;
  }

  /**
   * Get statistics about the graph
   */
  async getGraphStats(): Promise<{
    totalEdges: number;
    edgesByType: Record<string, number>;
    avgWeight: number;
  }> {
    const totalEdges = await prisma.memoryEdge.count();
    
    const edgesByTypeRaw = await prisma.memoryEdge.groupBy({
      by: ['edgeType'],
      _count: { edgeType: true },
    });

    const edgesByType: Record<string, number> = {};
    for (const group of edgesByTypeRaw) {
      edgesByType[group.edgeType] = group._count.edgeType;
    }

    const avgWeightResult = await prisma.memoryEdge.aggregate({
      _avg: { weight: true },
    });

    return {
      totalEdges,
      edgesByType,
      avgWeight: avgWeightResult._avg.weight || 0,
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

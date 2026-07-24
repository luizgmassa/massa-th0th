/**
 * Graph module internal types.
 *
 * Shared between GraphStore, GraphQueries, RelationExtractor,
 * and exposed through MemoryGraphService.
 */

import { MemoryEdge, MemoryRelationType } from "@massa-ai/shared";

/**
 * A row from the memories table (projection without embedding).
 */
export interface MemoryRow {
  id: string;
  content: string;
  type: string;
  level: number;
  importance: number;
  tags: string | null;
  created_at: number;
  updated_at: number;
  access_count: number;
  user_id: string | null;
  session_id: string | null;
  project_id: string | null;
  agent_id: string | null;
}

/**
 * A row from the memories table that also includes the embedding blob.
 * Used by RelationExtractor for similarity computation.
 */
export interface MemoryRowWithEmbedding extends MemoryRow {
  embedding: Buffer | null;
}

/**
 * A memory node returned from graph traversal,
 * including the edge that connects it and its BFS depth.
 */
export interface RelatedMemory {
  memory: MemoryRow;
  edge: MemoryEdge;
  depth: number;
}

// ── Unified graph-store contract (structural gap #14) ──────────

/**
 * Input shape for creating an edge.
 *
 * Canonical form: a single object. Both the PostgreSQL (`GraphStore`) and
 * PostgreSQL (`GraphStorePg`) implementations accept this shape so callers
 * are backend-agnostic. `createEdge` is always async because the PG store
 * requires a Prisma round-trip.
 */
export interface EdgeCreateInput {
  sourceId: string;
  targetId: string;
  relationType: MemoryRelationType;
  weight?: number;
  evidence?: string;
  autoExtracted?: boolean;
}

/**
 * Edge filter used by query methods.
 */
export interface EdgeFilter {
  sourceId?: string;
  targetId?: string;
  relationTypes?: MemoryRelationType[];
  minWeight?: number;
  autoExtractedOnly?: boolean;
  limit?: number;
}

/**
 * Canonical graph-store contract.
 *
 * All methods are async so the contract is backend-agnostic: PostgreSQL
 * implementations wrap their sync logic in `async`/`Promise.resolve`, while
 * the PostgreSQL implementation is natively async. This eliminates the
 * signature divergence (sync positional vs async object) that silently broke
 * callers when `DATABASE_URL` pointed at PostgreSQL.
 *
 * Both `GraphStore` (PostgreSQL) and `GraphStorePg` implement this interface, and
 * `getGraphStore()` returns an `IGraphStore` so consumers never depend on a
 * concrete backend.
 */
export interface IGraphStore {
  // ── Edge CRUD ───────────────────────────────────────────────
  /** Create (or upsert-weight) an edge. Returns the edge, or null on
   *  self-reference / failure. */
  createEdge(edge: EdgeCreateInput): Promise<MemoryEdge | null>;

  /** Get a specific edge by source, target, and relation type. */
  getEdge(
    sourceId: string,
    targetId: string,
    relationType: MemoryRelationType,
  ): Promise<MemoryEdge | null>;

  /** All edges connected to a memory (both directions). */
  getAllEdges(memoryId: string, filter?: EdgeFilter): Promise<MemoryEdge[]>;

  /** Delete an edge by ID. Returns true if an edge was removed. */
  deleteEdge(edgeId: string): Promise<boolean>;

  /** Delete all edges connected to a memory. Returns the count removed. */
  deleteEdgesForMemory(memoryId: string): Promise<number>;

  /** Update edge weight (set). Returns true if an edge was updated. */
  updateWeight(edgeId: string, weight: number): Promise<boolean>;

  /**
   * Atomically increment edge weight by delta, capped at maxWeight.
   * Returns true if an edge was updated.
   */
  incrementEdgeWeight(
    sourceId: string,
    targetId: string,
    relationType: MemoryRelationType,
    delta: number,
    maxWeight?: number,
  ): Promise<boolean>;

  // ── Traversal ───────────────────────────────────────────────
  /**
   * BFS over outgoing edges from `seedIds`, returning the set of memory ids
   * reachable within `depth` hops (excluding the seeds). Depth ≥ 1.
   */
  bfsNeighbors(seedIds: string[], depth: number): Promise<string[]>;

  // ── Analytics ───────────────────────────────────────────────
  /** Degree centrality for a memory. */
  getDegree(memoryId: string): Promise<{ in: number; out: number; total: number }>;

  /** Most-connected memories (hub nodes). */
  getHubMemories(
    limit?: number,
  ): Promise<{ memoryId: string; degree: number }[]>;

  /** Graph-level statistics. */
  getStats(): Promise<{
    totalEdges: number;
    byRelation: Record<string, number>;
    autoExtracted: number;
    avgWeight: number;
  }>;

  // ── Lifecycle ───────────────────────────────────────────────
  /** Clear all edges (primarily for tests). */
  clear(): Promise<void>;
}

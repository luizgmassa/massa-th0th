/**
 * Memory Graph Service
 *
 * Orchestration layer that coordinates graph operations triggered
 * by memory lifecycle events (store, search, delete).
 *
 * This service owns the composition of GraphStore, RelationExtractor,
 * and GraphQueries. Tools and other services interact with the graph
 * exclusively through this service, keeping them decoupled from
 * graph internals.
 *
 * Uses `getGraphStore()` (the factory) so the active backend is selected
 * by `DATABASE_URL` — PostgreSQL or PostgreSQL — rather than hardcoding the
 * PostgreSQL singleton (structural gap #14).
 */

import {
  MemoryRelationType,
  MemoryEdge,
  GraphQueryOptions,
  ContradictionPair,
  logger,
} from "@massa-ai/shared";
import { getGraphStore } from "./graph-store-factory.js";
import { RelationExtractor } from "./relation-extractor.js";
import { GraphQueries } from "./graph-queries.js";
import type { IGraphStore, RelatedMemory, MemoryRow } from "./types.js";

// Re-export for consumers
export type { GraphQueryOptions, ContradictionPair, RelatedMemory, MemoryRow };

export class MemoryGraphService {
  private static instance: MemoryGraphService | null = null;

  private readonly store: IGraphStore;
  private readonly extractor: RelationExtractor;
  private readonly queries: GraphQueries;

  private constructor() {
    // Route through the factory so the PG store is used when DATABASE_URL
    // points at PostgreSQL (structural gap #14).
    this.store = getGraphStore();
    this.extractor = new RelationExtractor(this.store);
    this.queries = new GraphQueries(this.store);
  }

  static getInstance(): MemoryGraphService {
    if (!MemoryGraphService.instance) {
      MemoryGraphService.instance = new MemoryGraphService();
    }
    return MemoryGraphService.instance;
  }

  // ── Lifecycle hooks (called by tools) ──────────────────────

  /**
   * Called after a memory is successfully stored.
   * Creates explicit links and triggers background relation extraction.
   */
  async onMemoryStored(
    memoryId: string,
    linkTo: string[] = [],
  ): Promise<void> {
    try {
      // 1. Create explicit edges requested by the caller
      for (const targetId of linkTo) {
        await this.store.createEdge({
          sourceId: memoryId,
          targetId,
          relationType: MemoryRelationType.RELATES_TO,
          weight: 0.8,
          evidence: "Explicit link by user/agent",
        });
      }

      // 2. Extract automatic relations (non-blocking)
      const edgesCreated = await this.extractor.extractRelations(memoryId);

      if (edgesCreated > 0 || linkTo.length > 0) {
        logger.info("Graph updated after memory store", {
          memoryId,
          explicitLinks: linkTo.length,
          autoExtracted: edgesCreated,
        });
      }
    } catch (error) {
      // Graph operations are best-effort; never fail the store
      logger.warn("Graph update failed after memory store", {
        memoryId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Called when a memory is deleted.
   * Cleans up all connected edges.
   */
  async onMemoryDeleted(memoryId: string): Promise<void> {
    try {
      const removed = await this.store.deleteEdgesForMemory(memoryId);
      if (removed > 0) {
        logger.info("Graph edges cleaned after memory delete", {
          memoryId,
          edgesRemoved: removed,
        });
      }
    } catch (error) {
      logger.warn("Graph cleanup failed after memory delete", {
        memoryId,
        error: (error as Error).message,
      });
    }
  }

  // ── Query operations (called by tools and services) ────────

  /**
   * Get memories related to a given memory via graph traversal.
   */
  async getRelatedContext(memoryId: string, options?: GraphQueryOptions) {
    return this.queries.getRelatedContext(memoryId, options);
  }

  /**
   * Find the shortest path between two memories.
   */
  async findPath(fromId: string, toId: string, maxDepth?: number) {
    return this.queries.findPath(fromId, toId, maxDepth);
  }

  /**
   * Detect contradictions in the memory graph.
   */
  async findContradictions(limit?: number): Promise<ContradictionPair[]> {
    return this.queries.findContradictions(limit);
  }

  /**
   * Follow the decision chain leading to a memory.
   */
  async getDecisionChain(memoryId: string, maxDepth?: number) {
    return this.queries.getDecisionChain(memoryId, maxDepth);
  }

  /**
   * Get hub memories (most connected nodes).
   */
  async getHubMemories(limit?: number) {
    return this.queries.getHubMemories(limit);
  }

  /**
   * Get a human-readable summary of a memory's neighborhood.
   * Useful for injecting into LLM context alongside search results.
   */
  async getNeighborhoodSummary(memoryId: string): Promise<string> {
    return this.queries.getNeighborhoodSummary(memoryId);
  }

  // ── Direct edge operations ─────────────────────────────────

  /**
   * Create a manual edge between two memories.
   */
  async linkMemories(
    sourceId: string,
    targetId: string,
    relationType: MemoryRelationType,
    options?: { weight?: number; evidence?: string },
  ): Promise<MemoryEdge | null> {
    return this.store.createEdge({
      sourceId,
      targetId,
      relationType,
      ...options,
      autoExtracted: false,
    });
  }

  /**
   * Remove an edge by ID.
   */
  async unlinkMemories(edgeId: string): Promise<boolean> {
    return this.store.deleteEdge(edgeId);
  }

  /**
   * Get all edges for a memory.
   */
  async getEdges(memoryId: string) {
    return this.store.getAllEdges(memoryId);
  }

  // ── Analytics ──────────────────────────────────────────────

  /**
   * Get graph-level statistics.
   */
  async getStats() {
    return this.store.getStats();
  }

  /**
   * Get degree centrality for a specific memory.
   */
  async getDegree(memoryId: string) {
    return this.store.getDegree(memoryId);
  }
}

/**
 * Background consolidation for long-running memory quality (Phase 1).
 *
 * Phase-1 changes vs the legacy Postgres-only job:
 *   - Removed the `isPostgresEnabled()` short-circuit. The job is now
 *     backend-polymorphic via `getMemoryRepository()` (mirror of the
 *     memory-repository-factory dispatch) and `getGraphStore()`.
 *   - Decay now delegates to the pure `decayScore` (services/memory/decay.ts)
 *     for BOTH backends; pinned memories are exempt.
 *   - Prune is now SOFT-delete (`deleted_at` tombstone) instead of hard DELETE,
 *     and is pinned-aware + deleted_at-aware.
 *   - New merge phase: clusters near-duplicates via `consolidateWindow` and,
 *     for each batch, inserts a new memory + a SUPERSEDES edge per source.
 *   - Emits `memory:consolidated` via EventBus per batch.
 *   - `ConsolidationStats` extended with `{ merged, batchesCreated }`.
 *   - LLM-gated + silent-degrade: when the LLM is disabled or fails, the merge
 *     phase is skipped and the rule-based (decay + prune) path completes with
 *     `merged=0, batchesCreated=0` and no error propagated.
 */

import { logger, MemoryLevel, MemoryType, MemoryRelationType } from "@massa-th0th/shared";
import { randomUUID } from "crypto";
import { getMemoryRepository } from "../../data/memory/memory-repository-factory.js";
import { getGraphStore } from "../graph/graph-store-factory.js";
import { eventBus } from "../events/event-bus.js";
import { decayScore, DEFAULT_DECAY_PARAMS } from "../memory/decay.js";
import { consolidateWindow, rowsToCandidates, type LlmSurface } from "../memory/consolidator.js";
import { llm as defaultLlmSurface } from "../memory/llm-client.js";
import type { MemoryRow } from "../../data/memory/memory-repository.js";
import type { GraphStore } from "../graph/graph-store.js";
import type { GraphStorePg } from "../graph/graph-store-pg.js";

export interface ConsolidationStats {
  promoted: number;
  decayed: number;
  pruned: number;
  edgesCleaned: number;
  /** Phase 1: number of source memories folded into batches. */
  merged: number;
  /** Phase 1: number of consolidation batches created. */
  batchesCreated: number;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Add a SUPERSEDES edge polymorphically across the GraphStore union.
 * SQLite createEdge is sync (sourceId, targetId, relationType, options);
 * PG createEdge is async ({sourceId, targetId, relationType, ...}).
 */
async function addSupercedesEdge(
  store: GraphStore | GraphStorePg,
  newId: string,
  sourceId: string,
  batchId: string,
): Promise<void> {
  const evidence = JSON.stringify({ batchId, consolidated: true });
  // Detect the PG shape by arity/prototype. Both classes expose createEdge;
  // the PG variant takes a single object argument.
  // We use a duck-type: PG createEdge has arity 1.
  const anyStore = store as any;
  if (anyStore.createEdge.length === 1) {
    // GraphStorePg
    await anyStore.createEdge({
      sourceId: newId,
      targetId: sourceId,
      relationType: MemoryRelationType.SUPERSEDES,
      weight: 1.0,
      evidence,
    });
  } else {
    // GraphStore (SQLite) — sync, but normalize to a promise.
    anyStore.createEdge(newId, sourceId, MemoryRelationType.SUPERSEDES, {
      weight: 1.0,
      evidence,
      autoExtracted: true,
    });
  }
}

/**
 * Insert a new memory polymorphically (SQLite insert is sync, PG is async).
 */
async function insertMemoryAsync(repo: any, input: any): Promise<void> {
  await Promise.resolve(repo.insert(input));
}

export class MemoryConsolidationJob {
  private running = false;
  private lastRunAt = 0;
  private runCount = 0;
  private readonly minIntervalMs = 5 * 60 * 1000;
  private readonly llm: LlmSurface;

  constructor(opts: { llm?: LlmSurface } = {}) {
    // Injectable for tests; defaults to the shared llm-client so production
    // picks up config + silent-degrade behavior without extra wiring.
    this.llm = opts.llm ?? (defaultLlmSurface as unknown as LlmSurface);
  }

  maybeRun(trigger: "store" | "search" = "store"): void {
    const now = Date.now();
    if (this.running || now - this.lastRunAt < this.minIntervalMs) {
      return;
    }
    this.lastRunAt = now;
    void this.runOnce(trigger);
  }

  private async runOnce(trigger: "store" | "search"): Promise<void> {
    this.running = true;
    this.runCount++;
    const startedAt = Date.now();

    try {
      const stats = await this.consolidate();
      logger.info("Memory consolidation completed", {
        trigger,
        cycle: this.runCount,
        ...stats,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      // Defensive: the inner phases swallow their own errors, but a top-level
      // guard ensures a job-cycle failure never crashes the host process.
      logger.warn("Memory consolidation skipped", {
        trigger,
        error: (error as Error).message,
      });
    } finally {
      this.running = false;
    }
  }

  /**
   * Run one consolidation cycle against the active backend. Exposed for tests.
   */
  async consolidate(): Promise<ConsolidationStats> {
    const now = Date.now();
    const staleSinceMs = now - 7 * DAY;

    const repo = getMemoryRepository();

    // Phase 1: decay — read candidates, compute decayScore, write back.
    const decayed = await this.decayStaleMemories(repo, staleSinceMs, now);
    // Phase 1: prune — soft-delete cold + old + low-access memories.
    const pruned = await this.pruneColdMemories(repo, now);
    // Phase 0 behavior preserved (session→user promotion) on PG; SQLite no-op.
    const promoted = await this.promoteSessionMemories(repo, now).catch(() => 0);
    // Phase 1: merge — cluster + LLM-summarize + SUPERSEDES edges.
    const graphStore = getGraphStore();
    const { merged, batchesCreated } = await this.mergeMemories(
      repo,
      graphStore,
      staleSinceMs,
      now,
    );

    return { promoted, decayed, pruned, edgesCleaned: 0, merged, batchesCreated };
  }

  /**
   * Decay: for each candidate, compute the pure decayScore and write it back
   * as the new importance. Pinned + soft-deleted rows are excluded by the
   * candidate query. Errors per-row are swallowed.
   */
  private async decayStaleMemories(
    repo: any,
    staleSinceMs: number,
    now: number,
  ): Promise<number> {
    let candidates: MemoryRow[] = [];
    try {
      candidates = await Promise.resolve(
        repo.listConsolidationCandidates(staleSinceMs, 500),
      );
    } catch (e) {
      logger.warn("consolidation: candidate list failed (decay)", {
        error: (e as Error).message,
      });
      return 0;
    }

    let decayed = 0;
    for (const row of candidates) {
      const score = decayScore(
        {
          importance: row.importance,
          accessCount: row.access_count,
          createdAt: row.created_at,
          lastAccessed: row.last_accessed,
          pinned: row.pinned,
        },
        DEFAULT_DECAY_PARAMS,
        now,
      );
      // Only write when the score actually changed (avoid churn).
      if (Math.abs(score - row.importance) < 1e-6) continue;
      try {
        const updated = await Promise.resolve(repo.update(row.id, { importance: score }));
        if (updated) decayed++;
      } catch (e) {
        logger.warn("consolidation: decay write failed", {
          id: row.id,
          error: (e as Error).message,
        });
      }
    }
    return decayed;
  }

  /**
   * Prune: soft-delete memories that are old + cold + low-access. Pinned and
   * already-tombstoned rows are excluded. Uses the soft-delete path so rows
   * remain restorable; a future ops job can hard-purge long-tombstoned rows.
   */
  private async pruneColdMemories(repo: any, now: number): Promise<number> {
    const cutoff = now - 45 * DAY;
    let pruned = 0;
    // Reuse the candidate list shape but query for cold/old/low-access.
    // Both repos expose softDeleteById; we drive pruning off a small SQL scan.
    try {
      const rows: MemoryRow[] = await Promise.resolve(
        (repo as any).listConsolidationCandidates(now, 500),
      );
      for (const row of rows) {
        if (row.created_at >= cutoff) continue;
        const score = decayScore(
          {
            importance: row.importance,
            accessCount: row.access_count,
            createdAt: row.created_at,
            lastAccessed: row.last_accessed,
            pinned: row.pinned,
          },
          DEFAULT_DECAY_PARAMS,
          now,
        );
        if (score < DEFAULT_DECAY_PARAMS.coldThreshold && (row.access_count ?? 0) < 2) {
          try {
            const ok = await Promise.resolve(repo.softDeleteById(row.id));
            if (ok) pruned++;
          } catch (e) {
            logger.warn("consolidation: soft-delete failed", {
              id: row.id,
              error: (e as Error).message,
            });
          }
        }
      }
    } catch (e) {
      logger.warn("consolidation: prune scan failed", {
        error: (e as Error).message,
      });
    }
    return pruned;
  }

  /**
   * Merge: cluster near-duplicates and, via the LLM, produce a consolidated
   * memory that SUPERSEDES its sources. LLM-gated + silent-degrade.
   */
  private async mergeMemories(
    repo: any,
    graphStore: GraphStore | GraphStorePg,
    staleSinceMs: number,
    now: number,
  ): Promise<{ merged: number; batchesCreated: number }> {
    let candidates: MemoryRow[] = [];
    try {
      candidates = await Promise.resolve(
        repo.listConsolidationCandidates(staleSinceMs, 200),
      );
    } catch (e) {
      logger.warn("consolidation: candidate list failed (merge)", {
        error: (e as Error).message,
      });
      return { merged: 0, batchesCreated: 0 };
    }

    const batch = await consolidateWindow(
      rowsToCandidates(candidates),
      this.llm,
      { idFactory: () => `batch-${now}-${randomUUID().slice(0, 8)}` },
    ).catch(() => null);

    if (!batch) return { merged: 0, batchesCreated: 0 };

    // Build the new memory from the batch.
    const sourceRows = candidates.filter((c) => batch.sourceIds.includes(c.id));
    const newId = `mem-${now}-${randomUUID().slice(0, 8)}`;
    const importance = sourceRows.length
      ? Math.min(1, Math.max(...sourceRows.map((r) => r.importance)))
      : 0.7;
    const projectId = sourceRows.find((r) => r.project_id)?.project_id ?? null;

    try {
      await insertMemoryAsync(repo, {
        id: newId,
        content: batch.summary,
        type: batch.type as MemoryType,
        level: batch.level as MemoryLevel,
        projectId,
        importance,
        tags: [],
        embedding: [], // no embedding for the summary; recall is graph-driven
        metadata: { batchId: batch.id, consolidated: true, rationale: batch.rationale },
      });
    } catch (e) {
      logger.warn("consolidation: merge insert failed", {
        batchId: batch.id,
        error: (e as Error).message,
      });
      return { merged: 0, batchesCreated: 0 };
    }

    // Add a SUPERSEDES edge per source.
    let edgesAdded = 0;
    for (const sourceId of batch.sourceIds) {
      try {
        await addSupercedesEdge(graphStore, newId, sourceId, batch.id);
        edgesAdded++;
      } catch (e) {
        logger.warn("consolidation: addSupercedesEdge failed", {
          newId,
          sourceId,
          error: (e as Error).message,
        });
      }
    }

    eventBus.publish("memory:consolidated", {
      batchId: batch.id,
      sourceIds: batch.sourceIds,
      newMemoryId: newId,
      projectId: projectId ?? undefined,
      stats: { merged: batch.sourceIds.length, batchesCreated: 1 },
    });

    return { merged: batch.sourceIds.length, batchesCreated: 1 };
  }

  /**
   * Phase-0 session→user promotion. Preserved for PG; on SQLite this is a
   * no-op (the original raw-SQL used Postgres `NOW()`/CTE features). Soft-fail.
   */
  private async promoteSessionMemories(repo: any, now: number): Promise<number> {
    // The PG path used prisma raw SQL; SQLite repo has no equivalent. To keep
    // this backend-polymorphic without duplicating logic, we skip promotion on
    // SQLite (candidates already decay via decayScore). PG promotion remains
    // available via the prisma client if needed in a future phase.
    const isPg = process.env.DATABASE_URL?.startsWith("postgresql");
    if (!isPg) return 0;
    try {
      // Lazy-import to avoid pulling prisma into the SQLite path.
      const { getPrismaClient } = await import("../query/prisma-client.js");
      const prisma = getPrismaClient();
      const cutoff = new Date(now - DAY);
      const result = await prisma.$executeRaw`
        UPDATE memories
        SET   level      = ${MemoryLevel.USER},
              importance = LEAST(1.0, importance + 0.08),
              updated_at = NOW()
        WHERE id IN (
          SELECT id FROM memories
          WHERE level        = ${MemoryLevel.SESSION}
            AND type         IN ('conversation', 'decision', 'pattern')
            AND created_at   < ${cutoff}
            AND importance  >= 0.7
            AND access_count >= 3
            AND deleted_at IS NULL
          LIMIT 120
        )
      `;
      return result as unknown as number;
    } catch (e) {
      logger.warn("consolidation: promote (PG) failed", {
        error: (e as Error).message,
      });
      return 0;
    }
  }
}

export const memoryConsolidationJob = new MemoryConsolidationJob();

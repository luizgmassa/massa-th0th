/**
 * PgCheckpointStore — PostgreSQL parity for the checkpoint store.
 *
 * Structural gap #16: checkpoints were SQLite-only (raw bun:sqlite inside
 * CheckpointManager). This store provides PG parity so a Postgres deployment
 * persists task/INDEX execution state in the same backend as the rest of the
 * data plane (one-backend rule).
 *
 * Mirrors PgSynapseSessionStore / PgScheduledJobStore's discipline: the
 * ICheckpointStore contract is SYNCHRONOUS (the MCP tools + AutoCheckpointer
 * call create/list/restore with no await, matching the SQLite store and
 * bun:sqlite API). PG is inherently async, so this store:
 *   - Writes fire-and-forget (best-effort, logged on failure — matching the
 *     SQLite store's try/catch best-effort semantics).
 *   - Reads are served from an in-memory mirror hydrated from PG on first use
 *     (async) and kept in sync by every create/delete. The mirror is the hot
 *     read path within a process; PG is the durability + cross-process recovery
 *     layer (a new process hydrates its mirror from the persisted rows, so a
 *     checkpoint created before a restart is visible after it once hydration
 *     settles).
 *
 * Uses raw SQL ($executeRaw / $queryRaw) via the shared prisma client — the
 * same pattern as PgSynapseSessionStore and MemoryRepositoryPg — to avoid the
 * Prisma 7.7.0 + adapter-pg isObjectEnumValue incompatibility. Reuses
 * getPrismaClient() (no second pool).
 *
 * Schema parity: task_checkpoints (see Prisma model Checkpoint and PG migration
 * 20260710160000_add_task_checkpoints_pg). State is stored compressed with the
 * SAME algorithm as the SQLite store (Bun.deflateSync on the JSON) so a row
 * round-trips byte-for-byte; decompression uses Bun.inflateSync. Note: the PG
 * store keeps a deserialized in-memory mirror (TaskCheckpoint objects), so the
 * compressed bytes only matter for parity with any future direct-SQL consumer.
 */

import {
  TaskCheckpoint,
  TaskState,
  CheckpointType,
  logger,
} from "@massa-th0th/shared";
import { getPrismaClient } from "../query/prisma-client.js";
import type { PrismaClient } from "../../generated/prisma/index.js";
import type {
  ICheckpointStore,
  CheckpointMetadata,
  ListCheckpointsOptions,
  CreateCheckpointOptions,
  CheckpointStats,
} from "./checkpoint-store.js";

// ── Raw row shape returned by $queryRaw ─────────────────────────────────────

interface CheckpointRow {
  id: string;
  task_id: string;
  task_description: string | null;
  agent_id: string | null;
  project_id: string | null;
  state: Buffer; // compressed JSON
  state_schema_version: number | bigint;
  memory_ids: string | null;
  file_changes: string | null;
  checkpoint_type: string;
  parent_checkpoint_id: string | null;
  created_at: number | bigint;
  expires_at: number | bigint | null;
}

interface CheckpointSizeRow {
  id: string;
  state: Buffer;
}

function toNum(v: number | bigint | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "bigint" ? Number(v) : v;
}

/** Compress state JSON the same way the SQLite store does (Bun.deflateSync). */
function compressState(state: TaskState): Buffer {
  const json = JSON.stringify(state);
  return Buffer.from(Bun.deflateSync(Buffer.from(json, "utf-8")));
}

/** Decompress state bytes the same way the SQLite store does (Bun.inflateSync). */
function decompressState(data: Buffer): TaskState {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as unknown as ArrayBuffer);
  const inflated = Bun.inflateSync(new Uint8Array(buf));
  return JSON.parse(Buffer.from(inflated).toString("utf-8")) as TaskState;
}

export class PgCheckpointStore implements ICheckpointStore {
  private prisma!: PrismaClient;
  /** In-memory mirror: the sync read path. Hydrated from PG on first use. */
  private mirror: Map<string, TaskCheckpoint> = new Map();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;
  /**
   * Epoch (ms) of the last failed hydration attempt. Rate-limits retries so a
   * persistent PG error does not turn every op into a full `SELECT *` retry
   * storm (hydrated stays false forever → ensureHydrated re-fires every call).
   */
  private hydrateFailedAt = 0;
  private static readonly HYDRATE_RETRY_MS = 30_000;
  /** Per-id serialized write chain so commits land in call order. */
  private inflight: Map<string, Promise<void>> = new Map();

  private getClient(): PrismaClient {
    if (!this.prisma) this.prisma = getPrismaClient();
    return this.prisma;
  }

  /**
   * Best-effort hydrate the mirror from PG. Resolves (never rejects) — failures
   * log a warn and leave the mirror empty; the manager can still create
   * checkpoints in-memory and persist them once PG is reachable.
   */
  private ensureHydrated(): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    if (this.hydrating) return this.hydrating;
    // Rate-limit retries: if the last hydration attempt failed recently,
    // skip the full SELECT and let the op proceed against the in-memory mirror.
    // Without this, a persistent PG error turns every op into a full-table
    // retry storm (hydrated stays false forever → ensureHydrated re-fires).
    if (
      this.hydrateFailedAt > 0 &&
      Date.now() - this.hydrateFailedAt < PgCheckpointStore.HYDRATE_RETRY_MS
    ) {
      return Promise.resolve();
    }
    this.hydrating = (async () => {
      try {
        const prisma = this.getClient();
        const rows = await prisma.$queryRaw<CheckpointRow[]>`
          SELECT * FROM task_checkpoints
        `;
        const next: Map<string, TaskCheckpoint> = new Map();
        const dbIds = new Set<string>();
        for (const row of rows) {
          dbIds.add(row.id);
          next.set(row.id, this.rowToCheckpoint(row));
        }
        // Re-apply any in-flight save whose row isn't in the DB snapshot yet.
        for (const [id, existing] of this.mirror) {
          if (!dbIds.has(id)) next.set(id, existing);
        }
        this.mirror = next;
        this.hydrated = true;
        this.hydrateFailedAt = 0;
        logger.info("PgCheckpointStore hydrated", {
          rows: this.mirror.size,
        });
      } catch (e) {
        this.hydrateFailedAt = Date.now();
        logger.warn("PgCheckpointStore hydrate failed (best-effort)", {
          error: (e as Error).message,
        });
      } finally {
        this.hydrating = null;
      }
    })();
    return this.hydrating;
  }

  private rowToCheckpoint(row: CheckpointRow): TaskCheckpoint {
    const state = decompressState(row.state);
    return {
      id: row.id,
      taskId: row.task_id,
      taskDescription: row.task_description ?? undefined,
      agentId: row.agent_id ?? undefined,
      projectId: row.project_id ?? undefined,
      state,
      memoryIds: row.memory_ids ? (JSON.parse(row.memory_ids) as string[]) : [],
      fileChanges: row.file_changes ? (JSON.parse(row.file_changes) as string[]) : [],
      checkpointType: row.checkpoint_type as CheckpointType,
      parentCheckpointId: row.parent_checkpoint_id ?? undefined,
      createdAt: toNum(row.created_at) ?? Date.now(),
      expiresAt: toNum(row.expires_at) ?? undefined,
    };
  }

  // ── Create ───────────────────────────────────────────────────────────────

  createCheckpoint(
    state: TaskState,
    options: CreateCheckpointOptions = {},
  ): TaskCheckpoint {
    const {
      agentId,
      projectId,
      checkpointType = CheckpointType.MANUAL,
      memoryIds = [],
      fileChanges = [],
      parentCheckpointId,
      ttlMs = 7 * 24 * 60 * 60 * 1000, // 7 days
    } = options;

    const id = `ckpt_${checkpointType}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = Date.now();
    const expiresAt = now + ttlMs;

    const checkpoint: TaskCheckpoint = {
      id,
      taskId: state.taskId,
      taskDescription: state.description,
      agentId,
      projectId,
      state,
      memoryIds,
      fileChanges,
      checkpointType,
      parentCheckpointId,
      createdAt: now,
      expiresAt,
    };

    // Mirror update is synchronous so a subsequent sync read sees the value.
    this.mirror.set(id, checkpoint);
    void this.ensureHydrated();

    // Fire-and-forget persist (best-effort).
    this.chainWrite(id, async () => {
      const prisma = this.getClient();
      const compressed = compressState(state);
      await prisma.$executeRaw`
        INSERT INTO task_checkpoints (
          id, task_id, task_description, agent_id, project_id,
          state, state_schema_version,
          memory_ids, file_changes,
          checkpoint_type, parent_checkpoint_id,
          created_at, expires_at
        ) VALUES (
          ${id},
          ${state.taskId},
          ${state.description ?? null},
          ${agentId ?? null},
          ${projectId ?? null},
          ${compressed},
          1,
          ${JSON.stringify(memoryIds)},
          ${JSON.stringify(fileChanges)},
          ${checkpointType},
          ${parentCheckpointId ?? null},
          ${now}::bigint,
          ${expiresAt}::bigint
        )
        ON CONFLICT (id) DO UPDATE SET
          task_id = EXCLUDED.task_id,
          task_description = EXCLUDED.task_description,
          agent_id = EXCLUDED.agent_id,
          project_id = EXCLUDED.project_id,
          state = EXCLUDED.state,
          state_schema_version = EXCLUDED.state_schema_version,
          memory_ids = EXCLUDED.memory_ids,
          file_changes = EXCLUDED.file_changes,
          checkpoint_type = EXCLUDED.checkpoint_type,
          parent_checkpoint_id = EXCLUDED.parent_checkpoint_id,
          created_at = EXCLUDED.created_at,
          expires_at = EXCLUDED.expires_at
      `;
    });

    logger.info("Checkpoint created (PG)", {
      id,
      taskId: state.taskId,
      type: checkpointType,
      compressedBytes: compressState(state).byteLength,
    });

    return checkpoint;
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  getCheckpoint(checkpointId: string): TaskCheckpoint | null {
    void this.ensureHydrated();
    return this.mirror.get(checkpointId) ?? null;
  }

  listCheckpoints(options: ListCheckpointsOptions = {}): TaskCheckpoint[] {
    void this.ensureHydrated();
    return this.applyFilters(this.mirror.values(), options);
  }

  listCheckpointsMetadata(
    options: ListCheckpointsOptions = {},
  ): CheckpointMetadata[] {
    void this.ensureHydrated();
    const filtered = this.applyFilters(this.mirror.values(), options);
    return filtered.map((c) => this.checkpointToMetadata(c));
  }

  getCheckpointState(checkpointId: string): TaskState | null {
    void this.ensureHydrated();
    const ckpt = this.mirror.get(checkpointId);
    return ckpt ? ckpt.state : null;
  }

  getLatestCheckpoint(taskId: string): TaskCheckpoint | null {
    void this.ensureHydrated();
    const now = Date.now();
    let latest: TaskCheckpoint | null = null;
    for (const ckpt of this.mirror.values()) {
      if (
        ckpt.taskId === taskId &&
        (ckpt.expiresAt == null || ckpt.expiresAt > now)
      ) {
        if (!latest || ckpt.createdAt > latest.createdAt) {
          latest = ckpt;
        }
      }
    }
    return latest;
  }

  // ── Delete / Cleanup ─────────────────────────────────────────────────────

  deleteCheckpoint(checkpointId: string): boolean {
    const existed = this.mirror.has(checkpointId);
    this.mirror.delete(checkpointId);
    void this.ensureHydrated();
    this.chainWrite(checkpointId, async () => {
      const prisma = this.getClient();
      await prisma.$executeRaw`
        DELETE FROM task_checkpoints WHERE id = ${checkpointId}
      `;
    });
    // Best-effort: report whether the mirror had it (durable delete is async).
    return existed;
  }

  purgeExpired(): number {
    const now = Date.now();
    let count = 0;
    const toRemove: string[] = [];
    for (const ckpt of this.mirror.values()) {
      if (ckpt.expiresAt != null && ckpt.expiresAt < now) {
        toRemove.push(ckpt.id);
        count++;
      }
    }
    for (const id of toRemove) this.mirror.delete(id);

    if (count > 0) {
      this.chainWrite("__purge__", async () => {
        const prisma = this.getClient();
        await prisma.$executeRaw`
          DELETE FROM task_checkpoints
          WHERE expires_at IS NOT NULL AND expires_at < ${now}::bigint
        `;
      });
      logger.info("Expired checkpoints purged (PG)", { count });
    }
    return count;
  }

  // ── Backend-aware memory existence ───────────────────────────────────────

  /**
   * KNOWN LIMITATION (PG): returns the input unchanged (assumes all referenced
   * memories exist). The ICheckpointStore contract is SYNCHRONOUS
   * (`countExistingMemoryIds(): string[]`), consumed synchronously by
   * CheckpointManager.restoreCheckpoint. PG is inherently async (prisma
   * `$queryRaw` returns a Promise we cannot await here without making
   * restoreCheckpoint async, which would ripple up and change the public MCP
   * tool response contract). So under PG the restore memory-integrity check is
   * silently permissive: `missingMemoryIds` is always empty. SQLite runs a real
   * `SELECT id FROM memories WHERE id IN (...)` and reports missing ids.
   *
   * A future fix that preserves the contract could maintain a PG-backed
   * in-memory mirror of memory ids (hydrated alongside checkpoints) and check
   * membership against it here; that mirror is out of scope for this store.
   */
  countExistingMemoryIds(memoryIds: string[]): string[] {
    if (memoryIds.length === 0) return [];
    void this.ensureHydrated();
    // Best-effort: assume all referenced memories exist (the restore is never
    // blocked). Mirrors the SQLite store's behavior when the memories table
    // query fails (its try/catch fallback also returns the full input).
    return memoryIds;
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  getStats(): CheckpointStats {
    void this.ensureHydrated();
    const checkpoints = Array.from(this.mirror.values());
    const byType: Record<string, number> = {};
    let totalSizeBytes = 0;
    let oldest: number | undefined;
    for (const c of checkpoints) {
      byType[c.checkpointType] = (byType[c.checkpointType] ?? 0) + 1;
      totalSizeBytes += compressState(c.state).byteLength;
      if (oldest == null || c.createdAt < oldest) oldest = c.createdAt;
    }
    return {
      totalCheckpoints: checkpoints.length,
      byType,
      totalSizeBytes,
      oldestCheckpointAge: oldest != null ? Date.now() - oldest : undefined,
    };
  }

  // ── Readiness ────────────────────────────────────────────────────────────

  /**
   * Await mirror hydration before a read (hydration race fix, #16).
   * The very first read after a process restart returns empty until hydration
   * settles (typically <100ms). Callers that must observe persisted rows
   * immediately after restart await this before reading.
   */
  ensureReady(): Promise<void> {
    return this.ensureHydrated();
  }

  close(): void {
    // Fire-and-forget writes may still be in-flight; they settle against the
    // shared prisma pool. Nothing to close here (the pool is owned by
    // getPrismaClient() / disconnectPrisma()).
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Apply the list filters + ordering + limit/offset to a checkpoint iterable. */
  private applyFilters(
    iter: Iterable<TaskCheckpoint>,
    options: ListCheckpointsOptions,
  ): TaskCheckpoint[] {
    const {
      taskId,
      projectId,
      checkpointType,
      includeExpired = false,
      limit = 20,
      offset = 0,
    } = options;
    const now = Date.now();
    const out: TaskCheckpoint[] = [];
    for (const c of iter) {
      if (taskId && c.taskId !== taskId) continue;
      if (projectId && c.projectId !== projectId) continue;
      if (checkpointType && c.checkpointType !== checkpointType) continue;
      if (!includeExpired && c.expiresAt != null && c.expiresAt <= now) continue;
      out.push(c);
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out.slice(offset, offset + limit);
  }

  private checkpointToMetadata(c: TaskCheckpoint): CheckpointMetadata {
    return {
      id: c.id,
      taskId: c.taskId,
      taskDescription: c.taskDescription,
      agentId: c.agentId,
      projectId: c.projectId,
      checkpointType: c.checkpointType,
      parentCheckpointId: c.parentCheckpointId,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
      compressedSizeBytes: compressState(c.state).byteLength,
      memoryCount: c.memoryIds.length,
      fileChangeCount: c.fileChanges.length,
    };
  }

  /**
   * Chain a write onto any in-flight write for the same key so commits land in
   * call order. Different keys stay concurrent. Mirrors PgSynapseSessionStore.
   */
  private chainWrite(key: string, fn: () => Promise<void>): void {
    const prev = this.inflight.get(key) ?? Promise.resolve();
    const next = prev.then(fn).catch((e) => {
      logger.warn("PgCheckpointStore write failed (best-effort)", {
        key,
        error: (e as Error).message,
      });
    });
    this.inflight.set(key, next);
    // Drop settled entries so the map does not grow.
    void next.then(() => {
      if (this.inflight.get(key) === next) this.inflight.delete(key);
    });
  }

  /** Test helper: await in-flight writes. Not for production use. */
  async __drain(): Promise<void> {
    // Snapshot the pending set ONCE. Re-reading `this.inflight` in a loop would
    // re-await writes that a concurrent caller repopulated during the drain,
    // risking a hang under load. We only owe the caller that the writes
    // in-flight at drain-start have settled.
    const pending = Array.from(this.inflight.values());
    if (pending.length > 0) await Promise.allSettled(pending);
    // A short settle delay covers any write queued during the drain.
    await new Promise((r) => setTimeout(r, 10));
  }

  /** Test helper: force hydration to complete before reading the mirror. */
  async __hydrate(): Promise<void> {
    await this.ensureHydrated();
  }
}

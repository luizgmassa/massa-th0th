/**
 * PgSynapseSessionStore — PostgreSQL parity for the Synapse session store.
 *
 * Mirrors PgScheduledJobStore / PgJobStore's discipline: the SessionStore
 * interface is SYNCHRONOUS (the SessionRegistry calls store.save/load with no
 * await, matching the SQLite store and bun:sqlite API). PG is inherently async,
 * so this store:
 *   - Writes fire-and-forget (best-effort, logged on failure — matching the
 *     SQLite store's try/catch best-effort semantics).
 *   - Reads are served from an in-memory mirror hydrated from PG on first use
 *     (async) and kept in sync by every save. The mirror is the hot read path
 *     within a process; PG is the durability + cross-process recovery layer
 *     (a new process hydrates its mirror from the persisted rows, so a session
 *     created before a restart is visible after it once hydration settles).
 *
 * Uses raw SQL ($executeRaw / $queryRaw) via the shared prisma client — the
 * same pattern as PgScheduledJobStore and MemoryRepositoryPg — to avoid the
 * Prisma 7.7.0 + adapter-pg isObjectEnumValue incompatibility. Reuses
 * getPrismaClient() (no second pool).
 *
 * Schema parity: synapse_sessions + synapse_access_history (see Prisma model
 * SynapseSession / SynapseAccessHistory and PG migration
 * 20260710120000_add_synapse_sessions_pg). The buffer snapshot + bufferConfig
 * are reconstructed into a live WorkingMemoryBuffer on load (#17), matching the
 * SQLite store. ensureReady() exposes the awaited-hydration hook the registry's
 * resume path uses so a session resume immediately after a process restart
 * observes PG-persisted sessions (#18).
 */

import { logger } from "@massa-th0th/shared";
import { getPrismaClient } from "../../query/prisma-client.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";
import type { AgentSession } from "../types.js";
import {
  restoreWorkingMemoryBuffer,
  type BufferSnapshot,
  type WorkingMemoryBufferConfig,
} from "../buffer/working-memory-buffer.js";
import type { SessionStore } from "./session-store.js";

// ── Raw row shapes returned by $queryRaw ────────────────────────────────────

interface SessionRow {
  session_id: string;
  agent_id: string;
  workspace_id: string | null;
  task_context: string | null;
  task_tokens: string | null; // JSON array
  task_embedding: Buffer | null; // Float32 buffer
  ttl_ms: number | bigint;
  created_at: number | bigint;
  expires_at: number | bigint;
  access_history_limit: number | bigint;
  buffer_config: string | null; // JSON
  buffer_snapshot: string | null; // JSON (best-effort)
  updated_at: number | bigint;
}

interface AccessRow {
  session_id: string;
  memory_id: string;
  access_count: number | bigint;
  last_accessed_at: number | bigint;
}

function toNum(v: number | bigint | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "bigint" ? Number(v) : v;
}

/** Best-effort buffer snapshot — scalars only (token Sets are regenerable). */
function snapshotBuffer(session: AgentSession): unknown {
  const buf = session.buffer as any;
  if (!buf || !buf.entries) return null;
  const out: any[] = [];
  for (const [id, entry] of buf.entries as Map<string, any>) {
    out.push({
      id,
      addedAt: entry.addedAt,
      lastAccessedAt: entry.lastAccessedAt,
      baselineScore: entry.baselineScore,
      result: entry.result,
    });
  }
  return { entries: out, config: buf.config };
}

export class PgSynapseSessionStore implements SessionStore {
  private prisma!: PrismaClient;
  /** In-memory mirror: the sync read path. Hydrated from PG on first use. */
  private mirror: Map<string, AgentSession> = new Map();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;
  /**
   * Epoch (ms) of the last failed hydration attempt. Rate-limits retries so a
   * persistent PG error does not turn every op into a full `SELECT *` retry
   * storm (hydrated stays false forever → ensureHydrated re-fires every call).
   */
  private hydrateFailedAt = 0;
  private static readonly HYDRATE_RETRY_MS = 30_000;
  /**
   * Per-sessionId serialized write chain. recordAccess fires frequently for one
   * session; without ordering, concurrent upserts on the same row have no
   * commit-order guarantee — an earlier touch could commit after a later one
   * and leave stale counts. Chaining each persist onto the previous in-flight
   * write for that sessionId guarantees commits land in call order. Different
   * sessionIds remain concurrent (independent rows). Settled entries are
   * dropped so the map does not grow. Mirrors PgJobStore's inflight pattern.
   */
  private inflight: Map<string, Promise<void>> = new Map();

  private getClient(): PrismaClient {
    if (!this.prisma) this.prisma = getPrismaClient();
    return this.prisma;
  }

  /**
   * Best-effort hydrate the mirror from PG. Resolves (never rejects) — failures
   * log a warn and leave the mirror empty; the registry can still create
   * sessions in-memory and persist them once PG is reachable. Also rehydrates
   * access history per session so the loaded AgentSession is complete.
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
      Date.now() - this.hydrateFailedAt < PgSynapseSessionStore.HYDRATE_RETRY_MS
    ) {
      return Promise.resolve();
    }
    this.hydrating = (async () => {
      try {
        const prisma = this.getClient();
        const rows = await prisma.$queryRaw<SessionRow[]>`
          SELECT * FROM synapse_sessions
        `;
        const accessRows = await prisma.$queryRaw<AccessRow[]>`
          SELECT * FROM synapse_access_history
        `;
        const accessBySession = new Map<string, Map<string, number>>();
        for (const a of accessRows) {
          let m = accessBySession.get(a.session_id);
          if (!m) {
            m = new Map();
            accessBySession.set(a.session_id, m);
          }
          m.set(a.memory_id, Number(a.access_count));
        }
        const next: Map<string, AgentSession> = new Map();
        const dbIds = new Set<string>();
        for (const row of rows) {
          dbIds.add(row.session_id);
          next.set(row.session_id, this.rowToSession(row, accessBySession.get(row.session_id)));
        }
        // Re-apply any in-flight save whose row isn't in the DB snapshot yet.
        for (const [id, existing] of this.mirror) {
          if (!dbIds.has(id)) next.set(id, existing);
        }
        this.mirror = next;
        this.hydrated = true;
        this.hydrateFailedAt = 0;
        logger.info("PgSynapseSessionStore hydrated", {
          rows: this.mirror.size,
        });
      } catch (e) {
        this.hydrateFailedAt = Date.now();
        logger.warn("PgSynapseSessionStore hydrate failed (best-effort)", {
          error: (e as Error).message,
        });
      } finally {
        this.hydrating = null;
      }
    })();
    return this.hydrating;
  }

  private rowToSession(row: SessionRow, accessMap?: Map<string, number>): AgentSession {
    const taskTokens = row.task_tokens
      ? new Set<string>(JSON.parse(row.task_tokens) as string[])
      : undefined;
    let taskEmbedding: Float32Array | number[] | undefined;
    if (row.task_embedding) {
      // pg returns BYTEA as a Buffer. Reconstruct the Float32Array → number[].
      const buf = Buffer.isBuffer(row.task_embedding)
        ? row.task_embedding
        : Buffer.from(row.task_embedding as unknown as ArrayBuffer);
      taskEmbedding = Array.from(
        new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4),
      );
    }

    const accessHistory = accessMap ?? new Map<string, number>();

    // Buffer (#17): reconstruct the live WorkingMemoryBuffer from the persisted
    // bufferConfig + best-effort snapshot so a session resumed after a process
    // restart keeps its primed working-set. Mirrors the SQLite store's restore.
    const bufferConfig = row.buffer_config
      ? (JSON.parse(row.buffer_config) as WorkingMemoryBufferConfig)
      : undefined;
    const snapshot = row.buffer_snapshot
      ? (JSON.parse(row.buffer_snapshot) as BufferSnapshot)
      : undefined;
    const buffer = bufferConfig
      ? restoreWorkingMemoryBuffer(snapshot ?? { entries: [], config: bufferConfig })
      : undefined;

    const session: AgentSession = {
      sessionId: row.session_id,
      agentId: row.agent_id,
      workspaceId: row.workspace_id ?? undefined,
      taskContext: row.task_context ?? undefined,
      taskTokens,
      taskEmbedding,
      ttlMs: Number(row.ttl_ms),
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      accessHistory,
      accessHistoryLimit: Number(row.access_history_limit),
      buffer,
    };
    return session;
  }

  save(session: AgentSession): void {
    // Mirror update is synchronous so a subsequent sync load() sees the value.
    this.mirror.set(session.sessionId, session);
    void this.ensureHydrated();
    // Fire-and-forget persist (best-effort, matching PgScheduledJobStore).
    this.chainWrite(session.sessionId, async () => {
      const prisma = this.getClient();
      const now = Date.now();
      const taskTokens = session.taskTokens
        ? JSON.stringify(Array.from(session.taskTokens))
        : null;
      const taskEmbedding = session.taskEmbedding
        ? Buffer.from(new Float32Array(session.taskEmbedding as number[]).buffer)
        : null;
      const bufferConfig = session.buffer
        ? JSON.stringify(session.buffer.config)
        : null;
      const bufferSnapshot = session.buffer
        ? JSON.stringify(snapshotBuffer(session))
        : null;

      await prisma.$executeRaw`
        INSERT INTO synapse_sessions (
          session_id, agent_id, workspace_id, task_context, task_tokens, task_embedding,
          ttl_ms, created_at, expires_at, access_history_limit, buffer_config, buffer_snapshot,
          updated_at
        ) VALUES (
          ${session.sessionId},
          ${session.agentId},
          ${session.workspaceId ?? null},
          ${session.taskContext ?? null},
          ${taskTokens},
          ${taskEmbedding},
          ${session.ttlMs}::bigint,
          ${session.createdAt}::bigint,
          ${session.expiresAt}::bigint,
          ${session.accessHistoryLimit},
          ${bufferConfig},
          ${bufferSnapshot},
          ${now}::bigint
        )
        ON CONFLICT (session_id) DO UPDATE SET
          agent_id = EXCLUDED.agent_id,
          workspace_id = EXCLUDED.workspace_id,
          task_context = EXCLUDED.task_context,
          task_tokens = EXCLUDED.task_tokens,
          task_embedding = EXCLUDED.task_embedding,
          ttl_ms = EXCLUDED.ttl_ms,
          expires_at = EXCLUDED.expires_at,
          access_history_limit = EXCLUDED.access_history_limit,
          buffer_config = EXCLUDED.buffer_config,
          buffer_snapshot = EXCLUDED.buffer_snapshot,
          updated_at = EXCLUDED.updated_at
      `;

      // Persist access history (replace strategy: clear + reinsert, matching
      // the SQLite store). Runs in the same chained write so it stays ordered
      // relative to the session upsert.
      await prisma.$executeRaw`
        DELETE FROM synapse_access_history WHERE session_id = ${session.sessionId}
      `;
      for (const [memoryId, count] of session.accessHistory) {
        await prisma.$executeRaw`
          INSERT INTO synapse_access_history (session_id, memory_id, access_count, last_accessed_at)
          VALUES (${session.sessionId}, ${memoryId}, ${count}, ${now}::bigint)
          ON CONFLICT (session_id, memory_id) DO UPDATE SET
            access_count = EXCLUDED.access_count,
            last_accessed_at = EXCLUDED.last_accessed_at
        `;
      }
    });
  }

  load(sessionId: string): AgentSession | null {
    void this.ensureHydrated();
    return this.mirror.get(sessionId) ?? null;
  }

  /**
   * Await mirror hydration before a read (hydration race fix, #18).
   *
   * The SessionStore read contract is synchronous, but this store serves reads
   * from an in-memory mirror hydrated from PG on first use. The very first
   * `load()` after a process restart returns null until hydration settles
   * (typically <100ms). Callers that must observe a persisted session
   * immediately after restart (session resume) await this before reading.
   * Sync backends resolve immediately.
   */
  ensureReady(): Promise<void> {
    return this.ensureHydrated();
  }

  delete(sessionId: string): void {
    this.mirror.delete(sessionId);
    this.chainWrite(sessionId, async () => {
      const prisma = this.getClient();
      await prisma.$executeRaw`
        DELETE FROM synapse_sessions WHERE session_id = ${sessionId}
      `;
      await prisma.$executeRaw`
        DELETE FROM synapse_access_history WHERE session_id = ${sessionId}
      `;
    });
  }

  recordAccess(sessionId: string, memoryId: string, count: number): void {
    void this.ensureHydrated();
    // Mirror the access touch synchronously so a sync load() sees the bump.
    const session = this.mirror.get(sessionId);
    if (session) {
      session.accessHistory.set(memoryId, count);
    }
    // Fire-and-forget persist (best-effort).
    this.chainWrite(`${sessionId}#access`, async () => {
      const prisma = this.getClient();
      const now = Date.now();
      await prisma.$executeRaw`
        INSERT INTO synapse_access_history (session_id, memory_id, access_count, last_accessed_at)
        VALUES (${sessionId}, ${memoryId}, ${count}, ${now}::bigint)
        ON CONFLICT (session_id, memory_id) DO UPDATE SET
          access_count = EXCLUDED.access_count,
          last_accessed_at = EXCLUDED.last_accessed_at
      `;
    });
  }

  /**
   * Chain a write onto any in-flight write for the same key so commits land in
   * call order. Different keys stay concurrent. Mirrors PgJobStore.inflight.
   */
  private chainWrite(key: string, fn: () => Promise<void>): void {
    const prev = this.inflight.get(key) ?? Promise.resolve();
    const next = prev.then(fn).catch((e) => {
      logger.warn("PgSynapseSessionStore write failed (best-effort)", {
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
    // Wait for all current in-flight writes to settle.
    while (this.inflight.size > 0) {
      const pending = Array.from(this.inflight.values());
      await Promise.allSettled(pending);
    }
    // A short settle delay covers any write queued during the drain.
    await new Promise((r) => setTimeout(r, 10));
  }

  /** Test helper: force hydration to complete before reading the mirror. */
  async __hydrate(): Promise<void> {
    await this.ensureHydrated();
  }
}

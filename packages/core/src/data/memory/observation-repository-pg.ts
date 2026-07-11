/**
 * PgObservationStore — PostgreSQL parity for the observation store.
 *
 * Mirrors PgScheduledJobStore / PgSynapseSessionStore's discipline: the
 * ObservationStore interface is SYNCHRONOUS (the hook-service and
 * CompactionSnapshotService call store.insert / listBySession / listRecent
 * with no await, matching the SQLite store and bun:sqlite API). PG is
 * inherently async, so this store:
 *   - Writes fire-and-forget (best-effort, logged on failure — matching the
 *     SQLite store's try/catch best-effort semantics).
 *   - Reads are served from an in-memory mirror hydrated from PG on first use
 *     (async) and kept in sync by every insert. The mirror is the hot read
 *     path within a process; PG is the durability + cross-process recovery
 *     layer (a new process hydrates its mirror from the persisted rows, so
 *     observations captured before a restart are visible after it once
 *     hydration settles). This is what makes compaction snapshots round-trip
 *     across a process restart under PG.
 *
 * Uses raw SQL ($executeRaw / $queryRaw) via the shared prisma client — the
 * same pattern as PgScheduledJobStore and MemoryRepositoryPg — to avoid the
 * Prisma 7.7.0 + adapter-pg isObjectEnumValue incompatibility. Reuses
 * getPrismaClient() (no second pool).
 *
 * Schema parity: observations table (see Prisma model Observation and PG
 * migration 20260710123800_add_observations_pg). The `created_at` column is
 * BIGINT ms-epoch to match the store's `createdAt: number` contract (NOT the
 * Prisma model's DateTime — see the migration note).
 */

import { logger } from "@massa-th0th/shared";
import { getPrismaClient } from "../../services/query/prisma-client.js";
import type { PrismaClient } from "../../generated/prisma/index.js";
import type {
  Observation,
  ObservationStore,
  ObservationRow,
} from "./observation-repository.js";

// ── Raw row shape returned by $queryRaw ────────────────────────────────────

interface PgObservationRow {
  id: string;
  project_id: string;
  session_id: string | null;
  source: string;
  category: string | null;
  payload_json: string;
  importance: number;
  created_at: number | bigint;
}

function toNum(v: number | bigint | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "bigint" ? Number(v) : v;
}

function pgRowToObservation(r: PgObservationRow): Observation {
  const row: ObservationRow = {
    id: r.id,
    project_id: r.project_id,
    session_id: r.session_id,
    source: r.source,
    category: r.category,
    payload_json: r.payload_json,
    importance: r.importance,
    created_at: toNum(r.created_at) ?? 0,
  };
  // Reuse the shared row mapper for parity with the SQLite store.
  // (rowToObservation is not exported, so inline the identical mapping.)
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    source: row.source as Observation["source"],
    category: (row.category as Observation["category"] | null) ?? undefined,
    payloadJson: row.payload_json,
    importance: row.importance,
    createdAt: row.created_at,
  };
}

export class PgObservationStore implements ObservationStore {
  private prisma!: PrismaClient;
  /**
   * In-memory mirror: the sync read path. Hydrated from PG on first use and
   * kept in sync by every insert(). Keyed by id for dedupe on upsert.
   */
  private mirror: Map<string, Observation> = new Map();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;
  /**
   * Epoch (ms) of the last failed hydration attempt. Used to rate-limit
   * retries so a persistent PG error does not turn every op into a full
   * `SELECT *` retry storm. We retry at most once per HYDRATE_RETRY_MS.
   */
  private hydrateFailedAt = 0;
  private static readonly HYDRATE_RETRY_MS = 30_000;

  private getClient(): PrismaClient {
    if (!this.prisma) this.prisma = getPrismaClient();
    return this.prisma;
  }

  /**
   * Best-effort hydrate the mirror from PG. Resolves (never rejects) —
   * failures log a warn and leave the mirror as-is; inserts made before
   * hydration lands are preserved (re-applied over the DB snapshot, matching
   * PgScheduledJobStore's inflight-merge).
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
      Date.now() - this.hydrateFailedAt < PgObservationStore.HYDRATE_RETRY_MS
    ) {
      return Promise.resolve();
    }
    this.hydrating = (async () => {
      try {
        const prisma = this.getClient();
        const rows = await prisma.$queryRaw<PgObservationRow[]>`
          SELECT id, project_id, session_id, source, category, payload_json, importance, created_at
          FROM observations
        `;
        const next: Map<string, Observation> = new Map();
        const dbIds = new Set<string>();
        for (const row of rows) {
          dbIds.add(row.id);
          next.set(row.id, pgRowToObservation(row));
        }
        // Re-apply any in-flight insert whose row isn't in the DB snapshot yet.
        for (const [id, obs] of this.mirror) {
          if (!dbIds.has(id)) next.set(id, obs);
        }
        this.mirror = next;
        this.hydrated = true;
        this.hydrateFailedAt = 0;
        logger.info("PgObservationStore hydrated", { rows: this.mirror.size });
      } catch (e) {
        // Record the failure so the backoff above suppresses the retry storm;
        // the mirror stays as-is and the op proceeds against it.
        this.hydrateFailedAt = Date.now();
        logger.warn("PgObservationStore hydrate failed (best-effort)", {
          error: (e as Error).message,
        });
      } finally {
        this.hydrating = null;
      }
    })();
    return this.hydrating;
  }

  insert(obs: Observation): void {
    // Mirror update is synchronous so a subsequent sync read sees the value.
    this.mirror.set(obs.id, obs);
    void this.ensureHydrated();
    // Fire-and-forget persist (best-effort, matching PgScheduledJobStore).
    void (async () => {
      try {
        const prisma = this.getClient();
        await prisma.$executeRaw`
          INSERT INTO observations (
            id, project_id, session_id, source, category, payload_json, importance, created_at
          ) VALUES (
            ${obs.id},
            ${obs.projectId},
            ${obs.sessionId},
            ${obs.source},
            ${obs.category ?? null},
            ${obs.payloadJson},
            ${obs.importance},
            ${obs.createdAt}::bigint
          )
          ON CONFLICT (id) DO UPDATE SET
            project_id   = EXCLUDED.project_id,
            session_id   = EXCLUDED.session_id,
            source       = EXCLUDED.source,
            category     = EXCLUDED.category,
            payload_json = EXCLUDED.payload_json,
            importance   = EXCLUDED.importance,
            created_at   = EXCLUDED.created_at
        `;
      } catch (e) {
        logger.warn("PgObservationStore.insert failed (best-effort)", {
          id: obs.id,
          error: (e as Error).message,
        });
      }
    })();
  }

  listRecent(projectId: string, limit: number): Observation[] {
    void this.ensureHydrated();
    const cap = Math.max(0, Math.floor(limit));
    return Array.from(this.mirror.values())
      .filter((o) => o.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, cap);
  }

  listBySession(sessionId: string, limit: number): Observation[] {
    void this.ensureHydrated();
    const cap = Math.max(0, Math.floor(limit));
    return Array.from(this.mirror.values())
      .filter((o) => o.sessionId === sessionId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, cap);
  }

  countByProject(projectId: string): number {
    void this.ensureHydrated();
    let n = 0;
    for (const o of this.mirror.values()) if (o.projectId === projectId) n++;
    return n;
  }

  journalMode(): string {
    return "postgres";
  }

  /** Test helper: force hydration to complete before reading the mirror. */
  async __hydrate(): Promise<void> {
    await this.ensureHydrated();
  }

  /** Test helper: await in-flight writes. Not for production use. */
  async __drain(): Promise<void> {
    // No per-id chain (observations are high-frequency but low-coupling); a
    // short settle delay covers the fire-and-forget persist. Kept for API
    // parity with PgScheduledJobStore.
    await new Promise((r) => setTimeout(r, 10));
  }
}

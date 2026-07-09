/**
 * PgJobStore — PostgreSQL durability for indexing jobs (Phase 1, T9).
 *
 * Mirrors SqliteJobStore's semantics so the job store follows the same
 * one-backend rule as the rest of the data plane: getJobStore() selects this
 * variant when DATABASE_URL is postgres, else SqliteJobStore.
 *
 * Interface contract: JobStore is SYNCHRONOUS (the tracker calls
 * `store?.save(job)` and `store.get(id)` with no await, mirroring the sync
 * bun:sqlite API). PG is inherently async, so this store:
 *   - Writes fire-and-forget (best-effort, logged on failure — matching the
 *     SQLite store's try/catch best-effort semantics).
 *   - Reads are served from an in-memory mirror that is hydrated from PG on
 *     first use (async) and kept in sync by every save. The mirror is the hot
 *     read path within a process; PG is the durability + cross-process recovery
 *     layer (crash recovery flips stale `running` → `failed` on init, and a new
 *     process hydrates its mirror from the recovered rows).
 *
 * Uses raw SQL ($executeRaw / $queryRaw) via the shared prisma client — the
 * same pattern as MemoryRepositoryPg — to avoid the Prisma 7.7.0 + adapter-pg
 * isObjectEnumValue incompatibility. Reuses getPrismaClient() (no second pool).
 */

import { logger } from "@massa-th0th/shared";
import { getPrismaClient } from "../../services/query/prisma-client.js";
import type { PrismaClient } from "../../generated/prisma/index.js";
import type { IndexJob } from "./index-job-tracker.js";
import type { JobStore } from "./index-job-store.js";

// Raw row shape returned by $queryRaw. Timestamps are BIGINT ms-epochs → come
// back as bigint under pg. We coerce to number for Date(ms) parity.
interface JobRow {
  job_id: string;
  project_id: string;
  project_path: string;
  status: string;
  current: number | bigint;
  total: number | bigint;
  percentage: number | bigint;
  files_indexed: number | bigint | null;
  chunks_indexed: number | bigint | null;
  errors: number | bigint | null;
  duration: number | bigint | null;
  error: string | null;
  created_at: number | bigint;
  started_at: number | bigint | null;
  completed_at: number | bigint | null;
  heartbeat_at: number | bigint | null;
}

function toNum(v: number | bigint | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "bigint" ? Number(v) : v;
}

function rowToJob(r: JobRow): IndexJob {
  const filesIndexed = toNum(r.files_indexed);
  return {
    jobId: r.job_id,
    projectId: r.project_id,
    projectPath: r.project_path,
    status: r.status as IndexJob["status"],
    progress: {
      current: Number(r.current),
      total: Number(r.total),
      percentage: Number(r.percentage),
    },
    result:
      filesIndexed != null
        ? {
            filesIndexed,
            chunksIndexed: toNum(r.chunks_indexed) ?? 0,
            errors: toNum(r.errors) ?? 0,
            duration: toNum(r.duration) ?? 0,
          }
        : undefined,
    error: r.error ?? undefined,
    createdAt: new Date(toNum(r.created_at) as number),
    startedAt:
      r.started_at != null ? new Date(toNum(r.started_at) as number) : undefined,
    completedAt:
      r.completed_at != null
        ? new Date(toNum(r.completed_at) as number)
        : undefined,
    heartbeatAt:
      r.heartbeat_at != null
        ? new Date(toNum(r.heartbeat_at) as number)
        : undefined,
  };
}

export class PgJobStore implements JobStore {
  private prisma!: PrismaClient;
  /** In-memory mirror: the sync read path. Hydrated from PG on first use. */
  private mirror: Map<string, IndexJob> = new Map();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;
  /** Crash recovery guard: runs once per process on first use. */
  private recovered = false;
  /**
   * Per-jobId serialized write chain. The tracker lifecycle calls save() many
   * times rapidly for one job (pending → running → progress → ... → completed).
   * Without ordering, these become concurrent in-flight upserts on the same
   * row with NO commit-order guarantee — an earlier write (e.g. `running`) can
   * commit AFTER the terminal write (`completed`) and leave the PG row stuck at
   * a non-terminal state. Chaining each persist onto the previous in-flight
   * write for that jobId guarantees persists commit in call order. Different
   * jobIds remain concurrent (independent rows). Settled entries are dropped so
   * the map does not grow.
   */
  private inflight: Map<string, Promise<void>> = new Map();

  private getClient(): PrismaClient {
    if (!this.prisma) this.prisma = getPrismaClient();
    return this.prisma;
  }

  /**
   * Best-effort hydrate the mirror from PG + run crash recovery once. Resolves
   * (never rejects) — failures log a warn and leave the mirror empty; the
   * tracker's own in-memory Map remains the authoritative hot cache.
   */
  private ensureHydrated(): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    if (this.hydrating) return this.hydrating;
    this.hydrating = (async () => {
      try {
        const prisma = this.getClient();
        // Crash recovery FIRST: flip stale `running` → `failed` before we read,
        // so the mirror reflects recovered state (parity with SqliteJobStore's
        // recovery-on-open). Runs once per process.
        if (!this.recovered) {
          try {
            const now = Date.now();
            const result = await prisma.$executeRaw`
              UPDATE index_jobs
              SET status = 'failed', error = 'process restart', completed_at = ${now}::bigint
              WHERE status = 'running'
            `;
            this.recovered = true;
            if (typeof result === "number" && result > 0) {
              logger.info("PgJobStore crash recovery", {
                staleRunningFailed: result,
              });
            }
          } catch (e) {
            this.recovered = true; // don't retry loop; surface once
            logger.warn("PgJobStore markStaleRunningFailed failed (best-effort)", {
              error: (e as Error).message,
            });
          }
        }
        // Hydrate: pull all rows into the mirror.
        const rows = await prisma.$queryRaw<JobRow[]>`
          SELECT * FROM index_jobs
        `;
        this.mirror.clear();
        for (const row of rows) {
          this.mirror.set(row.job_id, rowToJob(row));
        }
        this.hydrated = true;
        logger.info("PgJobStore hydrated", { rows: this.mirror.size });
      } catch (e) {
        // Hydration failed: leave hydrated=false so the next call retries. The
        // tracker's own Map still serves reads; PG writes still land.
        logger.warn("PgJobStore hydrate failed (best-effort)", {
          error: (e as Error).message,
        });
      } finally {
        this.hydrating = null;
      }
    })();
    return this.hydrating;
  }

  save(job: IndexJob): void {
    // Mirror update is synchronous so a subsequent sync get() sees the value.
    this.mirror.set(job.jobId, job);
    // Kick off hydration so the mirror catches up if it hasn't yet.
    void this.ensureHydrated();
    // Chain the PG persist onto the previous in-flight write for this jobId so
    // persists commit in call order (prevents out-of-order upserts clobbering
    // the terminal state). The mirror read contract is unaffected (already
    // updated above). Different jobIds remain concurrent.
    const prev = this.inflight.get(job.jobId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.persist(job));
    this.inflight.set(job.jobId, next);
    // Drop the chain entry once settled so the map doesn't grow.
    next.finally(() => {
      if (this.inflight.get(job.jobId) === next) {
        this.inflight.delete(job.jobId);
      }
    });
    next.catch((e) => {
      logger.warn("PgJobStore.save failed (best-effort)", {
        jobId: job.jobId,
        error: (e as Error).message,
      });
    });
  }

  /**
   * Test-infrastructure helper (double-underscore): await the current in-flight
   * write(s) for a job (or all jobs if omitted). Lets tests assert the FINAL
   * on-disk PG state deterministically without polling. Not for production use.
   */
  async __drain(jobId?: string): Promise<void> {
    if (jobId) {
      const p = this.inflight.get(jobId);
      if (p) await p.catch(() => {});
      return;
    }
    const all = Array.from(this.inflight.values());
    if (all.length) await Promise.all(all.map((p) => p.catch(() => {})));
  }

  private async persist(job: IndexJob): Promise<void> {
    const prisma = this.getClient();
    const filesIndexed = job.result?.filesIndexed ?? null;
    const chunksIndexed = job.result?.chunksIndexed ?? null;
    const errors = job.result?.errors ?? null;
    const duration = job.result?.duration ?? null;
    const error = job.error ?? null;
    const createdAt = job.createdAt.getTime();
    const startedAt = job.startedAt?.getTime() ?? null;
    const completedAt = job.completedAt?.getTime() ?? null;
    const heartbeatAt = job.heartbeatAt?.getTime() ?? null;
    await prisma.$executeRaw`
      INSERT INTO index_jobs (
        job_id, project_id, project_path, status, current, total, percentage,
        files_indexed, chunks_indexed, errors, duration, error,
        created_at, started_at, completed_at, heartbeat_at
      ) VALUES (
        ${job.jobId},
        ${job.projectId},
        ${job.projectPath},
        ${job.status},
        ${job.progress.current},
        ${job.progress.total},
        ${job.progress.percentage},
        ${filesIndexed}::int,
        ${chunksIndexed}::int,
        ${errors}::int,
        ${duration}::int,
        ${error},
        ${createdAt}::bigint,
        ${startedAt !== null ? startedAt : null}::bigint,
        ${completedAt !== null ? completedAt : null}::bigint,
        ${heartbeatAt !== null ? heartbeatAt : null}::bigint
      )
      ON CONFLICT (job_id) DO UPDATE SET
        status = EXCLUDED.status,
        current = EXCLUDED.current,
        total = EXCLUDED.total,
        percentage = EXCLUDED.percentage,
        files_indexed = EXCLUDED.files_indexed,
        chunks_indexed = EXCLUDED.chunks_indexed,
        errors = EXCLUDED.errors,
        duration = EXCLUDED.duration,
        error = EXCLUDED.error,
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at,
        heartbeat_at = EXCLUDED.heartbeat_at
    `;
  }

  get(jobId: string): IndexJob | null {
    void this.ensureHydrated();
    // Sync read from the mirror. If hydration hasn't completed yet, the tracker's
    // own in-memory Map is the authoritative hot cache; we return the mirror
    // value (may be undefined on a cold new process until hydration lands).
    return this.mirror.get(jobId) ?? null;
  }

  listByProject(projectId: string): IndexJob[] {
    void this.ensureHydrated();
    return Array.from(this.mirror.values())
      .filter((j) => j.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  listAll(): IndexJob[] {
    void this.ensureHydrated();
    return Array.from(this.mirror.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  listRunning(): IndexJob[] {
    void this.ensureHydrated();
    return Array.from(this.mirror.values()).filter((j) => j.status === "running");
  }

  markStaleRunningFailed(): number {
    // Parity with the SQLite store's markStaleRunningFailed. Fire-and-forget:
    // returns the count from the CURRENT mirror snapshot (the actual PG update
    // runs async). This matches the SQLite store's "best-effort, never crash
    // the API" contract; the reaper itself calls setResult → save which lands
    // the `failed` row synchronously in the mirror and async in PG.
    const stale = this.listRunning();
    void (async () => {
      try {
        const prisma = this.getClient();
        const now = Date.now();
        await prisma.$executeRaw`
          UPDATE index_jobs
          SET status = 'failed', error = 'process restart', completed_at = ${now}::bigint
          WHERE status = 'running'
        `;
      } catch (e) {
        logger.warn("PgJobStore markStaleRunningFailed failed (best-effort)", {
          error: (e as Error).message,
        });
      }
    })();
    return stale.length;
  }

  delete(jobId: string): void {
    this.mirror.delete(jobId);
    void (async () => {
      try {
        const prisma = this.getClient();
        await prisma.$executeRaw`DELETE FROM index_jobs WHERE job_id = ${jobId}`;
      } catch {
        /* best-effort */
      }
    })();
  }
}

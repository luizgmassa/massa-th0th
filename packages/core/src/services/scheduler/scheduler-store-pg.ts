/**
 * PgScheduledJobStore — PostgreSQL parity for the scheduler store.
 *
 * Mirrors PgJobStore's discipline: the ScheduledJobStore interface is
 * SYNCHRONOUS (the scheduler calls store.save/get with no await, matching the
 * PostgreSQL store). PG is inherently async, so this store:
 *   - Writes fire-and-forget (best-effort, logged on failure — matching the
 *     PostgreSQL store's try/catch best-effort semantics).
 *   - Reads are served from an in-memory mirror hydrated from PG on first use
 *     (async) and kept in sync by every save.
 *
 * Uses raw SQL ($executeRaw / $queryRaw) via the shared prisma client — the
 * same pattern as PgJobStore and MemoryRepositoryPg — to avoid the Prisma 7.7.0
 * + adapter-pg isObjectEnumValue incompatibility. Reuses getPrismaClient().
 */

import { logger } from "@massa-ai/shared";
import { getPrismaClient } from "../query/prisma-client.js";
import { getProjectIdentityAliasResolver } from "../project-identity/alias-resolver.js";
import type { PrismaClient } from "../../generated/prisma/index.js";
import type { ScheduledJob, ScheduleSpec, JobKind } from "./scheduler-types.js";
import type { ScheduledJobStore } from "./scheduler-store.js";

interface ScheduledJobRow {
  id: string;
  name: string;
  job_kind: string;
  schedule_type: string;
  interval_ms: number | bigint | null;
  cron: string | null;
  next_run_at: number | bigint;
  last_run_at: number | bigint;
  enabled: number | bigint;
  payload: string | null;
  // Wave 5 FR-13 / M-W5-02: success/failure split columns.
  last_success_at: number | bigint | null;
  last_failure_at: number | bigint | null;
  consecutive_failures: number | bigint;
  last_error: string | null;
}

function toNum(v: number | bigint | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "bigint" ? Number(v) : v;
}

function rowToJob(r: ScheduledJobRow): ScheduledJob {
  const scheduleType = r.schedule_type;
  const intervalMs = toNum(r.interval_ms);
  const cron = r.cron;
  const schedule: ScheduleSpec =
    scheduleType === "cron"
      ? { type: "cron", cron: cron ?? undefined }
      : { type: "interval", intervalMs: intervalMs ?? undefined };

  let payload: Record<string, unknown> | undefined;
  if (r.payload) {
    try {
      payload = JSON.parse(r.payload);
    } catch {
      payload = undefined;
    }
  }

  return {
    id: r.id,
    name: r.name,
    jobKind: r.job_kind as JobKind,
    schedule,
    nextRunAt: Number(r.next_run_at),
    lastRunAt: Number(r.last_run_at),
    enabled: Number(r.enabled) !== 0,
    payload,
    // Wave 5 FR-13: success/failure split columns.
    lastSuccessAt: toNum(r.last_success_at),
    lastFailureAt: toNum(r.last_failure_at),
    consecutiveFailures: Number(r.consecutive_failures),
    lastError: r.last_error,
  };
}

export class PgScheduledJobStore implements ScheduledJobStore {
  private prisma!: PrismaClient;
  private mirror: Map<string, ScheduledJob> = new Map();
  /** IDs deleted locally before/during hydration must not be resurrected. */
  private localDeletes = new Set<string>();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;
  /** Serialize mutations per job ID and expose their real settlement to tests. */
  private pendingById = new Map<string, Promise<void>>();
  private pendingOperations = new Set<Promise<void>>();

  private getClient(): PrismaClient {
    if (!this.prisma) this.prisma = getPrismaClient();
    return this.prisma;
  }

  /**
   * Best-effort hydrate the mirror from PG. Resolves (never rejects) — failures
   * log a warn and leave the mirror empty; the scheduler can still register jobs
   * in-memory and will persist them once PG is reachable.
   */
  private ensureHydrated(): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    if (this.hydrating) return this.hydrating;
    this.hydrating = (async () => {
      try {
        const prisma = this.getClient();
        const rows = await prisma.$queryRaw<ScheduledJobRow[]>`
          SELECT * FROM scheduled_jobs
        `;
        const next: Map<string, ScheduledJob> = new Map();
        for (const row of rows) {
          next.set(row.id, rowToJob(row));
        }
        // Local synchronous mutations are authoritative over the async DB
        // snapshot. Overlay every local value (not only IDs absent from PG),
        // otherwise hydration can replace a rapid update with an older row.
        for (const [id, job] of this.mirror) {
          next.set(id, job);
        }
        for (const id of this.localDeletes) {
          next.delete(id);
        }
        this.mirror = next;
        this.hydrated = true;
        logger.info("PgScheduledJobStore hydrated", { rows: this.mirror.size });
      } catch (e) {
        logger.warn("PgScheduledJobStore hydrate failed (best-effort)", {
          error: (e as Error).message,
        });
      } finally {
        this.hydrating = null;
      }
    })();
    return this.hydrating;
  }

  private enqueueMutation(
    id: string,
    action: () => Promise<void>,
    operation: "save" | "delete",
  ): void {
    const previous = this.pendingById.get(id);
    const run = async (): Promise<void> => {
      try {
        await action();
      } catch (e) {
        logger.warn(`PgScheduledJobStore.${operation} failed (best-effort)`, {
          id,
          error: (e as Error).message,
        });
      }
    };
    // Continue after an earlier best-effort failure so a later mutation can
    // recover. Per-ID serialization makes invocation order equal commit order.
    const pending = previous ? previous.then(run, run) : run();
    this.pendingById.set(id, pending);
    this.pendingOperations.add(pending);
    void pending.finally(() => {
      this.pendingOperations.delete(pending);
      if (this.pendingById.get(id) === pending) this.pendingById.delete(id);
    });
  }

  save(job: ScheduledJob): void {
    // Mirror update is synchronous so a subsequent sync get() sees the value.
    this.mirror.set(job.id, job);
    this.localDeletes.delete(job.id);

    // Capture values at save() time. The scheduler mutates job objects later,
    // while PostgreSQL persists synchronously at the call boundary. Payload is
    // captured RAW: its embedded projectId is alias-resolved inside the async
    // persist (spec req 3 — payload-only store, no identity column, so the DB
    // trigger cannot resolve it).
    const persisted = {
      id: job.id,
      name: job.name,
      jobKind: job.jobKind,
      scheduleType: job.schedule.type,
      intervalMs: job.schedule.intervalMs ?? null,
      cron: job.schedule.cron ?? null,
      nextRunAt: job.nextRunAt,
      lastRunAt: job.lastRunAt,
      enabled: job.enabled,
      payload: job.payload ? structuredClone(job.payload) : null,
      // Wave 5 FR-13: success/failure split columns.
      lastSuccessAt: job.lastSuccessAt ?? null,
      lastFailureAt: job.lastFailureAt ?? null,
      consecutiveFailures: job.consecutiveFailures ?? 0,
      lastError: job.lastError ?? null,
    };

    // Fire-and-forget remains the public contract, but same-ID writes are
    // chained so a slower old write cannot overwrite a newer save.
    this.enqueueMutation(job.id, async () => {
      const prisma = this.getClient();
      let payloadJson: string | null = null;
      if (persisted.payload) {
        if (typeof persisted.payload.projectId === "string" && persisted.payload.projectId) {
          persisted.payload.projectId = await getProjectIdentityAliasResolver()
            .resolve(persisted.payload.projectId);
        }
        payloadJson = JSON.stringify(persisted.payload);
      }
      await prisma.$executeRaw`
          INSERT INTO scheduled_jobs (
            id, name, job_kind, schedule_type, interval_ms, cron,
            next_run_at, last_run_at, enabled, payload,
            last_success_at, last_failure_at, consecutive_failures, last_error
          ) VALUES (
            ${persisted.id},
            ${persisted.name},
            ${persisted.jobKind},
            ${persisted.scheduleType},
            ${persisted.intervalMs}::bigint,
            ${persisted.cron},
            ${persisted.nextRunAt}::bigint,
            ${persisted.lastRunAt}::bigint,
            ${persisted.enabled ? 1 : 0}::int,
            ${payloadJson},
            ${persisted.lastSuccessAt}::bigint,
            ${persisted.lastFailureAt}::bigint,
            ${persisted.consecutiveFailures}::int,
            ${persisted.lastError}
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            job_kind = EXCLUDED.job_kind,
            schedule_type = EXCLUDED.schedule_type,
            interval_ms = EXCLUDED.interval_ms,
            cron = EXCLUDED.cron,
            next_run_at = EXCLUDED.next_run_at,
            last_run_at = EXCLUDED.last_run_at,
            enabled = EXCLUDED.enabled,
            payload = EXCLUDED.payload,
            last_success_at = EXCLUDED.last_success_at,
            last_failure_at = EXCLUDED.last_failure_at,
            consecutive_failures = EXCLUDED.consecutive_failures,
            last_error = EXCLUDED.last_error
      `;
    }, "save");
    void this.ensureHydrated();
  }

  get(id: string): ScheduledJob | null {
    void this.ensureHydrated();
    return this.mirror.get(id) ?? null;
  }

  listAll(): ScheduledJob[] {
    void this.ensureHydrated();
    return Array.from(this.mirror.values()).sort((a, b) => a.nextRunAt - b.nextRunAt);
  }

  listEnabled(): ScheduledJob[] {
    void this.ensureHydrated();
    return Array.from(this.mirror.values())
      .filter((j) => j.enabled)
      .sort((a, b) => a.nextRunAt - b.nextRunAt);
  }

  delete(id: string): void {
    this.mirror.delete(id);
    this.localDeletes.add(id);
    this.enqueueMutation(id, async () => {
      const prisma = this.getClient();
      await prisma.$executeRaw`DELETE FROM scheduled_jobs WHERE id = ${id}`;
    }, "delete");
    void this.ensureHydrated();
  }

  /** Test helper: await in-flight writes. Not for production use. */
  async __drain(): Promise<void> {
    // Work can be enqueued while hydration or an earlier mutation settles, so
    // re-check until the tracked set is genuinely empty.
    while (this.hydrating || this.pendingOperations.size > 0) {
      const pending = [
        ...(this.hydrating ? [this.hydrating] : []),
        ...this.pendingOperations,
      ];
      await Promise.all(pending);
    }
  }
}

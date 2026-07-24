/**
 * Scheduler — OS-level in-process cron-like scheduler (Phase 3, C2).
 *
 * Runs periodic jobs on a CLOCK, alongside the existing event-debounce
 * triggers. The existing job implementations (consolidation, decay-sweep,
 * auto-improve, observation-bridge) are unchanged — the scheduler just invokes
 * their existing entrypoints at scheduled times.
 *
 * Design:
 *  - Durable job table (PostgreSQL + PG parity): persists job definitions +
 *    nextRunAt/lastRunAt so a restart resumes the schedule.
 *  - Job registry: handlers keyed by jobKind. The scheduler invokes the
 *    registered handler; never the job implementation directly.
 *  - Scheduler loop: a single setInterval tick (default 60s, env-overridable).
 *    On each tick, loads enabled jobs whose nextRunAt <= now and fires them.
 *  - Missed-run policy: SKIP with a logged warning (avoid stampede). If a job's
 *    nextRunAt is far in the past (more than one tick), we skip the missed
 *    runs and reschedule from now.
 *  - Concurrency guard: never run the same jobKind twice concurrently.
 *  - Concurrency cap: at most MAX_CONCURRENT jobs firing at once.
 *  - Singleton: module-level cached instance + getScheduler()/resetScheduler().
 *  - Lifecycle: start() loads enabled jobs + begins the tick; stop() clears the
 *    interval. The interval is .unref()'d so it never keeps the event loop
 *    alive solely for scheduling (parity with the job-reaper pattern).
 *
 * Config (env-overridable, default OFF or conservative):
 *   MASSA_AI_SCHEDULER_ENABLED        (default false) master switch
 *   MASSA_AI_SCHEDULER_TICK_MS        (default 60000) tick interval
 *   MASSA_AI_SCHEDULER_MAX_CONCURRENT (default 2)     concurrent fire cap
 *
 * Default job intervals (conservative, env-overridable per kind):
 *   memory-consolidation: 30 min
 *   decay-sweep:           60 min
 *   auto-improve:          30 min
 *   observation-bridge:    30 min
 * All default to disabled=false unless MASSA_AI_SCHEDULER_ENABLED=true AND
 * the job's own enable flag is set. The boot wiring registers them as
 * default-disabled; a deployment opts in by setting enabled=true on the row or
 * MASSA_AI_SCHEDULER_<KIND>_ENABLED=true before boot.
 */

import { logger } from "@massa-ai/shared";
import { parsePositiveIntEnv } from "@massa-ai/shared/config";
import {
  parseCron,
  nextCronRun,
  type ParsedCron,
} from "./scheduler-cron.js";
import {
  getScheduledJobStore,
  resetScheduledJobStore,
} from "./scheduler-store-factory.js";
import type { ScheduledJobStore } from "./scheduler-store.js";
import type {
  JobHandler,
  JobKind,
  ScheduledJob,
  ScheduleSpec,
  SchedulerStatus,
  TickResult,
} from "./scheduler-types.js";

export interface SchedulerOptions {
  /** Inject a store (tests). Defaults to getScheduledJobStore(). */
  store?: ScheduledJobStore;
  /** Override the tick interval (tests). Defaults to env or 60000. */
  tickIntervalMs?: number;
  /** Override the concurrency cap (tests). Defaults to env or 2. */
  maxConcurrent?: number;
  /** Override the master switch (tests). Defaults to env or false. */
  enabled?: boolean;
}

const DEFAULTS = {
  tickMs: 60_000,
  maxConcurrent: 2,
} as const;

function readEnabled(): boolean {
  const raw = process.env.MASSA_AI_SCHEDULER_ENABLED;
  return raw === "true" || raw === "1";
}

export class Scheduler {
  private readonly store: ScheduledJobStore;
  private readonly tickIntervalMs: number;
  private readonly maxConcurrent: number;
  private readonly enabled: boolean;

  /** Registry: jobKind → handler. */
  private handlers: Map<JobKind, JobHandler> = new Map();
  /** Parsed cron cache (avoids re-parsing on every tick). */
  private cronCache: Map<string, ParsedCron> = new Map();
  /** Currently-running jobKinds (concurrency guard). */
  private running: Set<JobKind> = new Set();

  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(opts: SchedulerOptions = {}) {
    this.store = opts.store ?? getScheduledJobStore();
    this.tickIntervalMs =
      opts.tickIntervalMs ??
      parsePositiveIntEnv(process.env.MASSA_AI_SCHEDULER_TICK_MS, DEFAULTS.tickMs);
    this.maxConcurrent =
      opts.maxConcurrent ??
      parsePositiveIntEnv(process.env.MASSA_AI_SCHEDULER_MAX_CONCURRENT, DEFAULTS.maxConcurrent);
    this.enabled = opts.enabled ?? readEnabled();
  }

  // ── Registry ──────────────────────────────────────────────────────────────

  /**
   * Register a handler for a jobKind. The scheduler will invoke this handler
   * when a scheduled job of that kind fires. Overwrites any prior registration.
   */
  registerHandler(jobKind: JobKind, handler: JobHandler): void {
    this.handlers.set(jobKind, handler);
  }

  /** Unregister a handler (tests / shutdown). */
  unregisterHandler(jobKind: JobKind): void {
    this.handlers.delete(jobKind);
  }

  /** List registered jobKinds. */
  registeredKinds(): JobKind[] {
    return Array.from(this.handlers.keys());
  }

  // ── Job definition management ─────────────────────────────────────────────

  /**
   * Register or upsert a scheduled job definition. Persists it to the store.
   * If the job already exists (by id), its definition is updated; nextRunAt is
   * preserved unless the schedule changed.
   */
  registerJob(job: Omit<ScheduledJob, "lastRunAt"> & { lastRunAt?: number }): ScheduledJob {
    const existing = this.store.get(job.id);
    const full: ScheduledJob = {
      ...job,
      lastRunAt: job.lastRunAt ?? existing?.lastRunAt ?? 0,
    };
    // If nextRunAt is 0 or the schedule changed, recompute it.
    if (full.nextRunAt === 0 || this.scheduleChanged(existing, full)) {
      full.nextRunAt = this.computeNextRun(full.schedule, Date.now());
    }
    this.store.save(full);
    return full;
  }

  /**
   * Register or RESUME a scheduled job definition across a restart. Like
   * registerJob, but when the schedule is unchanged and the job already exists,
   * it preserves the existing nextRunAt (resume on restart) rather than
   * recomputing. If the preserved nextRunAt is in the past and the job is
   * enabled, reschedule from now (avoids a noisy missed-run log on boot).
   *
   * This is the boot-time registration used by registerDefaultJobs().
   */
  registerOrResumeJob(
    job: Omit<ScheduledJob, "lastRunAt"> & { lastRunAt?: number },
  ): ScheduledJob {
    const existing = this.store.get(job.id);
    const full: ScheduledJob = {
      ...job,
      lastRunAt: job.lastRunAt ?? existing?.lastRunAt ?? 0,
    };

    if (!existing) {
      // New job: compute nextRunAt from now.
      full.nextRunAt = this.computeNextRun(full.schedule, Date.now());
    } else if (this.scheduleChanged(existing, full)) {
      // Schedule changed: recompute from now.
      full.nextRunAt = this.computeNextRun(full.schedule, Date.now());
    } else {
      // Schedule unchanged: preserve the EXISTING persisted nextRunAt (resume on
      // restart). The contract is "don't reschedule an unchanged job." We check
      // the PERSISTED nextRunAt (not the passed-in one, which callers set to 0)
      // against now — a future persisted nextRunAt is kept as-is.
      const now = Date.now();
      full.nextRunAt = existing.nextRunAt;
      // Wave 5 FR-13: do NOT reschedule past-due jobs here — catchUpMissedJobs()
      // fires one tick per missed job at boot. Preserving the past-due nextRunAt
      // lets catch-up identify which jobs were missed.
      // If disabled, keep the existing nextRunAt as-is (it'll be recomputed
      // when the job is re-enabled via setEnabled).
      void now; // now referenced in catchUpMissedJobs
    }

    this.store.save(full);
    return full;
  }

  private scheduleChanged(a: ScheduledJob | null, b: ScheduledJob): boolean {
    if (!a) return true;
    return (
      a.schedule.type !== b.schedule.type ||
      a.schedule.intervalMs !== b.schedule.intervalMs ||
      a.schedule.cron !== b.schedule.cron
    );
  }

  /** Enable/disable a job by id. Persists. */
  setEnabled(id: string, enabled: boolean): void {
    const job = this.store.get(id);
    if (!job) {
      logger.warn("Scheduler.setEnabled: job not found", { id });
      return;
    }
    job.enabled = enabled;
    // If re-enabling and nextRunAt is in the past, reschedule from now.
    if (enabled && job.nextRunAt <= Date.now()) {
      job.nextRunAt = this.computeNextRun(job.schedule, Date.now());
    }
    this.store.save(job);
  }

  /** Delete a job definition. */
  removeJob(id: string): void {
    this.store.delete(id);
  }

  // ── Next-run computation ──────────────────────────────────────────────────

  /**
   * Compute the next run time for a schedule, anchored at `fromMs`.
   * For intervals: fromMs + intervalMs.
   * For cron: the next cron match strictly after fromMs.
   */
  computeNextRun(schedule: ScheduleSpec, fromMs: number): number {
    if (schedule.type === "interval") {
      // Fall back to the scheduler's tick interval if intervalMs is missing —
      // a missing intervalMs is a malformed definition, and using the tick is
      // a sane conservative default (fires once per tick).
      const ms = schedule.intervalMs ?? this.tickIntervalMs;
      return fromMs + ms;
    }
    // cron
    const expr = schedule.cron ?? "* * * * *";
    let parsed = this.cronCache.get(expr);
    if (!parsed) {
      parsed = parseCron(expr);
      this.cronCache.set(expr, parsed);
    }
    return nextCronRun(parsed, fromMs);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start the scheduler. Loads enabled jobs from the store and begins the tick.
   * Safe to call when already started (no-op). Safe to call when the master
   * switch is off (logs once, no tick).
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.enabled) {
      logger.info("Scheduler disabled (MASSA_AI_SCHEDULER_ENABLED != true)");
      return;
    }
    // Seed default jobs that have no row yet (registerDefaultJobs is called by
    // the boot wiring before start(); this is a safety net).
    const jobs = this.store.listEnabled();
    logger.info("Scheduler starting", {
      tickMs: this.tickIntervalMs,
      maxConcurrent: this.maxConcurrent,
      enabledJobs: jobs.length,
    });

    this.timer = setInterval(() => {
      void this.tick().catch((e) => {
        logger.warn("Scheduler tick failed (swallowed)", {
          error: (e as Error).message,
        });
      });
    }, this.tickIntervalMs);
    // Never keep the event loop alive solely for the scheduler.
    this.timer.unref?.();

    // Fire one immediate tick so jobs due now run without waiting for the first
    // interval. This also handles catch-up-on-boot: jobs whose nextRunAt is in
    // the past will be skipped-with-warning and rescheduled (missed-run policy).
    void this.tick().catch(() => {});
  }

  /**
   * Wave 5 FR-13: catch-up missed jobs at boot. Fires ONE tick per missed job
   * (jobs with next_run_at < now() AND enabled=true), non-overlapping per kind
   * (the `running` set prevents concurrent execution of the same jobKind). Not
   * a full backfill — exactly one tick per missed job. Called by the boot
   * wiring after registerDefaultJobs() and before start().
   *
   * Each fired job's nextRunAt is advanced to the next scheduled run (via
   * fireJob). Jobs that are already due-but-not-missed (overdue < tick) are
   * left for the normal tick to pick up.
   */
  catchUpMissedJobs(now: number = Date.now()): { caughtUp: number; skipped: number } {
    if (!this.enabled) return { caughtUp: 0, skipped: 0 };
    const jobs = this.store.listEnabled();
    let caughtUp = 0;
    let skipped = 0;
    for (const job of jobs) {
      // Non-overlapping per kind: skip if this jobKind is already running.
      if (this.running.has(job.jobKind)) {
        skipped++;
        continue;
      }
      // Missed = nextRunAt is in the past (overdue by more than one tick).
      // The normal tick handles jobs due within the current tick window.
      const overdueMs = now - job.nextRunAt;
      if (overdueMs <= this.tickIntervalMs) {
        // Not missed — the normal tick will fire it.
        continue;
      }
      // Fire one catch-up tick for this missed job.
      logger.info("Scheduler: catch-up tick for missed job", {
        id: job.id,
        name: job.name,
        jobKind: job.jobKind,
        overdueMs,
      });
      this.fireJob(job, now);
      caughtUp++;
    }
    return { caughtUp, skipped };
  }

  /**
   * Stop the scheduler. Clears the interval. Does NOT delete job definitions.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
    logger.info("Scheduler stopped");
  }

  isRunning(): boolean {
    return this.started && this.timer !== null;
  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  /**
   * Run one scheduler tick. Evaluates all enabled jobs, fires those due, skips
   * missed runs with a warning, and reschedules. Returns a summary for logging.
   */
  async tick(now: number = Date.now()): Promise<TickResult> {
    const result: TickResult = { evaluated: 0, fired: 0, skipped: 0, errors: 0 };
    if (!this.enabled) return result;

    const jobs = this.store.listEnabled();
    result.evaluated = jobs.length;

    for (const job of jobs) {
      // Concurrency guard: skip if this jobKind is already running.
      if (this.running.has(job.jobKind)) {
        result.skipped++;
        continue;
      }

      if (job.nextRunAt > now) {
        // Not due yet.
        continue;
      }

      // Missed-run policy: if the job is overdue by more than one tick, we
      // SKIP (don't stampede) and reschedule from now. We log the skip.
      const overdueMs = now - job.nextRunAt;
      const isMissed = overdueMs > this.tickIntervalMs;
      if (isMissed) {
        logger.warn("Scheduler: missed run (skipping, rescheduling)", {
          id: job.id,
          name: job.name,
          jobKind: job.jobKind,
          overdueMs,
        });
        job.nextRunAt = this.computeNextRun(job.schedule, now);
        this.store.save(job);
        result.skipped++;
        continue;
      }

      // Concurrency cap: don't exceed maxConcurrent simultaneous fires.
      if (this.running.size >= this.maxConcurrent) {
        result.skipped++;
        continue;
      }

      // Fire the job.
      this.fireJob(job, now);
      result.fired++;
    }

    return result;
  }

  /**
   * Fire a single job: invoke its handler, update lastRunAt + nextRunAt,
   * persist. Never throws — all errors are caught and logged.
   */
  private fireJob(job: ScheduledJob, firedAt: number): void {
    const handler = this.handlers.get(job.jobKind);
    if (!handler) {
      logger.warn("Scheduler: no handler registered for jobKind", {
        id: job.id,
        jobKind: job.jobKind,
      });
      // Still advance nextRunAt so we don't spin on an unhandled job.
      job.lastRunAt = firedAt;
      job.nextRunAt = this.computeNextRun(job.schedule, firedAt);
      this.store.save(job);
      return;
    }

    this.running.add(job.jobKind);
    logger.info("Scheduler: firing job", {
      id: job.id,
      name: job.name,
      jobKind: job.jobKind,
    });

    void (async () => {
      let succeeded = false;
      let errMsg: string | null = null;
      try {
        await Promise.resolve(handler(job));
        succeeded = true;
        logger.info("Scheduler: job completed", {
          id: job.id,
          jobKind: job.jobKind,
          durationMs: Date.now() - firedAt,
        });
      } catch (e) {
        errMsg = (e as Error).message;
        logger.warn("Scheduler: job handler threw (caught)", {
          id: job.id,
          jobKind: job.jobKind,
          error: errMsg,
        });
      } finally {
        // Wave 5 FR-13: success/failure split. last_success_at updates ONLY
        // on success; consecutive_failures resets to 0 on success and
        // increments on failure. last_error captures the truncated message.
        if (succeeded) {
          job.lastSuccessAt = firedAt;
          job.consecutiveFailures = 0;
          job.lastError = null;
        } else {
          job.lastFailureAt = firedAt;
          job.consecutiveFailures = (job.consecutiveFailures ?? 0) + 1;
          // Truncate last_error to 2000 chars (avoid unbounded TEXT growth).
          job.lastError = errMsg
            ? (errMsg.length > 2000 ? errMsg.substring(0, 1997) + "..." : errMsg)
            : "unknown error";
        }
        // Update lastRunAt + nextRunAt and persist.
        job.lastRunAt = firedAt;
        job.nextRunAt = this.computeNextRun(job.schedule, firedAt);
        try {
          this.store.save(job);
        } catch (e) {
          logger.warn("Scheduler: persist after fire failed", {
            id: job.id,
            error: (e as Error).message,
          });
        }
        this.running.delete(job.jobKind);
      }
    })();
  }

  // ── Status (optional debug endpoint) ──────────────────────────────────────

  status(now: number = Date.now()): SchedulerStatus {
    const jobs = this.store.listAll();
    return {
      running: this.isRunning(),
      tickIntervalMs: this.tickIntervalMs,
      registeredHandlers: this.registeredKinds(),
      jobs: jobs.map((j) => ({
        id: j.id,
        name: j.name,
        jobKind: j.jobKind,
        enabled: j.enabled,
        nextRunAt: j.nextRunAt,
        lastRunAt: j.lastRunAt,
        due: j.enabled && j.nextRunAt <= now,
        currentlyRunning: this.running.has(j.jobKind),
      })),
    };
  }

  /** Test/debug: is a jobKind currently executing? */
  isJobRunning(jobKind: JobKind): boolean {
    return this.running.has(jobKind);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let cachedScheduler: Scheduler | null = null;

export function getScheduler(): Scheduler {
  if (!cachedScheduler) cachedScheduler = new Scheduler();
  return cachedScheduler;
}

export function resetScheduler(): void {
  if (cachedScheduler) {
    cachedScheduler.stop();
    cachedScheduler = null;
  }
  resetScheduledJobStore();
}

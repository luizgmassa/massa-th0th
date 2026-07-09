/**
 * Job Tracker for Async Indexing Operations
 * 
 * Tracks long-running indexing jobs with progress updates
 * and status polling support.
 */

import { randomUUID } from "crypto";
import { logger } from "@massa-th0th/shared";
import type { JobStore } from "./index-job-store.js";

export interface IndexJob {
  jobId: string;
  projectId: string;
  projectPath: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: {
    current: number;
    total: number;
    percentage: number;
  };
  result?: {
    filesIndexed: number;
    chunksIndexed: number;
    errors: number;
    duration: number;
  };
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  /**
   * Heartbeat timestamp: refreshed on every progress emit and when the job
   * enters `running`. Used by `reapStaleJobs` to detect a job that has hung
   * (e.g. an Ollama stall or a mid-flight crash) while the server is still
   * alive — flipping it to `failed` within the server's lifetime, instead of
   * waiting for the next process restart to recover it.
   */
  heartbeatAt?: Date;
}

/**
 * In-memory job tracker singleton
 */
export class IndexJobTracker {
  private static instance: IndexJobTracker;
  private jobs: Map<string, IndexJob> = new Map();
  private readonly MAX_JOBS = 100; // Keep last 100 jobs
  private readonly store?: JobStore;

  constructor(store?: JobStore) {
    this.store = store;
  }

  static getInstance(): IndexJobTracker {
    if (!IndexJobTracker.instance) {
      // Phase 1: wire the durable SQLite job store (with crash recovery on
      // first open). Falls back to in-memory only if construction throws.
      let store: JobStore | undefined;
      try {
        const { getJobStore } = require("./index-job-store.js") as {
          getJobStore: () => JobStore;
        };
        store = getJobStore();
      } catch {
        store = undefined;
      }
      IndexJobTracker.instance = new IndexJobTracker(store);
    }
    return IndexJobTracker.instance;
  }

  /**
   * Create a new indexing job
   */
  createJob(projectId: string, projectPath: string): IndexJob {
    const jobId = randomUUID();

    const job: IndexJob = {
      jobId,
      projectId,
      projectPath,
      status: "pending",
      progress: {
        current: 0,
        total: 0,
        percentage: 0,
      },
      createdAt: new Date(),
    };

    this.jobs.set(jobId, job);
    this.cleanupOldJobs();
    try { this.store?.save(job); } catch { /* best-effort */ }
    return job;
  }

  /**
   * Get job by ID. Phase 1: lazy-loads from the durable store on a hot miss.
   */
  getJob(jobId: string): IndexJob | undefined {
    const cached = this.jobs.get(jobId);
    if (cached) return cached;
    if (this.store) {
      try {
        const loaded = this.store.get(jobId);
        if (loaded) {
          this.jobs.set(jobId, loaded);
          return loaded;
        }
      } catch { /* best-effort */ }
    }
    return undefined;
  }

  /**
   * Update job status
   */
  updateStatus(jobId: string, status: IndexJob["status"]): void {
    const job = this.jobs.get(jobId) ?? this.getJob(jobId);
    if (!job) return;

    job.status = status;

    if (status === "running") {
      if (!job.startedAt) job.startedAt = new Date();
      // Seed the heartbeat the moment a job enters `running` so the reaper has
      // a baseline before the first progress emit.
      job.heartbeatAt = new Date();
    }

    if (status === "completed" || status === "failed") {
      job.completedAt = new Date();
    }
    try { this.store?.save(job); } catch { /* best-effort */ }
  }

  /**
   * Update job progress. Piggybacks the heartbeat: every progress emit refreshes
   * `heartbeatAt`, which is what `reapStaleJobs` checks. This keeps a healthy
   * (actively-progressing) job from ever being reaped while catching jobs whose
   * progress has gone silent.
   */
  updateProgress(jobId: string, current: number, total: number): void {
    const job = this.jobs.get(jobId) ?? this.getJob(jobId);
    if (!job) return;

    job.progress = {
      current,
      total,
      percentage: total > 0 ? Math.round((current / total) * 100) : 0,
    };
    job.heartbeatAt = new Date();
    try { this.store?.save(job); } catch { /* best-effort */ }
  }

  /**
   * Tick ONLY the heartbeat (no progress change). Use when you want to signal
   * "still alive" between progress emits (e.g. a long single-file parse that
   * doesn't increment the file counter).
   */
  heartbeat(jobId: string): void {
    const job = this.jobs.get(jobId) ?? this.getJob(jobId);
    if (!job) return;
    job.heartbeatAt = new Date();
    try { this.store?.save(job); } catch { /* best-effort */ }
  }

  /**
   * Reap stale `running` jobs: flip any job whose heartbeat is older than
   * `staleMs` (or, as a fallback for jobs with no heartbeat, whose `startedAt`
   * is older than `staleMs`) to `failed`. Covers the case where a job hangs or
   * crashes mid-flight while the server keeps running — the existing
   * restart-time `markStaleRunningFailed` only fires on the NEXT process start,
   * which never happens during a long-lived test suite.
   *
   * Returns the count of reaped jobs.
   */
  reapStaleJobs(staleMs: number): number {
    if (!this.store) return 0;
    let running: IndexJob[] = [];
    try {
      running = this.store.listRunning();
    } catch {
      return 0;
    }
    if (running.length === 0) return 0;

    const now = Date.now();
    const cutoff = now - staleMs;
    let reaped = 0;
    for (const job of running) {
      const hbMs = job.heartbeatAt?.getTime();
      const startedMs = job.startedAt?.getTime();
      // Stale if heartbeat is older than the cutoff. Fallback for jobs with no
      // heartbeat yet: stale if startedAt is older than the cutoff (covers the
      // theoretical window between createJob and the first running/heartbeat).
      const stale =
        (hbMs != null && hbMs < cutoff) ||
        (hbMs == null && startedMs != null && startedMs < cutoff);
      if (!stale) continue;

      logger.warn(
        `indexJobTracker: reaping stale running job ${job.jobId} (heartbeatAt=${job.heartbeatAt?.toISOString() ?? "n/a"}, startedAt=${job.startedAt?.toISOString() ?? "n/a"}, staleMs=${staleMs})`,
        { jobId: job.jobId, projectId: job.projectId, staleMs },
      );
      // Promote into the hot cache so setResult mutates the same object the
      // next getJob() will return, then flip to failed with a clear cause.
      this.jobs.set(job.jobId, job);
      this.setResult(job.jobId, undefined, "heartbeat stale (possible crash/OOM)");
      reaped++;
    }
    return reaped;
  }

  /**
   * Set job result on completion
   */
  setResult(
    jobId: string,
    result: IndexJob["result"],
    error?: string
  ): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    if (error) {
      job.status = "failed";
      job.error = error;
    } else {
      job.status = "completed";
      job.result = result;
    }

    job.completedAt = new Date();
    try {
      this.store?.save(job);
    } catch (err) {
      // Surfacing (not rethrowing): a silent catch here hides the fact that
      // the durable job store never recorded completion, so a caller polling
      // via the durable path would see the job stuck in "running".
      logger.warn(
        `indexJobTracker: job store write failed for ${jobId} on setResult`,
        { jobId, error: (err as Error)?.message ?? String(err) },
      );
    }
  }

  /**
   * List all jobs (for debugging/monitoring)
   */
  listJobs(): IndexJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  /**
   * List jobs by project
   */
  listJobsByProject(projectId: string): IndexJob[] {
    return this.listJobs().filter((job) => job.projectId === projectId);
  }

  /**
   * Clean up old jobs (keep last MAX_JOBS).
   *
   * Never evict a non-terminal (pending/running) job: a long-running
   * full-repo index can be dropped before the caller polls, making the job
   * appear to never reach a terminal state. Only terminal (completed/failed)
   * jobs are evictable; the oldest terminal job is dropped first. If the cap
   * can only be met by dropping a non-terminal job (pathological case: more
   * than MAX_JOBS in-flight jobs at once), the OLDEST non-terminal job is
   * dropped as an absolute last resort with a warning.
   */
  private cleanupOldJobs(): void {
    const jobs = this.listJobs(); // newest-first by createdAt
    if (jobs.length <= this.MAX_JOBS) return;

    const isTerminal = (j: IndexJob) =>
      j.status === "completed" || j.status === "failed";

    // Drop oldest terminal jobs first (jobs is newest-first → last = oldest).
    const terminalOld = jobs
      .filter(isTerminal)
      .slice(this.MAX_JOBS) // beyond the cap, oldest terminal first
      .reverse(); // oldest-first for readability of eviction order
    for (const job of terminalOld) {
      this.jobs.delete(job.jobId);
    }

    // Recompute; if still over cap, evict oldest non-terminal as last resort.
    if (this.jobs.size > this.MAX_JOBS) {
      const remaining = this.listJobs();
      const survivors = remaining.slice(0, this.MAX_JOBS);
      const overflow = remaining.slice(this.MAX_JOBS); // oldest non-terminal
      for (const job of overflow) {
        logger.warn(
          `indexJobTracker: evicting non-terminal job ${job.jobId} (status=${job.status}) to honor MAX_JOBS cap — caller may lose visibility`,
          { jobId: job.jobId, projectId: job.projectId, status: job.status },
        );
        this.jobs.delete(job.jobId);
      }
      void survivors; // survivors remain in this.jobs untouched
    }
  }

  /**
   * Clear all jobs (for testing)
   */
  clear(): void {
    this.jobs.clear();
  }
}

// Export singleton instance
export const indexJobTracker = IndexJobTracker.getInstance();

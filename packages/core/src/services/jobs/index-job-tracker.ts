/**
 * Job Tracker for Async Indexing Operations
 * 
 * Tracks long-running indexing jobs with progress updates
 * and status polling support.
 */

import { randomUUID } from "crypto";
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

    if (status === "running" && !job.startedAt) {
      job.startedAt = new Date();
    }

    if (status === "completed" || status === "failed") {
      job.completedAt = new Date();
    }
    try { this.store?.save(job); } catch { /* best-effort */ }
  }

  /**
   * Update job progress
   */
  updateProgress(jobId: string, current: number, total: number): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.progress = {
      current,
      total,
      percentage: total > 0 ? Math.round((current / total) * 100) : 0,
    };
    try { this.store?.save(job); } catch { /* best-effort */ }
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
    try { this.store?.save(job); } catch { /* best-effort */ }
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
   * Clean up old completed jobs (keep last MAX_JOBS)
   */
  private cleanupOldJobs(): void {
    const jobs = this.listJobs();
    
    if (jobs.length > this.MAX_JOBS) {
      const toRemove = jobs.slice(this.MAX_JOBS);
      toRemove.forEach((job) => this.jobs.delete(job.jobId));
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

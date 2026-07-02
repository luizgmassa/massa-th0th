/**
 * SqliteJobStore — durable persistence for indexing jobs (Phase 1).
 *
 * Borrows ai-memory's writer/reader discipline: the in-memory Map in
 * IndexJobTracker stays the hot cache, and this write-through store persists
 * job state so a process restart can recover (stale `running` jobs are marked
 * `failed` on init) and recently-completed jobs remain queryable.
 *
 * Backend: SQLite-canonical (jobs are runtime state, not analytics).
 */

import { config, logger } from "@th0th-ai/shared";
import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";
import type { IndexJob } from "./index-job-tracker.js";

export interface JobStore {
  save(job: IndexJob): void;
  get(jobId: string): IndexJob | null;
  listByProject(projectId: string): IndexJob[];
  listAll(): IndexJob[];
  /** Crash recovery: mark stale `running` jobs as `failed`. */
  markStaleRunningFailed(): number;
  delete(jobId: string): void;
}

interface JobRow {
  job_id: string;
  project_id: string;
  project_path: string;
  status: string;
  current: number;
  total: number;
  percentage: number;
  files_indexed: number | null;
  chunks_indexed: number | null;
  errors: number | null;
  duration: number | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

function rowToJob(r: JobRow): IndexJob {
  return {
    jobId: r.job_id,
    projectId: r.project_id,
    projectPath: r.project_path,
    status: r.status as IndexJob["status"],
    progress: { current: r.current, total: r.total, percentage: r.percentage },
    result:
      r.files_indexed != null
        ? {
            filesIndexed: r.files_indexed,
            chunksIndexed: r.chunks_indexed ?? 0,
            errors: r.errors ?? 0,
            duration: r.duration ?? 0,
          }
        : undefined,
    error: r.error ?? undefined,
    createdAt: new Date(r.created_at),
    startedAt: r.started_at != null ? new Date(r.started_at) : undefined,
    completedAt: r.completed_at != null ? new Date(r.completed_at) : undefined,
  };
}

export class SqliteJobStore implements JobStore {
  private db: Database | null = null;
  private dbPath: string;
  private recovered = false;

  constructor(dbPath?: string) {
    const dataDir = config.get("dataDir") as string;
    this.dbPath = dbPath ?? path.join(dataDir, "index-jobs.db");
  }

  private getDB(): Database {
    if (this.db) return this.db;
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.exec("PRAGMA busy_timeout = 3000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS index_jobs (
        job_id       TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL,
        project_path TEXT NOT NULL,
        status       TEXT NOT NULL,
        current      INTEGER NOT NULL DEFAULT 0,
        total        INTEGER NOT NULL DEFAULT 0,
        percentage   INTEGER NOT NULL DEFAULT 0,
        files_indexed INTEGER,
        chunks_indexed INTEGER,
        errors       INTEGER,
        duration     INTEGER,
        error        TEXT,
        created_at   INTEGER NOT NULL,
        started_at   INTEGER,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_project ON index_jobs(project_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON index_jobs(status);
    `);
    // Crash recovery: run once on first open.
    if (!this.recovered) {
      this.db
        .prepare(
          `UPDATE index_jobs SET status = 'failed', error = 'process restart', completed_at = ?
           WHERE status = 'running'`,
        )
        .run(Date.now());
      this.recovered = true;
    }
    logger.info("SqliteJobStore initialized", { dbPath: this.dbPath });
    return this.db;
  }

  save(job: IndexJob): void {
    try {
      const db = this.getDB();
      db.prepare(
        `INSERT INTO index_jobs (
          job_id, project_id, project_path, status, current, total, percentage,
          files_indexed, chunks_indexed, errors, duration, error,
          created_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          status = excluded.status,
          current = excluded.current,
          total = excluded.total,
          percentage = excluded.percentage,
          files_indexed = excluded.files_indexed,
          chunks_indexed = excluded.chunks_indexed,
          errors = excluded.errors,
          duration = excluded.duration,
          error = excluded.error,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at`,
      ).run(
        job.jobId,
        job.projectId,
        job.projectPath,
        job.status,
        job.progress.current,
        job.progress.total,
        job.progress.percentage,
        job.result?.filesIndexed ?? null,
        job.result?.chunksIndexed ?? null,
        job.result?.errors ?? null,
        job.result?.duration ?? null,
        job.error ?? null,
        job.createdAt.getTime(),
        job.startedAt?.getTime() ?? null,
        job.completedAt?.getTime() ?? null,
      );
    } catch (e) {
      logger.warn("JobStore.save failed (best-effort)", {
        jobId: job.jobId, error: (e as Error).message,
      });
    }
  }

  get(jobId: string): IndexJob | null {
    try {
      const db = this.getDB();
      const row = db.prepare(`SELECT * FROM index_jobs WHERE job_id = ?`).get(jobId) as JobRow | null;
      return row ? rowToJob(row) : null;
    } catch {
      return null;
    }
  }

  listByProject(projectId: string): IndexJob[] {
    try {
      const db = this.getDB();
      const rows = db
        .prepare(`SELECT * FROM index_jobs WHERE project_id = ? ORDER BY created_at DESC`)
        .all(projectId) as JobRow[];
      return rows.map(rowToJob);
    } catch {
      return [];
    }
  }

  listAll(): IndexJob[] {
    try {
      const db = this.getDB();
      const rows = db
        .prepare(`SELECT * FROM index_jobs ORDER BY created_at DESC`)
        .all() as JobRow[];
      return rows.map(rowToJob);
    } catch {
      return [];
    }
  }

  markStaleRunningFailed(): number {
    try {
      const db = this.getDB();
      const result = db
        .prepare(
          `UPDATE index_jobs
           SET status = 'failed', error = 'process restart', completed_at = ?
           WHERE status = 'running'`,
        )
        .run(Date.now());
      if (result.changes > 0) {
        logger.info("JobStore crash recovery", { staleRunningFailed: result.changes });
      }
      return result.changes;
    } catch {
      return 0;
    }
  }

  delete(jobId: string): void {
    try {
      this.getDB().prepare(`DELETE FROM index_jobs WHERE job_id = ?`).run(jobId);
    } catch { /* best-effort */ }
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

let cachedStore: JobStore | null = null;

export function getJobStore(): JobStore {
  if (cachedStore) return cachedStore;
  try {
    cachedStore = new SqliteJobStore();
  } catch (e) {
    logger.warn("SqliteJobStore unavailable — using no-op job store", {
      error: (e as Error).message,
    });
    cachedStore = new NoopJobStore();
  }
  return cachedStore;
}

export function resetJobStore(): void {
  cachedStore = null;
}

class NoopJobStore implements JobStore {
  save(): void {}
  get(): IndexJob | null { return null; }
  listByProject(): IndexJob[] { return []; }
  listAll(): IndexJob[] { return []; }
  markStaleRunningFailed(): number { return 0; }
  delete(): void {}
}

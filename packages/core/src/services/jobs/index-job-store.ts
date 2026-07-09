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

import { config, logger } from "@massa-th0th/shared";
import { parsePositiveIntEnv } from "@massa-th0th/shared/config";
import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";
import type { IndexJob } from "./index-job-tracker.js";

export interface JobStore {
  save(job: IndexJob): void;
  get(jobId: string): IndexJob | null;
  listByProject(projectId: string): IndexJob[];
  listAll(): IndexJob[];
  /** List all jobs currently in `running` status (for the stale-job reaper). */
  listRunning(): IndexJob[];
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
  heartbeat_at: number | null;
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
    heartbeatAt: r.heartbeat_at != null ? new Date(r.heartbeat_at) : undefined,
  };
}

export class SqliteJobStore implements JobStore {
  private db: Database | null = null;
  private dbPath: string;
  private recovered = false;

  /**
   * Stale-heartbeat cutoff (ms-epoch): running jobs whose
   * `COALESCE(heartbeat_at, started_at)` is older than this are considered
   * stale (crashed / orphaned) and may be flipped to `failed`. Parity with
   * PgJobStore: sourced from MASSA_TH0TH_JOB_STALE_MS (default 300000).
   */
  private staleHeartbeatCutoffMs(now: number = Date.now()): number {
    const staleMs = parsePositiveIntEnv(
      process.env.MASSA_TH0TH_JOB_STALE_MS,
      300_000,
    );
    return now - staleMs;
  }

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
        completed_at INTEGER,
        heartbeat_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_project ON index_jobs(project_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON index_jobs(status);
    `);
    // Idempotent migration: add heartbeat_at to pre-existing DB files.
    // SQLite has no ADD COLUMN IF NOT EXISTS, so wrap and ignore the
    // "duplicate column name" error on DBs that already have the column.
    try {
      this.db.exec(`ALTER TABLE index_jobs ADD COLUMN heartbeat_at INTEGER`);
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      if (!msg.includes("duplicate column name")) throw e;
    }
    // Crash recovery: run once on first open. Only flip running jobs whose
    // heartbeat (or started_at fallback) is older than the stale threshold —
    // parity with PgJobStore. Single-process SQLite is low-risk, but matching
    // the predicate keeps the two backends behaviorally identical.
    if (!this.recovered) {
      const now = Date.now();
      const cutoff = this.staleHeartbeatCutoffMs(now);
      this.db
        .prepare(
          `UPDATE index_jobs SET status = 'failed', error = 'process restart', completed_at = ?
           WHERE status = 'running'
             AND COALESCE(heartbeat_at, started_at) IS NOT NULL
             AND COALESCE(heartbeat_at, started_at) < ?`,
        )
        .run(now, cutoff);
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
          created_at, started_at, completed_at, heartbeat_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          completed_at = excluded.completed_at,
          heartbeat_at = excluded.heartbeat_at`,
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
        job.heartbeatAt?.getTime() ?? null,
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

  listRunning(): IndexJob[] {
    try {
      const db = this.getDB();
      const rows = db
        .prepare(`SELECT * FROM index_jobs WHERE status = 'running'`)
        .all() as JobRow[];
      return rows.map(rowToJob);
    } catch {
      return [];
    }
  }

  markStaleRunningFailed(): number {
    try {
      const db = this.getDB();
      const now = Date.now();
      const cutoff = this.staleHeartbeatCutoffMs(now);
      const result = db
        .prepare(
          `UPDATE index_jobs
           SET status = 'failed', error = 'process restart', completed_at = ?
           WHERE status = 'running'
             AND COALESCE(heartbeat_at, started_at) IS NOT NULL
             AND COALESCE(heartbeat_at, started_at) < ?`,
        )
        .run(now, cutoff);
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
  const databaseUrl = process.env.DATABASE_URL;
  const isPostgres =
    databaseUrl?.startsWith("postgresql://") ||
    databaseUrl?.startsWith("postgres://");
  try {
    // One-backend rule: follow DATABASE_URL the same way the memory / symbol /
    // vector factories do. Postgres → PgJobStore (jobs in the same DB as the
    // data plane); otherwise SQLite-canonical (index-jobs.db).
    if (isPostgres) {
      const { PgJobStore } = require("./index-job-store-pg.js") as {
        PgJobStore: new () => JobStore;
      };
      cachedStore = new PgJobStore();
      logger.info("Using PostgreSQL JobStore");
    } else {
      cachedStore = new SqliteJobStore();
    }
  } catch (e) {
    logger.warn("JobStore unavailable — using no-op job store", {
      backend: isPostgres ? "postgres" : "sqlite",
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
  listRunning(): IndexJob[] { return []; }
  markStaleRunningFailed(): number { return 0; }
  delete(): void {}
}

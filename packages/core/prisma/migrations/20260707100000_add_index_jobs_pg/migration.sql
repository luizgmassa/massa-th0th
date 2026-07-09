-- Index Jobs (Phase 1, T9): PG parity for the durable job store.
-- The SQLite store (SqliteJobStore / index-jobs.db) is the local-first default;
-- this table lets a Postgres deployment keep indexing-job runtime state in the
-- SAME backend as the rest of the data plane (one-backend rule).
-- Timestamps are BIGINT ms-epochs (parity with the SQLite store's INTEGER epoch
-- columns and SymbolFile.mtime). Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS "index_jobs" (
    "job_id"        TEXT NOT NULL,
    "project_id"    TEXT NOT NULL,
    "project_path"  TEXT NOT NULL,
    "status"        TEXT NOT NULL,
    "current"       INTEGER NOT NULL DEFAULT 0,
    "total"         INTEGER NOT NULL DEFAULT 0,
    "percentage"    INTEGER NOT NULL DEFAULT 0,
    "files_indexed" INTEGER,
    "chunks_indexed" INTEGER,
    "errors"        INTEGER,
    "duration"      INTEGER,
    "error"         TEXT,
    "created_at"    BIGINT NOT NULL,
    "started_at"    BIGINT,
    "completed_at"  BIGINT,
    "heartbeat_at"  BIGINT,
    CONSTRAINT "index_jobs_pkey" PRIMARY KEY ("job_id")
);

CREATE INDEX IF NOT EXISTS "index_jobs_project_id_idx" ON "index_jobs"("project_id");
CREATE INDEX IF NOT EXISTS "index_jobs_status_idx" ON "index_jobs"("status");

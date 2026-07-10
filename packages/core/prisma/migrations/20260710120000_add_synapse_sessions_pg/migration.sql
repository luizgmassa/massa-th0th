-- Synapse Sessions (Phase 3, C4): PG parity for the Synapse session store.
-- The SQLite store (SqliteSessionStore / synapse-sessions.db) is the
-- local-first default; these tables let a Postgres deployment persist Synapse
-- agent-session + working-memory buffer state across process restarts
-- (one-backend rule). Timestamps are BIGINT ms-epochs (parity with the SQLite
-- store's INTEGER epoch columns and IndexJob/ScheduledJob). Idempotent — safe
-- to re-run.

CREATE TABLE IF NOT EXISTS "synapse_sessions" (
    "session_id"            TEXT NOT NULL,
    "agent_id"              TEXT NOT NULL,
    "workspace_id"          TEXT,
    "task_context"          TEXT,
    "task_tokens"           TEXT,
    "task_embedding"        BYTEA,
    "ttl_ms"                BIGINT NOT NULL,
    "created_at"            BIGINT NOT NULL,
    "expires_at"            BIGINT NOT NULL,
    "access_history_limit"  INTEGER NOT NULL,
    "buffer_config"         TEXT,
    "buffer_snapshot"       TEXT,
    "updated_at"            BIGINT NOT NULL,
    CONSTRAINT "synapse_sessions_pkey" PRIMARY KEY ("session_id")
);

CREATE INDEX IF NOT EXISTS "synapse_sessions_expires_at_idx" ON "synapse_sessions"("expires_at");

CREATE TABLE IF NOT EXISTS "synapse_access_history" (
    "session_id"        TEXT NOT NULL,
    "memory_id"         TEXT NOT NULL,
    "access_count"      INTEGER NOT NULL DEFAULT 0,
    "last_accessed_at"  BIGINT NOT NULL,
    CONSTRAINT "synapse_access_history_pkey" PRIMARY KEY ("session_id", "memory_id")
);

CREATE INDEX IF NOT EXISTS "synapse_access_history_session_id_idx" ON "synapse_access_history"("session_id");

-- Phase 3, C4: SQLite parity marker for Synapse session persistence.
-- The SqliteSessionStore creates these tables inline (CREATE TABLE IF NOT
-- EXISTS in session-store.ts createSchema()) against its own DB file
-- (synapse-sessions.db). This migration documents the canonical SQLite schema
-- for parity with the PG migration (20260710120000_add_synapse_sessions_pg)
-- and is safe to re-run. It is a no-op when run against an existing
-- synapse-sessions.db because the store already created the tables on first
-- open; it exists so a fresh local-first deployment's schema is reproducible
-- from the migrations directory alone.

CREATE TABLE IF NOT EXISTS synapse_sessions (
  session_id   TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL,
  workspace_id TEXT,
  task_context TEXT,
  task_tokens  TEXT,
  task_embedding BLOB,
  ttl_ms       INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  access_history_limit INTEGER NOT NULL,
  buffer_config TEXT,
  buffer_snapshot TEXT,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_syn_sessions_expires ON synapse_sessions(expires_at);

CREATE TABLE IF NOT EXISTS synapse_access_history (
  session_id TEXT NOT NULL,
  memory_id  TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, memory_id)
);
CREATE INDEX IF NOT EXISTS idx_syn_access_session ON synapse_access_history(session_id);

-- Phase 3, C1: Add derived `category` column to observations.
-- The category is a semantic classification (~30 categories: files-read,
-- git-changes, tasks, errors, decisions, etc.) derived from (source, payload)
-- by ObservationExtractor. It is additive and nullable for backward compat:
-- legacy rows have NULL category and fall back to "lifecycle-raw" in code.

-- SQLite ALTER TABLE ADD COLUMN is safe (no table rebuild) for nullable columns.
ALTER TABLE observations ADD COLUMN category TEXT;

-- Composite index for session-scoped queries (newest-first), used by the
-- compaction snapshot builder to list a session's observations.
CREATE INDEX IF NOT EXISTS idx_obs_session_created ON observations(session_id, created_at DESC);

-- Wave 5 M-W5-02 — scheduler last_success_at + crash-safe catch-up (FR-13)
--
-- Additive nullable columns on scheduled_jobs so the scheduler can split
-- success/failure state (currently only last_run_at, written unconditionally).
--
-- last_success_at  BIGINT?  — ms-epoch of the last SUCCESSFUL run (NULL until
--                             the first success; resets the "stale since" signal).
-- last_failure_at  BIGINT?  — ms-epoch of the last FAILED run (NULL until the
--                             first failure).
-- consecutive_failures INT NOT NULL DEFAULT 0 — failure streak counter.
--                             Reset to 0 on success; incremented on failure.
-- last_error       TEXT?    — truncated error message from the last failure
--                             (NULL when the last run succeeded).
--
-- NULL-safe: existing rows get NULL for the timestamp columns and 0 for the
-- counter. No data migration needed — the columns are additive. The scheduler
-- (T20) updates success→last_success_at + consecutive_failures=0, failure→
-- last_failure_at + consecutive_failures++ + last_error (truncated).

ALTER TABLE "scheduled_jobs"
  ADD COLUMN IF NOT EXISTS "last_success_at" BIGINT,
  ADD COLUMN IF NOT EXISTS "last_failure_at" BIGINT,
  ADD COLUMN IF NOT EXISTS "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_error" TEXT;
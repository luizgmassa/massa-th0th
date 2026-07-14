ALTER TABLE index_jobs
  ADD COLUMN IF NOT EXISTS parser_diagnostics_count INTEGER,
  ADD COLUMN IF NOT EXISTS parser_recovered_files INTEGER,
  ADD COLUMN IF NOT EXISTS parser_hard_failure_files INTEGER,
  ADD COLUMN IF NOT EXISTS parser_stale_files INTEGER,
  ADD COLUMN IF NOT EXISTS parser_language_counts JSONB;

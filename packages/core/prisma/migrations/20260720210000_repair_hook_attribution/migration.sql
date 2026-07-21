-- Hook Attribution Repair (M45+M47 / HAR-08)
--
-- One-shot, idempotent repair of historical hook-attribution drift: rows whose
-- project_id is 'default' or no longer a live (or alias-target) workspace are
-- re-derived from their payload cwd via path-deduplicated containment, and
-- memories are re-derived via unambiguous session linkage. Broad root '/' and
-- roots shared by more than one project_id are excluded so only UNAMBIGUOUS
-- matches are applied. The pre-repair project id is preserved inside
-- payload_json / metadata so the change is reversible.
--
-- Idempotent: repaired rows carry attribution_source='repaired' and a live
-- project_id, so the candidate predicate excludes them on re-run. The DO $$
-- block self-verifies the post-state and raises if any repaired id is not live
-- or any pre-repair id was not preserved.
--
-- NULL-safety: every "unknown id" test uses NOT EXISTS over the live/alias set,
-- never NOT IN over a nullable subquery.

BEGIN;

-- ---------------------------------------------------------------------------
-- Live id set (workspace + alias target). Targets are FK-bound to workspaces,
-- so the UNION is belt-and-suspenders for the "live-or-alias" language.
-- ---------------------------------------------------------------------------

-- (inlined per query; no temp/view to keep the migration self-contained)

-- ---------------------------------------------------------------------------
-- 1. Observation repair: re-derive project_id from payload.cwd via containment
--    against path-deduplicated, unambiguous live roots (broad '/' excluded).
-- ---------------------------------------------------------------------------

WITH roots AS (
  SELECT project_path, project_id
  FROM workspaces
  WHERE project_path IS NOT NULL
    AND project_path <> '/'
    AND project_path <> ''
),
-- A path shared by >1 project_id is ambiguous at the containment tier and is
-- excluded. (Self-match is an explicit-tier concern; repair has no caller id.)
path_count AS (
  SELECT project_path, COUNT(DISTINCT project_id) AS n
  FROM roots
  GROUP BY project_path
),
deduped AS (
  SELECT r.project_path, r.project_id
  FROM roots r
  JOIN path_count pc ON pc.project_path = r.project_path
  WHERE pc.n = 1
),
candidates AS (
  SELECT
    o.id,
    o.project_id AS old_id,
    (o.payload_json::jsonb)->>'cwd' AS cwd
  FROM observations o
  WHERE (o.payload_json::jsonb)->>'cwd' IS NOT NULL
    -- Never touch rows already repaired (preserves _pre_repair_project_id).
    AND o.attribution_source IS DISTINCT FROM 'repaired'
    AND (
      o.project_id = 'default'
      OR NOT EXISTS (
        SELECT 1 FROM workspaces w WHERE w.project_id = o.project_id
        UNION ALL
        SELECT 1 FROM project_identity_aliases a WHERE a.target_project_id = o.project_id
      )
    )
),
matches AS (
  SELECT
    c.id,
    c.old_id,
    c.cwd,
    d.project_id AS new_id,
    length(d.project_path) AS plen
  FROM candidates c
  JOIN deduped d
    ON c.cwd = d.project_path OR starts_with(c.cwd, d.project_path || '/')
),
-- rn = longest match per candidate; tie = how many distinct paths share that
-- candidate's longest length. rn=1 AND tie=1 ⇒ unambiguous longest match.
ranked AS (
  SELECT
    id,
    old_id,
    new_id,
    plen,
    ROW_NUMBER() OVER (PARTITION BY id ORDER BY plen DESC) AS rn,
    COUNT(*) OVER (PARTITION BY id, plen) AS tie
  FROM matches
),
winners AS (
  SELECT id, old_id, new_id
  FROM ranked
  WHERE rn = 1 AND tie = 1
)
UPDATE observations
SET
  project_id = winners.new_id,
  attribution_source = 'repaired',
  payload_json = jsonb_set(
    payload_json::jsonb,
    '{_pre_repair_project_id}',
    to_jsonb(winners.old_id),
    true
  )::text
FROM winners
WHERE observations.id = winners.id;

-- ---------------------------------------------------------------------------
-- 2. Memory repair: re-derive via UNAMBIGUOUS session linkage — a memory's
--    session must yield exactly one distinct live-or-repaired project id across
--    its observations.
-- ---------------------------------------------------------------------------

WITH mem_candidates AS (
  SELECT
    m.id,
    m.project_id AS old_id,
    m.session_id
  FROM memories m
  WHERE m.session_id IS NOT NULL
    AND (m.metadata IS NULL OR NOT (m.metadata::jsonb ? '_pre_repair_project_id'))
    AND (
      m.project_id IS NULL
      OR m.project_id = 'default'
      OR NOT EXISTS (
        SELECT 1 FROM workspaces w WHERE w.project_id = m.project_id
        UNION ALL
        SELECT 1 FROM project_identity_aliases a WHERE a.target_project_id = m.project_id
      )
    )
),
-- Distinct (session, project) targets observed to be live or repaired.
session_targets AS (
  SELECT o.session_id, o.project_id
  FROM observations o
  WHERE o.session_id IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM workspaces w WHERE w.project_id = o.project_id)
      OR o.attribution_source = 'repaired'
    )
  GROUP BY o.session_id, o.project_id
),
unambiguous AS (
  SELECT session_id
  FROM session_targets
  GROUP BY session_id
  HAVING COUNT(DISTINCT project_id) = 1
),
winners AS (
  SELECT
    mc.id,
    mc.old_id,
    st.project_id AS new_id
  FROM mem_candidates mc
  JOIN unambiguous u ON u.session_id = mc.session_id
  JOIN session_targets st ON st.session_id = mc.session_id
)
UPDATE memories
SET
  project_id = winners.new_id,
  metadata = jsonb_set(
    COALESCE(memories.metadata::jsonb, '{}'::jsonb),
    '{_pre_repair_project_id}',
    COALESCE(to_jsonb(winners.old_id), 'null'::jsonb),
    true
  )::text
FROM winners
WHERE memories.id = winners.id;

-- ---------------------------------------------------------------------------
-- 3. Self-verification: every repaired id is live; every pre-repair id was
--    preserved. Counts surface the unrepairable residue (ambiguous / no cwd).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  n_obs_repaired    int;
  n_obs_remaining   int;
  n_mem_repaired    int;
  n_mem_remaining   int;
BEGIN
  SELECT count(*) INTO n_obs_repaired
  FROM observations WHERE attribution_source = 'repaired';

  SELECT count(*) INTO n_obs_remaining
  FROM observations o
  WHERE o.attribution_source IS DISTINCT FROM 'repaired'
    AND (
      o.project_id = 'default'
      OR NOT EXISTS (
        SELECT 1 FROM workspaces w WHERE w.project_id = o.project_id
        UNION ALL
        SELECT 1 FROM project_identity_aliases a WHERE a.target_project_id = o.project_id
      )
    );

  SELECT count(*) INTO n_mem_repaired
  FROM memories m
  WHERE m.metadata IS NOT NULL AND m.metadata::jsonb ? '_pre_repair_project_id';

  SELECT count(*) INTO n_mem_remaining
  FROM memories m
  WHERE (m.metadata IS NULL OR NOT (m.metadata::jsonb ? '_pre_repair_project_id'))
    AND (
      m.project_id IS NULL
      OR m.project_id = 'default'
      OR NOT EXISTS (
        SELECT 1 FROM workspaces w WHERE w.project_id = m.project_id
        UNION ALL
        SELECT 1 FROM project_identity_aliases a WHERE a.target_project_id = m.project_id
      )
    );

  RAISE NOTICE 'hook_attribution_repair: observations repaired=% remaining=%',
    n_obs_repaired, n_obs_remaining;
  RAISE NOTICE 'hook_attribution_repair: memories repaired=% remaining=%',
    n_mem_repaired, n_mem_remaining;

  -- Invariant 1: every repaired observation points at a live workspace.
  IF EXISTS (
    SELECT 1 FROM observations o
    WHERE o.attribution_source = 'repaired'
      AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.project_id = o.project_id)
  ) THEN
    RAISE EXCEPTION 'hook_attribution_repair_observation_non_live';
  END IF;

  -- Invariant 2: every repaired observation preserved its pre-repair id.
  IF EXISTS (
    SELECT 1 FROM observations o
    WHERE o.attribution_source = 'repaired'
      AND NOT ((o.payload_json::jsonb) ? '_pre_repair_project_id')
  ) THEN
    RAISE EXCEPTION 'hook_attribution_repair_observation_missing_pre_repair';
  END IF;

  -- Invariant 3: every repaired memory points at a live workspace.
  IF EXISTS (
    SELECT 1 FROM memories m
    WHERE m.metadata IS NOT NULL
      AND m.metadata::jsonb ? '_pre_repair_project_id'
      AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.project_id = m.project_id)
  ) THEN
    RAISE EXCEPTION 'hook_attribution_repair_memory_non_live';
  END IF;

  -- (Unrepairable residue — ambiguous paths, multi-id sessions, rows with no
  -- cwd — is contract-legal and reported via the NOTICE counts above, not an
  -- error. There is no further structural invariant to check.)
END $$;

COMMIT;

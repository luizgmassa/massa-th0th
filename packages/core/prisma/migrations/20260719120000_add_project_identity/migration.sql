BEGIN;

CREATE TABLE "project_identity_aliases" (
  "retired_project_id" TEXT PRIMARY KEY,
  "target_project_id" TEXT NOT NULL,
  "canonical_root" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "project_identity_aliases_distinct_check"
    CHECK ("retired_project_id" <> "target_project_id"),
  CONSTRAINT "project_identity_aliases_target_fkey"
    FOREIGN KEY ("target_project_id") REFERENCES "workspaces"("project_id")
    ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX "project_identity_aliases_target_project_id_idx"
  ON "project_identity_aliases" ("target_project_id");

CREATE TABLE "project_identity_operations" (
  "operation_id" TEXT PRIMARY KEY,
  "mode" TEXT NOT NULL,
  "source_project_id" TEXT NOT NULL,
  "target_project_id" TEXT NOT NULL,
  "source_canonical_root" TEXT NOT NULL,
  "target_canonical_root" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "plan_hash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "committed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "project_identity_operations_mode_check"
    CHECK ("mode" IN ('rename', 'merge')),
  CONSTRAINT "project_identity_operations_distinct_check"
    CHECK ("source_project_id" <> "target_project_id"),
  CONSTRAINT "project_identity_operations_request_hash_check"
    CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "project_identity_operations_plan_hash_check"
    CHECK ("plan_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "project_identity_operations_result_check"
    CHECK (jsonb_typeof("result") = 'object')
);

ALTER TABLE "project_identity_aliases"
  ADD CONSTRAINT "project_identity_aliases_operation_id_fkey"
    FOREIGN KEY ("operation_id")
    REFERENCES "project_identity_operations"("operation_id")
    ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "project_identity_operations_source_project_id_idx"
  ON "project_identity_operations" ("source_project_id");
CREATE INDEX "project_identity_operations_target_project_id_idx"
  ON "project_identity_operations" ("target_project_id");

CREATE FUNCTION project_identity_reject_operation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'project_identity_operations_are_immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER project_identity_operations_immutable
BEFORE UPDATE OR DELETE ON "project_identity_operations"
FOR EACH ROW EXECUTE FUNCTION project_identity_reject_operation_mutation();

CREATE FUNCTION project_identity_lock_key(project_id TEXT)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT hashtextextended('massa-ai:project-identity:' || project_id, 0);
$$;

CREATE FUNCTION project_identity_lock_shared(project_ids TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  project_id TEXT;
BEGIN
  FOR project_id IN
    SELECT DISTINCT value
    FROM unnest(project_ids) AS value
    WHERE value IS NOT NULL AND value <> ''
    ORDER BY value
  LOOP
    PERFORM pg_advisory_xact_lock_shared(project_identity_lock_key(project_id));
  END LOOP;
END;
$$;

CREATE FUNCTION project_identity_lock_exclusive(project_ids TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  project_id TEXT;
BEGIN
  FOR project_id IN
    SELECT DISTINCT value
    FROM unnest(project_ids) AS value
    WHERE value IS NOT NULL AND value <> ''
    ORDER BY value
  LOOP
    PERFORM pg_advisory_xact_lock(project_identity_lock_key(project_id));
  END LOOP;
END;
$$;

CREATE FUNCTION project_identity_resolve(project_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_id TEXT := project_id;
  next_id TEXT;
  visited TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF current_id IS NULL OR current_id = '' THEN
    RETURN current_id;
  END IF;

  LOOP
    IF current_id = ANY(visited) OR cardinality(visited) >= 64 THEN
      RAISE EXCEPTION 'project_identity_alias_cycle'
        USING ERRCODE = '23514';
    END IF;
    visited := array_append(visited, current_id);

    SELECT alias."target_project_id" INTO next_id
    FROM "project_identity_aliases" AS alias
    WHERE alias."retired_project_id" = current_id;

    IF NOT FOUND THEN
      RETURN current_id;
    END IF;
    current_id := next_id;
  END LOOP;
END;
$$;

CREATE FUNCTION project_identity_guard_project_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  column_name TEXT := TG_ARGV[0];
  old_id TEXT;
  new_id TEXT;
BEGIN
  IF column_name IS NULL OR column_name = '' THEN
    RAISE EXCEPTION 'project_identity_guard_requires_column'
      USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_id := to_jsonb(OLD) ->> column_name;
    PERFORM project_identity_lock_shared(ARRAY[old_id]);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    old_id := to_jsonb(OLD) ->> column_name;
  END IF;
  new_id := to_jsonb(NEW) ->> column_name;
  PERFORM project_identity_lock_shared(ARRAY[old_id, new_id]);

  IF new_id IS NOT NULL THEN
    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object(column_name, project_identity_resolve(new_id))
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION project_identity_install_guard(target_table REGCLASS, column_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  trigger_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = target_table
      AND attname = column_name
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'project_identity_guard_column_missing'
      USING ERRCODE = '42703';
  END IF;

  trigger_name := 'project_identity_guard_' || substr(md5(target_table::TEXT || ':' || column_name), 1, 16);
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', trigger_name, target_table);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION project_identity_guard_project_id(%L)',
    trigger_name,
    column_name,
    target_table,
    column_name
  );
END;
$$;

-- Project identity changes traverse a graph/workspace FK cycle. Preserve all
-- existing delete behavior while making the update cascade atomic and deferred.
ALTER TABLE "graph_generations"
  DROP CONSTRAINT "graph_generations_project_id_fkey",
  ADD CONSTRAINT "graph_generations_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "workspaces"("project_id")
    ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "workspaces"
  DROP CONSTRAINT "workspaces_active_graph_generation_fkey",
  ADD CONSTRAINT "workspaces_active_graph_generation_fkey"
    FOREIGN KEY ("project_id", "active_graph_generation_id")
    REFERENCES "graph_generations"("project_id", "id")
    ON UPDATE CASCADE ON DELETE SET NULL ("active_graph_generation_id")
    DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT "workspaces_pending_graph_generation_fkey",
  ADD CONSTRAINT "workspaces_pending_graph_generation_fkey"
    FOREIGN KEY ("project_id", "pending_graph_generation_id")
    REFERENCES "graph_generations"("project_id", "id")
    ON UPDATE CASCADE ON DELETE SET NULL ("pending_graph_generation_id")
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "symbol_files"
  DROP CONSTRAINT "symbol_files_generation_fkey",
  ADD CONSTRAINT "symbol_files_generation_fkey"
    FOREIGN KEY ("project_id", "generation_id")
    REFERENCES "graph_generations"("project_id", "id")
    ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "symbol_definitions"
  DROP CONSTRAINT "symbol_definitions_generation_fkey",
  ADD CONSTRAINT "symbol_definitions_generation_fkey"
    FOREIGN KEY ("project_id", "generation_id")
    REFERENCES "graph_generations"("project_id", "id")
    ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "symbol_references"
  DROP CONSTRAINT "symbol_references_generation_fkey",
  ADD CONSTRAINT "symbol_references_generation_fkey"
    FOREIGN KEY ("project_id", "generation_id")
    REFERENCES "graph_generations"("project_id", "id")
    ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "symbol_imports"
  DROP CONSTRAINT "symbol_imports_generation_fkey",
  ADD CONSTRAINT "symbol_imports_generation_fkey"
    FOREIGN KEY ("project_id", "generation_id")
    REFERENCES "graph_generations"("project_id", "id")
    ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "symbol_centrality"
  DROP CONSTRAINT "symbol_centrality_generation_fkey",
  ADD CONSTRAINT "symbol_centrality_generation_fkey"
    FOREIGN KEY ("project_id", "generation_id")
    REFERENCES "graph_generations"("project_id", "id")
    ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

COMMIT;

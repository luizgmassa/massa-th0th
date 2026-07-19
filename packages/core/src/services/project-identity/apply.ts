import {
  parseProjectIdentityApplyRequest,
  type ProjectIdentityApplyInput,
  type ProjectIdentityApplyResult,
  type ProjectIdentityTransactionClient,
} from "./contracts.js";
import {
  computeIdentityPlan,
} from "./planner.js";
import {
  discoverProjectIdentityStorage,
  quoteDiscoveredIdentifier,
  type DiscoveredDirectStore,
  type ProjectIdentityQueryClient,
} from "./discovery.js";
import { ProjectIdentityError } from "./errors.js";
import { hashProjectIdentityRequest } from "./hash.js";
import type { PayloadStorePolicy } from "./registry.js";

/**
 * Runner owns acquisition and release of a transaction-backed client.
 *
 * Production wires this to the shared pg pool (`pool.connect()`); tests
 * substitute a fake that stages BEGIN/COMMIT/ROLLBACK against in-memory rows.
 * The runner MUST return a client whose `rollbackTransaction` is safe to call
 * even after `commitTransaction` (used by the finally clause below).
 */
export interface ProjectIdentityTransactionRunner {
  withTransaction<T>(
    body: (client: ProjectIdentityTransactionClient) => Promise<T>,
  ): Promise<T>;
}

/**
 * pg-backed runner: connect → BEGIN → body → COMMIT, ROLLBACK on any throw.
 * `rollbackTransaction` in finally is best-effort: if the body committed, a
 * real pool client will reject a second ROLLBACK silently (caught here).
 */
class PgPoolTransactionRunner implements ProjectIdentityTransactionRunner {
  constructor(
    private readonly acquireClient: () => Promise<ProjectIdentityTransactionClient>,
    private readonly releaseClient: (client: ProjectIdentityTransactionClient) => Promise<void>,
  ) {}

  async withTransaction<T>(
    body: (client: ProjectIdentityTransactionClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.acquireClient();
    let committed = false;
    try {
      await client.beginTransaction();
      const result = await body(client);
      await client.commitTransaction();
      committed = true;
      return result;
    } finally {
      if (!committed) {
        try { await client.rollbackTransaction(); } catch { /* best-effort */ }
      }
      await this.releaseClient(client);
    }
  }
}

interface OperationRow {
  operation_id: string;
  mode: string;
  source_project_id: string;
  target_project_id: string;
  source_canonical_root: string;
  target_canonical_root: string;
  request_hash: string;
  plan_hash: string;
  result: ProjectIdentityApplyResult;
  committed_at: Date | string;
}

interface GraphGenerationRow {
  id: string;
  project_id: string;
  status: string;
  activated_at: Date | string | null;
}

interface WorkspaceAggregateRow {
  files: number | string;
  definitions: number | string;
  references: number | string;
  imports: number | string;
  centrality: number | string;
}

interface RewrittenPayload {
  rowIdentifiers: readonly unknown[];
  newValue: unknown;
}

const IDENTITY_KEYS = new Set(["projectId", "project_id", "workspaceId", "workspace_id"]);

function rewriteIdentityInValue(
  value: unknown,
  source: string,
  target: string,
  encoding: PayloadStorePolicy["encoding"],
): { value: unknown; rewritten: boolean } {
  if (encoding === "text-array") {
    if (!Array.isArray(value)) return { value, rewritten: false };
    let rewritten = false;
    const next = value.map((item) => {
      if (item === `handoff:${source}`) { rewritten = true; return `handoff:${target}`; }
      if (item === `project:${source}`) { rewritten = true; return `project:${target}`; }
      if (item === source) { rewritten = true; return target; }
      return item;
    });
    return { value: next, rewritten };
  }
  const decoded = encoding === "json-text" && typeof value === "string"
    ? safeJsonParse(value)
    : value;
  if (decoded == null || typeof decoded !== "object") return { value, rewritten: false };
  const { result, rewritten } = rewriteIdentityObject(decoded as Record<string, unknown>, source, target);
  if (encoding === "json-text") {
    return { value: JSON.stringify(result), rewritten };
  }
  return { value: result, rewritten };
}

function safeJsonParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

function rewriteIdentityObject(
  input: Record<string, unknown>,
  source: string,
  target: string,
): { result: Record<string, unknown>; rewritten: boolean } {
  let rewritten = false;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(input)) {
    if (IDENTITY_KEYS.has(key) && item === source) {
      result[key] = target;
      rewritten = true;
      continue;
    }
    if (Array.isArray(item)) {
      const inner = rewriteIdentityArray(item, source, target);
      result[key] = inner.result;
      if (inner.rewritten) rewritten = true;
      continue;
    }
    if (item && typeof item === "object") {
      const inner = rewriteIdentityObject(item as Record<string, unknown>, source, target);
      result[key] = inner.result;
      if (inner.rewritten) rewritten = true;
      continue;
    }
    result[key] = item;
  }
  return { result, rewritten };
}

function rewriteIdentityArray(
  input: unknown[],
  source: string,
  target: string,
): { result: unknown[]; rewritten: boolean } {
  let rewritten = false;
  const result: unknown[] = [];
  for (const item of input) {
    if (Array.isArray(item)) {
      const inner = rewriteIdentityArray(item, source, target);
      result.push(inner.result);
      if (inner.rewritten) rewritten = true;
      continue;
    }
    if (item && typeof item === "object") {
      const inner = rewriteIdentityObject(item as Record<string, unknown>, source, target);
      result.push(inner.result);
      if (inner.rewritten) rewritten = true;
      continue;
    }
    result.push(item);
  }
  return { result, rewritten };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedBy<T, K extends string>(items: readonly T[], key: (item: T) => K): readonly T[] {
  return [...items].sort((a, b) => compareText(key(a), key(b)));
}

/**
 * Project identity apply service.
 *
 * Locks source and target in lexical order, recomputes the authoritative plan
 * inside the same transaction, gates on conflicts/unknown storage/plan-hash,
 * rewrites direct + payload stores, repairs the graph active pointer (merge),
 * creates the alias, and writes exactly one operation row.
 *
 * Failure boundaries (T6 injects faults here):
 *   - FIRST MUTATION: any write in `rewriteDirectStores` / payload / graph.
 *     A throw past this point rolls back the entire transaction via the
 *     `withTransaction` finally clause.
 *   - PRE-COMMIT: after the operation row insert, before COMMIT. A throw here
 *     also rolls back; the operation row never becomes durable.
 */
export class ProjectIdentityApplyService {
  constructor(
    private readonly runner: ProjectIdentityTransactionRunner,
    private readonly schema = "public",
  ) {}

  async apply(input: ProjectIdentityApplyInput): Promise<ProjectIdentityApplyResult> {
    const request = parseProjectIdentityApplyRequest(input);
    try {
      return await this.runner.withTransaction(async (client) =>
        this.applyInTransaction(client, request),
      );
    } catch (error) {
      if (error instanceof ProjectIdentityError) throw error;
      throw new ProjectIdentityError("PROJECT_IDENTITY_BACKEND_UNAVAILABLE", { cause: error });
    }
  }

  private async applyInTransaction(
    client: ProjectIdentityTransactionClient,
    request: {
      mode: "rename" | "merge";
      sourceProjectId: string;
      targetProjectId: string;
      operationId: string;
      expectedPlanHash: string;
    },
  ): Promise<ProjectIdentityApplyResult> {
    // 1. Idempotency FIRST: fast path. If operationId already committed, return
    //    the stored result without mutation when the request material matches.
    //    This pre-lock read is a fast path only — an authoritative re-check
    //    after the lock (step 1b) closes the concurrent-retry race where a
    //    winner commits between this read and lock acquisition.
    const requestHash = hashProjectIdentityRequest({
      mode: request.mode,
      sourceProjectId: request.sourceProjectId,
      targetProjectId: request.targetProjectId,
      operationId: request.operationId,
    });
    const preExisting = await this.storedResultFor(client, request.operationId, requestHash);
    if (preExisting) return preExisting;

    // 2. Acquire ordered exclusive identity locks (lexical ordering handled by SQL).
    await client.query(
      `SELECT project_identity_lock_exclusive(ARRAY[$1, $2])`,
      [request.sourceProjectId, request.targetProjectId],
    );

    // 1b. Authoritative post-lock idempotency re-check. A concurrent retry that
    //     lost the race blocked on the lock above; by the time it proceeds, the
    //     winner has committed the operation row. Re-read here so the loser
    //     returns the stored result instead of recomputing (and failing on)
    //     an already-retired source.
    const postExisting = await this.storedResultFor(client, request.operationId, requestHash);
    if (postExisting) return postExisting;

    // 3. Authoritative in-tx plan.
    const plan = await computeIdentityPlan(
      client as ProjectIdentityQueryClient,
      {
        mode: request.mode,
        sourceProjectId: request.sourceProjectId,
        targetProjectId: request.targetProjectId,
      },
      this.schema,
    );

    if (plan.planHash !== request.expectedPlanHash) {
      throw new ProjectIdentityError("PROJECT_IDENTITY_PLAN_CHANGED");
    }
    if (plan.conflicts.length > 0) {
      throw new ProjectIdentityError("PROJECT_IDENTITY_CONFLICT");
    }
    if (plan.unknownStores.length > 0) {
      throw new ProjectIdentityError("PROJECT_IDENTITY_UNKNOWN_STORAGE");
    }

    // Rename moves source→target; the new target workspace adopts source's
    // canonical root. Merge keeps the existing target root. In both modes the
    // stored source root is what the alias records.
    const targetRootForRecord = request.mode === "rename"
      ? plan.sourceCanonicalRoot
      : plan.targetCanonicalRoot;

    // 4. FIRST MUTATION BOUNDARY — every statement below mutates; a throw past
    //    here rolls back the whole transaction.

    // 4a. Payload stores FIRST: nested identity is rewritten while the row's
    //     project_id column still points at source (the project-filter the spec
    //     permits relies on this order). The direct move in (4b) then carries
    //     the already-rewritten payload to target.
    //
    //     Single inventory read shared by payload + direct loops + merge graph
    //     repair; avoids running discovery three times.
    const inventory = await discoverProjectIdentityStorage(client as ProjectIdentityQueryClient, this.schema);
    const payloadStores = sortedBy(inventory.payloadStores, (policy) => `${policy.storeId}.${policy.column}`);
    const mutableDirectStores = inventory.directStores.filter((store) => store.mutable);
    for (const policy of payloadStores) {
      await this.rewritePayloadStore(client, policy, request);
    }

    // 4b. Direct mutable stores: rename → UPDATE id_col; merge → dedupe then UPDATE.
    //     In merge mode the source workspaces row is skipped here (its project_id
    //     PK would collide with the existing target row); it is retired in (4c)
    //     after its graph_generations dependents have moved.
    for (const store of mutableDirectStores) {
      if (request.mode === "merge" && store.storeId === "workspaces") continue;
      await this.rewriteDirectStore(client, store, request);
    }

    // 4c. Graph active/pending pointer repair (merge only). Rename moves graph
    //     rows via the direct UPDATE + FK cascade; the workspace active pointer
    //     follows via ON UPDATE CASCADE — we verify no stale pointers remain.
    if (request.mode === "merge") {
      await this.repairGraphForMerge(client, request, mutableDirectStores);
    } else {
      await this.verifyRenameGraphPointers(client, request);
    }

    // 4d. Alias row — retires source to target for both rename and merge.
    await client.query(
      `INSERT INTO project_identity_aliases
         (retired_project_id, target_project_id, canonical_root, operation_id)
       VALUES ($1, $2, $3, $4)`,
      [
        request.sourceProjectId,
        request.targetProjectId,
        plan.sourceCanonicalRoot,
        request.operationId,
      ],
    );

    // 5. Operation row (idempotent + strict audit). ON CONFLICT covers the race
    //    where another writer committed the same operationId between (1) and here.
    const committedAt = new Date();
    const result: ProjectIdentityApplyResult = {
      mode: request.mode,
      dryRun: false,
      operationId: request.operationId,
      sourceProjectId: request.sourceProjectId,
      targetProjectId: request.targetProjectId,
      sourceCanonicalRoot: plan.sourceCanonicalRoot,
      targetCanonicalRoot: targetRootForRecord,
      planHash: plan.planHash,
      stores: plan.stores,
      committedAt: committedAt.toISOString(),
    };

    await client.query(
      `INSERT INTO project_identity_operations
         (operation_id, mode, source_project_id, target_project_id,
          source_canonical_root, target_canonical_root, request_hash, plan_hash, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (operation_id) DO NOTHING`,
      [
        request.operationId,
        request.mode,
        request.sourceProjectId,
        request.targetProjectId,
        plan.sourceCanonicalRoot,
        targetRootForRecord,
        requestHash,
        plan.planHash,
        JSON.stringify(result),
      ],
    );

    // Re-SELECT for the concurrent-commit case: another writer may have inserted
    // a different request_hash for the same operationId.
    const reselected = await client.query<OperationRow>(
      `SELECT request_hash, result FROM project_identity_operations WHERE operation_id = $1`,
      [request.operationId],
    );
    const committed = reselected.rows[0];
    if (!committed) {
      // The immutability trigger (55000) is the only realistic path; surface as backend.
      throw new ProjectIdentityError("PROJECT_IDENTITY_BACKEND_UNAVAILABLE");
    }
    if (committed.request_hash !== requestHash) {
      throw new ProjectIdentityError("PROJECT_IDENTITY_OPERATION_REUSED");
    }
    // 6. PRE-COMMIT BOUNDARY — withTransaction COMMITs next; any throw above rolls back.
    return committed.result ?? result;
  }

  /**
   * Idempotency read for project_identity_operations. Returns the stored
   * result when the operation row exists and its request_hash matches; returns
   * undefined when absent; throws PROJECT_IDENTITY_OPERATION_REUSED when the
   * same operationId was recorded under different request material.
   */
  private async storedResultFor(
    client: ProjectIdentityTransactionClient,
    operationId: string,
    requestHash: string,
  ): Promise<ProjectIdentityApplyResult | undefined> {
    const existing = await client.query<Pick<OperationRow, "operation_id" | "request_hash" | "result">>(
      `SELECT operation_id, request_hash, result
         FROM project_identity_operations WHERE operation_id = $1`,
      [operationId],
    );
    if (existing.rows.length === 0) return undefined;
    const stored = existing.rows[0]!;
    if (stored.request_hash !== requestHash) {
      throw new ProjectIdentityError("PROJECT_IDENTITY_OPERATION_REUSED");
    }
    return stored.result;
  }

  private async rewriteDirectStore(
    client: ProjectIdentityTransactionClient,
    store: DiscoveredDirectStore,
    request: { mode: "rename" | "merge"; sourceProjectId: string; targetProjectId: string },
  ): Promise<void> {
    const table = quoteDiscoveredIdentifier(store.storeId);
    const column = quoteDiscoveredIdentifier(store.identityColumn);

    if (request.mode === "rename") {
      await client.query(
        `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`,
        [request.targetProjectId, request.sourceProjectId],
      );
      return;
    }

    // merge: dedupe byte-equivalent source rows first, then move the remainder.
    // Primary-key collisions where the non-identity material differs were
    // already flagged PROJECT_IDENTITY_CONFLICT in the plan; here we only drop
    // exact-duplicate rows so the subsequent UPDATE does not violate the PK.
    //
    // NOTE: this material equality is intentionally narrower than the planner's
    // key_collision gate (which includes heavy columns and fires first to abort
    // apply), so the two cannot diverge in practice: any collision that this
    // narrower check would miss is already a CONFLICT before we reach here.
    const keyColumns = store.primaryKey.filter((col) => col !== store.identityColumn);
    if (keyColumns.length > 0) {
      const keyProjection = keyColumns.map((col) => quoteDiscoveredIdentifier(col)).join(", ");
      // Material equality on the safe (non-bytea/vector) columns.
      const materialColumns = store.materialColumns.length > 0 ? store.materialColumns : keyColumns;
      const materialProjection = materialColumns.map((col) => quoteDiscoveredIdentifier(col)).join(", ");
      await client.query(
        `DELETE FROM ${table} t_source
          USING ${table} t_target
          WHERE t_source.${column} = $1
            AND t_target.${column} = $2
            AND (t_source.${keyProjection}) IS NOT DISTINCT FROM (t_target.${keyProjection})
            AND (t_source.${materialProjection}) IS NOT DISTINCT FROM (t_target.${materialProjection})`,
        [request.sourceProjectId, request.targetProjectId],
      );
    }

    await client.query(
      `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`,
      [request.targetProjectId, request.sourceProjectId],
    );
  }

  private async rewritePayloadStore(
    client: ProjectIdentityTransactionClient,
    policy: PayloadStorePolicy,
    request: { sourceProjectId: string; targetProjectId: string },
  ): Promise<void> {
    const table = quoteDiscoveredIdentifier(policy.storeId);
    const column = quoteDiscoveredIdentifier(policy.column);

    // Project-filter when the table has a project_id column; otherwise scan
    // (scheduled_jobs has no project_id — acceptable per spec).
    const hasProjectColumn = await this.tableHasColumn(client, policy.storeId, "project_id");
    const filter = hasProjectColumn
      ? `WHERE "project_id" = $1`
      : `WHERE ${column} IS NOT NULL`;
    const filterValues = hasProjectColumn ? [request.sourceProjectId] : [];

    // Fetch rows + a row identifier for targeted UPDATE. Prefer an `id` PK.
    const hasId = await this.tableHasColumn(client, policy.storeId, "id");
    const projection = hasId ? `"id", ${column}` : column;
    const select = hasProjectColumn
      ? `SELECT ${projection} FROM ${table} ${filter}`
      : `SELECT ${projection} FROM ${table} WHERE ${column} IS NOT NULL`;
    const rows = await client.query<Record<string, unknown>>(select, filterValues);

    const rewrites: RewrittenPayload[] = [];
    for (const row of rows.rows) {
      const original = row[policy.column];
      if (original == null) continue;
      const { value, rewritten } = rewriteIdentityInValue(
        original, request.sourceProjectId, request.targetProjectId, policy.encoding,
      );
      if (!rewritten) continue;
      rewrites.push({
        rowIdentifiers: hasId ? [row.id] : [],
        newValue: value,
      });
    }
    if (rewrites.length === 0) return;

    if (hasId) {
      for (const rewrite of rewrites) {
        await client.query(
          `UPDATE ${table} SET ${column} = $1 WHERE "id" = $2`,
          [rewrite.newValue, rewrite.rowIdentifiers[0]],
        );
      }
      return;
    }
    // No row identifier available: refuse to fan out a blind UPDATE. The
    // registered payload stores all carry an `id` PK; if a runtime-created
    // table lacks one it must be added before apply can safely rewrite it.
    throw new ProjectIdentityError("PROJECT_IDENTITY_BACKEND_UNAVAILABLE");
  }

  private async tableHasColumn(
    client: ProjectIdentityTransactionClient,
    table: string,
    column: string,
  ): Promise<boolean> {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
       ) AS exists`,
      [this.schema, table, column],
    );
    return Boolean(result.rows[0]?.exists);
  }

  private async repairGraphForMerge(
    client: ProjectIdentityTransactionClient,
    request: { sourceProjectId: string; targetProjectId: string },
    mutableDirectStores: readonly DiscoveredDirectStore[],
  ): Promise<void> {
    // Before the generation project_id rewrite: NULL out workspace active/pending
    // pointers for BOTH ids so the deferred composite FK survives the rewrite.
    await client.query(
      `UPDATE workspaces
          SET active_graph_generation_id = NULL,
              pending_graph_generation_id = NULL
        WHERE project_id = $1 OR project_id = $2`,
      [request.sourceProjectId, request.targetProjectId],
    );

    // graph_generations rows moved from source to target in step (4a); assert
    // none remain under source before retiring the source workspace row.
    // Stray-row assertion: every mutable direct store other than `workspaces`
    // (retired below) must have ZERO rows still pointing at source. This covers
    // graph_generations and any symbol_* / runtime-created direct store; rows
    // that failed to move would otherwise be silently cascade-deleted when the
    // source workspace row is removed.
    for (const store of mutableDirectStores) {
      if (store.storeId === "workspaces") continue;
      const table = quoteDiscoveredIdentifier(store.storeId);
      const column = quoteDiscoveredIdentifier(store.identityColumn);
      const stray = await client.query<{ count: number | string }>(
        `SELECT count(*)::integer AS count FROM ${table} WHERE ${column} = $1`,
        [request.sourceProjectId],
      );
      if (Number(stray.rows[0]?.count ?? 0) > 0) {
        throw new ProjectIdentityError("PROJECT_IDENTITY_BACKEND_UNAVAILABLE");
      }
    }

    // Retire the source workspace row: its identity is now an alias. The alias
    // row (4d) and immutable operation_log are the only allowed source refs.
    await client.query(
      `DELETE FROM workspaces WHERE project_id = $1`,
      [request.sourceProjectId],
    );

    // graph_generations.project_id was rewritten in step (4a). Select the
    // newest activated generation now consolidated under target.
    const generations = await client.query<GraphGenerationRow>(
      `SELECT id, project_id, status, activated_at
         FROM graph_generations
        WHERE project_id = $1
        ORDER BY (activated_at IS NULL) ASC, activated_at DESC, id DESC`,
      [request.targetProjectId],
    );
    const winner = generations.rows.find((row) => row.status === "active")
      ?? generations.rows.find((row) => row.status === "completed");
    // pending rows are untouched by the supersede/activate updates below, so the
    // in-memory generations list is authoritative for them. Preserve the target
    // workspace's in-flight pending pointer (NULLed above for FK survival).
    const pendingWinner = generations.rows.find((row) => row.status === "pending") ?? null;
    // Supersede every other active generation under target.
    if (winner) {
      await client.query(
        `UPDATE graph_generations
            SET status = 'superseded', superseded_at = COALESCE(superseded_at, now())
          WHERE project_id = $1 AND status = 'active' AND id <> $2`,
        [request.targetProjectId, winner.id],
      );
      await client.query(
        `UPDATE graph_generations SET status = 'active', activated_at = COALESCE(activated_at, now())
          WHERE project_id = $1 AND id = $2`,
        [request.targetProjectId, winner.id],
      );
    }

    // Recompute workspace aggregate counts from the chosen generation.
    const aggregateTarget = winner?.id ?? null;
    const aggregate = aggregateTarget
      ? await client.query<WorkspaceAggregateRow>(
          `SELECT
             (SELECT count(*)::integer FROM symbol_files WHERE project_id = $1 AND generation_id = $2) AS files,
             (SELECT count(*)::integer FROM symbol_definitions WHERE project_id = $1 AND generation_id = $2) AS definitions,
             (SELECT count(*)::integer FROM symbol_references WHERE project_id = $1 AND generation_id = $2) AS references,
             (SELECT count(*)::integer FROM symbol_imports WHERE project_id = $1 AND generation_id = $2) AS imports,
             (SELECT count(*)::integer FROM symbol_centrality WHERE project_id = $1 AND generation_id = $2) AS centrality`,
          [request.targetProjectId, aggregateTarget],
        )
      : null;
    const counts = aggregate?.rows[0] ?? null;

    await client.query(
      `UPDATE workspaces
          SET active_graph_generation_id = $2,
              pending_graph_generation_id = $3,
              active_files_count = $4,
              active_definitions_count = $5,
              active_references_count = $6,
              active_imports_count = $7,
              active_centrality_count = $8
        WHERE project_id = $1`,
      [
        request.targetProjectId,
        aggregateTarget,
        pendingWinner?.id ?? null,
        counts ? Number(counts.files) : 0,
        counts ? Number(counts.definitions) : 0,
        counts ? Number(counts.references) : 0,
        counts ? Number(counts.imports) : 0,
        counts ? Number(counts.centrality) : 0,
      ],
    );
  }

  private async verifyRenameGraphPointers(
    client: ProjectIdentityTransactionClient,
    request: { sourceProjectId: string; targetProjectId: string },
  ): Promise<void> {
    // After step (4b) the source workspace row has been moved to target, so no
    // row should remain under source on `workspaces` or `graph_generations`.
    // Pointer integrity for the moved target row is guaranteed by the deferred
    // composite FK ON UPDATE CASCADE.
    for (const table of ["workspaces", "graph_generations"] as const) {
      const stale = await client.query<{ count: number | string }>(
        `SELECT count(*)::integer AS count FROM ${table} WHERE project_id = $1`,
        [request.sourceProjectId],
      );
      const remaining = Number(stale.rows[0]?.count ?? 0);
      if (remaining > 0) {
        throw new ProjectIdentityError("PROJECT_IDENTITY_BACKEND_UNAVAILABLE");
      }
    }
  }
}

/**
 * Build a ProjectIdentityApplyService backed by a function that yields a
 * pg-style transaction client. Production passes the shared pool's connect.
 */
export function createProjectIdentityApplyService(
  acquireClient: () => Promise<ProjectIdentityTransactionClient>,
  releaseClient: (client: ProjectIdentityTransactionClient) => Promise<void>,
  schema = "public",
): ProjectIdentityApplyService {
  return new ProjectIdentityApplyService(
    new PgPoolTransactionRunner(acquireClient, releaseClient),
    schema,
  );
}

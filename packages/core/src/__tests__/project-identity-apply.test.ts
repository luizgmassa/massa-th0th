import { describe, expect, test } from "bun:test";

import {
  ProjectIdentityApplyService,
  ProjectIdentityError,
  canonicalProjectIdentityJson,
  hashProjectIdentityPlan,
  hashProjectIdentityRequest,
  type ProjectIdentityTransactionClient,
} from "../services/project-identity/index.js";
import { computeIdentityPlan } from "../services/project-identity/planner.js";
import { PROJECT_IDENTITY_PLAN_VERSION } from "../services/project-identity/contracts.js";

type Row = Record<string, unknown>;

interface ColumnSpec { table_name: string; column_name: string; data_type: string }
interface PkSpec { table_name: string; columns: string[] }

/**
 * Transaction-aware in-memory client. `committed` is the durable snapshot;
 * `staged` is the working copy inside a transaction. COMMIT copies staged→committed,
 * ROLLBACK copies committed→staged. Mutations between BEGIN and COMMIT are isolated.
 *
 * Honors enough SQL to drive the apply service: information_schema lookups,
 * workspaces/aliases/operations selects, identity-column UPDATE/DELETE, and
 * advisory-lock function calls (no-op).
 */
class FakeTransactionClient implements ProjectIdentityTransactionClient {
  columns: ColumnSpec[];
  primaryKeys: PkSpec[];
  tables: Record<string, Row[]>;
  inTransaction = false;
  private staged: Record<string, Row[]> | null = null;
  private failAfterFirstMutation: Error | null = null;
  mutations = 0;
  lockCalls = 0;
  /**
   * Number of times project_identity_operations has been read for a single
   * operationId. Used with deferredOperationRow to simulate a concurrent
   * winner committing between the pre-lock and post-lock idempotency reads.
   */
  operationReadCount = 0;
  deferredOperationRow: Row | null = null;

  constructor(initial: {
    columns: ColumnSpec[];
    primaryKeys: PkSpec[];
    tables: Record<string, Row[]>;
  }) {
    this.columns = initial.columns;
    this.primaryKeys = initial.primaryKeys;
    this.tables = initial.tables;
  }

  injectFailureAfterFirstMutation(error: Error): void {
    this.failAfterFirstMutation = error;
  }

  async beginTransaction(): Promise<void> {
    if (this.inTransaction) throw new Error("nested BEGIN");
    this.inTransaction = true;
    // Deep-copy committed state into staged.
    this.staged = {};
    for (const [table, rows] of Object.entries(this.tables)) {
      this.staged[table] = rows.map((row) => ({ ...row }));
    }
  }

  async commitTransaction(): Promise<void> {
    if (!this.inTransaction || !this.staged) throw new Error("COMMIT without BEGIN");
    this.tables = this.staged;
    this.staged = null;
    this.inTransaction = false;
  }

  async rollbackTransaction(): Promise<void> {
    this.staged = null;
    this.inTransaction = false;
  }

  private active(): Record<string, Row[]> {
    return this.inTransaction && this.staged ? this.staged : this.tables;
  }

  async query<T = Row>(text: string, values: readonly unknown[] = []): Promise<{ rows: T[] }> {
    // Advisory lock function calls are no-ops; record the call for assertions.
    if (/project_identity_lock_(exclusive|shared)/.test(text)) {
      this.lockCalls++;
      return { rows: [] as T[] };
    }
    // Column-existence probe: SELECT EXISTS (... FROM information_schema.columns WHERE table_name = $2 AND column_name = $3)
    if (/SELECT\s+EXISTS\s*\(/i.test(text) && text.includes("information_schema.columns")) {
      const [table, column] = [values[1], values[2]];
      const exists = this.columns.some(
        (row) => row.table_name === table && row.column_name === column,
      );
      return { rows: [{ exists }] as unknown as T[] };
    }
    if (text.includes("information_schema.columns")) {
      return { rows: this.columns as unknown as T[] };
    }
    if (text.includes("information_schema.table_constraints")) {
      return { rows: this.primaryKeys as unknown as T[] };
    }
    if (/FROM\s+workspaces\s+WHERE/i.test(text) && /project_id\s*=\s*\$1\s+OR/i.test(text)) {
      return { rows: this.active().workspaces?.filter((row) =>
        values.includes(row.project_id)) as unknown as T[] };
    }
    if (/FROM\s+project_identity_aliases/i.test(text) && /retired_project_id\s*=\s*\$1\s+OR/i.test(text)) {
      return { rows: (this.active().project_identity_aliases ?? []).filter((row) =>
        values.includes(row.retired_project_id)) as unknown as T[] };
    }
    if (/FROM\s+project_identity_operations\s+WHERE\s+operation_id/i.test(text)) {
      this.operationReadCount++;
      // Simulate a concurrent winner committing between the pre-lock read
      // (operationReadCount === 1, returns no row) and the post-lock read
      // (operationReadCount === 2, returns the deferred row the winner wrote).
      if (this.operationReadCount === 2 && this.deferredOperationRow) {
        const row = this.deferredOperationRow;
        const normalized = [{
          ...row,
          result: typeof row.result === "string" ? JSON.parse(row.result) : row.result,
        }];
        return { rows: normalized as unknown as T[] };
      }
      const rows = (this.active().project_identity_operations ?? []).filter((row) =>
        row.operation_id === values[0]);
      if (rows.length === 0) return { rows: [] as T[] };
      // Normalize result JSON if stored as string.
      const normalized = rows.map((row) => ({
        ...row,
        result: typeof row.result === "string" ? JSON.parse(row.result) : row.result,
      }));
      return { rows: normalized as unknown as T[] };
    }
    if (/^SELECT[\s\S]*FROM\s+graph_generations/i.test(text)) {
      const rows = this.active().graph_generations ?? [];
      const forProject = rows.filter((row) => row.project_id === values[0]);
      return { rows: forProject as unknown as T[] };
    }
    if (/FROM\s+graph_generations\s+WHERE\s+project_id/i.test(text)) {
      const countMatch = text.match(/count\(\*\)::integer\s+AS\s+count/i);
      if (countMatch) {
        const count = (this.active().graph_generations ?? [])
          .filter((row) => row.project_id === values[0]).length;
        return { rows: [{ count }] as unknown as T[] };
      }
    }
    if (/count\(\*\)::integer\s+AS\s+count/i.test(text) && /FROM\s+workspaces/i.test(text)) {
      const count = (this.active().workspaces ?? [])
        .filter((row) => row.project_id === values[0]).length;
      return { rows: [{ count }] as unknown as T[] };
    }
    if (/FROM\s+workspaces\s+WHERE\s+project_id\s*=\s*\$1$/i.test(text.trim())) {
      const countMatch = text.match(/count\(\*\)::integer\s+AS\s+count/i);
      if (countMatch) {
        const count = (this.active().workspaces ?? [])
          .filter((row) => row.project_id === values[0])
          .filter((row) => row.active_graph_generation_id != null || row.pending_graph_generation_id != null)
          .length;
        return { rows: [{ count }] as unknown as T[] };
      }
    }
    if (/SELECT\s+.*AS\s+payload_value\s+FROM/i.test(text)) {
      const table = text.match(/FROM "([a-z0-9_]+)"/)?.[1] ?? "";
      const column = text.match(/SELECT "([a-z0-9_]+)" AS payload_value/)?.[1] ?? "";
      const rows = this.active()[table] ?? [];
      const filtered = text.includes("project_id")
        ? rows.filter((row) => row.project_id === values[0])
        : rows;
      return { rows: filtered
        .filter((row) => row[column] != null)
        .map((row) => ({ id: row.id, [column]: row[column] })) as unknown as T[] };
    }
    if (/^SELECT\s+("id",\s*)?"(project_id|workspace_id|metadata|payload|payload_json|results|tags)"/i.test(text)) {
      const table = text.match(/FROM "([a-z0-9_]+)"/)?.[1] ?? "";
      const identityCol = text.match(/WHERE "(project_id|workspace_id)" = \$1/)?.[1];
      const rows = this.active()[table] ?? [];
      if (identityCol) {
        // Match the OR ($1, $2) pattern used by the planner's loadDirectRows.
        if (/OR\s+"(project_id|workspace_id)"\s*=\s*\$2/i.test(text)) {
          return { rows: rows.filter((row) =>
            values.includes(row[identityCol])) as unknown as T[] };
        }
        return { rows: rows.filter((row) => row[identityCol] === values[0]) as unknown as T[] };
      }
      return { rows: rows as unknown as T[] };
    }
    if (/^UPDATE/i.test(text.trim())) return this.applyWrite(text, values) as { rows: T[] };
    if (/^DELETE/i.test(text.trim())) return this.applyWrite(text, values) as { rows: T[] };
    if (/^INSERT/i.test(text.trim())) return this.applyInsert(text, values) as { rows: T[] };
    // Fallback: empty result for unrecognized selects (count subqueries etc.)
    return { rows: [] as T[] };
  }

  private bumpMutation(): void {
    this.mutations++;
    if (this.failAfterFirstMutation && this.mutations === 1) {
      const err = this.failAfterFirstMutation;
      this.failAfterFirstMutation = null;
      throw err;
    }
  }

  private applyWrite(text: string, values: readonly unknown[]): { rows: Row[] } {
    this.bumpMutation();
    const store = this.active();
    const table = text.match(/(?:UPDATE|DELETE FROM)\s+"?([a-z0-9_]+)"?/i)?.[1] ?? "";
    const target = store[table] ?? (store[table] = []);

    // Dedupe DELETE: drop source rows byte-equivalent to a target row. The SQL
    // emits two t_source.(...) groups: the composite key, then the material
    // columns. Both must match for a row to be dropped.
    if (/^DELETE FROM/i.test(text) && /USING/i.test(text)) {
      const sourceId = values[0];
      const targetId = values[1];
      const groups = [...text.matchAll(/\(t_source\.([^)]+)\)/g)].map((match) =>
        match[1]!.split(",").map((col) => col.replace(/"/g, "").trim())
          .filter((col) => col && col !== "project_id" && col !== "workspace_id"));
      const keyCols = groups[0] ?? [];
      const materialCols = groups[1] ?? keyCols;
      const dropIndexes = new Set<number>();
      const sourceRows = target.map((row, index) => ({ row, index }))
        .filter((entry) => entry.row.project_id === sourceId);
      const targetRows = target.filter((row) => row.project_id === targetId);
      for (const { row: sRow, index } of sourceRows) {
        const matches = targetRows.some((tRow) =>
          keyCols.every((col) => sRow[col] === tRow[col]) &&
          materialCols.every((col) => canonicalProjectIdentityJson(sRow[col]) === canonicalProjectIdentityJson(tRow[col])));
        if (matches) dropIndexes.add(index);
      }
      store[table] = target.filter((_, index) => !dropIndexes.has(index));
      return { rows: [] };
    }
    // DELETE FROM <table> WHERE project_id = $1 (workspace retirement).
    if (/^DELETE FROM/i.test(text) && /WHERE\s+"?project_id"?\s*=\s*\$1/i.test(text)) {
      const doomed = values[0];
      store[table] = target.filter((row) => row.project_id !== doomed);
      return { rows: [] };
    }
    if (/^UPDATE\s+"?([a-z0-9_]+)"?\s+SET\s+"?(project_id|workspace_id)"?/i.test(text)) {
      const idCol = text.match(/SET\s+"?(project_id|workspace_id)"?/i)?.[1] ?? "project_id";
      const newValue = values[0];
      const oldValue = values[1];
      for (const row of target) {
        if (row[idCol] === oldValue) row[idCol] = newValue;
      }
      return { rows: [] };
    }
    if (/^UPDATE\s+"?([a-z0-9_]+)"?\s+SET\s+"?(metadata|payload|payload_json|results|tags)"?/i.test(text)) {
      const colMatch = text.match(/SET\s+"?([a-z0-9_]+)"?\s*=/i);
      const col = colMatch?.[1] ?? "";
      const newValue = values[0];
      const rowId = values[1];
      for (const row of target) {
        if (rowId !== undefined && row.id === rowId) {
          row[col] = newValue;
        }
      }
      return { rows: [] };
    }
    if (/^UPDATE\s+workspaces\s+SET\s+active_graph/i.test(text)) {
      const whereProject = values[0];
      // Detect whether the UPDATE also restores pending_graph_generation_id
      // (post-fix merge path). The new SQL is:
      //   SET active_graph_generation_id = $2,
      //       pending_graph_generation_id = $3, ...  WHERE project_id = $1
      // so active=values[1], pending=values[2]. The pre-fix SQL used
      //   active_graph_generation_id = $3 WHERE project_id = $1
      // so we detect that shape too and read active from values[2].
      const restoresPending = /pending_graph_generation_id\s*=/i.test(text);
      const activeIndex = restoresPending ? 1 : 2;
      const pendingIndex = 2;
      for (const row of target) {
        if (row.project_id === whereProject) {
          row.active_graph_generation_id = values[activeIndex] ?? null;
          if (restoresPending) {
            row.pending_graph_generation_id = values[pendingIndex] ?? null;
          }
        }
      }
      return { rows: [] };
    }
    if (/^UPDATE\s+workspaces\s+SET\s+active_graph_generation_id\s*=\s*NULL/i.test(text)) {
      const a = values[0];
      const b = values[1];
      for (const row of target) {
        if (row.project_id === a || row.project_id === b) {
          row.active_graph_generation_id = null;
          row.pending_graph_generation_id = null;
        }
      }
      return { rows: [] };
    }
    if (/^UPDATE\s+graph_generations\s+SET\s+status/i.test(text)) {
      const projectId = values[0];
      const targetId = values[1];
      const isSupersede = /status\s*=\s*'superseded'/i.test(text);
      const isInclusive = /AND id\s*=\s*\$2/i.test(text);
      for (const row of target) {
        if (row.project_id !== projectId) continue;
        if (isSupersede) {
          if (targetId && row.id === targetId) continue;
          if (row.status === "active") row.status = "superseded";
        } else if (isInclusive) {
          if (row.id === targetId) row.status = "active";
        }
      }
      return { rows: [] };
    }
    if (/^UPDATE\s+graph_generations\s+SET\s+project_id/i.test(text)) {
      const newProject = values[0];
      const oldProject = values[1];
      for (const row of target) {
        if (row.project_id === oldProject) row.project_id = newProject;
      }
      return { rows: [] };
    }
    return { rows: [] };
  }

  private applyInsert(text: string, values: readonly unknown[]): { rows: Row[] } {
    this.bumpMutation();
    const store = this.active();
    if (/INTO\s+"?project_identity_aliases"?/i.test(text)) {
      const rows = store.project_identity_aliases ?? (store.project_identity_aliases = []);
      rows.push({
        retired_project_id: values[0],
        target_project_id: values[1],
        canonical_root: values[2],
        operation_id: values[3],
      });
      return { rows: [] };
    }
    if (/INTO\s+"?project_identity_operations"?/i.test(text)) {
      const rows = store.project_identity_operations ?? (store.project_identity_operations = []);
      const operationId = values[0] as string;
      if (rows.some((row) => row.operation_id === operationId)) {
        return { rows: [] }; // ON CONFLICT DO NOTHING
      }
      rows.push({
        operation_id: operationId,
        mode: values[1],
        source_project_id: values[2],
        target_project_id: values[3],
        source_canonical_root: values[4],
        target_canonical_root: values[5],
        request_hash: values[6],
        plan_hash: values[7],
        result: values[8], // stored as JSON string; parsed on read
      });
      return { rows: [] };
    }
    return { rows: [] };
  }
}

function baselineClient(): FakeTransactionClient {
  return new FakeTransactionClient({
    columns: [
      { table_name: "workspaces", column_name: "project_id", data_type: "text" },
      { table_name: "workspaces", column_name: "project_path", data_type: "text" },
      { table_name: "workspaces", column_name: "active_graph_generation_id", data_type: "text" },
      { table_name: "workspaces", column_name: "pending_graph_generation_id", data_type: "text" },
      { table_name: "memories", column_name: "id", data_type: "text" },
      { table_name: "memories", column_name: "project_id", data_type: "text" },
      { table_name: "memories", column_name: "metadata", data_type: "jsonb" },
      { table_name: "memories", column_name: "tags", data_type: "ARRAY" },
      { table_name: "documents", column_name: "id", data_type: "text" },
      { table_name: "documents", column_name: "project_id", data_type: "text" },
      { table_name: "scheduled_jobs", column_name: "id", data_type: "text" },
      { table_name: "scheduled_jobs", column_name: "payload", data_type: "text" },
      { table_name: "graph_generations", column_name: "id", data_type: "text" },
      { table_name: "graph_generations", column_name: "project_id", data_type: "text" },
      { table_name: "graph_generations", column_name: "status", data_type: "text" },
      { table_name: "graph_generations", column_name: "activated_at", data_type: "timestamptz" },
      { table_name: "symbol_files", column_name: "id", data_type: "text" },
      { table_name: "symbol_files", column_name: "project_id", data_type: "text" },
      { table_name: "symbol_files", column_name: "generation_id", data_type: "text" },
      { table_name: "operation_log", column_name: "id", data_type: "text" },
      { table_name: "operation_log", column_name: "project_id", data_type: "text" },
    ],
    primaryKeys: [
      { table_name: "workspaces", columns: ["project_id"] },
      { table_name: "memories", columns: ["id"] },
      { table_name: "documents", columns: ["id"] },
      { table_name: "scheduled_jobs", columns: ["id"] },
      { table_name: "graph_generations", columns: ["id"] },
      { table_name: "symbol_files", columns: ["id"] },
      { table_name: "operation_log", columns: ["id"] },
    ],
    tables: {},
  });
}

function withSourceAndTarget(
  client: FakeTransactionClient,
  mode: "rename" | "merge",
  overrides: { sourcePath?: string; targetPath?: string } = {},
): { client: FakeTransactionClient; source: string; target: string } {
  const source = "source";
  const target = "target";
  const sourcePath = overrides.sourcePath ?? "/repos/app";
  const targetPath = overrides.targetPath ?? (mode === "merge" ? "/repos/app" : "/repos/app");
  client.tables.workspaces = [
    { project_id: source, project_path: sourcePath, active_graph_generation_id: null, pending_graph_generation_id: null },
    ...(mode === "merge"
      ? [{ project_id: target, project_path: targetPath, active_graph_generation_id: null, pending_graph_generation_id: null }]
      : []),
  ];
  client.tables.memories = [
    { id: "m1", project_id: source, metadata: { projectId: "source" }, tags: ["handoff:source"] },
  ];
  client.tables.documents = [
    { id: "d1", project_id: source },
  ];
  client.tables.scheduled_jobs = [
    { id: "j1", payload: JSON.stringify({ projectId: "source" }) },
  ];
  client.tables.operation_log = [
    { id: "log1", project_id: source },
  ];
  client.tables.project_identity_aliases = [];
  client.tables.project_identity_operations = [];
  return { client, source, target };
}

function serviceFor(client: FakeTransactionClient): ProjectIdentityApplyService {
  return new ProjectIdentityApplyService({
    withTransaction: async <T,>(body: (c: FakeTransactionClient) => Promise<T>): Promise<T> => {
      await client.beginTransaction();
      try {
        const result = await body(client);
        await client.commitTransaction();
        return result;
      } catch (error) {
        try { await client.rollbackTransaction(); } catch { /* best-effort */ }
        throw error;
      }
    },
  });
}

async function previewHash(
  client: FakeTransactionClient,
  mode: "rename" | "merge",
  source: string,
  target: string,
): Promise<string> {
  const plan = await computeIdentityPlan(client, { mode, sourceProjectId: source, targetProjectId: target });
  // Rebuild the canonical plan material using the same targetCanonicalRoot rule
  // the public preview uses (null when target absent).
  return hashProjectIdentityPlan({
    planVersion: PROJECT_IDENTITY_PLAN_VERSION,
    mode: plan.mode,
    sourceProjectId: plan.sourceProjectId,
    targetProjectId: plan.targetProjectId,
    sourceCanonicalRoot: plan.sourceCanonicalRoot,
    targetCanonicalRoot: plan.hasTarget ? plan.targetCanonicalRoot : null,
    stores: plan.stores,
    conflicts: plan.conflicts,
    unknownStores: plan.unknownStores,
    storageFingerprint: plan.storageFingerprint,
  });
}

describe("project identity apply — idempotency", () => {
  test("repeated operationId with same material returns stored result and performs no further mutation", async () => {
    const { client, source, target } = withSourceAndTarget(baselineClient(), "rename");
    const service = serviceFor(client);
    const planHash = await previewHash(client, "rename", source, target);
    const request = {
      mode: "rename" as const,
      sourceProjectId: source,
      targetProjectId: target,
      dryRun: false as const,
      operationId: "op-retry-1",
      expectedPlanHash: planHash,
    };
    const first = await service.apply(request);
    const mutationsAfterFirst = client.mutations;
    const aliasCount = client.tables.project_identity_aliases!.length;

    // Reset mutation counter and re-apply with the same operationId.
    client.mutations = 0;
    const second = await service.apply(request);

    expect(second.operationId).toBe("op-retry-1");
    expect(second.sourceProjectId).toBe(source);
    expect(second.targetProjectId).toBe(target);
    expect(second.planHash).toBe(planHash);
    expect(client.mutations).toBe(0); // no writes on the idempotent path
    expect(mutationsAfterFirst).toBeGreaterThan(0);
    expect(client.tables.project_identity_operations!.length).toBe(1);
    expect(client.tables.project_identity_aliases!.length).toBe(aliasCount);
    expect(first.operationId).toBe(second.operationId);
    expect(first.planHash).toBe(second.planHash);
  });

  test("operationId reused with different material throws OPERATION_REUSED and performs no mutation", async () => {
    const { client, source, target } = withSourceAndTarget(baselineClient(), "rename");
    const service = serviceFor(client);
    const planHash = await previewHash(client, "rename", source, target);
    await service.apply({
      mode: "rename", sourceProjectId: source, targetProjectId: target,
      dryRun: false, operationId: "op-reuse", expectedPlanHash: planHash,
    });
    const operationsBefore = client.tables.project_identity_operations!.length;

    // Same operationId, different source → different request_hash.
    const { client: otherClient } = withSourceAndTarget(baselineClient(), "rename");
    // Seed the same operation row under a different request_hash.
    otherClient.tables.project_identity_operations = [{
      operation_id: "op-reuse",
      mode: "rename",
      source_project_id: "other-source",
      target_project_id: target,
      source_canonical_root: "/x",
      target_canonical_root: "/x",
      request_hash: hashProjectIdentityRequest({
        mode: "rename", sourceProjectId: "other-source", targetProjectId: target, operationId: "op-reuse",
      }),
      plan_hash: planHash,
      result: JSON.stringify({
        mode: "rename", dryRun: false, operationId: "op-reuse",
        sourceProjectId: "other-source", targetProjectId: target,
        sourceCanonicalRoot: "/x", targetCanonicalRoot: "/x", planHash,
        stores: [], committedAt: "2026-07-19T00:00:00.000Z",
      }),
    }];
    const otherService = serviceFor(otherClient);
    await expect(otherService.apply({
      mode: "rename", sourceProjectId: source, targetProjectId: target,
      dryRun: false, operationId: "op-reuse", expectedPlanHash: planHash,
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_OPERATION_REUSED" });

    expect(otherClient.tables.project_identity_operations!.length).toBe(operationsBefore);
    expect(otherClient.tables.project_identity_aliases?.length ?? 0).toBe(0);
  });
});

describe("project identity apply — gates before mutation", () => {
  test("expectedPlanHash mismatch throws PLAN_CHANGED with no mutation", async () => {
    const { client, source, target } = withSourceAndTarget(baselineClient(), "rename");
    const service = serviceFor(client);
    const snapshot = JSON.stringify({
      memories: client.tables.memories,
      workspaces: client.tables.workspaces,
      aliases: client.tables.project_identity_aliases,
      operations: client.tables.project_identity_operations,
    });
    await expect(service.apply({
      mode: "rename", sourceProjectId: source, targetProjectId: target,
      dryRun: false, operationId: "op-plan", expectedPlanHash: "0".repeat(64),
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_PLAN_CHANGED" });

    const after = JSON.stringify({
      memories: client.tables.memories,
      workspaces: client.tables.workspaces,
      aliases: client.tables.project_identity_aliases,
      operations: client.tables.project_identity_operations,
    });
    expect(after).toBe(snapshot);
  });

  test("conflict present throws CONFLICT with no mutation", async () => {
    const { client, source, target } = withSourceAndTarget(baselineClient(), "merge");
    // Introduce a key_collision: source and target memories with same id but different material.
    client.tables.memories = [
      { id: "collide", project_id: source, metadata: {}, tags: [] },
      { id: "collide", project_id: target, metadata: { other: true }, tags: [] },
    ];
    const planHash = await previewHash(client, "merge", source, target);
    const service = serviceFor(client);
    await expect(service.apply({
      mode: "merge", sourceProjectId: source, targetProjectId: target,
      dryRun: false, operationId: "op-conflict", expectedPlanHash: planHash,
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_CONFLICT" });
    expect(client.tables.project_identity_aliases?.length ?? 0).toBe(0);
    expect(client.tables.project_identity_operations?.length ?? 0).toBe(0);
  });

  test("unknown storage throws UNKNOWN_STORAGE with no mutation", async () => {
    const { client, source, target } = withSourceAndTarget(baselineClient(), "rename");
    client.columns.push({ table_name: "extension_data", column_name: "project_id", data_type: "text" });
    const planHash = await previewHash(client, "rename", source, target);
    const service = serviceFor(client);
    await expect(service.apply({
      mode: "rename", sourceProjectId: source, targetProjectId: target,
      dryRun: false, operationId: "op-unknown", expectedPlanHash: planHash,
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_UNKNOWN_STORAGE" });
    expect(client.tables.project_identity_aliases?.length ?? 0).toBe(0);
    expect(client.tables.project_identity_operations?.length ?? 0).toBe(0);
  });
});

describe("project identity apply — rename success", () => {
  test("moves source rows to target, creates alias, writes operation row, leaves zero mutable source refs", async () => {
    const { client, source, target } = withSourceAndTarget(baselineClient(), "rename");
    const planHash = await previewHash(client, "rename", source, target);
    const service = serviceFor(client);
    const result = await service.apply({
      mode: "rename", sourceProjectId: source, targetProjectId: target,
      dryRun: false, operationId: "op-rename", expectedPlanHash: planHash,
    });

    expect(result.mode).toBe("rename");
    expect(result.operationId).toBe("op-rename");
    expect(result.sourceProjectId).toBe(source);
    expect(result.targetProjectId).toBe(target);
    expect(result.targetCanonicalRoot).toBe(result.sourceCanonicalRoot);

    // Source rows moved on every mutable direct store.
    for (const table of ["memories", "documents", "workspaces"]) {
      const rows = client.tables[table]!;
      expect(rows.filter((row) => row.project_id === source).length).toBe(0);
      expect(rows.filter((row) => row.project_id === target).length).toBeGreaterThan(0);
    }
    // Payload store rewritten.
    expect(client.tables.scheduled_jobs![0]!.payload).toBe(JSON.stringify({ projectId: target }));
    // Alias + operation rows.
    expect(client.tables.project_identity_aliases).toEqual([
      expect.objectContaining({ retired_project_id: source, target_project_id: target, operation_id: "op-rename" }),
    ]);
    expect(client.tables.project_identity_operations!.length).toBe(1);
    expect(client.tables.project_identity_operations![0]!.operation_id).toBe("op-rename");
    // operation_log is immutable: source ref remains (allowed).
    expect(client.tables.operation_log![0]!.project_id).toBe(source);
    // Exactly one alias row, zero mutable source refs.
    expect(client.tables.project_identity_aliases!.length).toBe(1);
  });
});

describe("project identity apply — merge success", () => {
  test("dedupes byte-equivalent rows, newest activated generation becomes active, others superseded", async () => {
    const client = baselineClient();
    const source = "source";
    const target = "target";
    const path = "/repos/app";
    client.tables.workspaces = [
      { project_id: source, project_path: path, active_graph_generation_id: "g-source-active", pending_graph_generation_id: null },
      { project_id: target, project_path: path, active_graph_generation_id: "g-target-active", pending_graph_generation_id: null },
    ];
    client.tables.graph_generations = [
      { id: "g-source-active", project_id: source, status: "active", activated_at: "2026-07-19T10:00:00Z" },
      { id: "g-target-active", project_id: target, status: "active", activated_at: "2026-07-18T10:00:00Z" },
    ];
    // memories: one byte-equivalent duplicate (same id+material), one source-only.
    client.tables.memories = [
      { id: "dup", project_id: source, metadata: {}, tags: [] },
      { id: "dup", project_id: target, metadata: {}, tags: [] },
      { id: "uniq", project_id: source, metadata: { projectId: "source" }, tags: [] },
    ];
    client.tables.documents = [{ id: "d1", project_id: source }];
    client.tables.scheduled_jobs = [{ id: "j1", payload: JSON.stringify({ projectId: "source" }) }];
    client.tables.operation_log = [{ id: "log1", project_id: source }];
    client.tables.project_identity_aliases = [];
    client.tables.project_identity_operations = [];
    client.tables.symbol_files = [
      { id: "f1", project_id: source, generation_id: "g-source-active" },
      { id: "f2", project_id: target, generation_id: "g-target-active" },
    ];

    const planHash = await previewHash(client, "merge", source, target);
    const service = serviceFor(client);
    const result = await service.apply({
      mode: "merge", sourceProjectId: source, targetProjectId: target,
      dryRun: false, operationId: "op-merge", expectedPlanHash: planHash,
    });

    expect(result.mode).toBe("merge");
    expect(result.operationId).toBe("op-merge");
    // Duplicate memory dropped; unique memory moved.
    const memories = client.tables.memories!;
    const dupRows = memories.filter((row) => row.id === "dup");
    expect(dupRows.length).toBe(1);
    expect(dupRows[0]!.project_id).toBe(target);
    const uniqRow = memories.find((row) => row.id === "uniq");
    expect(uniqRow?.project_id).toBe(target);
    expect(uniqRow?.metadata).toEqual({ projectId: target });
    // Source workspace retired; target kept.
    expect(client.tables.workspaces!.filter((row) => row.project_id === source).length).toBe(0);
    expect(client.tables.workspaces!.filter((row) => row.project_id === target).length).toBe(1);
    // Generations consolidated under target; newest activated wins.
    const generations = client.tables.graph_generations!;
    expect(generations.filter((row) => row.project_id === source).length).toBe(0);
    const active = generations.filter((row) => row.status === "active");
    expect(active.length).toBe(1);
    expect(active[0]!.id).toBe("g-source-active");
    const superseded = generations.filter((row) => row.status === "superseded");
    expect(superseded.map((row) => row.id).sort()).toEqual(["g-target-active"]);
    // Alias + operation.
    expect(client.tables.project_identity_aliases).toEqual([
      expect.objectContaining({ retired_project_id: source, target_project_id: target }),
    ]);
    expect(client.tables.project_identity_operations!.length).toBe(1);
    // Zero mutable source refs.
    for (const table of ["memories", "documents", "workspaces", "graph_generations", "symbol_files"]) {
      expect(client.tables[table]!.filter((row) => row.project_id === source).length).toBe(0);
    }
    // operation_log is immutable.
    expect(client.tables.operation_log![0]!.project_id).toBe(source);
  });

  test("preserves the target workspace's in-flight pending graph generation pointer", async () => {
    const client = baselineClient();
    const source = "source";
    const target = "target";
    const path = "/repos/app";
    client.tables.workspaces = [
      { project_id: source, project_path: path, active_graph_generation_id: "g-source-active", pending_graph_generation_id: null },
      { project_id: target, project_path: path, active_graph_generation_id: "g-target-active", pending_graph_generation_id: "g-target-pending" },
    ];
    client.tables.graph_generations = [
      { id: "g-source-active", project_id: source, status: "active", activated_at: "2026-07-19T10:00:00Z" },
      { id: "g-target-active", project_id: target, status: "active", activated_at: "2026-07-18T10:00:00Z" },
      { id: "g-target-pending", project_id: target, status: "pending", activated_at: null },
    ];
    client.tables.memories = [
      { id: "uniq", project_id: source, metadata: { projectId: "source" }, tags: [] },
    ];
    client.tables.documents = [{ id: "d1", project_id: source }];
    client.tables.scheduled_jobs = [];
    client.tables.operation_log = [{ id: "log1", project_id: source }];
    client.tables.project_identity_aliases = [];
    client.tables.project_identity_operations = [];
    client.tables.symbol_files = [];

    const planHash = await previewHash(client, "merge", source, target);
    const service = serviceFor(client);
    await service.apply({
      mode: "merge", sourceProjectId: source, targetProjectId: target,
      dryRun: false, operationId: "op-merge-pending", expectedPlanHash: planHash,
    });

    const survivingTarget = client.tables.workspaces!.find((row) => row.project_id === target);
    expect(survivingTarget).toBeDefined();
    // The target's in-flight pending pointer must be restored, not silently lost.
    expect(survivingTarget!.pending_graph_generation_id).toBe("g-target-pending");
    // The newest activated generation still wins the active slot.
    expect(survivingTarget!.active_graph_generation_id).toBe("g-source-active");
    // The pending generation row itself is untouched (still pending).
    const pendingGen = client.tables.graph_generations!.find((row) => row.id === "g-target-pending");
    expect(pendingGen?.status).toBe("pending");
  });
});

describe("project identity apply — concurrent retry race", () => {
  test("post-lock idempotency re-read wins the race when a winner commits mid-flight", async () => {
    const { client, source, target } = withSourceAndTarget(baselineClient(), "rename");
    const planHash = await previewHash(client, "rename", source, target);
    const service = serviceFor(client);
    const operationId = "op-race";

    const requestHash = hashProjectIdentityRequest({
      mode: "rename", sourceProjectId: source, targetProjectId: target, operationId,
    });
    // Build a fully-formed operation row a concurrent winner would have committed
    // between this client's pre-lock read (returns no row) and its post-lock read.
    const storedResult = {
      mode: "rename", dryRun: false, operationId,
      sourceProjectId: source, targetProjectId: target,
      sourceCanonicalRoot: "/repos/app", targetCanonicalRoot: "/repos/app",
      planHash, stores: [], committedAt: "2026-07-19T00:00:00.000Z",
    };
    client.deferredOperationRow = {
      operation_id: operationId,
      request_hash: requestHash,
      result: JSON.stringify(storedResult),
    };

    const result = await service.apply({
      mode: "rename", sourceProjectId: source, targetProjectId: target,
      dryRun: false, operationId, expectedPlanHash: planHash,
    });

    // The loser returns the stored result the winner wrote.
    expect(result.operationId).toBe(operationId);
    expect(result.sourceProjectId).toBe(source);
    expect(result.targetProjectId).toBe(target);
    expect(result.planHash).toBe(planHash);
    expect(result.committedAt).toBe("2026-07-19T00:00:00.000Z");
    // The post-lock re-check wins the race: ZERO mutations, no alias insert,
    // no operation row inserted by this (losing) call.
    expect(client.mutations).toBe(0);
    expect(client.tables.project_identity_aliases?.length ?? 0).toBe(0);
    expect(client.tables.project_identity_operations?.length ?? 0).toBe(0);
    // Source rows untouched: the loser never reached the rewrite path.
    expect(client.tables.memories!.every((row) => row.project_id === source)).toBe(true);
    // The pre-lock (count=1) and post-lock (count=2) reads both fired.
    expect(client.operationReadCount).toBeGreaterThanOrEqual(2);
  });
});

describe("project identity apply — rollback failpoint", () => {
  test("injected failure after first mutation rolls back to pre-apply snapshot", async () => {
    const { client, source, target } = withSourceAndTarget(baselineClient(), "rename");
    const planHash = await previewHash(client, "rename", source, target);
    const service = serviceFor(client);

    const before = JSON.stringify(canonicalProjectIdentityJson({
      memories: client.tables.memories,
      workspaces: client.tables.workspaces,
      documents: client.tables.documents,
      scheduled_jobs: client.tables.scheduled_jobs,
      aliases: client.tables.project_identity_aliases,
      operations: client.tables.project_identity_operations,
    }));
    client.injectFailureAfterFirstMutation(new Error("failpoint-mid-apply"));

    await expect(service.apply({
      mode: "rename", sourceProjectId: source, targetProjectId: target,
      dryRun: false, operationId: "op-fail", expectedPlanHash: planHash,
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_BACKEND_UNAVAILABLE" });

    const after = JSON.stringify(canonicalProjectIdentityJson({
      memories: client.tables.memories,
      workspaces: client.tables.workspaces,
      documents: client.tables.documents,
      scheduled_jobs: client.tables.scheduled_jobs,
      aliases: client.tables.project_identity_aliases,
      operations: client.tables.project_identity_operations,
    }));
    expect(after).toBe(before);
    expect(client.tables.project_identity_aliases?.length ?? 0).toBe(0);
    expect(client.tables.project_identity_operations?.length ?? 0).toBe(0);
    // Source identity intact.
    expect(client.tables.memories!.every((row) => row.project_id === source)).toBe(true);
  });
});

describe("project identity apply — error sanitization", () => {
  test("thrown error messages never expose SQL, payloads, or operation material", async () => {
    const { client, source, target } = withSourceAndTarget(baselineClient(), "rename");
    const planHash = await previewHash(client, "rename", source, target);
    const service = serviceFor(client);
    client.injectFailureAfterFirstMutation(new Error("SELECT secret FROM credentials; payload=xyz"));
    try {
      await service.apply({
        mode: "rename", sourceProjectId: source, targetProjectId: target,
        dryRun: false, operationId: "op-leak", expectedPlanHash: planHash,
      });
      throw new Error("expected apply to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectIdentityError);
      const message = (error as Error).message;
      expect(message).not.toContain("SELECT");
      expect(message).not.toContain("secret");
      expect(message).not.toContain("payload");
      expect(message).not.toContain(source);
      expect(message).not.toContain(target);
    }
  });
});

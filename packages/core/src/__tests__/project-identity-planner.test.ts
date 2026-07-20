import { describe, expect, test } from "bun:test";

import {
  ProjectIdentityError,
  ProjectIdentityPreviewPlanner,
  discoverProjectIdentityStorage,
  inspectIdentityPayload,
  type ProjectIdentityQueryClient,
} from "../services/project-identity/index.js";

type Row = Record<string, unknown>;

class FakeClient implements ProjectIdentityQueryClient {
  columns: Row[] = [
    { table_name: "workspaces", column_name: "project_id", data_type: "text" },
    { table_name: "workspaces", column_name: "project_path", data_type: "text" },
    { table_name: "memories", column_name: "project_id", data_type: "text" },
    { table_name: "memories", column_name: "metadata", data_type: "jsonb" },
    { table_name: "memories", column_name: "tags", data_type: "ARRAY" },
    { table_name: "scheduled_jobs", column_name: "payload", data_type: "text" },
    { table_name: "vector_documents_768d", column_name: "project_id", data_type: "text" },
    { table_name: "vector_documents_768d", column_name: "metadata", data_type: "jsonb" },
    { table_name: "synapse_sessions", column_name: "workspace_id", data_type: "text" },
  ];
  primaryKeys: Row[] = [
    { table_name: "workspaces", columns: ["project_id"] },
    { table_name: "memories", columns: ["id"] },
    { table_name: "vector_documents_768d", columns: ["id"] },
    { table_name: "synapse_sessions", columns: ["session_id"] },
  ];
  workspaces: Row[] = [
    { project_id: "source", project_path: "/repos/app" },
    { project_id: "target", project_path: "/repos/app" },
  ];
  aliases: Row[] = [];
  tables: Record<string, Row[]> = {
    workspaces: this.workspaces,
    memories: [
      { id: "m1", project_id: "source", metadata: { projectId: "source" }, tags: ["handoff:source"] },
      { id: "m2", project_id: "target", metadata: {}, tags: [] },
    ],
    scheduled_jobs: [{ id: "j1", payload: '{"projectId":"source"}' }],
    vector_documents_768d: [
      { id: "v1", project_id: "source", metadata: { marker: { projectId: "source" } } },
    ],
    synapse_sessions: [{ session_id: "s1", workspace_id: "source" }],
  };

  async query<T = Row>(text: string, values: readonly unknown[] = []): Promise<{ rows: T[] }> {
    if (text.includes("information_schema.columns")) return { rows: this.columns as T[] };
    if (text.includes("information_schema.table_constraints")) return { rows: this.primaryKeys as T[] };
    if (text.includes("FROM workspaces WHERE")) {
      return { rows: this.workspaces.filter((row) => values.includes(row.project_id)) as T[] };
    }
    if (text.includes("FROM project_identity_aliases")) {
      return { rows: this.aliases.filter((row) => values.includes(row.retired_project_id)) as T[] };
    }
    const table = text.match(/FROM "([a-z0-9_]+)"/)?.[1];
    if (!table) throw new Error(`Unexpected query: ${text}`);
    const rows = this.tables[table] ?? [];
    const identityColumn = text.match(/WHERE "(project_id|workspace_id)"/)?.[1];
    if (identityColumn) {
      return { rows: rows.filter((row) => values.includes(row[identityColumn])) as T[] };
    }
    const column = text.match(/SELECT "([a-z0-9_]+)" AS payload_value/)?.[1];
    // Planner scopes payload scans to the source/target rows when the table
    // carries project_id; unscoped tables (scheduled_jobs) scan all rows.
    const scoped = /"project_id"\s*=\s*\$1/i.test(text);
    return {
      rows: rows
        .filter((row) => row[column!] != null)
        .filter((row) => !scoped || values.includes(row.project_id))
        .map((row) => ({ payload_value: row[column!] })) as T[],
    };
  }
}

describe("project identity storage discovery", () => {
  test("classifies static and runtime direct stores plus registered payload adapters", async () => {
    const inventory = await discoverProjectIdentityStorage(new FakeClient());
    expect(inventory.unknownStores).toEqual([]);
    expect(inventory.directStores.map((store) => `${store.storeId}.${store.identityColumn}`)).toEqual([
      "memories.project_id",
      "synapse_sessions.workspace_id",
      "vector_documents_768d.project_id",
      "workspaces.project_id",
    ]);
    expect(inventory.payloadStores.map((store) => `${store.storeId}.${store.column}`)).toEqual([
      "memories.metadata",
      "memories.tags",
      "scheduled_jobs.payload",
      "vector_documents_768d.metadata",
    ]);
  });

  test("blocks unregistered scoped columns and suspicious scoped tables", async () => {
    const client = new FakeClient();
    client.columns.push(
      { table_name: "plugin_records", column_name: "project_id", data_type: "text" },
      { table_name: "workspace_shadow", column_name: "owner", data_type: "text" },
    );
    const inventory = await discoverProjectIdentityStorage(client);
    expect(inventory.unknownStores).toEqual([
      "plugin_records.project_id",
      "workspace_shadow",
    ]);
  });

  test("excludes heavy bytea/vector columns from row material but keeps text content", async () => {
    const client = new FakeClient();
    client.columns.push(
      { table_name: "memories", column_name: "embedding", data_type: "bytea" },
      { table_name: "memories", column_name: "content", data_type: "text" },
    );
    const inventory = await discoverProjectIdentityStorage(client);
    const memories = inventory.directStores.find((store) => store.storeId === "memories");
    expect(memories?.materialColumns).toContain("content");
    expect(memories?.materialColumns).not.toContain("embedding");
    expect(memories?.materialColumns).not.toContain("project_id");
  });

  test("finds nested marker identities and treats malformed registered payloads as corruption", () => {
    expect(inspectIdentityPayload(
      { marker: { workspace_id: "source" }, projectId: "source" }, "json", "source",
    ).count).toBe(2);
    expect(inspectIdentityPayload("{bad", "json-text", "source").malformed).toBe(true);
    expect(inspectIdentityPayload(["handoff:source", "other"], "text-array", "source").count).toBe(1);
  });
});

describe("project identity preview planner", () => {
  test("returns direct/adapted counts and a content-sensitive deterministic hash", async () => {
    const client = new FakeClient();
    const planner = new ProjectIdentityPreviewPlanner(client);
    const request = { mode: "merge" as const, sourceProjectId: "source", targetProjectId: "target" };
    const first = await planner.preview(request);
    const second = await planner.preview(request);
    expect(first).toEqual(second);
    expect(first.conflicts).toEqual([]);
    expect(first.stores).toContainEqual({ storeId: "memories", directCount: 1, adaptedCount: 2 });
    expect(first.stores).toContainEqual({ storeId: "scheduled_jobs", directCount: 0, adaptedCount: 1 });
    expect(first.stores).toContainEqual({ storeId: "vector_documents_768d", directCount: 1, adaptedCount: 1 });

    client.tables.memories![0]!.content = "changed after preview";
    const changed = await planner.preview(request);
    expect(changed.planHash).not.toBe(first.planHash);
  });

  test("payload fingerprint ignores unrelated projects in project_id-bearing tables", async () => {
    const request = { mode: "merge" as const, sourceProjectId: "source", targetProjectId: "target" };
    const baseline = await new ProjectIdentityPreviewPlanner(new FakeClient()).preview(request);

    // Spec req 1 (only relevant storage change may flip a preview) + T6 ledger
    // #10: a third project's payload row in a project_id-bearing table is
    // outside the source∪target scan, so an unrelated write between preview
    // and apply must leave the plan untouched. A global-scan regression
    // (T7 verifier mutant M4) flips this hash.
    const withThird = new FakeClient();
    withThird.tables.memories!.push({
      id: "m3",
      project_id: "third",
      metadata: { projectId: "third", note: "unrelated write between preview and apply" },
      tags: ["handoff:third"],
    });
    const planner = new ProjectIdentityPreviewPlanner(withThird);
    const first = await planner.preview(request);
    expect(first.planHash).toBe(baseline.planHash);
    expect(first.stores).toEqual(baseline.stores);
    expect(first.conflicts).toEqual([]);

    withThird.tables.memories!.at(-1)!.metadata = { projectId: "third", note: "changed again" };
    const second = await planner.preview(request);
    expect(second.planHash).toBe(baseline.planHash);
  });

  test("reports key collisions, malformed payloads, and unknown storage without mutation", async () => {
    const client = new FakeClient();
    client.tables.memories = [
      { id: "same", project_id: "source", content: "source", metadata: {}, tags: [] },
      { id: "same", project_id: "target", content: "target", metadata: {}, tags: [] },
    ];
    client.tables.scheduled_jobs = [{ id: "bad", payload: "not-json" }];
    client.columns.push({ table_name: "extension_data", column_name: "project_id", data_type: "text" });
    const preview = await new ProjectIdentityPreviewPlanner(client).preview({
      mode: "merge", sourceProjectId: "source", targetProjectId: "target",
    });
    expect(preview.conflicts).toContainEqual({ storeId: "memories", kind: "key_collision", count: 1 });
    expect(preview.conflicts).toContainEqual({ storeId: "scheduled_jobs", kind: "malformed_payload", count: 1 });
    expect(preview.unknownStores).toEqual(["extension_data.project_id"]);
  });

  test("enforces rename/merge target, canonical-root, and retired-ID rules", async () => {
    const client = new FakeClient();
    const planner = new ProjectIdentityPreviewPlanner(client);
    await expect(planner.preview({ mode: "rename", sourceProjectId: "source", targetProjectId: "target" }))
      .rejects.toMatchObject({ code: "PROJECT_IDENTITY_TARGET_EXISTS" });
    client.workspaces[1]!.project_path = "/repos/other";
    await expect(planner.preview({ mode: "merge", sourceProjectId: "source", targetProjectId: "target" }))
      .rejects.toMatchObject({ code: "PROJECT_IDENTITY_ROOT_MISMATCH" });
    client.workspaces.pop();
    client.tables.workspaces = client.workspaces;
    await expect(planner.preview({ mode: "merge", sourceProjectId: "source", targetProjectId: "target" }))
      .rejects.toMatchObject({ code: "PROJECT_IDENTITY_TARGET_NOT_FOUND" });
    client.aliases.push({ retired_project_id: "source", target_project_id: "other" });
    await expect(planner.preview({ mode: "rename", sourceProjectId: "source", targetProjectId: "unused" }))
      .rejects.toBeInstanceOf(ProjectIdentityError);
  });
});

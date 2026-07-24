import { describe, expect, test } from "bun:test";
import { PgCheckpointStore } from "../services/checkpoint/checkpoint-store-pg.js";
import type { CheckpointRow } from "../services/checkpoint/checkpoint-store-pg.js";
import { TaskState, CheckpointType } from "@massa-ai/shared";
import { SchemaAheadError } from "../services/structural/schema-version.js";

/**
 * DB-free guard test: exercise rowToCheckpoint's schema-ahead branch directly
 * (the method is pure — only ensureHydrated touches PG). We cast to access the
 * private method and feed it synthetic rows with varying state_schema_version.
 */

function makeRow(overrides: Partial<CheckpointRow> = {}): CheckpointRow {
  const state: TaskState = {
    taskId: "task_1",
    description: "t",
    messages: [],
  } as unknown as TaskState;
  const json = JSON.stringify(state);
  const compressed = Buffer.from(Bun.deflateSync(Buffer.from(json, "utf-8")));
  return {
    id: "ckpt_test_1",
    task_id: "task_1",
    task_description: null,
    agent_id: null,
    project_id: null,
    state: compressed,
    state_schema_version: 1,
    memory_ids: null,
    file_changes: null,
    checkpoint_type: CheckpointType.MANUAL,
    parent_checkpoint_id: null,
    created_at: Date.now(),
    expires_at: null,
    ...overrides,
  };
}

describe("PgCheckpointStore rowToCheckpoint schema-ahead guard", () => {
  test("current version (1) passes through", () => {
    const store = new PgCheckpointStore();
    const rowToCheckpoint = (
      store as unknown as { rowToCheckpoint: (r: CheckpointRow) => unknown }
    ).rowToCheckpoint.bind(store);
    expect(() => rowToCheckpoint(makeRow({ state_schema_version: 1 }))).not.toThrow();
  });

  test("absent / null version passes through", () => {
    const store = new PgCheckpointStore();
    const rowToCheckpoint = (
      store as unknown as { rowToCheckpoint: (r: CheckpointRow) => unknown }
    ).rowToCheckpoint.bind(store);
    expect(() =>
      rowToCheckpoint(makeRow({ state_schema_version: null as unknown as number })),
    ).not.toThrow();
  });

  test("strictly-newer integer version (2) throws SchemaAheadError", () => {
    const store = new PgCheckpointStore();
    const rowToCheckpoint = (
      store as unknown as { rowToCheckpoint: (r: CheckpointRow) => unknown }
    ).rowToCheckpoint.bind(store);
    try {
      rowToCheckpoint(makeRow({ state_schema_version: 2 }));
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaAheadError);
      const err = e as SchemaAheadError;
      expect(err.context.kind).toBe("checkpoint");
      expect(err.context.stored).toBe("2.0.0");
      expect(err.context.supported).toBe("1.0.0");
    }
  });
});

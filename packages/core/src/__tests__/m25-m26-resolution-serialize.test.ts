/**
 * T35 — M25 (project name-tail resolution) + M26 (escaped JSON extraction).
 *
 * M25: WorkspaceManager.resolveByNameTail — unique → return; ambiguous → error
 *      with candidates; none → not-found.
 * M26: serializeToolResponse / projectFields / unescapeJsonField — unescape
 *      escaped JSON, return nested structures, clear error on failure.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  projectFields,
  unescapeJsonField,
  serializeToolResponse,
} from "../tools/serialize.js";

// ── M26: escaped JSON extraction ────────────────────────────────────────────

describe("T35 M26: escaped JSON extraction", () => {
  test("escaped JSON object string → parsed nested object", () => {
    const data = { config: '{"key":"value","nested":{"a":1}}' };
    const result = projectFields(data, ["config"]);
    expect(result).toEqual({ config: { key: "value", nested: { a: 1 } } });
  });

  test("escaped JSON array string → parsed nested array", () => {
    const data = { items: '[1,2,3]' };
    const result = projectFields(data, ["items"]);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  test("doubly-escaped JSON (with \\\" patterns) → unescaped + parsed", () => {
    const data = { config: '{\\"key\\":\\"value\\"}' };
    const result = projectFields(data, ["config"]);
    expect(result).toEqual({ config: { key: "value" } });
  });

  test("non-JSON string → unchanged (returned as-is)", () => {
    const data = { name: "hello world" };
    const result = projectFields(data, ["name"]);
    expect(result).toEqual({ name: "hello world" });
  });

  test("already-parsed object → returned as-is (no re-parsing)", () => {
    const data = { config: { key: "value" } };
    const result = projectFields(data, ["config"]);
    expect(result).toEqual({ config: { key: "value" } });
  });

  test("invalid JSON string → unescaped string returned (clear, no throw)", () => {
    const data = { config: '{"key": invalid}' };
    const result = projectFields(data, ["config"]);
    // Should not throw; should return the (unescaped) string
    expect(typeof result).toBe("object");
    expect(typeof (result as any).config).toBe("string");
    expect((result as any).config).toContain("key");
  });

  test("scalar values (number, boolean, null) → unchanged", () => {
    const data = { count: 42, active: true, empty: null };
    const result = projectFields(data, ["count", "active", "empty"]);
    expect(result).toEqual({ count: 42, active: true, empty: null });
  });

  test("unescapeJsonField direct: escaped JSON object", () => {
    const result = unescapeJsonField('{\\"key\\":\\"value\\"}');
    expect(result).toEqual({ key: "value" });
  });

  test("unescapeJsonField direct: plain JSON object", () => {
    const result = unescapeJsonField('{"key":"value"}');
    expect(result).toEqual({ key: "value" });
  });

  test("unescapeJsonField direct: non-JSON string unchanged", () => {
    const result = unescapeJsonField("hello world");
    expect(result).toBe("hello world");
  });

  test("unescapeJsonField direct: null/undefined passthrough", () => {
    expect(unescapeJsonField(null)).toBe(null);
    expect(unescapeJsonField(undefined)).toBe(undefined);
  });

  test("serializeToolResponse with escaped JSON field → nested in result", () => {
    const result = serializeToolResponse(
      { config: '{\\"name\\":\\"test\\",\\"count\\":3}' },
      { fields: ["config"] },
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ config: { name: "test", count: 3 } });
  });
});

// ── M25: project name-tail resolution ───────────────────────────────────────
//
// resolveByNameTail reads getSymbolRepository().listWorkspaces() and matches
// by the last path segment of project_path OR the project_id. We mock the
// symbol-repository-factory so listWorkspaces returns a controllable row set,
// and stub event-bus + symbol-graph.service so the WorkspaceManager singleton
// constructs without touching a live DB or global event subscribers.

import type { WorkspaceRow } from "../data/symbol/symbol-repository-pg.js";

let mockWorkspaces: WorkspaceRow[] = [];
let listCallCount = 0;

mock.module("../data/symbol/symbol-repository-factory.js", () => ({
  getSymbolRepository: () => ({
    listWorkspaces: async () => {
      listCallCount++;
      return mockWorkspaces;
    },
  }),
}));

mock.module("../services/events/event-bus.js", () => ({
  eventBus: {
    subscribe: () => () => {},
    publish: () => {},
  },
}));

mock.module("../services/symbol/symbol-graph.service.js", () => ({
  symbolGraphService: {
    recomputeCentrality: async () => {},
  },
}));

const { WorkspaceManager } = await import("../services/workspace/workspace-manager.js");

function makeRow(projectId: string, projectPath: string): WorkspaceRow {
  return {
    project_id: projectId,
    project_path: projectPath,
    display_name: projectPath.split("/").pop() ?? projectPath,
    status: "indexed",
    files_count: 0,
    chunks_count: 0,
    symbols_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  } as WorkspaceRow;
}

describe("T35 M25: project name-tail resolution (behavior)", () => {
  beforeEach(() => {
    mockWorkspaces = [];
    listCallCount = 0;
  });

  test("unique name tail → returns the matching WorkspaceRow", async () => {
    mockWorkspaces = [
      makeRow("foo/bar/my-project", "/home/user/foo/bar/my-project"),
      makeRow("baz/qux/other-project", "/srv/baz/qux/other-project"),
    ];
    const wm = WorkspaceManager.getInstance();
    const result = await wm.resolveByNameTail("my-project");
    expect(result).not.toBeNull();
    expect(result!.project_id).toBe("foo/bar/my-project");
    expect(result!.project_path).toBe("/home/user/foo/bar/my-project");
  });

  test("ambiguous (multiple matches) → throws error listing candidates", async () => {
    mockWorkspaces = [
      makeRow("foo/bar/my-project", "/home/user/foo/bar/my-project"),
      makeRow("baz/qux/my-project", "/srv/baz/qux/my-project"),
    ];
    const wm = WorkspaceManager.getInstance();
    await expect(wm.resolveByNameTail("my-project")).rejects.toThrow(/Ambiguous/);
    await expect(wm.resolveByNameTail("my-project")).rejects.toThrow(
      /foo\/bar\/my-project.*baz\/qux\/my-project/,
    );
  });

  test("no match → returns null (not-found)", async () => {
    mockWorkspaces = [
      makeRow("foo/bar/something-else", "/home/user/foo/bar/something-else"),
    ];
    const wm = WorkspaceManager.getInstance();
    const result = await wm.resolveByNameTail("my-project");
    expect(result).toBeNull();
  });

  test("empty name tail → returns null (not-found) without querying", async () => {
    const wm = WorkspaceManager.getInstance();
    const result = await wm.resolveByNameTail("");
    expect(result).toBeNull();
    expect(listCallCount).toBe(0);
  });

  test("match by projectId (not path tail) → returns the row", async () => {
    mockWorkspaces = [
      makeRow("org/unique-id-123", "/some/path/unique-app"),
    ];
    const wm = WorkspaceManager.getInstance();
    // The project_id itself is a valid name-tail input (matches by id).
    const result = await wm.resolveByNameTail("org/unique-id-123");
    expect(result).not.toBeNull();
    expect(result!.project_id).toBe("org/unique-id-123");
  });
});
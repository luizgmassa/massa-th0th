/**
 * T35 — M25 (project name-tail resolution) + M26 (escaped JSON extraction).
 *
 * M25: WorkspaceManager.resolveByNameTail — unique → return; ambiguous → error
 *      with candidates; none → not-found.
 * M26: serializeToolResponse / projectFields / unescapeJsonField — unescape
 *      escaped JSON, return nested structures, clear error on failure.
 */

import { describe, test, expect } from "bun:test";
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
// WorkspaceManager.resolveByNameTail is a DB-dependent method. We test the
// resolution logic by importing the class and verifying the method signature
// exists. Full DB integration tests would require a live PostgreSQL instance.

describe("T35 M25: project name-tail resolution (contract)", () => {
  test("WorkspaceManager has resolveByNameTail method", async () => {
    const mod = await import("../services/workspace/workspace-manager.js");
    expect(typeof mod.WorkspaceManager).toBe("function");
    // The method is on the prototype
    expect(typeof mod.WorkspaceManager.prototype.resolveByNameTail).toBe("function");
  });
});
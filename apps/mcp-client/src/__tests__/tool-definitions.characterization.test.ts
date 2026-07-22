/**
 * ToolDefinitions — characterization tests (Wave 6 N31, T02)
 *
 * Purpose: pin the exact TOOL_DEFINITIONS roster before the Phase 3
 * facade split so any drift (dropped tool, renamed, reordered, changed
 * schema) is caught. These tests are mutation-killing anchors.
 *
 * NOTE: The spec design.md said "57 tools" — actual roster count is 52.
 * This characterization pins the ACTUAL count (52), not the spec number.
 * A future task that adds/removes a tool MUST update this test
 * intentionally (never silently).
 *
 * Discrimination spot-check: flip one tool name, reorder two entries,
 * delete the inputSchema of one tool; each must FAIL.
 */

import { describe, test, expect } from "bun:test";
import { TOOL_DEFINITIONS, getToolDefinition } from "../tool-definitions.js";

// ── Canonical roster (pinned order) ─────────────────────────────────────────
const EXPECTED_NAMES = [
  "index",
  "index_status",
  "search",
  "remember",
  "recall",
  "memory_update",
  "memory_delete",
  "list_checkpoints",
  "create_checkpoint",
  "restore_checkpoint",
  "compress",
  "optimized_context",
  "analytics",
  "list_projects",
  "project_map",
  "get_architecture",
  "search_definitions",
  "get_references",
  "go_to_definition",
  "trace_path",
  "impact_analysis",
  "reset_project",
  "read_file",
  "synapse_session",
  "synapse_get",
  "synapse_update",
  "synapse_end",
  "synapse_prime",
  "synapse_access",
  "synapse_prefetch",
  "synapse_list",
  "synapse_task_begin",
  "synapse_task_end",
  "symbol_snippet",
  "memory_list",
  "reindex",
  "hook_ingest",
  "compact_snapshot",
  "bootstrap",
  "handoff_begin",
  "handoff_accept",
  "handoff_cancel",
  "handoff_list_pending",
  "list_proposals",
  "approve_proposal",
  "reject_proposal",
  "execute",
  "execute_file",
  "batch_execute",
  "fetch_and_index",
  "rename_project",
  "merge_projects",
] as const;

describe("ToolDefinitions — characterization (T02)", () => {
  test("TOOL_DEFINITIONS count is exactly 52 (spec said 57 — actual is 52)", () => {
    expect(TOOL_DEFINITIONS.length).toBe(52);
  });

  test("every tool name matches the pinned roster in order", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual([...EXPECTED_NAMES]);
  });

  test("every tool has name, description, inputSchema, apiEndpoint, apiMethod", () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.inputSchema).toBe("object");
      expect(t.inputSchema).not.toBeNull();
      expect(typeof t.apiEndpoint).toBe("string");
      expect(["GET", "POST", "PATCH", "DELETE"]).toContain(t.apiMethod);
    }
  });

  test("getToolDefinition returns the correct def for each name", () => {
    for (const expected of EXPECTED_NAMES) {
      const def = getToolDefinition(expected);
      expect(def).toBeDefined();
      expect(def!.name).toBe(expected);
    }
  });

  test("getToolDefinition returns undefined for unknown names", () => {
    expect(getToolDefinition("nonexistent_tool")).toBeUndefined();
    expect(getToolDefinition("")).toBeUndefined();
    expect(getToolDefinition("Search")).toBeUndefined(); // case-sensitive
  });

  test("apiEndpoint always starts with /api/v1/", () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.apiEndpoint.startsWith("/api/v1/")).toBe(true);
    }
  });

  test("no duplicate tool names in the roster", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });
});
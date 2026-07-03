/**
 * Asserts the checkpoint tools are exposed to MCP hosts via TOOL_DEFINITIONS.
 * (The route-delegation behavior is covered by
 * apps/tools-api/src/routes/checkpoints.test.ts.)
 */

import { describe, test, expect } from "bun:test";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";

describe("checkpoint MCP exposure", () => {
  test("TOOL_DEFINITIONS exposes the three checkpoint tools with correct endpoints", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain("list_checkpoints");
    expect(names).toContain("create_checkpoint");
    expect(names).toContain("restore_checkpoint");

    const byName = Object.fromEntries(TOOL_DEFINITIONS.map((t) => [t.name, t]));
    expect(byName.list_checkpoints.apiEndpoint).toBe("/api/v1/checkpoints/list");
    expect(byName.create_checkpoint.apiEndpoint).toBe("/api/v1/checkpoints/create");
    expect(byName.restore_checkpoint.apiEndpoint).toBe("/api/v1/checkpoints/restore");
    expect(byName.create_checkpoint.apiMethod).toBe("POST");
  });
});

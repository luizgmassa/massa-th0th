/**
 * Asserts the checkpoint tools are exposed to MCP hosts via TOOL_DEFINITIONS.
 * (The route-delegation behavior is covered by
 * apps/tools-api/src/routes/checkpoints.test.ts.)
 */

import { describe, test, expect } from "bun:test";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";
import {
  STRUCTURAL_FQN_DESCRIPTION,
  STRUCTURAL_SYMBOL_KINDS,
} from "@massa-ai/shared";

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

describe("structural MCP contracts", () => {
  const byName = Object.fromEntries(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

  test("publishes all 18 canonical schema-v2 symbol kinds from shared source", () => {
    const schema = byName.search_definitions.inputSchema as any;
    expect(schema.properties.kind.anyOf[0].enum).toEqual(STRUCTURAL_SYMBOL_KINDS);
    expect(schema.properties.kind.anyOf[0].enum).toHaveLength(18);
    expect(schema.properties.kind.anyOf[1].items.enum).toEqual(STRUCTURAL_SYMBOL_KINDS);
  });

  test("documents the same explicit FQN ambiguity contract on every graph consumer", () => {
    expect(byName.go_to_definition.description).toContain(STRUCTURAL_FQN_DESCRIPTION);
    expect(byName.get_references.description).toContain(STRUCTURAL_FQN_DESCRIPTION);
    expect(byName.trace_path.description).toContain(STRUCTURAL_FQN_DESCRIPTION);
    expect((byName.trace_path.inputSchema as any).anyOf).toEqual([
      { required: ["function_name"] },
      { required: ["symbol"] },
      { required: ["qualifiedName"] },
    ]);
    expect(byName.project_map.description).toContain("parser-diagnostic summary");
    expect(byName.index_status.description).toContain("activatedGraphGenerationId");
  });
});

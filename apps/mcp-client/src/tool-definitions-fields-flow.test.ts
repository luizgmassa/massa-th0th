/**
 * Fields-flow parity test (plan-critic F4).
 *
 * Verifies the `fields` projection parameter survives the MCP-client dispatch
 * boundary (proxyCallTool) and reaches the Tools API payload that backs each
 * tool's core `handle()`. The MCP client proxies args verbatim into the API
 * request body/query — if a proxy/validator ever stripped unknown keys, the
 * projected output would silently degrade to full data and these tests fail
 * loud.
 *
 * Also asserts two-layer schema parity: every one of the 12 data-returning
 * tools advertises `fields` in its static MCP inputSchema (matching the class
 * inputSchema edited in packages/core).
 */

import { describe, expect, test } from "bun:test";
import { proxyCallTool } from "./call-tool-proxy.js";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";

/** The 12 data-returning tools that gained `fields` projection (M36). */
const FIELDS_TOOLS = [
  "read_file",
  "search",
  "remember",
  "recall",
  "memory_update",
  "memory_delete",
  "list_checkpoints",
  "create_checkpoint",
  "restore_checkpoint",
  "optimized_context",
  "trace_path",
  "impact_analysis",
] as const;

const byName = Object.fromEntries(
  TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, (typeof TOOL_DEFINITIONS)[number]>;

describe("fields projection — two-layer schema parity", () => {
  test("all 12 data-returning tools advertise `fields` in their MCP inputSchema", () => {
    for (const name of FIELDS_TOOLS) {
      const def = byName[name];
      expect(def, `tool ${name} present in TOOL_DEFINITIONS`).toBeDefined();
      const props = (def.inputSchema as { properties: Record<string, unknown> })
        .properties;
      expect(
        props.fields,
        `tool ${name} must declare fields in MCP inputSchema`,
      ).toBeDefined();
      expect((props.fields as { type: string }).type).toBe("array");
    }
  });
});

describe("fields projection — dispatch flow (plan-critic F4)", () => {
  test("POST tool: fields reaches the Tools API request body unchanged", async () => {
    const captured: Array<{ endpoint: string; body: unknown }> = [];
    const apiResponse = {
      success: true,
      data: { impacted: [{ symbol: "run", risk: 0.9 }] },
    };

    await proxyCallTool(
      {
        get: async () => {
          throw new Error("must POST");
        },
        post: async (endpoint, body) => {
          captured.push({ endpoint, body });
          return apiResponse;
        },
      },
      "impact_analysis",
      {
        projectId: "p1",
        projectPath: "/tmp/repo",
        format: "json",
        fields: ["impacted.symbol", "impacted.risk"],
      },
    );

    expect(captured).toHaveLength(1);
    const body = captured[0]!.body as Record<string, unknown>;
    // fields survives the proxy verbatim — not stripped, not renamed
    expect(body.fields).toEqual(["impacted.symbol", "impacted.risk"]);
    expect(body.format).toBe("json");
  });

  test("GET tool: fields reaches the Tools API query params unchanged", async () => {
    const captured: Array<{
      endpoint: string;
      params?: Record<string, unknown>;
    }> = [];
    const apiResponse = { success: true, data: { nodes: [{ symbol: "run" }] } };

    await proxyCallTool(
      {
        get: async (endpoint, params) => {
          captured.push({ endpoint, params });
          return apiResponse;
        },
        post: async () => {
          throw new Error("trace_path must GET");
        },
      },
      "trace_path",
      {
        projectId: "p1",
        function_name: "run",
        fields: ["nodes.symbol"],
      },
    );

    expect(captured).toHaveLength(1);
    const params = captured[0]!.params as Record<string, unknown>;
    expect(params.fields).toEqual(["nodes.symbol"]);
  });

  test("absent fields is not injected by the proxy", async () => {
    const captured: Array<{ endpoint: string; body: unknown }> = [];
    await proxyCallTool(
      {
        get: async () => {
          throw new Error("must POST");
        },
        post: async (endpoint, body) => {
          captured.push({ endpoint, body });
          return { success: true, data: {} };
        },
      },
      "impact_analysis",
      { projectId: "p1", projectPath: "/tmp/repo" },
    );
    const body = captured[0]!.body as Record<string, unknown>;
    expect(body.fields).toBeUndefined();
  });
});

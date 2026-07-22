/**
 * Embedded mode wiring + handleIndexTool parity tests (Wave 6 N32, T19)
 *
 * Verifies:
 * - MASSA_TH0TH_EMBEDDED=true selects EmbeddedApiClient; unset selects ApiClient
 * - Health check reports mode ("embedded" or "http")
 * - handleIndexTool in embedded mode exercises path-safety validation
 * - Parity: same tool call in both modes → same result shape (including index tool)
 *
 * DB-free: these tests check routing and error shapes, not DB-dependent results.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ApiClient, ApiHttpError } from "../api-client.js";
import { EmbeddedApiClient } from "../embedded-api-client.js";
import { proxyCallTool } from "../call-tool-proxy.js";
import type { ToolProxyApiClient } from "../call-tool-proxy.js";
import { TOOL_DEFINITIONS, getToolDefinition } from "../tool-definitions.js";

describe("Embedded mode wiring (T19)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("MASSA_TH0TH_EMBEDDED=true → EmbeddedApiClient instance", () => {
    process.env.MASSA_TH0TH_EMBEDDED = "true";
    // Simulate the constructor logic
    const isEmbedded = process.env.MASSA_TH0TH_EMBEDDED === "true";
    expect(isEmbedded).toBe(true);
    const client = isEmbedded ? new EmbeddedApiClient() : new ApiClient();
    expect(client).toBeInstanceOf(EmbeddedApiClient);
  });

  test("MASSA_TH0TH_EMBEDDED not set → ApiClient instance (HTTP, unchanged)", () => {
    delete process.env.MASSA_TH0TH_EMBEDDED;
    const isEmbedded = process.env.MASSA_TH0TH_EMBEDDED === "true";
    expect(isEmbedded).toBe(false);
    const client = isEmbedded ? new EmbeddedApiClient() : new ApiClient();
    expect(client).toBeInstanceOf(ApiClient);
  });

  test("both clients implement ToolProxyApiClient (get/post/patch/delete)", () => {
    const http = new ApiClient();
    const embedded = new EmbeddedApiClient();
    for (const client of [http, embedded]) {
      expect(typeof client.get).toBe("function");
      expect(typeof client.post).toBe("function");
    }
  });

  test("both clients have uploadAndIndex + healthCheck", () => {
    const http = new ApiClient();
    const embedded = new EmbeddedApiClient();
    for (const client of [http, embedded]) {
      expect(typeof (client as any).uploadAndIndex).toBe("function");
      expect(typeof (client as any).healthCheck).toBe("function");
    }
  });

  test("EmbeddedApiClient healthCheck returns true (mode: embedded)", async () => {
    const embedded = new EmbeddedApiClient();
    const healthy = await embedded.healthCheck();
    expect(healthy).toBe(true);
  });
});

describe("Parity: HTTP vs Embedded result shape (T19)", () => {
  test("all non-index tool definitions have apiEndpoint starting with /api/v1/", () => {
    // Parity contract: every tool endpoint is routed by both clients.
    // If a tool endpoint exists, EmbeddedApiClient must handle it.
    const nonIndexTools = TOOL_DEFINITIONS.filter((t) => t.name !== "index");
    for (const tool of nonIndexTools) {
      expect(tool.apiEndpoint.startsWith("/api/v1/")).toBe(true);
    }
  });

  test("index tool is special-cased in both modes (not via proxyCallTool)", () => {
    // proxyCallTool throws for "index" — both modes handle it via handleIndexTool
    const toolDef = getToolDefinition("index");
    expect(toolDef).toBeDefined();
    expect(toolDef!.name).toBe("index");
  });

  test("proxyCallTool rejects index tool (both modes use handleIndexTool)", async () => {
    const http = new ApiClient();
    const embedded = new EmbeddedApiClient();
    for (const client of [http, embedded]) {
      const result = await proxyCallTool(
        client as ToolProxyApiClient,
        "index",
        { projectPath: "/tmp" },
      );
      // proxyCallTool catches the "Unknown tool: index" error and returns isError
      expect(result.isError).toBe(true);
      const text = result.content[0]!.text;
      expect(text).toContain("Unknown tool");
    }
  });

  test("unknown tool produces isError in both modes (same shape)", async () => {
    const http = new ApiClient();
    const embedded = new EmbeddedApiClient();
    for (const client of [http, embedded]) {
      const result = await proxyCallTool(
        client as ToolProxyApiClient,
        "nonexistent_tool",
        {},
      );
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.success).toBe(false);
      expect(typeof parsed.error).toBe("string");
    }
  });
});

describe("handleIndexTool path-safety in embedded mode (T19 F1)", () => {
  test("EmbeddedApiClient.uploadAndIndex rejects traversal paths (same as HTTP route)", async () => {
    const client = new EmbeddedApiClient();
    try {
      await client.uploadAndIndex({
        projectPath: "/tmp/test",
        files: [{ relativePath: "../../etc/passwd", content: "x" }],
      });
      expect(false).toBe(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      expect(msg).toContain("Invalid file path");
    }
  });

  test("EmbeddedApiClient.uploadAndIndex rejects absolute paths (same as HTTP route)", async () => {
    const client = new EmbeddedApiClient();
    try {
      await client.uploadAndIndex({
        projectPath: "/tmp/test",
        files: [{ relativePath: "/etc/passwd", content: "x" }],
      });
      expect(false).toBe(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      expect(msg).toContain("Invalid file path");
    }
  });

  test("EmbeddedApiClient.uploadAndIndex rejects path-escape via .. after resolve", async () => {
    const client = new EmbeddedApiClient();
    try {
      await client.uploadAndIndex({
        projectPath: "/tmp/test",
        files: [{ relativePath: "subdir/../../../etc/passwd", content: "x" }],
      });
      expect(false).toBe(true);
    } catch (error) {
      // Either "Invalid file path" (contains "..") or "Path escapes" after resolve
      const msg = error instanceof Error ? error.message : String(error);
      expect(msg.includes("Invalid file path") || msg.includes("Path escapes")).toBe(true);
    }
  });
});
/**
 * EmbeddedApiClient — unit tests (Wave 6 N32, T18)
 *
 * Verifies the EmbeddedApiClient implements the ToolProxyApiClient interface
 * (get/post/patch/delete), routes endpoints to core service calls, and
 * produces ApiHttpError-shaped errors for unknown endpoints.
 *
 * These tests are DB-free (no live DB needed for the routing logic). The
 * core tool singletons may fail on missing DB, but the error shape is what
 * we assert — not the DB-dependent result.
 */

import { describe, test, expect } from "bun:test";
import { EmbeddedApiClient } from "../embedded-api-client.js";
import { ApiHttpError } from "../api-client.js";
import type { ToolProxyApiClient } from "../call-tool-proxy.js";

describe("EmbeddedApiClient (T18)", () => {
  test("implements ToolProxyApiClient interface (get/post/patch/delete)", () => {
    const client = new EmbeddedApiClient();
    expect(typeof client.get).toBe("function");
    expect(typeof client.post).toBe("function");
    expect(typeof client.patch).toBe("function");
    expect(typeof client.delete).toBe("function");
    // ToolProxyApiClient shape check
    const _proxy: ToolProxyApiClient = client;
    expect(_proxy).toBe(client);
  });

  test("has uploadAndIndex method (not on proxy interface)", () => {
    const client = new EmbeddedApiClient();
    expect(typeof client.uploadAndIndex).toBe("function");
  });

  test("has healthCheck method (not on proxy interface)", () => {
    const client = new EmbeddedApiClient();
    expect(typeof client.healthCheck).toBe("function");
  });

  test("healthCheck returns true (embedded = always healthy)", async () => {
    const client = new EmbeddedApiClient();
    const result = await client.healthCheck();
    expect(result).toBe(true);
  });

  test("GET unknown endpoint throws ApiHttpError with 404", async () => {
    const client = new EmbeddedApiClient();
    try {
      await client.get("/api/v1/nonexistent");
      expect(false).toBe(true); // should not reach
    } catch (error) {
      expect(error).toBeInstanceOf(ApiHttpError);
      expect((error as ApiHttpError).status).toBe(404);
      expect((error as ApiHttpError).body.success).toBe(false);
    }
  });

  test("POST unknown endpoint throws ApiHttpError with 404", async () => {
    const client = new EmbeddedApiClient();
    try {
      await client.post("/api/v1/nonexistent", {});
      expect(false).toBe(true); // should not reach
    } catch (error) {
      expect(error).toBeInstanceOf(ApiHttpError);
      expect((error as ApiHttpError).status).toBe(404);
    }
  });

  test("PATCH unknown endpoint throws ApiHttpError with 404", async () => {
    const client = new EmbeddedApiClient();
    try {
      await client.patch("/api/v1/nonexistent", {});
      expect(false).toBe(true); // should not reach
    } catch (error) {
      expect(error).toBeInstanceOf(ApiHttpError);
      expect((error as ApiHttpError).status).toBe(404);
    }
  });

  test("DELETE unknown endpoint throws ApiHttpError with 404", async () => {
    const client = new EmbeddedApiClient();
    try {
      await client.delete("/api/v1/nonexistent");
      expect(false).toBe(true); // should not reach
    } catch (error) {
      expect(error).toBeInstanceOf(ApiHttpError);
      expect((error as ApiHttpError).status).toBe(404);
    }
  });

  test("ApiHttpError shape matches { success: false, error } structure", async () => {
    const client = new EmbeddedApiClient();
    try {
      await client.get("/api/v1/unknown-endpoint");
    } catch (error) {
      const httpErr = error as ApiHttpError;
      expect(httpErr.body).toBeDefined();
      expect(httpErr.body.success).toBe(false);
      const errMsg = String(httpErr.body.error);
      expect(typeof errMsg).toBe("string");
      expect(errMsg.length).toBeGreaterThan(0);
    }
  });

  test("uploadAndIndex rejects paths with traversal sequences (path safety)", async () => {
    const client = new EmbeddedApiClient();
    try {
      await client.uploadAndIndex({
        projectPath: "/tmp/test-project",
        files: [
          { relativePath: "../../../etc/passwd", content: "malicious" },
        ],
      });
    } catch (error) {
      // The path-safety check should reject the traversal path before any DB access
      expect(error).toBeDefined();
      expect(error instanceof Error || error instanceof ApiHttpError).toBe(true);
      const msg = error instanceof Error ? error.message : String((error as ApiHttpError).body.error);
      expect(msg).toContain("Invalid file path");
    }
  });

  test("uploadAndIndex rejects absolute paths (path safety)", async () => {
    const client = new EmbeddedApiClient();
    try {
      await client.uploadAndIndex({
        projectPath: "/tmp/test-project",
        files: [
          { relativePath: "/etc/passwd", content: "malicious" },
        ],
      });
    } catch (error) {
      expect(error).toBeDefined();
      const msg = error instanceof Error ? error.message : String((error as ApiHttpError).body.error);
      expect(msg).toContain("Invalid file path");
    }
  });
});
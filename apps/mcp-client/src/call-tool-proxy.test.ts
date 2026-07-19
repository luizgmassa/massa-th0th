import { describe, expect, test } from "bun:test";
import { ApiHttpError } from "./api-client.js";
import {
  proxyCallTool,
  proxyToolRequest,
  type ToolProxyApiClient,
} from "./call-tool-proxy.js";

const projectId = "transport-project";
const legacyFqn = "src/service.ts#run";
const modernFqn = `src/service.ts#Service.run~method~${"a".repeat(64)}`;
const candidates = [{
  fqn: modernFqn,
  file: "src/service.ts",
  name: "run",
  displayName: "Service.run",
  qualifiedName: "Service.run",
  kind: "method",
  signatureHash: "a".repeat(64),
}];

const identities = {
  resolved: { status: "resolved", fqn: modernFqn },
  missing: { status: "missing", query: legacyFqn },
  ambiguous: { status: "ambiguous", legacyFqn, candidates },
} as const;

const structuralTools = [
  {
    name: "go_to_definition",
    args: { projectId, symbolName: legacyFqn },
    data: (identity: unknown) => ({ identity, definitions: [] }),
  },
  {
    name: "get_references",
    args: { projectId, symbolName: "run", fqn: legacyFqn },
    data: (identity: unknown) => ({ identity, references: [] }),
  },
  {
    name: "trace_path",
    args: { projectId, qualifiedName: legacyFqn },
    data: (identity: unknown) => ({ found: false, identity }),
  },
] as const;

describe("MCP CallTool structural transport", () => {
  test("preserves resolved, missing, and ambiguous HTTP payloads exactly for all graph consumers", async () => {
    for (const tool of structuralTools) {
      for (const identity of Object.values(identities)) {
        const httpResponse = { success: true, data: tool.data(identity) };
        const calls: Array<{ endpoint: string; params?: Record<string, unknown> }> = [];
        const result = await proxyCallTool({
          get: async (endpoint, params) => {
            calls.push({ endpoint, params });
            return httpResponse;
          },
          post: async () => { throw new Error("structural tools must use GET"); },
          patch: async () => { throw new Error("structural tools must use GET"); },
          delete: async () => { throw new Error("structural tools must use GET"); },
        }, tool.name, tool.args);

        expect(calls).toHaveLength(1);
        expect(JSON.parse(result.content[0]!.text)).toEqual(httpResponse);
      }
    }
  });

  test("preserves durable index diagnostics and generation identity exactly", async () => {
    const httpResponse = {
      success: true,
      data: {
        jobId: "job-21",
        projectId,
        status: "completed",
        result: {
          filesIndexed: 3,
          chunksIndexed: 4,
          errors: 27,
          duration: 42,
          activatedGraphGenerationId: "generation-active",
          parserDiagnostics: {
            diagnosticsCount: 27,
            recoveredFiles: 2,
            hardFailureFiles: 3,
            staleFiles: 1,
            languages: { typescript: 2, vue: 1 },
          },
        },
      },
    };
    const calls: Array<{ endpoint: string; params?: Record<string, unknown> }> = [];
    const result = await proxyCallTool({
      get: async (endpoint, params) => {
        calls.push({ endpoint, params });
        return httpResponse;
      },
      post: async () => { throw new Error("index_status must use GET"); },
      patch: async () => { throw new Error("index_status must use GET"); },
      delete: async () => { throw new Error("index_status must use GET"); },
    }, "index_status", { jobId: "job-21" });

    expect(calls).toEqual([{ endpoint: "/api/v1/project/index/status/job-21", params: {} }]);
    expect(JSON.parse(result.content[0]!.text)).toEqual(httpResponse);
  });

  test("serializes operational API failures instead of fabricating identity data", async () => {
    for (const tool of structuralTools) {
      const result = await proxyCallTool({
        get: async () => { throw new Error("upstream unavailable"); },
        post: async () => { throw new Error("unexpected POST"); },
        patch: async () => { throw new Error("unexpected PATCH"); },
        delete: async () => { throw new Error("unexpected DELETE"); },
      }, tool.name, tool.args);
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0]!.text)).toEqual({
        success: false,
        error: "upstream unavailable",
      });
    }
  });
});

describe("MCP CallTool HTTP method dispatch", () => {
  test("substitutes path fields, removes them from payloads, and dispatches all four verbs", async () => {
    const calls: Array<{ method: string; endpoint: string; body?: unknown }> = [];
    const apiClient: ToolProxyApiClient = {
      get: async (endpoint, body) => {
        calls.push({ method: "GET", endpoint, body });
        return { success: true };
      },
      post: async (endpoint, body) => {
        calls.push({ method: "POST", endpoint, body });
        return { success: true };
      },
      patch: async (endpoint, body) => {
        calls.push({ method: "PATCH", endpoint, body });
        return { success: true };
      },
      delete: async (endpoint, body) => {
        calls.push({ method: "DELETE", endpoint, body });
        return { success: true };
      },
    };

    for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
      await proxyToolRequest(apiClient, method, "/sessions/:id", {
        id: "session/with space",
        taskContext: `${method}-context`,
      });
    }

    expect(calls).toEqual([
      { method: "GET", endpoint: "/sessions/session%2Fwith%20space", body: { taskContext: "GET-context" } },
      { method: "POST", endpoint: "/sessions/session%2Fwith%20space", body: { taskContext: "POST-context" } },
      { method: "PATCH", endpoint: "/sessions/session%2Fwith%20space", body: { taskContext: "PATCH-context" } },
      { method: "DELETE", endpoint: "/sessions/session%2Fwith%20space", body: { taskContext: "DELETE-context" } },
    ]);
  });

  test("preserves parsed REST envelopes as MCP tool errors", async () => {
    const envelope = {
      success: false,
      error: { code: "SESSION_EXPIRED", message: "Session expired" },
    };
    const result = await proxyCallTool({
      get: async () => { throw new ApiHttpError(410, envelope); },
      post: async () => { throw new Error("unexpected POST"); },
      patch: async () => { throw new Error("unexpected PATCH"); },
      delete: async () => { throw new Error("unexpected DELETE"); },
    }, "index_status", { jobId: "expired" });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toEqual(envelope);
    expect(result.content[0]!.text).not.toContain("API error");
  });

  test("returns the exact sanitized search REST envelope with isError", async () => {
    const envelope = {
      success: false,
      error: {
        code: "SEARCH_BACKEND_UNAVAILABLE",
        message: "A required search backend is unavailable",
        component: "keyword_search",
      },
    };
    const result = await proxyCallTool({
      get: async () => { throw new Error("unexpected GET"); },
      post: async () => { throw new ApiHttpError(503, envelope); },
    }, "search", { query: "required", projectId: "project" });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toEqual(envelope);
    expect(result.content[0]!.text).not.toContain("cause");
  });

  test("preserves PATCH and DELETE authentication failures with isError", async () => {
    const envelope = { success: false, error: { code: "UNAUTHORIZED", message: "Invalid API key" } };
    const methods: string[] = [];
    const apiClient: ToolProxyApiClient = {
      get: async () => { throw new Error("unexpected GET"); },
      post: async () => { throw new Error("unexpected POST"); },
      patch: async () => { methods.push("PATCH"); throw new ApiHttpError(401, envelope); },
      delete: async () => { methods.push("DELETE"); throw new ApiHttpError(401, envelope); },
    };
    for (const [name, args] of [
      ["synapse_update", { id: "session", taskContext: "updated" }],
      ["synapse_end", { id: "session" }],
    ] as const) {
      const result = await proxyCallTool(apiClient, name, args);
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0]!.text)).toEqual(envelope);
    }
    expect(methods).toEqual(["PATCH", "DELETE"]);
  });
});

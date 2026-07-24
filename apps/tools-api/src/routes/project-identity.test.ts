/**
 * Route tests for POST /api/v1/project/rename + /merge (T5; spec public
 * contract + req 9 sanitized errors). The Core service is stubbed via
 * mock.module so the transport layer is tested in isolation: dryRun default,
 * preview/apply dispatch, envelope shape, and status/code mapping.
 */

import { describe, test, expect, mock } from "bun:test";

const calls: { method: string; input: unknown }[] = [];
let previewResult: unknown = { dryRun: true, planHash: "a".repeat(64), mode: "rename" };
let applyResult: unknown = { dryRun: false, operationId: "op-1", committedAt: "2026-07-20T00:00:00.000Z" };
let throwOn: { preview?: unknown; apply?: unknown } = {};

class FakeProjectIdentityError extends Error {
  readonly statusCode: number;
  constructor(readonly code: string, status = 400) {
    super(`sanitized message for ${code}`);
    this.name = "ProjectIdentityError";
    this.statusCode = status;
  }
}

mock.module("@massa-ai/core", () => {
  const actual = require("@massa-ai/core");
  return {
    ...actual,
    ProjectIdentityError: FakeProjectIdentityError,
    createProjectIdentityService: () => ({
      preview: async (input: unknown) => {
        calls.push({ method: "preview", input });
        if (throwOn.preview) throw throwOn.preview;
        return previewResult;
      },
      apply: async (input: unknown) => {
        calls.push({ method: "apply", input });
        if (throwOn.apply) throw throwOn.apply;
        return applyResult;
      },
    }),
  };
});

import { projectRoutes } from "./project.js";

async function post(p: string, body: unknown) {
  const res = await projectRoutes.handle(
    new Request(`http://localhost${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() } as {
    status: number;
    json: { success: boolean; data?: unknown; error?: { code: string; message: string } };
  };
}

describe("project identity routes (T5)", () => {
  test("POST /rename defaults to dryRun preview and returns the plan envelope", async () => {
    calls.length = 0;
    throwOn = {};
    const res = await post("/api/v1/project/rename", {
      sourceProjectId: "source",
      targetProjectId: "target",
    });

    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.data).toEqual(previewResult);
    expect(calls).toEqual([{
      method: "preview",
      input: { mode: "rename", sourceProjectId: "source", targetProjectId: "target", dryRun: true },
    }]);
  });

  test("POST /merge with dryRun=false dispatches apply with operationId + expectedPlanHash", async () => {
    calls.length = 0;
    throwOn = {};
    const res = await post("/api/v1/project/merge", {
      sourceProjectId: "a",
      targetProjectId: "b",
      dryRun: false,
      operationId: "op-1",
      expectedPlanHash: "b".repeat(64),
    });

    expect(res.status).toBe(200);
    expect(res.json.data).toEqual(applyResult);
    expect(calls).toEqual([{
      method: "apply",
      input: {
        mode: "merge",
        sourceProjectId: "a",
        targetProjectId: "b",
        dryRun: false,
        operationId: "op-1",
        expectedPlanHash: "b".repeat(64),
      },
    }]);
  });

  test("a typed identity error maps to its HTTP status with a sanitized code envelope", async () => {
    calls.length = 0;
    throwOn = { apply: new FakeProjectIdentityError("PROJECT_IDENTITY_TARGET_EXISTS", 409) };
    const res = await post("/api/v1/project/rename", {
      sourceProjectId: "source",
      targetProjectId: "taken",
      dryRun: false,
      operationId: "op-2",
      expectedPlanHash: "c".repeat(64),
    });

    expect(res.status).toBe(409);
    expect(res.json.success).toBe(false);
    expect(res.json.error).toEqual({
      code: "PROJECT_IDENTITY_TARGET_EXISTS",
      message: "sanitized message for PROJECT_IDENTITY_TARGET_EXISTS",
    });
  });

  test("dryRun=true explicitly stays on the preview path", async () => {
    calls.length = 0;
    throwOn = {};
    const res = await post("/api/v1/project/merge", {
      sourceProjectId: "a",
      targetProjectId: "b",
      dryRun: true,
    });

    expect(res.status).toBe(200);
    expect(calls[0]?.method).toBe("preview");
  });
});

describe("validation error envelope (error middleware)", () => {
  test("a schema-invalid body returns a typed 4xx INVALID_REQUEST envelope, never INTERNAL_ERROR", async () => {
    const { Elysia, t } = await import("elysia");
    const { errorHandler } = await import("../middleware/error.js");
    const app = new Elysia()
      .use(errorHandler)
      .post("/probe", ({ body }) => body, {
        body: t.Object({ sourceProjectId: t.String() }),
      });

    const res = await app.handle(new Request("http://localhost/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wrong: true }),
    }));
    const json = await res.json() as { success: boolean; error?: { code: string; message: string } };

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(json.success).toBe(false);
    expect(json.error?.code).toBe("INVALID_REQUEST");
    // Sanitized: no TypeBox/property internals, no echoed payload.
    expect(JSON.stringify(json)).not.toContain("sourceProjectId");
    expect(JSON.stringify(json)).not.toContain("wrong");
  });
});

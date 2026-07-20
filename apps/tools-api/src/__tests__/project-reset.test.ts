import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Elysia } from "elysia";

const calls = {
  vector: [] as string[],
  keyword: [] as string[],
  cache: [] as string[],
  symbol: [] as string[],
  memory: [] as string[],
  // M8 audit-log captures
  audit: [] as Record<string, unknown>[],
};

mock.module("@massa-th0th/core", () => ({
  IndexProjectTool: class { handle() {} },
  GetIndexStatusTool: class { handle() {} },
  getVectorStore: async () => ({
    deleteByProject: async (projectId: string) => {
      calls.vector.push(projectId);
      return 3;
    },
  }),
  getKeywordSearch: () => ({
    deleteByProject: async (projectId: string) => {
      calls.keyword.push(projectId);
      return 4;
    },
  }),
  getSearchCache: () => ({
    invalidateProject: async (projectId: string) => {
      calls.cache.push(projectId);
      return 1;
    },
  }),
  workspaceManager: {
    removeWorkspace: async (projectId: string) => calls.symbol.push(projectId),
  },
  getMemoryRepository: () => ({
    deleteByProject: async (projectId: string) => {
      calls.memory.push(projectId);
      return 2;
    },
  }),
  getOperationLogRepository: () => ({
    recordOperation: async (input: Record<string, unknown>) => {
      calls.audit.push(input);
    },
  }),
  UNKNOWN_ACTOR: { actorType: "api_key", actorId: "unknown" },
  // T5 identity surface — the reset routes never invoke these, but the module
  // mock must satisfy every runtime binding that routes/project.ts imports.
  ProjectIdentityError: class ProjectIdentityError extends Error {},
  createProjectIdentityService: () => ({
    preview: async () => {
      throw new Error("project-reset tests never invoke identity preview");
    },
    apply: async () => {
      throw new Error("project-reset tests never invoke identity apply");
    },
  }),
}));

const { projectRoutes } = await import("../routes/project.js");
const app = new Elysia().use(projectRoutes);

beforeEach(() => {
  for (const values of Object.values(calls)) values.length = 0;
});

async function reset(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const response = await app.handle(
    new Request("http://localhost/api/v1/project/reset", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, json: await response.json() as any };
}

describe("project reset lexical lifecycle", () => {
  test("clearVectors deletes vector and keyword chunks before cache invalidation", async () => {
    const response = await reset({
      projectId: "reset-project",
      clearVectors: true,
      clearSymbols: false,
      clearMemories: false,
    });

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      success: true,
      data: { vectorsDeleted: 3, keywordsDeleted: 4 },
    });
    expect(calls.vector).toEqual(["reset-project"]);
    expect(calls.keyword).toEqual(["reset-project"]);
    expect(calls.cache).toEqual(["reset-project"]);
    expect(calls.symbol).toEqual([]);
    expect(calls.memory).toEqual([]);
  });

  test("clearVectors false preserves both semantic and lexical chunks", async () => {
    const response = await reset({
      projectId: "partial-project",
      clearVectors: false,
      clearSymbols: true,
      clearMemories: true,
    });

    expect(response.status).toBe(200);
    expect(calls.vector).toEqual([]);
    expect(calls.keyword).toEqual([]);
    expect(calls.cache).toEqual([]);
    expect(calls.symbol).toEqual(["partial-project"]);
    expect(calls.memory).toEqual(["partial-project"]);
  });
});

// M8 — audit-log attribution for the destructive reset entry point.
describe("project reset audit-log attribution", () => {
  test("records a project_reset row with the full requested scope", async () => {
    const response = await reset({
      projectId: "audit-full",
      clearVectors: true,
      clearSymbols: true,
      clearMemories: true,
    });

    expect(response.status).toBe(200);
    expect(calls.audit).toHaveLength(1);
    const [entry] = calls.audit;
    expect(entry).toMatchObject({
      op: "project_reset",
      projectId: "audit-full",
      result: "success",
      actorType: "api_key",
      actorId: "unknown",
    });
    expect(entry?.scope).toMatchObject({
      projectId: "audit-full",
      requestedScopes: { vectors: true, symbols: true, memories: true },
    });
    expect(entry?.meta).toMatchObject({
      vectorsDeleted: 3,
      keywordsDeleted: 4,
      memoriesDeleted: 2,
      symbolsCleared: 1,
    });
    expect(entry?.error).toBeNull();
  });

  test("captures the x-actor-id header as actorId", async () => {
    await reset(
      { projectId: "audit-actor", clearVectors: false, clearSymbols: false, clearMemories: false },
      { "x-actor-id": "ops-bot-7" },
    );
    expect(calls.audit).toHaveLength(1);
    expect(calls.audit[0]).toMatchObject({
      actorType: "api_key",
      actorId: "ops-bot-7",
    });
  });
});

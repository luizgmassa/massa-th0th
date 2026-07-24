/**
 * T34 — Path recovery tests (N42).
 *
 * Behavior tests for recoverProjectPath:
 * - valid projectId + newPath → re-associates index (findUnique hit + update
 *   called with newPath), returns { found: true, oldPath, newPath }
 * - non-existent projectId → { found: false, oldPath: null, newPath }
 * - update receives the new path so the alias-chain (M16/M17) is preserved
 *   (projectId unchanged, only projectPath changes).
 *
 * The DB layer is mocked via mock.module on "@massa-ai/core/services" so
 * getPrismaClient returns a controllable prisma stub. No live DB needed.
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";

let fakeExisting: { projectPath: string } | null = null;
let lastUpdateArgs: { where: { projectId: string }; data: { projectPath: string } } | null = null;
let findUniqueCalls = 0;
let updateCalls = 0;

const fakePrisma = {
  workspace: {
    findUnique: async (_args: { where: { projectId: string } }) => {
      findUniqueCalls++;
      return fakeExisting;
    },
    update: async (args: { where: { projectId: string }; data: { projectPath: string } }) => {
      updateCalls++;
      lastUpdateArgs = args;
      return {};
    },
  },
};

mock.module("@massa-ai/core/services", () => ({
  getPrismaClient: () => fakePrisma,
}));

const { recoverProjectPath } = await import("../recover-project.js");

describe("T34: Path recovery (N42)", () => {
  beforeEach(() => {
    fakeExisting = null;
    lastUpdateArgs = null;
    findUniqueCalls = 0;
    updateCalls = 0;
  });

  test("recoverProjectPath export exists and is a function", () => {
    expect(typeof recoverProjectPath).toBe("function");
  });

  test("valid projectId + newPath → re-associates index, returns found:true", async () => {
    fakeExisting = { projectPath: "/old/path/my-project" };
    const result = await recoverProjectPath("proj-abc", "/new/path/my-project");

    expect(result.found).toBe(true);
    expect(result.oldPath).toBe("/old/path/my-project");
    expect(result.newPath).toBe("/new/path/my-project");
    // findUnique was called with the projectId
    expect(findUniqueCalls).toBe(1);
    // update was called with the new path, SAME projectId (alias-chain preserved)
    expect(updateCalls).toBe(1);
    expect(lastUpdateArgs).not.toBeNull();
    expect(lastUpdateArgs!.where.projectId).toBe("proj-abc");
    expect(lastUpdateArgs!.data.projectPath).toBe("/new/path/my-project");
  });

  test("non-existent projectId → returns found:false, oldPath:null, no update", async () => {
    fakeExisting = null;
    const result = await recoverProjectPath("does-not-exist", "/any/path");

    expect(result.found).toBe(false);
    expect(result.oldPath).toBeNull();
    expect(result.newPath).toBe("/any/path");
    expect(findUniqueCalls).toBe(1);
    // update MUST NOT be called when the project doesn't exist
    expect(updateCalls).toBe(0);
  });

  test("recover preserves projectId (only projectPath changes) — alias-chain safe", async () => {
    fakeExisting = { projectPath: "/srv/old" };
    await recoverProjectPath("org/proj-keep-id", "/srv/new");

    expect(lastUpdateArgs!.where.projectId).toBe("org/proj-keep-id");
    // The projectId in the update WHERE clause is the ORIGINAL id — no rename.
    // This proves M16/M17 alias-chain integrity (projectId is the stable key).
    expect(lastUpdateArgs!.data).not.toHaveProperty("projectId");
  });
});
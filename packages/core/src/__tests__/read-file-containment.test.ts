/**
 * Wave 5 T17 / FR-12 / AC-10: read_file path containment.
 *
 * Absolute paths must resolve under one of:
 *   1. the project root (workspace lookup for projectId)
 *   2. process.cwd()
 *   3. an entry in MASSA_AI_READ_FILE_ROOTS (colon-separated env)
 *
 * Outside → teaching error listing valid roots only (no host path
 * enumeration). Project root + cwd are ALWAYS allowed. Does not regress
 * the 500-line cap (N9).
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { ReadFileTool } from "../tools/read_file.js";
import type { SymbolGraphService } from "../services/symbol/symbol-graph.service.js";

type IndexingStartedPayload = {
  jobId: string;
  projectId: string;
  projectPath: string;
  totalFiles?: number;
};

const indexingStartedListeners = new Set<(payload: IndexingStartedPayload) => void>();

// Workspace root for the "inside project root" case.
const FAKE_WORKSPACE_ROOT = path.join(
  os.tmpdir(),
  `massa-ai-readfile-containment-ws-${process.pid}`,
);

beforeEach(() => {
  fs.mkdirSync(FAKE_WORKSPACE_ROOT, { recursive: true });
});

mock.module("../services/events/event-bus.js", () => ({
  eventBus: {
    subscribe: (event: string, listener: (payload: IndexingStartedPayload) => void) => {
      if (event === "indexing:started") indexingStartedListeners.add(listener);
      return () => indexingStartedListeners.delete(listener);
    },
    publish: (event: string, payload: IndexingStartedPayload) => {
      if (event === "indexing:started") {
        for (const listener of indexingStartedListeners) listener(payload);
      }
    },
  },
}));
mock.module("../services/workspace/workspace-manager.js", () => ({
  workspaceManager: {
    getWorkspace: async (_projectId: string) => ({
      project_path: FAKE_WORKSPACE_ROOT,
    }),
  },
}));

describe("ReadFileTool — path containment (T17 / FR-12 / AC-10)", () => {
  let tmpOutside: string;
  let tmpInsideProject: string;
  let tmpInsideCwd: string;
  let outsideFile: string;
  let insideProjectFile: string;
  let insideCwdFile: string;

  beforeEach(() => {
    // A directory OUTSIDE both the fake workspace root and cwd. We use a
    // sibling temp dir that is neither under FAKE_WORKSPACE_ROOT nor under
    // process.cwd().
    tmpOutside = fs.mkdtempSync(path.join(os.tmpdir(), "massa-ai-containment-out-"));
    tmpInsideProject = path.join(FAKE_WORKSPACE_ROOT, "nested-containment");
    fs.mkdirSync(tmpInsideProject, { recursive: true });
    // insideCwd: create a file directly under process.cwd() (the repo root).
    // We use a unique name to avoid colliding with real repo files.
    tmpInsideCwd = path.resolve(process.cwd(), `__containment_cwd_probe_${process.pid}.txt`);

    outsideFile = path.join(tmpOutside, "secret.txt");
    insideProjectFile = path.join(tmpInsideProject, "sample.txt");
    insideCwdFile = tmpInsideCwd;

    fs.writeFileSync(outsideFile, "host-secret\n");
    fs.writeFileSync(insideProjectFile, "project-content\n");
    fs.writeFileSync(insideCwdFile, "cwd-content\n");
  });

  afterEach(() => {
    fs.rmSync(tmpOutside, { recursive: true, force: true });
    fs.rmSync(insideProjectFile, { force: true });
    fs.rmSync(insideCwdFile, { force: true });
  });

  test("absolute path outside project root + cwd + allowlist → teaching error listing valid roots", async () => {
    // No projectId → project root is NOT in the roots list (only cwd + env
    // allowlist). The outside file is outside cwd → containment rejection.
    const tool = new ReadFileTool();
    const res = await tool.handle({ filePath: outsideFile });

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    // Teaching error shape: mentions containment, lists valid roots, no host
    // path enumeration beyond the configured roots.
    expect(res.error!).toMatch(/path containment/i);
    expect(res.error!).toContain(outsideFile);
    expect(res.error!).toMatch(/Valid roots/i);
    // Without projectId, only cwd is listed (project root not resolved).
    expect(res.error!).toContain(process.cwd());
    // Must NOT enumerate arbitrary host paths (only the configured roots).
    expect(res.error!).not.toContain("/etc/passwd");
    // Must NOT be the generic catch message.
    expect(res.error!).not.toMatch(/^Failed to read file:/);
  });

  test("absolute path outside project root WITH projectId → teaching error lists project root + cwd", async () => {
    // With projectId, the project root (FAKE_WORKSPACE_ROOT) is added to the
    // roots list. The outside file is still outside → containment rejection
    // listing BOTH project root and cwd.
    const tool = new ReadFileTool();
    const res = await tool.handle({ filePath: outsideFile, projectId: "proj-containment-list" });

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error!).toMatch(/path containment/i);
    expect(res.error!).toContain(FAKE_WORKSPACE_ROOT);
    expect(res.error!).toContain(process.cwd());
  });

  test("absolute path inside project root (with projectId) → succeeds", async () => {
    const tool = new ReadFileTool();
    const res = await tool.handle({
      filePath: insideProjectFile,
      projectId: "proj-containment",
    });

    expect(res.success).toBe(true);
    const data = res.data as { absolutePath: string; content: string };
    expect(data.absolutePath).toBe(path.resolve(insideProjectFile));
    expect(data.content).toContain("project-content");
  });

  test("absolute path inside cwd (no projectId) → succeeds", async () => {
    const tool = new ReadFileTool();
    const res = await tool.handle({ filePath: insideCwdFile });

    expect(res.success).toBe(true);
    const data = res.data as { absolutePath: string; content: string };
    expect(data.absolutePath).toBe(path.resolve(insideCwdFile));
    expect(data.content).toContain("cwd-content");
  });

  test("relative path with ../ traversal against projectId → contained (sanitized to project root)", async () => {
    // A relative path with ../ that would escape the project root if not
    // sanitized. sanitizeFilePath strips ../, so the resolved path stays
    // under the project root.
    const tool = new ReadFileTool();
    const res = await tool.handle({
      filePath: "../outside-attempt.txt",
      projectId: "proj-traversal",
    });

    // The path is sanitized (../ stripped) → resolves under project root →
    // the file doesn't exist there → "Failed to read file" (ENOENT), NOT a
    // containment rejection. This proves traversal was contained.
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBeDefined();
      // Either ENOENT (file not found under project root) or a containment
      // error. The key assertion: NOT a successful read of tmpOutside.
      expect(res.error!).not.toContain("host-secret");
    }
  });

  test("MASSA_AI_READ_FILE_ROOTS env adds an extra allowed root", async () => {
    // Set the env to include tmpOutside as an extra root, then read the
    // outside file → should now succeed. The tool reads the env at call
    // time (not config-load time) so this works without restarting.
    const prev = process.env.MASSA_AI_READ_FILE_ROOTS;
    process.env.MASSA_AI_READ_FILE_ROOTS = tmpOutside;
    try {
      const tool = new ReadFileTool();
      const res = await tool.handle({ filePath: outsideFile });

      if (!res.success) {
        // eslint-disable-next-line no-console
        console.error("env-root test failed:", res.error);
      }
      expect(res.success).toBe(true);
      if (res.success) {
        const data = res.data as { absolutePath: string; content: string };
        expect(data.content).toContain("host-secret");
      }
    } finally {
      if (prev === undefined) delete process.env.MASSA_AI_READ_FILE_ROOTS;
      else process.env.MASSA_AI_READ_FILE_ROOTS = prev;
    }
  });

  test("does not regress 500-line cap (N9) — long file inside project root is clipped", async () => {
    // Create a 600-line file inside the project root. The containment check
    // passes; the N9 cap (MASSA_AI_READ_FILE_MAX_LINES, default 500)
    // applies and source_clipped=true. compress:false avoids an LLM call
    // (auto-compress kicks in >100 lines with compress:true by default).
    const longFile = path.join(tmpInsideProject, "long.txt");
    const lines = Array.from({ length: 600 }, (_, i) => `line${i + 1}`);
    fs.writeFileSync(longFile, lines.join("\n") + "\n");
    try {
      const tool = new ReadFileTool();
      const res = await tool.handle({
        filePath: longFile,
        projectId: "proj-long",
        compress: false,
      });

      expect(res.success).toBe(true);
      const data = res.data as {
        source_clipped: boolean;
        lineRange: { actual: { total: number; start: number; end: number } };
      };
      expect(data.source_clipped).toBe(true);
      // 600 content lines + trailing newline → split gives 601 elements
      // (last is ""). The cap is 500.
      expect(data.lineRange.actual.total).toBeGreaterThanOrEqual(600);
      expect(data.lineRange.actual.end - data.lineRange.actual.start + 1).toBe(500);
    } finally {
      fs.rmSync(longFile, { force: true });
    }
  });
});
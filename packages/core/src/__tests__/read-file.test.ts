/**
 * Unit tests for ReadFileTool path resolution (COVERAGE finding #3).
 *
 * Covers the three resolveFilePath branches surfaced through handle():
 *   1. relative filePath + no projectId  → distinct { success:false } error,
 *      NOT a cwd guess (the bug fixed in T3).
 *   2. relative filePath + projectId     → resolves against the workspace
 *      project_path (workspaceManager stubbed).
 *   3. absolute filePath                 → used verbatim (base-independent).
 */

import { describe, test, expect, mock, beforeEach, afterEach, afterAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { ReadFileTool } from "../tools/read_file.js";
import { eventBus } from "../services/events/event-bus.js";
import type { SymbolGraphService } from "../services/symbol/symbol-graph.service.js";

// Stub the workspaceManager singleton BEFORE the tool imports it transitively.
// We only need getWorkspace(); the tool caches the returned project_path.
// Use a real temp dir so the tool can actually fs.readFile the resolved path.
const FAKE_WORKSPACE_ROOT = path.join(
  os.tmpdir(),
  `massa-ai-readfile-ws-${process.pid}`
);
type IndexingStartedPayload = {
  jobId: string;
  projectId: string;
  projectPath: string;
  totalFiles?: number;
};
const indexingStartedListeners = new Set<(payload: IndexingStartedPayload) => void>();

// Wave 5 FR-12: read_file path containment rejects absolute paths outside
// project root + cwd + MASSA_AI_READ_FILE_ROOTS. These Wave-4 tests
// create temp files under os.tmpdir() (outside cwd), so allow tmpdir as an
// extra root. The tool reads this env at CALL TIME, so setting it here
// covers all tests in this file. Restored in afterAll.
const PREV_READ_FILE_ROOTS = process.env.MASSA_AI_READ_FILE_ROOTS;
beforeEach(() => {
  fs.mkdirSync(FAKE_WORKSPACE_ROOT, { recursive: true });
  process.env.MASSA_AI_READ_FILE_ROOTS = os.tmpdir();
});
afterAll(() => {
  if (PREV_READ_FILE_ROOTS === undefined) delete process.env.MASSA_AI_READ_FILE_ROOTS;
  else process.env.MASSA_AI_READ_FILE_ROOTS = PREV_READ_FILE_ROOTS;
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

describe("ReadFileTool — resolveFilePath branches", () => {
  let tmpFile: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "massa-ai-readfile-"));
    tmpFile = path.join(tmpDir, "sample.txt");
    fs.writeFileSync(tmpFile, "line1\nline2\nline3\n");
  });

  test("relative filePath + no projectId → distinct success:false error", async () => {
    const tool = new ReadFileTool();
    const res = await tool.handle({
      filePath: "packages/core/src/tools/read_file.ts",
    });

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error!).toMatch(/requires a projectId.*absolute path/i);
    // Must NOT be the generic catch message — confirms we hit the early return.
    expect(res.error!).not.toMatch(/^Failed to read file:/);
  });

  test("relative filePath + projectId → resolves against workspace root", async () => {
    // Build an absolute target that matches what the tool will compute from the
    // (stubbed) workspace root + relative path, then assert absolutePath in the
    // successful response equals path.resolve(root, rel).
    const rel = "nested/file.txt";
    const expectedAbs = path.resolve(FAKE_WORKSPACE_ROOT, rel);

    // The tool will try to fs.readFile(expectedAbs). Create it so the read
    // succeeds and we can assert the resolved absolute path.
    fs.mkdirSync(path.dirname(expectedAbs), { recursive: true });
    fs.writeFileSync(expectedAbs, "hello\n");

    const tool = new ReadFileTool();
    const res = await tool.handle({
      filePath: rel,
      projectId: "proj-xyz",
    });

    expect(res.success).toBe(true);
    const data = res.data as { absolutePath: string };
    expect(data.absolutePath).toBe(expectedAbs);

    // cleanup the synthetic workspace file
    fs.rmSync(path.join(FAKE_WORKSPACE_ROOT, rel), { force: true });
  });

  test("reindex lifecycle refreshes a cached project root on the same tool instance", async () => {
    const projectId = "proj-moved-root";
    const rel = "nested/file.txt";
    const oldAbs = path.resolve(FAKE_WORKSPACE_ROOT, rel);
    const nextRoot = fs.mkdtempSync(path.join(os.tmpdir(), "massa-ai-readfile-moved-"));
    const nextAbs = path.resolve(nextRoot, rel);

    fs.mkdirSync(path.dirname(oldAbs), { recursive: true });
    fs.writeFileSync(oldAbs, "old root\n");
    fs.mkdirSync(path.dirname(nextAbs), { recursive: true });
    fs.writeFileSync(nextAbs, "new root\n");

    try {
      const tool = new ReadFileTool();
      const before = await tool.handle({ filePath: rel, projectId });
      expect(before.success).toBe(true);
      expect((before.data as { absolutePath: string }).absolutePath).toBe(oldAbs);

      eventBus.publish("indexing:started", {
        jobId: "job-moved-root",
        projectId,
        projectPath: nextRoot,
      });

      const after = await tool.handle({ filePath: rel, projectId });
      expect(after.success).toBe(true);
      expect((after.data as { absolutePath: string; content: string }).absolutePath).toBe(nextAbs);
      expect((after.data as { content: string }).content).toContain("new root");
    } finally {
      fs.rmSync(nextRoot, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // best-effort teardown of both temp dirs
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(FAKE_WORKSPACE_ROOT, { recursive: true, force: true });
  });

  test("absolute filePath → used verbatim (base-independent)", async () => {
    const tool = new ReadFileTool();
    const res = await tool.handle({ filePath: tmpFile });

    expect(res.success).toBe(true);
    const data = res.data as { absolutePath: string; content: string };
    // path.resolve on an already-absolute path is idempotent.
    expect(data.absolutePath).toBe(path.resolve(tmpFile));
    expect(data.content).toContain("line2");
  });
});

// ── cache-key regression (side-finding [med] — the only e2e red: 08.search F33) ─
//
// ReadFileTool.fileCache keys on filePath ONLY, so a second read of the same
// file within the 60s TTL with different includeSymbols/includeImports returns
// stale, options-baked metadata. In production ONE ReadFileTool instance is a
// module singleton (apps/tools-api/src/routes/file.ts:15), so the cache
// survives across HTTP requests → F33 (includeSymbols:false) fails in-suite,
// warmed by F30 (includeSymbols defaults true) on the same file.
//
// CRITICAL: a real SymbolGraphService must be injected via the constructor —
// without it metadata.symbols is NEVER populated, so a vacuous pass would mask
// the bug. The stub provides listDefinitions returning one definition so the
// includeSymbols:true path populates metadata.symbols.
describe("ReadFileTool — cache key includes option flags", () => {
  let tmpFile: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "massa-ai-readfile-cache-"));
    // .ts so extractMetadata detects a language and the symbol path engages.
    tmpFile = path.join(tmpDir, "sample.ts");
    fs.writeFileSync(tmpFile, "import { x } from 'y';\nexport function foo() {}\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("same file, different includeSymbols within TTL → distinct metadata", async () => {
    // Duck-typed stub matching the slice of SymbolGraphService the tool calls
    // (extractMetadata → listDefinitions). Cast to the service type so the
    // constructor accepts it.
    const stubSymbolGraph = {
      listDefinitions: async (_projectId: string, _opts: any) => ({
        definitions: [
          {
            name: "foo",
            kind: "function",
            filePath: tmpFile,
            lineStart: 2,
            lineEnd: 2,
          },
        ],
        total: 1,
        total_exact: true,
      }),
      getReferences: async (_projectId: string, _name: string, _fqn?: string) => [],
    } as unknown as SymbolGraphService;

    // ONE instance — mirrors the production singleton.
    const tool = new ReadFileTool(stubSymbolGraph);

    // Call 1: includeSymbols true (default). Assert symbols populated.
    const r1 = await tool.handle({
      filePath: tmpFile,
      projectId: "proj-cache",
      compress: false,
    });
    expect(r1.success).toBe(true);
    const d1 = r1.data as { metadata?: { symbols?: { definitions: number } } };
    expect(d1.metadata?.symbols).toBeDefined();
    expect(d1.metadata!.symbols!.definitions).toBe(1);

    // Call 2: SAME file, SAME projectId, back-to-back (within TTL), but
    // includeSymbols:false. Pre-fix this returned d1's stale symbols entry.
    const r2 = await tool.handle({
      filePath: tmpFile,
      projectId: "proj-cache",
      includeSymbols: false,
      compress: false,
    });
    expect(r2.success).toBe(true);
    const d2 = r2.data as { metadata?: { symbols?: unknown } };
    expect(d2.metadata?.symbols).toBeUndefined();
  });
});

// ── T3: fileCache LRU cap (512) + cache-hit metadata writeback ──────────────
//
// The fileCache and projectRootCache are bounded LRU maps mirroring
// WebController's 512-cap pattern. On GET a key is promoted to
// most-recently-used (delete+set); on SET the oldest entry is evicted while
// over the cap. Separately, a legacy cache entry with undefined metadata used
// to re-extract on EVERY hit without persisting; it now writes back so the
// second hit is served from cache.

describe("ReadFileTool — fileCache LRU cap + promotion", () => {
  // CAP+1 distinct inserts → oldest evicted, a touched (LRU-promoted) hot key
  // survives. We drive this through the private fileCache directly via a cast,
  // since constructing CAP+1 real files is wasteful and the cap logic lives in
  // evictOldest() which is agnostic to the cache type.
  const CAP = 512;

  test("inserting CAP+1 distinct keys evicts the oldest; a promoted hot key survives", () => {
    const tool = new ReadFileTool() as unknown as {
      fileCache: Map<string, unknown>;
      projectRootCache: Map<string, unknown>;
      evictOldest: <K, V>(cache: Map<K, V>) => void;
      FILE_CACHE_MAX_ENTRIES: number;
    };

    expect(tool.FILE_CACHE_MAX_ENTRIES).toBe(CAP);

    // Seed CAP entries. The first-inserted is the eviction candidate.
    for (let i = 0; i < CAP; i++) {
      tool.evictOldest(tool.fileCache);
      tool.fileCache.set(`key-${i}`, { content: `c${i}`, timestamp: Date.now() });
    }
    expect(tool.fileCache.size).toBe(CAP);
    expect(tool.fileCache.has("key-0")).toBe(true);

    // Touch key-0 (LRU promote via delete+set) — it must NOT be evicted next.
    const v0 = tool.fileCache.get("key-0")!;
    tool.fileCache.delete("key-0");
    tool.fileCache.set("key-0", v0);

    // Insert one more → evict oldest in insertion order. After the key-0
    // promotion, the oldest is now key-1.
    tool.evictOldest(tool.fileCache);
    tool.fileCache.set(`key-${CAP}`, { content: `c${CAP}`, timestamp: Date.now() });

    expect(tool.fileCache.size).toBe(CAP);
    // Hot (promoted) key survived.
    expect(tool.fileCache.has("key-0")).toBe(true);
    // Oldest non-promoted key evicted.
    expect(tool.fileCache.has("key-1")).toBe(false);
    // New key present.
    expect(tool.fileCache.has(`key-${CAP}`)).toBe(true);
  });
});

describe("ReadFileTool — cache-hit metadata writeback", () => {
  let tmpFile: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "massa-ai-readfile-writeback-"));
    tmpFile = path.join(tmpDir, "sample.ts");
    fs.writeFileSync(tmpFile, "import { x } from 'y';\nexport function foo() {}\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("undefined-metadata entry: first hit re-extracts + persists, second hit does NOT re-extract", async () => {
    const tool = new ReadFileTool();

    // Spy extractMetadata by replacing it on the instance.
    let callCount = 0;
    const realExtract = tool.extractMetadata.bind(tool);
    tool.extractMetadata = async (...args: Parameters<typeof realExtract>) => {
      callCount++;
      return realExtract(...args);
    };

    // Seed a cache entry with undefined metadata — the legacy/edge shape.
    // Use the SAME cache key shape the tool computes in readFileWithCache:
    // handle() passes options.projectId = p.projectId (undefined here → null)
    // and options.relativePath = p.filePath (the raw caller param, NOT the
    // resolved absolute path). includeSymbols/includeImports default to true.
    const cacheKey = JSON.stringify({
      filePath: tmpFile,
      includeSymbols: true,
      includeImports: true,
      projectId: null,
      relativePath: tmpFile,
    });
    const content = fs.readFileSync(tmpFile, "utf-8");
    (tool as unknown as { fileCache: Map<string, unknown> }).fileCache.set(cacheKey, {
      content,
      timestamp: Date.now(),
      // metadata deliberately omitted → undefined
    });

    // Hit 1: cache valid (fresh), metadata undefined → re-extract + persist.
    const r1 = await tool.handle({ filePath: tmpFile, compress: false });
    expect(r1.success).toBe(true);
    expect(callCount).toBe(1);
    const d1 = r1.data as { metadata?: { language?: string } };
    expect(d1.metadata?.language).toBe("TypeScript");

    // The cache entry must now have metadata persisted (no longer undefined).
    const entry = (tool as unknown as { fileCache: Map<string, unknown> }).fileCache.get(cacheKey) as
      | { metadata?: unknown }
      | undefined;
    expect(entry).toBeDefined();
    expect(entry?.metadata).toBeDefined();

    // Hit 2: cache valid, metadata now defined → served from cache, NO re-extract.
    const r2 = await tool.handle({ filePath: tmpFile, compress: false });
    expect(r2.success).toBe(true);
    expect(callCount).toBe(1); // still 1, not 2 — writeback worked
    const d2 = r2.data as { metadata?: { language?: string } };
    expect(d2.metadata?.language).toBe("TypeScript");
  });
});

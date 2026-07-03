/**
 * Unit tests for memory CRUD: MemoryRepository.update / deleteById
 * and MemoryController update (tag merge) + delete (graph edge severance).
 *
 * Uses a temp dataDir (mocked config) so the real SQLite singletons run
 * against throwaway databases. No Ollama: content updates are exercised at
 * the repository layer (embedding supplied), and controller.update is only
 * tested with tag changes (no embedding call).
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

// ── Mock config and logger ────────────────────────────────────
let tmpDir: string;

mock.module("@massa-th0th/shared", () => {
  const actual = require("@massa-th0th/shared");
  return {
    ...actual,
    config: {
      get: (key: string) => {
        if (key === "dataDir") return tmpDir;
        const defaults: Record<string, any> = {
          vectorStore: { type: "sqlite", dbPath: path.join(tmpDir, "vector.db"), collectionName: "test", embeddingModel: "default" },
          keywordSearch: { dbPath: path.join(tmpDir, "kw.db"), ftsVersion: "fts5" },
          security: { maxInputLength: 10000, sanitizeInputs: true, maxIndexSize: 1000, maxFileSize: 1048576, allowedExtensions: [".ts"], excludePatterns: [] },
          memory: { decay: { lambda: 0.02, sigma: 0.6, mu: 0.04, coldThreshold: 0.2 } },
          llm: { enabled: false, baseUrl: "http://localhost:11434/v1", apiKey: "ollama", model: "qwen2.5-coder:7b", temperature: 0.2, maxOutputTokens: 2000, timeoutMs: 5000 },
        };
        return defaults[key];
      },
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      metric: () => {},
    },
  };
});

import { MemoryLevel, MemoryRelationType } from "@massa-th0th/shared";
import { MemoryRepository } from "../data/memory/memory-repository.js";
import type { InsertMemoryInput } from "../data/memory/memory-repository.js";
import { MemoryController } from "../controllers/memory-controller.js";
import { MemoryGraphService } from "../services/graph/memory-graph.service.js";
import { GraphStore } from "../services/graph/graph-store.js";
import { MemoryService } from "../services/memory/memory-service.js";

const synthEmbedding = () => [0.01, 0.02, 0.03, 0.04];

/** Injectable fake LLM surface for MemoryConsolidationJob (Phase 1, no network). */
function makeFakeLlm(opts: { enabled?: boolean; ok?: boolean; value?: any } = {}) {
  return {
    isEnabled: () => opts.enabled ?? false,
    object: async () =>
      opts.ok === false
        ? { ok: false, error: "boom" }
        : {
            ok: true,
            value:
              opts.value ?? {
                summary: "consolidated alpha summary",
                type: "decision",
                level: MemoryLevel.USER,
                rationale: "near-dup",
                sourceIds: ["a", "b"],
              },
          },
  };
}

function insertMemory(repo: MemoryRepository, id: string, content: string, tags: string[] = []) {
  const input: InsertMemoryInput = {
    id,
    content,
    type: "decision",
    level: MemoryLevel.PERSISTENT,
    importance: 0.5,
    tags,
    embedding: synthEmbedding(),
  };
  repo.insert(input);
}

describe("MemoryRepository.update / deleteById", () => {
  let repo: MemoryRepository;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "massa-th0th-crud-"));
    (MemoryRepository as any).instance = null;
    repo = MemoryRepository.getInstance();
  });

  afterEach(() => {
    try { (repo as any).db?.close?.(); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("update content rewrites the row and rebuilds the FTS index", () => {
    insertMemory(repo, "m1", "alpha content here");
    const updated = repo.update("m1", { content: "beta gamma content", embedding: synthEmbedding() });

    expect(updated).toBe(true);
    expect(repo.getById("m1")?.content).toBe("beta gamma content");

    const before = repo.fullTextSearch("alpha", 10, { minImportance: 0, includePersistent: true, limit: 10 });
    const after = repo.fullTextSearch("gamma", 10, { minImportance: 0, includePersistent: true, limit: 10 });
    expect(before.map((r) => r.id)).not.toContain("m1");
    expect(after.map((r) => r.id)).toContain("m1");
  });

  test("update importance only leaves content intact (no FTS rebuild needed)", () => {
    insertMemory(repo, "m2", "unchanged content");
    const updated = repo.update("m2", { importance: 0.9 });

    expect(updated).toBe(true);
    const row = repo.getById("m2");
    expect(row?.importance).toBe(0.9);
    expect(row?.content).toBe("unchanged content");
  });

  test("update tags replaces the tag array", () => {
    insertMemory(repo, "m3", "some content", ["old"]);
    repo.update("m3", { tags: ["new", "shiny"] });

    const row = repo.getById("m3");
    expect(JSON.parse(row?.tags ?? "[]")).toEqual(["new", "shiny"]);
  });

  test("update on a missing id returns false", () => {
    expect(repo.update("nope", { importance: 0.1 })).toBe(false);
  });

  test("update with an empty patch reports existence (true if present, false if absent)", () => {
    insertMemory(repo, "m4", "present");
    expect(repo.update("m4", {})).toBe(true);
    expect(repo.update("missing", {})).toBe(false);
  });

  test("deleteById removes the row and its FTS entry, returns true", () => {
    insertMemory(repo, "m5", "deletable gamma");
    expect(repo.deleteById("m5")).toBe(true);
    expect(repo.getById("m5")).toBeNull();
    const hits = repo.fullTextSearch("gamma", 10, { minImportance: 0, includePersistent: true, limit: 10 });
    expect(hits.map((r) => r.id)).not.toContain("m5");
  });

  test("deleteById on a missing id returns false and is idempotent", () => {
    expect(repo.deleteById("ghost")).toBe(false);
    expect(repo.deleteById("ghost")).toBe(false);
  });
});

describe("MemoryController update (merge tags) + delete (sever edges)", () => {
  let repo: MemoryRepository;
  let controller: MemoryController;
  let graph: MemoryGraphService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "massa-th0th-crud-ctrl-"));
    (GraphStore as any).instance = null;
    (MemoryGraphService as any).instance = null;
    (MemoryRepository as any).instance = null;
    (MemoryService as any).instance = null;
    (MemoryController as any).instance = null;
    repo = MemoryRepository.getInstance();
    controller = MemoryController.getInstance();
    graph = MemoryGraphService.getInstance();
  });

  afterEach(() => {
    try { (repo as any).db?.close?.(); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("update merges tags when mergeTags is true (no content change → no embedding)", async () => {
    insertMemory(repo, "c1", "controller merge target", ["alpha"]);
    const result = await controller.update({ id: "c1", tags: ["beta"], mergeTags: true });

    expect(result.updated).toBe(true);
    const tags = JSON.parse(result.memory?.tags ?? "[]");
    expect(tags.sort()).toEqual(["alpha", "beta"]);
  });

  test("update returns updated:false for a missing id", async () => {
    const result = await controller.update({ id: "ghost", tags: ["x"] });
    expect(result.updated).toBe(false);
  });

  test("update rejects empty/whitespace content", async () => {
    insertMemory(repo, "c-empty", "has content");
    await expect(
      controller.update({ id: "c-empty", content: "   " }),
    ).rejects.toThrow(/content must not be empty/);
  });

  test("update with empty tags + mergeTags:false explicitly clears tags", async () => {
    insertMemory(repo, "c-clear", "has content", ["old", "stale"]);
    const result = await controller.update({ id: "c-clear", tags: [] });
    expect(result.updated).toBe(true);
    expect(JSON.parse(result.memory?.tags ?? "[]")).toEqual([]);
  });

  test("delete hard-deletes the memory and severs its graph edges", async () => {
    insertMemory(repo, "c2", "edge source");
    insertMemory(repo, "c3", "edge target");

    graph.linkMemories("c2", "c3", MemoryRelationType.RELATES_TO);
    expect(graph.getEdges("c2").length).toBeGreaterThan(0);

    const result = await controller.delete("c2");
    expect(result.deleted).toBe(true);
    expect(repo.getById("c2")).toBeNull();
    expect(graph.getEdges("c2").length).toBe(0);
  });

  test("delete on a missing id returns deleted:false", async () => {
    const result = await controller.delete("ghost");
    expect(result.deleted).toBe(false);
  });
});

// ── Phase 1: soft-delete (deleted_at) + recall filtering ────────────────
describe("MemoryRepository.softDeleteById + recall filtering (Phase 1)", () => {
  let repo: MemoryRepository;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "massa-th0th-soft-"));
    (MemoryRepository as any).instance = null;
    repo = MemoryRepository.getInstance();
  });

  afterEach(() => {
    try { (repo as any).db?.close?.(); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("softDeleteById tombstones the row (sets deleted_at) and hides it from recall", () => {
    insertMemory(repo, "s1", "soft delete me please");
    expect(repo.getById("s1")?.deleted_at).toBeNull();

    const ok = repo.softDeleteById("s1");
    expect(ok).toBe(true);

    // Row still exists (tombstoned, not hard-deleted) — getById is unfiltered.
    const row = repo.getById("s1");
    expect(row).not.toBeNull();
    expect(row?.deleted_at).not.toBeNull();

    // FTS recall excludes it.
    const hits = repo.fullTextSearch("soft", 10, { minImportance: 0, includePersistent: true, limit: 10 });
    expect(hits.map((r) => r.id)).not.toContain("s1");
  });

  test("softDeleteById is idempotent — second call returns false, no error", () => {
    insertMemory(repo, "s2", "idempotent tombstone");
    expect(repo.softDeleteById("s2")).toBe(true);
    expect(repo.softDeleteById("s2")).toBe(false);
  });

  test("softDeleteById on a missing id returns false", () => {
    expect(repo.softDeleteById("ghost")).toBe(false);
  });

  test("hard deleteById still works (back-compat) and removes the row entirely", () => {
    insertMemory(repo, "s3", "hard delete target");
    expect(repo.deleteById("s3")).toBe(true);
    expect(repo.getById("s3")).toBeNull();
  });
});

// ── Phase 1: MemoryConsolidationJob — SQLite integration ─────────────────
// Lives here (not in memory-consolidation-job.test.ts) because bun's
// mock.module is process-wide and two files mocking "@massa-th0th/shared"
// collide. The throttle + PG-skip tests stay in the other file (no config
// mock needed).
describe("MemoryConsolidationJob — SQLite integration (Phase 1)", () => {
  let repo: MemoryRepository;
  let graph: GraphStore;
  let job: any;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "massa-th0th-consol-"));
    (MemoryRepository as any).instance = null;
    (GraphStore as any).instance = null;
    const { resetGraphStore } = await import("../services/graph/graph-store-factory.js");
    await resetGraphStore();
    repo = MemoryRepository.getInstance();
    graph = GraphStore.getInstance();
    const { MemoryConsolidationJob } = await import("../services/jobs/memory-consolidation-job.js");
    job = new MemoryConsolidationJob({ llm: makeFakeLlm({ enabled: false }) });
  });

  afterEach(() => {
    try { (repo as any).db?.close?.(); } catch {}
    try { (graph as any).db?.close?.(); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const VEC_A = [1, 0, 0, 0];
  const VEC_A_NEAR = [0.99, 0.01, 0, 0];

  function ageRows(ids: string[], daysAgo: number) {
    const old = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
    (repo as any).db
      .prepare(`UPDATE memories SET created_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`)
      .run(old, ...ids);
  }

  function insertEmb(id: string, content: string, embedding: number[], over: Partial<InsertMemoryInput> = {}) {
    repo.insert({
      id, content, type: "decision", level: MemoryLevel.PERSISTENT,
      importance: 0.5, tags: [], embedding, ...over,
    });
  }

  test("SQLite path runs (no isPostgresEnabled short-circuit) and does not throw", async () => {
    insertEmb("old1", "stale memory", VEC_A, { importance: 0.3 });
    const stats = await job.consolidate();
    expect(stats.merged).toBe(0);
    expect(stats.batchesCreated).toBe(0);
  });

  test("LLM off → rule-based only, merged=0, no SUPERSEDES edges", async () => {
    insertEmb("a", "alpha content", VEC_A);
    insertEmb("b", "alpha content dup", VEC_A_NEAR);
    ageRows(["a", "b"], 8);
    const stats = await job.consolidate();
    expect(stats.batchesCreated).toBe(0);
    const sup = graph
      .getIncomingEdges("a")
      .filter((e: any) => e.relationType === MemoryRelationType.SUPERSEDES);
    expect(sup.length).toBe(0);
  });

  test("LLM on + ok → SUPERSEDES edges + memory:consolidated event + recall hides sources", async () => {
    const { MemoryConsolidationJob } = await import("../services/jobs/memory-consolidation-job.js");
    const { eventBus } = await import("../services/events/event-bus.js");
    const llmJob = new MemoryConsolidationJob({ llm: makeFakeLlm({ enabled: true }) });
    insertEmb("a", "alpha content", VEC_A);
    insertEmb("b", "alpha content dup", VEC_A_NEAR);
    ageRows(["a", "b"], 8);

    let fired: any = null;
    const off = eventBus.subscribe("memory:consolidated", (p: any) => { fired = p; });

    const stats = await llmJob.consolidate();
    off();

    expect(stats.batchesCreated).toBe(1);
    expect(stats.merged).toBe(2);
    expect(fired).not.toBeNull();
    expect(fired.sourceIds.sort()).toEqual(["a", "b"]);

    const supA = graph.getIncomingEdges("a").find(
      (e: any) => e.relationType === MemoryRelationType.SUPERSEDES && e.targetId === "a",
    );
    const supB = graph.getIncomingEdges("b").find(
      (e: any) => e.relationType === MemoryRelationType.SUPERSEDES && e.targetId === "b",
    );
    expect(supA).toBeDefined();
    expect(supB).toBeDefined();
    expect(supA!.sourceId).toBe(supB!.sourceId);

    const hits = repo
      .fullTextSearch("alpha", 10, { minImportance: 0, includePersistent: true, limit: 10 })
      .map((r) => r.id);
    expect(hits).not.toContain("a");
    expect(hits).not.toContain("b");
    expect(hits).toContain(supA!.sourceId);
  });

  test("LLM returns not-ok → silent degrade (no throw, merged=0)", async () => {
    const { MemoryConsolidationJob } = await import("../services/jobs/memory-consolidation-job.js");
    const llmJob = new MemoryConsolidationJob({ llm: makeFakeLlm({ enabled: true, ok: false }) });
    insertEmb("a", "alpha", VEC_A);
    insertEmb("b", "alpha dup", VEC_A_NEAR);
    ageRows(["a", "b"], 8);
    const stats = await llmJob.consolidate();
    expect(stats.batchesCreated).toBe(0);
    expect(stats.merged).toBe(0);
  });

  test("pinned memories are decay-exempt (importance unchanged)", async () => {
    insertEmb("p1", "pinned content", VEC_A, { importance: 0.9, pinned: true });
    const before = repo.getById("p1")?.importance;
    await job.consolidate();
    expect(repo.getById("p1")?.importance).toBe(before);
  });
});

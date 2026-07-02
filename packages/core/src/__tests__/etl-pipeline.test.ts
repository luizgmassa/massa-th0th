/**
 * Phase 7e — Characterization tests for the ETL Pipeline.
 *
 * Two load-bearing concerns:
 *   (1) DiscoverStage's SHA-256 skip-if-unchanged fingerprint cache.
 *   (2) EtlPipeline.run's 4-stage orchestration shape + EventBus events.
 *
 * Isolation: DiscoverStage reads the process-wide `symbolRepository` singleton
 * (constructed from config.vectorStore.dbPath). We seed it directly via
 * `upsertFile` / clear via `clearProject` for the skip test — the singleton is
 * the SAME instance DiscoverStage uses, so the read-after-write is consistent.
 * No `mock.module("@th0th-ai/shared")`.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createHash } from "crypto";
import { DiscoverStage } from "../services/etl/stages/discover.js";
import { EtlPipeline } from "../services/etl/pipeline.js";
import { getSymbolRepository } from "../data/sqlite/symbol-repository-factory.js";
import { eventBus } from "../services/events/event-bus.js";

const TEST_PROJECT = "p7e-etl-probe";

async function makeTempProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "th0th-etl-"));
  await Promise.all(
    Object.entries(files).map(async ([rel, content]) => {
      const fp = path.join(dir, rel);
      await fs.mkdir(path.dirname(fp), { recursive: true });
      await fs.writeFile(fp, content, "utf-8");
    }),
  );
  return dir;
}

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

describe("ETL — DiscoverStage SHA-256 skip (characterization)", () => {
  let stage: DiscoverStage;
  const repo = getSymbolRepository();

  beforeEach(() => {
    stage = new DiscoverStage();
    try {
      repo.clearProject(TEST_PROJECT);
    } catch {
      /* clearProject may not exist for PG; SQLite-canonical here */
    }
  });

  afterEach(() => {
    try {
      repo.clearProject(TEST_PROJECT);
    } catch {
      /* noop */
    }
  });

  test("first run → all files needsReparse=true", async () => {
    const dir = await makeTempProject({ "a.ts": "export const a = 1;\n" });
    try {
      const ctx = {
        projectId: TEST_PROJECT,
        projectPath: dir,
        jobId: "j1",
        emit: () => {},
      };
      const discovered = await stage.run(ctx, {});
      expect(discovered.length).toBe(1);
      expect(discovered[0].needsReparse).toBe(true);
      expect(discovered[0].contentHash).toBe(sha("export const a = 1;\n"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("second run with matching stored hash → needsReparse=false", async () => {
    const content = "export const b = 2;\n";
    const dir = await makeTempProject({ "b.ts": content });
    try {
      // Seed the fingerprint cache with the current hash (simulates a prior run).
      repo.upsertFile({
        project_id: TEST_PROJECT,
        relative_path: "b.ts",
        content_hash: sha(content),
        mtime: Date.now(),
        size: content.length,
        indexed_at: Date.now(),
        symbol_count: 1,
        chunk_count: 1,
      });
      const ctx = {
        projectId: TEST_PROJECT,
        projectPath: dir,
        jobId: "j2",
        emit: () => {},
      };
      const discovered = await stage.run(ctx, {});
      expect(discovered.length).toBe(1);
      expect(discovered[0].needsReparse).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("second run with changed content → needsReparse=true", async () => {
    const dir = await makeTempProject({ "c.ts": "export const c = 3;\n" });
    try {
      // Stored hash is STALE (different content).
      repo.upsertFile({
        project_id: TEST_PROJECT,
        relative_path: "c.ts",
        content_hash: sha("OLD CONTENT"),
        mtime: Date.now(),
        size: 100,
        indexed_at: Date.now(),
        symbol_count: 1,
        chunk_count: 1,
      });
      const ctx = {
        projectId: TEST_PROJECT,
        projectPath: dir,
        jobId: "j3",
        emit: () => {},
      };
      const discovered = await stage.run(ctx, {});
      expect(discovered.length).toBe(1);
      expect(discovered[0].needsReparse).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("forceReindex=true overrides the fingerprint cache", async () => {
    const content = "export const d = 4;\n";
    const dir = await makeTempProject({ "d.ts": content });
    try {
      repo.upsertFile({
        project_id: TEST_PROJECT,
        relative_path: "d.ts",
        content_hash: sha(content),
        mtime: Date.now(),
        size: content.length,
        indexed_at: Date.now(),
        symbol_count: 1,
        chunk_count: 1,
      });
      const ctx = {
        projectId: TEST_PROJECT,
        projectPath: dir,
        jobId: "j4",
        emit: () => {},
      };
      const discovered = await stage.run(ctx, { forceReindex: true });
      expect(discovered[0].needsReparse).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("ETL — EtlPipeline.run orchestration shape (characterization)", () => {
  const repo = getSymbolRepository();

  beforeEach(() => {
    try {
      repo.clearProject(TEST_PROJECT);
    } catch {
      /* noop */
    }
  });
  afterEach(() => {
    try {
      repo.clearProject(TEST_PROJECT);
    } catch {
      /* noop */
    }
  });

  test("forceReindex run emits indexing:started + indexing:completed and returns EtlResult", async () => {
    const dir = await makeTempProject({
      "alpha.ts": "export const alpha = 1;\n",
      "beta.ts": "export function beta() { return 2; }\n",
    });
    const events: { name: string; payload: Record<string, unknown> }[] = [];
    const unsubStarted = eventBus.subscribe("indexing:started", (p) =>
      events.push({ name: "indexing:started", payload: p as Record<string, unknown> }),
    );
    const unsubCompleted = eventBus.subscribe("indexing:completed", (p) =>
      events.push({ name: "indexing:completed", payload: p as Record<string, unknown> }),
    );
    try {
      const pipeline = EtlPipeline.getInstance();
      const result = await pipeline.run({
        projectId: TEST_PROJECT,
        projectPath: dir,
        jobId: "shape-1",
        forceReindex: true,
      });
      // EtlResult shape
      expect(typeof result.filesDiscovered).toBe("number");
      expect(typeof result.filesIndexed).toBe("number");
      expect(typeof result.chunksIndexed).toBe("number");
      expect(typeof result.symbolsIndexed).toBe("number");
      // `errors` is a COUNT (number), not an array — characterization.
      expect(typeof result.errors).toBe("number");
      expect(typeof result.durationMs).toBe("number");
      expect(result.stageTimings).toBeDefined();
      expect(result.stageTimings.discover).toBeDefined();
      expect(result.stageTimings.parse).toBeDefined();
      expect(result.stageTimings.resolve).toBeDefined();
      expect(result.stageTimings.load).toBeDefined();
      // discovered both files
      expect(result.filesDiscovered).toBe(2);
      // events fired
      expect(events.some((e) => e.name === "indexing:started")).toBe(true);
      expect(events.some((e) => e.name === "indexing:completed")).toBe(true);
    } finally {
      unsubStarted();
      unsubCompleted();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("second run with no changes → filesSkipped reflects the fingerprint cache", async () => {
    const dir = await makeTempProject({
      "gamma.ts": "export const gamma = 3;\n",
    });
    try {
      const pipeline = EtlPipeline.getInstance();
      // First run populates the fingerprint cache (forceReindex seeds it).
      await pipeline.run({
        projectId: TEST_PROJECT,
        projectPath: dir,
        jobId: "skip-1",
        forceReindex: true,
      });
      // Second run, no force — files unchanged → skipped.
      const result2 = await pipeline.run({
        projectId: TEST_PROJECT,
        projectPath: dir,
        jobId: "skip-2",
      });
      expect(result2.filesSkipped).toBeGreaterThanOrEqual(1);
      expect(result2.filesIndexed).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

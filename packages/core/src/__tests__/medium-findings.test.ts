/**
 * Tests for the MEDIUM-severity side findings (M1–M8).
 *
 * Each fix is covered in isolation here so the suite can run with
 * `DATABASE_URL=""` (SQLite mode) for the PG-store hydration-storm tests,
 * and without rustc for the Rust-temp-leak test (we exercise the
 * compile-failure path, which must still clean up).
 *
 * Run:
 *   DATABASE_URL="" bun test src/__tests__/medium-findings.test.ts
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { PolyglotExecutor } from "../services/executor/executor.js";
import { ExecutorController } from "../controllers/executor-controller.js";
import { PgCheckpointStore } from "../services/checkpoint/checkpoint-store-pg.js";
import { PgSynapseSessionStore } from "../services/synapse/session/session-store-pg.js";
import { PgObservationStore } from "../data/memory/observation-repository-pg.js";
import { TracePathService } from "../services/symbol/trace-path.js";
import fs from "fs";
import path from "path";
import os from "os";

// ── M1: Rust temp-dir leak ─────────────────────────────────────────────────

describe("M1: Rust temp-dir cleanup", () => {
  test("compile-failure path still cleans up the sandbox tmp dir", async () => {
    // Count massa-th0th exec temp dirs before.
    const tmp = os.tmpdir();
    const before = countExecDirs(tmp);

    // Inject a runtimes map that PRETENDS rustc is available so buildCommand
    // returns the __rust_compile_run__ sentinel. The real rustc is absent in
    // the test env, so execFileSync throws → compile-failure branch. Before
    // the fix this branch returned WITHOUT cleanup (the leak); the fix wraps
    // the whole method in a finally that always removes the dir.
    const exec = new PolyglotExecutor({
      projectRoot: process.cwd(),
      runtimes: {
        javascript: "bun",
        typescript: "bun",
        shell: "bash",
        python: null,
        ruby: null,
        go: null,
        rust: "rustc", // pretend rustc exists
        php: null,
        perl: null,
        r: null,
      } as any,
    });
    const result = await exec.execute({
      language: "rust",
      code: `fn main() {}`,
      timeout: 5_000,
    });

    // Give the OS a moment to settle the rmSync.
    await new Promise((r) => setTimeout(r, 50));
    const after = countExecDirs(tmp);

    expect(after).toBe(before);
    // The compile should have failed (no rustc) and produced a stderr.
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Compilation failed/i);
  });

  function countExecDirs(tmp: string): number {
    try {
      return fs
        .readdirSync(tmp)
        .filter((e) => e.startsWith(".massa-th0th-exec-")).length;
    } catch {
      return 0;
    }
  }
});

// ── M2: batch_execute cap ──────────────────────────────────────────────────

describe("M2: batch_execute cap", () => {
  let ctrl: ExecutorController;

  beforeEach(() => {
    ExecutorController.resetInstance();
    ctrl = new ExecutorController();
  });

  afterEach(() => {
    ExecutorController.resetInstance();
  });

  test("rejects a batch exceeding the cap with a clear error", async () => {
    // Build a payload just over the cap (256).
    const tooMany = Array.from({ length: 257 }, (_, i) => `echo ${i}`);
    const res = await ctrl.batchExecute({
      commands: tooMany,
      concurrency: 4,
    });
    expect(res.success).toBe(false);
    expect(typeof res.error).toBe("string");
    expect(res.error!).toMatch(/at most \d+ commands/i);
    expect(res.error!).toMatch(/received 257/i);
  });

  test("accepts a batch at exactly the cap", async () => {
    // A batch of exactly 256 trivially-succeeding commands should be accepted
    // (not rejected by the cap guard). We use `true` so they all succeed.
    const at = Array.from({ length: 256 }, () => "true");
    const res = await ctrl.batchExecute({
      commands: at,
      concurrency: 8,
      timeout: 5_000,
    });
    // Not rejected by the cap: either success, or a non-cap error.
    const err = res.error ?? "";
    expect(err).not.toMatch(/at most/i);
  });
});

// ── M3: index-manager dim-agnostic metadata ────────────────────────────────
//
// The IndexManager resolves the embedding dimension from vectorStore.getStats()
// instead of hardcoding 4096. We verify the metadata doc's embedding length
// matches what getStats reports.

describe("M3: index-manager dim-agnostic metadata embedding", () => {
  test("metadata embedding length follows vectorStore.getStats(), not a hardcoded 4096", async () => {
    // Stub vector store + collection capturing the add() call.
    let addedEmbedding: number[] | undefined;
    const collection = {
      name: "test-proj",
      async count() {
        return 0;
      },
      async query() {
        return [];
      },
      async add(docs: any[]) {
        addedEmbedding = docs[0]?.embedding;
      },
      async delete() {},
    };
    const FAKE_DIM = 1024;
    const vectorStore: any = {
      async getCollection() {
        return collection;
      },
      async getStats() {
        return { embeddingDimensions: FAKE_DIM };
      },
    };
    // Import lazily so the stub is in place.
    const { IndexManager } = await import("../services/search/index-manager.js");
    const mgr = new IndexManager(vectorStore);
    // updateIndexMetadata triggers saveIndexMetadata internally.
    await mgr.updateIndexMetadata("test-proj", "/tmp/fake", []);
    expect(addedEmbedding).toBeDefined();
    expect(addedEmbedding!.length).toBe(FAKE_DIM);
    // Explicitly NOT 4096.
    expect(addedEmbedding!.length).not.toBe(4096);
    // All zeros (marker vector).
    expect(addedEmbedding!.every((v) => v === 0)).toBe(true);
  });
});

// ── M4: ensureHydrated retry-storm backoff ──────────────────────────────────
//
// When the first hydration attempt throws, the store must NOT re-fire the full
// SELECT on every subsequent op. We force a failure by pointing getPrismaClient
// at a throwing stub.

describe("M4: ensureHydrated backoff (no retry storm)", () => {
  test("checkpoint store: a failed hydration suppresses the next SELECT within the backoff window", async () => {
    const store = new PgCheckpointStore();
    let selectCount = 0;
    // Monkeypatch getClient to a fake prisma that always throws on $queryRaw.
    (store as any).getClient = () => ({
      $queryRaw: async () => {
        selectCount++;
        throw new Error("simulated PG failure");
      },
      $executeRaw: async () => {
        throw new Error("simulated PG failure");
      },
    });

    // First attempt fires the SELECT and fails.
    await store.__hydrate();
    expect(selectCount).toBe(1);

    // Subsequent ops within the backoff window must NOT re-fire the SELECT.
    store.getCheckpoint("any"); // triggers ensureHydrated
    store.listCheckpoints(); // triggers ensureHydrated
    store.getLatestCheckpoint("t1"); // triggers ensureHydrated
    await store.__hydrate(); // explicitly again
    expect(selectCount).toBe(1); // no storm
  });

  test("observation store: failed hydration suppresses subsequent SELECTs", async () => {
    const store = new PgObservationStore();
    let selectCount = 0;
    (store as any).getClient = () => ({
      $queryRaw: async () => {
        selectCount++;
        throw new Error("simulated PG failure");
      },
      $executeRaw: async () => {
        throw new Error("simulated PG failure");
      },
    });

    await store.__hydrate();
    expect(selectCount).toBe(1);

    store.listRecent("p1", 10);
    store.listBySession("s1", 10);
    store.countByProject("p1");
    await store.__hydrate();
    expect(selectCount).toBe(1);
  });

  test("session store: failed hydration suppresses subsequent SELECTs", async () => {
    const store = new PgSynapseSessionStore();
    let selectCount = 0;
    (store as any).getClient = () => ({
      $queryRaw: async () => {
        selectCount++;
        throw new Error("simulated PG failure");
      },
      $executeRaw: async () => {
        throw new Error("simulated PG failure");
      },
    });

    await store.__hydrate();
    expect(selectCount).toBe(1);

    store.load("sess1");
    store.recordAccess("sess1", "mem1", 1);
    await store.__hydrate();
    expect(selectCount).toBe(1);
  });
});

// ── M7: impact-analysis bounded definitions query ───────────────────────────
//
// We verify the per-analyze definitions cache prevents repeated queries for the
// same importer file across multiple changed files. We mock the symbol-
// repository factory so the service picks up an instrumented repo.

describe("M7: impact-analysis definitions cache + bound", () => {
  test("listDefinitionsByFile is called once per unique importer file across changed files", async () => {
    // Topology:
    //   hub.ts and leaf.ts are changed (the importees).
    //   a.ts imports hub.ts, b.ts imports hub.ts → both are impacted consumers.
    //   hub.ts imports leaf.ts → hub.ts is also an impacted consumer of leaf.ts.
    // So hub.ts is reached from BOTH changed-file frontiers; without the cache
    // it would be queried twice. The cache dedupes it to one query.
    let defCalls = 0;
    const queriedFiles: string[] = [];
    const repo: any = {
      allFiles: () => ["a.ts", "b.ts", "hub.ts", "leaf.ts"],
      listDefinitions: (_pid: string, opts: { file: string; limit: number }) => {
        defCalls++;
        queriedFiles.push(opts.file);
        return [
          {
            id: `${opts.file}#fn`,
            name: "fn",
            kind: "function",
            line_start: 1,
            exported: true,
            file_path: opts.file,
          },
        ];
      },
      allImportEdges: () => [
        { from_file: "a.ts", to_file: "hub.ts", is_external: false },
        { from_file: "b.ts", to_file: "hub.ts", is_external: false },
        { from_file: "hub.ts", to_file: "leaf.ts", is_external: false },
      ],
      findReferencesByFqn: () => [],
      findReferencesByName: () => [],
      getCentrality: () => new Map([["a.ts", 0.5], ["b.ts", 0.3], ["hub.ts", 0.9]]),
    };

    // Mock the factory BEFORE importing the service so it binds the stub.
    mock.module("../data/sqlite/symbol-repository-factory.js", () => ({
      getSymbolRepository: () => repo,
    }));
    const { ImpactAnalysisService } = await import("../services/symbol/impact-analysis.js");
    const svc = ImpactAnalysisService.getInstance();

    // hub.ts and leaf.ts changed. a.ts/b.ts import hub.ts → impacted at hop 1.
    // hub.ts imports leaf.ts → hub.ts impacted at hop 1 (from leaf.ts frontier).
    const result = await svc.analyze({
      projectId: "test-impact",
      projectPath: "/tmp/fake",
      scope: "unstaged",
      depth: 2,
      diffRunner: () => ["hub.ts", "leaf.ts"],
    });
    // The cache bounds unique-file queries: hub.ts queried once even though
    // reached from two changed files. Max unique files: hub, leaf, a, b = 4.
    expect(defCalls).toBeLessThanOrEqual(4);
    expect(defCalls).toBeGreaterThan(0);
    expect(result.impacted.length).toBeGreaterThan(0);
    // a.ts and b.ts (direct importers of changed hub.ts) are impacted.
    expect(result.impacted.some((i: any) => i.file === "a.ts")).toBe(true);
    expect(result.impacted.some((i: any) => i.file === "b.ts")).toBe(true);
    // hub.ts must appear at most once in the queried-files list (cache dedupe).
    const hubQueryCount = queriedFiles.filter((f) => f === "hub.ts").length;
    expect(hubQueryCount).toBe(1);
  });
});

// ── M8: buildChains bounded DFS ─────────────────────────────────────────────
//
// We verify that a dense hub topology (many paths through the same nodes) does
// not blow up the walk count before the 50-chain cap.

describe("M8: buildChains walk budget", () => {
  test("dense hub topology is bounded (no exponential blowup)", async () => {
    const svc = TracePathService.getInstance();
    // Build a pathological edge set: a fan-out tree that re-converges on a
    // single hub, creating exponentially many paths to the same leaf.
    // Without the walk budget, this explodes before slice(0,50).
    // We exercise buildChains via the private method through the public
    // tracePath path with a mocked symbol graph.
    // Instead, call buildChains directly via reflection with a synthetic edge set.
    const edges: any[] = [];
    // Layer 1: 1 root → 10 mids
    for (let i = 0; i < 10; i++) {
      edges.push({ from: "root.ts#r", to: `mid.ts#m${i}`, type: "CALL" });
    }
    // Layer 2: each mid → same hub (10 paths converge)
    for (let i = 0; i < 10; i++) {
      edges.push({ from: `mid.ts#m${i}`, to: "hub.ts#h", type: "CALL" });
    }
    // hub → leaf
    edges.push({ from: "hub.ts#h", to: "leaf.ts#l", type: "CALL" });
    // This creates 10 distinct root→leaf chains — manageable, but proves the
    // walk terminates and returns a bounded list.
    const buildChains = (svc as any).buildChains.bind(svc);
    const chains: string[] = buildChains(["root.ts#r"], edges);
    expect(chains.length).toBeLessThanOrEqual(50);
    expect(chains.length).toBeGreaterThan(0);
    // Every chain starts at r and ends at l.
    for (const c of chains) {
      expect(c.startsWith("r →")).toBe(true);
      expect(c.endsWith("→ l")).toBe(true);
    }
  });

  test("walk budget caps a genuinely explosive graph", async () => {
    const svc = TracePathService.getInstance();
    // Diamond-of-diamonds: 5 layers, each node fans to 5 next-layer nodes,
    // then they all converge. Paths = 5^4 = 625 before the cap.
    const edges: any[] = [];
    const layers = 4;
    const fan = 5;
    for (let l = 0; l < layers; l++) {
      const cur = l === 0 ? ["s"] : Array.from({ length: fan }, (_, i) => `n${l}_${i}`);
      const next =
        l === layers - 1
          ? ["t"]
          : Array.from({ length: fan }, (_, i) => `n${l + 1}_${i}`);
      for (const c of cur) for (const n of next) edges.push({ from: c, to: n, type: "CALL" });
    }
    const buildChains = (svc as any).buildChains.bind(svc);
    const chains: string[] = buildChains(["s"], edges);
    // Must be bounded — never more than 50 (the cap), and the walk budget
    // guarantees it terminates quickly even though raw paths = 625.
    expect(chains.length).toBeLessThanOrEqual(50);
    expect(chains.length).toBeGreaterThan(0);
  });
});

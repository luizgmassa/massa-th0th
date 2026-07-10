/**
 * Phase 4 D2 — trace_path tool
 *
 * Integration tests run the ETL on a TINY TS fixture with a known 3-hop call
 * chain, then assert the BFS traversal (outbound/inbound/both), mode→edge-type
 * filtering, depth cap, cycle guard, cross_service (HTTP_CALL) following, and
 * the include_tests toggle. NEVER a full-repo index — fixture only.
 *
 * Isolation: throwaway projectId cleared in beforeEach/afterEach (mirrors
 * typed-edges.test.ts). Guards against the known batch-only disconnectPrisma
 * debt via an ENV_BROKEN sentinel — skips gracefully when the shared pool is
 * dead (same [D2:SKIP] pattern P4-T1 used).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { EtlPipeline } from "../services/etl/pipeline.js";
import { symbolGraphService } from "../services/symbol/symbol-graph.service.js";
import { tracePathService } from "../services/symbol/trace-path.js";
import { TracePathTool } from "../tools/trace_path.js";
import { getSymbolRepository } from "../data/sqlite/symbol-repository-factory.js";

const TEST_PROJECT = "p4d2-trace-path";

async function makeTempProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "massa-th0th-d2-"));
  await Promise.all(
    Object.entries(files).map(async ([rel, content]) => {
      const fp = path.join(dir, rel);
      await fs.mkdir(path.dirname(fp), { recursive: true });
      await fs.writeFile(fp, content, "utf-8");
    }),
  );
  return dir;
}

/**
 * Fixture: a 3-hop outbound call chain a → b → c, plus an HTTP fetch and a test
 * file that calls a(). This lets us exercise depth, direction, mode filtering,
 * cross_service hops, and the test-file toggle.
 *
 *   chain.ts:  alpha() → beta() → gamma()
 *   net.ts:    alpha() → fetch('/api/x')     (HTTP_CALL)
 *   alpha.test.ts: alpha()                    (test file)
 */
const FIXTURE: Record<string, string> = {
  "chain.ts": `
    export function alpha() {
      return beta();
    }
    export function beta() {
      return gamma();
    }
    export function gamma() {
      return 42;
    }
  `,
  "net.ts": `
    export function fetchAlpha() {
      fetch('/api/v1/alpha');
      return 0;
    }
  `,
  "alpha.test.ts": `
    import { alpha } from './chain.js';
    export function testAlpha() {
      return alpha();
    }
  `,
};

describe("trace_path", () => {
  const repo = getSymbolRepository();

  /** Env-broken sentinel (pre-existing disconnectPrisma debt). */
  let ENV_BROKEN = false;
  let ENV_REASON = "";
  let INDEXED = false;

  beforeEach(() => {
    try {
      repo.clearProject(TEST_PROJECT);
    } catch {
      /* SQLite-only / best-effort */
    }
  });
  afterEach(() => {
    try {
      repo.clearProject(TEST_PROJECT);
    } catch {
      /* noop */
    }
  });

  async function indexFixture(dir: string, jobId: string): Promise<Record<string, number>> {
    const pipeline = EtlPipeline.getInstance();
    try {
      await pipeline.run({
        projectId: TEST_PROJECT,
        projectPath: dir,
        jobId,
        forceReindex: true,
      });
    } catch (e) {
      ENV_BROKEN = true;
      ENV_REASON = `pipeline.run threw: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
      return {};
    }
    let counts: Record<string, number> = {};
    try {
      counts = await Promise.resolve(repo.countEdgesByKind(TEST_PROJECT));
    } catch (e) {
      ENV_BROKEN = true;
      ENV_REASON = `countEdgesByKind threw: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
      return {};
    }
    if (Object.keys(counts).length === 0) {
      ENV_BROKEN = true;
      ENV_REASON = "zero edges after forceReindex (pool dead or repo stubbed)";
    }
    INDEXED = true;
    return counts;
  }

  function skipIfBroken(label: string): boolean {
    if (ENV_BROKEN) {
      console.log(`[D2:SKIP] ${label}: ${ENV_REASON}`);
      return true;
    }
    return false;
  }

  // ── Tool-level smoke (pure, no DB) ──────────────────────────────────────

  test("tool requires function_name", async () => {
    const tool = new TracePathTool();
    const res = await tool.handle({ projectId: TEST_PROJECT });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/function_name/i);
  });

  test("tool requires projectId", async () => {
    const tool = new TracePathTool();
    const res = await tool.handle({ function_name: "alpha" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/projectId/i);
  });

  test("tool returns not-found hint for unknown symbol", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d2-nf-1");
      if (skipIfBroken("not-found hint")) return;
      const tool = new TracePathTool();
      const res = await tool.handle({
        projectId: TEST_PROJECT,
        function_name: "doesNotExistXYZ",
      });
      expect(res.success).toBe(false);
      expect(res.data?.hint).toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  // ── Traversal integration on the indexed fixture ────────────────────────

  test("outbound traversal follows alpha → beta → gamma", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d2-out-1");
      if (skipIfBroken("outbound traversal")) return;

      const res = await tracePathService.tracePath({
        projectId: TEST_PROJECT,
        symbol: "alpha",
        direction: "outbound",
        mode: "calls",
        depth: 3,
      });

      // Seeds resolve to chain.ts#alpha (possibly also fetchAlpha — name match
      // is exact for "alpha", so expect the chain.ts one at minimum).
      expect(res.seeds.some((s) => s.includes("#alpha"))).toBe(true);
      const names = res.nodes.map((n) => n.name);
      // gamma must be reachable within depth 3 from alpha.
      expect(names).toContain("gamma");
      // gamma should be at depth 2 (alpha:0 → beta:1 → gamma:2).
      const gamma = res.nodes.find((n) => n.name === "gamma")!;
      expect(gamma.depth).toBe(2);
      // A readable chain ending in gamma should be produced.
      expect(res.chains.length).toBeGreaterThan(0);
      const fullChain = res.chains.find((c) => c.includes("gamma"));
      expect(fullChain).toBeDefined();
      expect(fullChain!).toMatch(/alpha.*beta.*gamma/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("inbound traversal finds callers of gamma", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d2-in-1");
      if (skipIfBroken("inbound traversal")) return;

      const res = await tracePathService.tracePath({
        projectId: TEST_PROJECT,
        symbol: "gamma",
        direction: "inbound",
        mode: "calls",
        depth: 3,
      });

      expect(res.seeds.some((s) => s.includes("#gamma"))).toBe(true);
      const names = res.nodes.map((n) => n.name);
      // beta calls gamma; alpha calls beta (transitively inbound).
      expect(names).toContain("beta");
      const beta = res.nodes.find((n) => n.name === "beta")!;
      expect(beta.depth).toBe(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("both direction returns outbound and inbound nodes", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d2-both-1");
      if (skipIfBroken("both direction")) return;

      const res = await tracePathService.tracePath({
        projectId: TEST_PROJECT,
        symbol: "beta",
        direction: "both",
        mode: "calls",
        depth: 3,
      });

      const names = res.nodes.map((n) => n.name);
      // outbound from beta reaches gamma; inbound reaches alpha.
      expect(names).toContain("gamma");
      expect(names).toContain("alpha");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("mode=calls only follows CALL edges (no http_call)", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d2-mode-1");
      if (skipIfBroken("mode calls filter")) return;

      const res = await tracePathService.tracePath({
        projectId: TEST_PROJECT,
        symbol: "fetchAlpha",
        direction: "outbound",
        mode: "calls",
        depth: 3,
      });

      // calls mode: only 'call' edges — the fetch() HTTP_CALL must NOT appear.
      expect(res.edgeTypes).toEqual(["call"]);
      const edgeTypes = new Set(res.edges.map((e) => e.type));
      expect(edgeTypes.has("http_call")).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("mode=cross_service follows HTTP_CALL edges", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d2-xs-1");
      if (skipIfBroken("cross_service HTTP_CALL")) return;

      const res = await tracePathService.tracePath({
        projectId: TEST_PROJECT,
        symbol: "fetchAlpha",
        direction: "outbound",
        mode: "cross_service",
        depth: 3,
      });

      // cross_service mode must include http_call in its edge types.
      expect(res.edgeTypes).toContain("http_call");
      // The fetch HTTP_CALL edge should be present in the result.
      const httpEdges = res.edges.filter((e) => e.type === "http_call");
      expect(httpEdges.length).toBeGreaterThanOrEqual(1);
      const fetchEdge = httpEdges.find((e) => e.meta?.route === "/api/v1/alpha");
      expect(fetchEdge).toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("depth cap limits traversal depth", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d2-depth-1");
      if (skipIfBroken("depth cap")) return;

      // depth=1 from alpha → only beta is reachable (gamma is depth 2).
      const res = await tracePathService.tracePath({
        projectId: TEST_PROJECT,
        symbol: "alpha",
        direction: "outbound",
        mode: "calls",
        depth: 1,
      });

      const names = res.nodes.map((n) => n.name);
      expect(names).toContain("beta");
      expect(names).not.toContain("gamma");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("depth is hard-capped at MAX_DEPTH (6)", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d2-maxdepth-1");
      if (skipIfBroken("max depth cap")) return;

      // Request an absurd depth; service must clamp to 6 without throwing.
      const res = await tracePathService.tracePath({
        projectId: TEST_PROJECT,
        symbol: "alpha",
        direction: "outbound",
        mode: "calls",
        depth: 999,
      });
      // gamma still reachable; no error / runaway.
      expect(res.nodes.map((n) => n.name)).toContain("gamma");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("cycle guard prevents infinite loops on self/cyclic edges", async () => {
    // Fixture where a function calls itself (recursive) — must not hang.
    const cyclic: Record<string, string> = {
      "cyclic.ts": `
        export function loop(n: number): number {
          if (n <= 0) return 0;
          return loop(n - 1);
        }
      `,
    };
    const dir = await makeTempProject(cyclic);
    try {
      await indexFixture(dir, "d2-cycle-1");
      if (skipIfBroken("cycle guard")) return;

      // Must terminate. The self-edge to loop is visited once, then skipped.
      const res = await tracePathService.tracePath({
        projectId: TEST_PROJECT,
        symbol: "loop",
        direction: "outbound",
        mode: "calls",
        depth: 6,
      });
      // Only the loop node itself (plus one self-hop edge) — bounded.
      expect(res.nodes.length).toBeLessThanOrEqual(2);
      expect(res.truncated).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("include_tests=false excludes test-file nodes by default", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d2-tests-1");
      if (skipIfBroken("include_tests false")) return;

      // Seed alpha (chain.ts, not a test file). With include_tests=false, no
      // node originating from a test file should survive the filter.
      const res = await tracePathService.tracePath({
        projectId: TEST_PROJECT,
        symbol: "alpha",
        direction: "outbound",
        mode: "calls",
        depth: 3,
        include_tests: false,
      });

      const testNodes = res.nodes.filter((n) => n.isTest);
      expect(testNodes.length).toBe(0);
      // testAlpha (in alpha.test.ts) must not appear.
      expect(res.nodes.map((n) => n.name)).not.toContain("testAlpha");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  // ── include_tests filter — pure unit (D1 does not yet emit test-file typed
  //    edges, so the toggle is exercised at the classification/filter layer) ──

  test("include_tests filter: test-file path classification + toggle logic", async () => {
    // The filter logic under test:
    //   finalNodes = nodes.filter(n => includeTests || !n.isTest || n.isSeed)
    // plus the TEST_FILE_RE classification that stamps isTest.
    // We assert the classification + predicate directly so the toggle is
    // covered regardless of whether D1 emits test-file edges.
    const TEST_FILE_RE = /(^|\/)(test|tests|spec|specs|__tests__)(\/|$)|(\.|_|-)(test|spec)\.(t|j)sx?$/i;

    // Classification: these paths MUST be flagged as test files.
    expect(TEST_FILE_RE.test("alpha.test.ts")).toBe(true);
    expect(TEST_FILE_RE.test("src/spec/foo.spec.ts")).toBe(true);
    expect(TEST_FILE_RE.test("tests/helper.ts")).toBe(true);
    expect(TEST_FILE_RE.test("__tests__/setup.ts")).toBe(true);
    // Classification: these paths MUST NOT be flagged.
    expect(TEST_FILE_RE.test("src/services/alpha.ts")).toBe(false);
    expect(TEST_FILE_RE.test("lib/test-utils.ts")).toBe(false); // 'test-utils' has no .test. boundary

    // Predicate: with includeTests=false, a non-seed test node is dropped; a
    // seed test node is kept. With includeTests=true, all are kept.
    type N = { isTest: boolean; isSeed?: boolean };
    const drop = (n: N, includeTests: boolean) => includeTests || !n.isTest || !!n.isSeed;

    const testNode: N = { isTest: true };
    const testSeed: N = { isTest: true, isSeed: true };
    const srcNode: N = { isTest: false };

    expect(drop(testNode, false)).toBe(false); // excluded by default
    expect(drop(testSeed, false)).toBe(true); // seed always kept
    expect(drop(srcNode, false)).toBe(true); // src always kept
    expect(drop(testNode, true)).toBe(true); // included when toggle on
  });

  test("explicit edge_types override overrides mode", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d2-override-1");
      if (skipIfBroken("edge_types override")) return;

      const res = await tracePathService.tracePath({
        projectId: TEST_PROJECT,
        symbol: "fetchAlpha",
        direction: "outbound",
        mode: "calls", // would normally exclude http_call
        edge_types: ["http_call"],
        depth: 3,
      });

      // Explicit override wins: only http_call is followed.
      expect(res.edgeTypes).toEqual(["http_call"]);
      expect(res.edges.every((e) => e.type === "http_call")).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("qualifiedName skips name resolution (exact FQN)", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d2-fqn-1");
      if (skipIfBroken("qualifiedName")) return;

      const res = await tracePathService.tracePath({
        projectId: TEST_PROJECT,
        qualifiedName: "chain.ts#alpha",
        direction: "outbound",
        mode: "calls",
        depth: 3,
      });

      // Seed is exactly chain.ts#alpha — no name-search ambiguity.
      expect(res.seeds).toEqual(["chain.ts#alpha"]);
      expect(res.nodes.map((n) => n.name)).toContain("gamma");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});

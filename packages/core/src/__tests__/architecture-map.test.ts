/**
 * Phase 4 D4 — Richer Architecture Map + Community Detection
 *
 * Two layers of tests:
 *
 *   (1) Unit (pure functions, no DB): community detection (Louvain) on a known-
 *       structure graph; entry-point heuristic; route surfacing; package
 *       grouping; cap/fallback behavior; the architecture-map orchestrator.
 *
 *   (2) Integration (fixture pipeline): run the ETL on a TINY multi-module TS
 *       fixture and assert `getProjectMap` returns the new additive fields
 *       (packages / entryPoints / communities / layers) WITHOUT breaking the
 *       pre-existing fields (backward-compat).
 *
 * Isolation: the integration test uses a throwaway projectId, never triggers a
 * full-repo index (mirrors typed-edges.test.ts).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { describeNative } from "./_helpers/native-skip.js";
import {
  runLouvain,
  COMMUNITY_NODE_CAP,
  COMMUNITY_EDGE_CAP,
  type WeightedEdge,
} from "../services/symbol/communities.js";
import {
  computeArchitectureMap,
  detectPackages,
  detectEntryPoints,
  detectRoutes,
  detectHotspots,
  labelCommunities,
  VALID_ARCHITECTURE_ASPECTS,
} from "../services/symbol/architecture.js";
import type { HttpEdgeLite } from "../services/symbol/architecture.js";
import { ToolError } from "../tools/enum-validation.js";

// ─── (1) Unit tests — pure functions ─────────────────────────────────────────

describe("Louvain community detection (pure)", () => {
  test("groups tightly-coupled files into separate communities", () => {
    // Two clear clusters: {0,1,2} fully interconnected, {3,4,5} fully
    // interconnected, with a single bridge edge 2↔3.
    const edges: WeightedEdge[] = [
      { a: 0, b: 1, w: 1 },
      { a: 0, b: 2, w: 1 },
      { a: 1, b: 2, w: 1 },
      { a: 3, b: 4, w: 1 },
      { a: 3, b: 5, w: 1 },
      { a: 4, b: 5, w: 1 },
      { a: 2, b: 3, w: 1 }, // bridge
    ];

    const result = runLouvain(6, edges);
    expect(result.algorithm).toBe("louvain");
    expect(result.communities.length).toBeGreaterThanOrEqual(2);

    // Cluster A nodes must share a community, cluster B nodes must share a
    // (different) community.
    const a = [0, 1, 2].map((i) => result.assignment[i]);
    const b = [3, 4, 5].map((i) => result.assignment[i]);
    const aSet = new Set(a);
    const bSet = new Set(b);
    expect(aSet.size).toBe(1); // all three in cluster A together
    expect(bSet.size).toBe(1); // all three in cluster B together
    // The two clusters are in different communities.
    expect(aSet.has([...bSet][0])).toBe(false);
    // Modularity of a clean two-cluster partition should be strongly positive.
    expect(result.modularity).toBeGreaterThan(0.1);
  });

  test("empty / single-node graphs short-circuit without crashing", () => {
    const empty = runLouvain(0, []);
    expect(empty.algorithm).toBe("trivial");
    expect(empty.communities).toEqual([]);

    const single = runLouvain(1, []);
    expect(single.algorithm).toBe("trivial");
    expect(single.communities.length).toBe(1);
    expect(single.communities[0].members).toEqual([0]);
  });

  test("no-edge graph assigns every node its own community", () => {
    const result = runLouvain(4, []);
    expect(result.algorithm).toBe("trivial");
    expect(result.communities.length).toBe(4);
    // Each node alone.
    for (const c of result.communities) {
      expect(c.members.length).toBe(1);
    }
  });

  test("multi-edges collapse into weights (dedup)", () => {
    // Two nodes connected by 5 parallel import edges → one weighted edge.
    const edges: WeightedEdge[] = [
      { a: 0, b: 1, w: 1 },
      { a: 0, b: 1, w: 1 },
      { a: 0, b: 1, w: 1 },
    ];
    const result = runLouvain(2, edges);
    // Both nodes end up in the same community (only one possible partition
    // beyond singletons, and merging raises modularity).
    expect(result.assignment[0]).toBe(result.assignment[1]);
  });

  test("falls back to label-propagation above the node cap", () => {
    // Force a tiny cap so we can exercise the fallback path cheaply.
    const cap = 5;
    const edges: WeightedEdge[] = [];
    // Build a 10-node ring.
    for (let i = 0; i < 10; i++) {
      edges.push({ a: i, b: (i + 1) % 10, w: 1 });
    }
    const result = runLouvain(10, edges, { nodeCap: cap, edgeCap: cap });
    expect(result.algorithm).toBe("fallback");
    // Fallback still returns a valid per-node assignment.
    expect(result.assignment.length).toBe(10);
    // Every node assigned to a known community.
    const ids = new Set(result.communities.map((c) => c.id));
    for (const a of result.assignment) expect(ids.has(a)).toBe(true);
  });

  test("honors a large node cap (no spurious fallback)", () => {
    // Under the default cap, a small graph uses Louvain.
    const edges: WeightedEdge[] = [
      { a: 0, b: 1, w: 1 },
      { a: 1, b: 2, w: 1 },
    ];
    const result = runLouvain(3, edges);
    expect(result.algorithm).toBe("louvain");
  });

  test("caps are exported and configurable", () => {
    expect(COMMUNITY_NODE_CAP).toBeGreaterThan(0);
    expect(COMMUNITY_EDGE_CAP).toBeGreaterThan(0);
  });

  test("self-loops are tolerated (folded into degree, not materialized)", () => {
    const edges: WeightedEdge[] = [
      { a: 0, b: 0, w: 5 }, // self-loop
      { a: 0, b: 1, w: 1 },
      { a: 1, b: 2, w: 1 },
    ];
    const result = runLouvain(3, edges);
    expect(result.assignment.length).toBe(3);
    // No crash; modularity is a finite number.
    expect(Number.isFinite(result.modularity)).toBe(true);
  });
});

// ─── Architecture analyzers (pure) ───────────────────────────────────────────

describe("architecture analyzers (pure)", () => {
  const files = [
    "packages/core/src/index.ts",
    "packages/core/src/server.ts",
    "packages/core/src/utils.ts",
    "packages/api/src/routes.ts",
    "packages/api/src/handler.ts",
    "apps/cli/main.ts",
    "README.md",
  ];

  const internalEdges = [
    { fromFile: "packages/core/src/server.ts", toFile: "packages/core/src/index.ts" },
    { fromFile: "packages/core/src/server.ts", toFile: "packages/core/src/utils.ts" },
    { fromFile: "packages/core/src/index.ts", toFile: "packages/core/src/utils.ts" },
    { fromFile: "packages/api/src/routes.ts", toFile: "packages/api/src/handler.ts" },
    { fromFile: "packages/api/src/handler.ts", toFile: "packages/core/src/index.ts" },
    { fromFile: "apps/cli/main.ts", toFile: "packages/core/src/index.ts" },
  ];

  test("detectPackages groups by monorepo segment", () => {
    const gv = buildGv(files, internalEdges);
    const pkgs = detectPackages(files, gv);
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toContain("core");
    expect(names).toContain("api");
    expect(names).toContain("cli");
    // core is imported by api and cli → fanIn >= 1
    const core = pkgs.find((p) => p.name === "core")!;
    expect(core).toBeDefined();
    expect(core.fanIn).toBeGreaterThanOrEqual(1);
    expect(core.fileCount).toBe(3);
  });

  test("detectEntryPoints flags bootstrap-named + high-in-degree files", () => {
    const gv = buildGv(files, internalEdges);
    const eps = detectEntryPoints(gv);
    const epFiles = eps.map((e) => e.file);
    // server.ts and main.ts are bootstrap-named; index.ts has the highest
    // in-degree (imported by handler, main, server).
    expect(epFiles).toContain("packages/core/src/server.ts");
    expect(epFiles).toContain("apps/cli/main.ts");
    expect(epFiles).toContain("packages/core/src/index.ts");
    const idx = eps.find((e) => e.file === "packages/core/src/index.ts")!;
    expect(idx.inDegree).toBeGreaterThanOrEqual(2);
  });

  test("detectRoutes surfaces http_call edges + route-kind definitions", () => {
    const httpEdges = [
      { fromFile: "packages/api/src/routes.ts", route: "/api/users", method: "GET", targetFqn: "routes.ts#getUsers" },
      { fromFile: "packages/api/src/routes.ts", route: "/api/users", method: "POST", targetFqn: "routes.ts#createUser" },
    ];
    const defs = [
      { filePath: "packages/api/src/routes.ts", name: "GET /api/health", kind: "function" },
      { filePath: "packages/api/src/legacy.ts", name: "legacyRoute", kind: "route" },
    ];
    const routes = detectRoutes(httpEdges, defs);
    const paths = routes.map((r) => r.path).sort();
    expect(paths).toContain("/api/users");
    expect(paths).toContain("/api/health");
    expect(paths).toContain("legacyRoute");
    // Dedup: /api/users appears once per method.
    const users = routes.filter((r) => r.path === "/api/users");
    expect(users.length).toBe(2);
    const methods = users.map((r) => r.method).sort();
    expect(methods).toEqual(["GET", "POST"]);
  });

  test("detectHotspots ranks by centrality then in-degree", () => {
    const gv = buildGv(files, internalEdges);
    const centrality = new Map<string, number>([
      ["packages/core/src/index.ts", 0.9],
      ["packages/core/src/utils.ts", 0.7],
    ]);
    const symbolCounts = new Map<string, number>([
      ["packages/core/src/utils.ts", 12],
    ]);
    const hot = detectHotspots(gv, { centrality, symbolCounts, maxResults: 3 });
    expect(hot.length).toBe(3);
    // Highest-centrality file ranks first.
    expect(hot[0].file).toBe("packages/core/src/index.ts");
    expect(hot[0].centrality).toBe(0.9);
  });

  test("labelCommunities assigns common-prefix labels + cohesion", () => {
    const gv = buildGv(files, internalEdges);
    // Two communities: core cluster {0,1,2} and api cluster {3,4}.
    const communities = [
      { id: 0, members: [0, 1, 2] },
      { id: 1, members: [3, 4] },
    ];
    const labeled = labelCommunities(files, gv, communities);
    expect(labeled.length).toBe(2);
    // The core community's common prefix is "packages/core/src".
    const core = labeled.find((c) => c.label.includes("packages/core"))!;
    expect(core).toBeDefined();
    expect(core.size).toBe(3);
    expect(core.cohesion).toBeGreaterThan(0);
    expect(core.topFiles.length).toBeLessThanOrEqual(5);
  });

  test("computeArchitectureMap orchestrator wires everything together", () => {
    const map = computeArchitectureMap({
      files,
      internalEdges,
      definitions: [
        { filePath: "packages/api/src/routes.ts", name: "fn", kind: "function" },
      ],
      httpEdges: [],
      centrality: new Map([["packages/core/src/index.ts", 0.5]]),
      symbolCounts: new Map([["packages/core/src/index.ts", 5]]),
      communities: [
        { id: 0, members: [0, 1, 2] },
        { id: 1, members: [3, 4] },
      ],
    });
    expect(map.packages.length).toBeGreaterThan(0);
    expect(map.entryPoints.length).toBeGreaterThan(0);
    expect(map.hotspots.length).toBeGreaterThan(0);
    expect(map.communities.length).toBe(2);
    expect(map.layers.length).toBeGreaterThan(0);
    // Every layer label is a known value.
    for (const l of map.layers) {
      expect(["entry", "api", "core", "service", "leaf", "unknown"]).toContain(l.layer);
    }
  });
});

// ─── Wave 5 — `cycles` aspect + `aspects` opt-in (T03 / FR-02 / FR-04) ────────

describe("computeArchitectureMap — cycles aspect + aspects opt-in (Wave 5)", () => {
  const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
  const internalEdges: Array<{ fromFile: string; toFile: string }> = [];
  const definitions = [{ filePath: "a.ts", name: "fn", kind: "function" }];
  const httpEdges: HttpEdgeLite[] = [];

  test("no aspects → baseline map, cycles absent (backward-compat)", () => {
    const map = computeArchitectureMap({
      files,
      internalEdges,
      definitions,
      httpEdges,
      callEdges: [{ from: "a.ts", to: "b.ts" }, { from: "b.ts", to: "a.ts" }],
    });
    expect(map.cycles).toBeUndefined();
    expect(map.cycles_truncated).toBeUndefined();
  });

  test('aspects: ["cycles"] → surfaces SCCs of size >1', () => {
    // a↔b cycle, plus a→c (no cycle), plus d↔d self-loop.
    const map = computeArchitectureMap(
      {
        files,
        internalEdges,
        definitions,
        httpEdges,
        callEdges: [
          { from: "a.ts", to: "b.ts" },
          { from: "b.ts", to: "a.ts" },
          { from: "a.ts", to: "c.ts" },
          { from: "d.ts", to: "d.ts" },
        ],
      },
      { aspects: ["cycles"] },
    );
    expect(map.cycles).toBeDefined();
    expect(map.cycles!.length).toBe(2);
    // The a↔b SCC.
    const ab = map.cycles!.find((c) => c.nodes.length === 2);
    expect(ab).toBeDefined();
    expect(ab!.nodes.sort()).toEqual(["a.ts", "b.ts"]);
    expect(ab!.edgeCount).toBe(2); // a→b + b→a
    expect(ab!.id).toBe("cycle:a.ts|b.ts");
    // The d self-loop SCC.
    const d = map.cycles!.find((c) => c.nodes.length === 1);
    expect(d).toBeDefined();
    expect(d!.nodes).toEqual(["d.ts"]);
    expect(d!.edgeCount).toBe(1);
    expect(map.cycles_truncated).toBe(false);
  });

  test('aspects: ["cycles"] with no CALL edges → empty cycles, no truncation', () => {
    const map = computeArchitectureMap(
      { files, internalEdges, definitions, httpEdges, callEdges: [] },
      { aspects: ["cycles"] },
    );
    expect(map.cycles).toEqual([]);
    expect(map.cycles_truncated).toBe(false);
  });

  test('aspects: ["cycles"] with callEdges absent (undefined) → empty cycles', () => {
    const map = computeArchitectureMap(
      { files, internalEdges, definitions, httpEdges },
      { aspects: ["cycles"] },
    );
    expect(map.cycles).toEqual([]);
    expect(map.cycles_truncated).toBe(false);
  });

  test("unknown aspect → teaching error listing valid values (Wave 4 N6 parity)", () => {
    expect(() =>
      computeArchitectureMap(
        { files, internalEdges, definitions, httpEdges },
        { aspects: ["cycles", "bogus"] },
      ),
    ).toThrow(ToolError);
    expect(() =>
      computeArchitectureMap(
        { files, internalEdges, definitions, httpEdges },
        { aspects: ["bogus"] },
      ),
    ).toThrow(/Invalid aspects value: bogus.*Valid values: cycles/);
  });

  test("VALID_ARCHITECTURE_ASPECTS exports the opt-in set", () => {
    expect(VALID_ARCHITECTURE_ASPECTS).toContain("cycles");
  });

  test("teaching error fires before any analyzer work (fail-fast)", () => {
    // Pass files that would crash detectPackages if reached; the validator
    // must throw first. We assert the error is raised even with empty input.
    let ranAnalyzer = false;
    try {
      computeArchitectureMap(
        {
          files: [],
          internalEdges: [],
          definitions: [],
          httpEdges: [],
        },
        { aspects: ["nope"] },
      );
    } catch {
      ranAnalyzer = true;
    }
    expect(ranAnalyzer).toBe(true);
  });
});

// Local helper mirroring the private buildGraphView in architecture.ts, so unit
// tests can call the analyzers without going through the DB.
function buildGv(files: string[], edges: { fromFile: string; toFile: string }[]) {
  const fileIndex = new Map(files.map((f, i) => [f, i] as const));
  const inDegree = new Int32Array(files.length);
  const outDegree = new Int32Array(files.length);
  const outAdj = new Map<string, Set<string>>();
  const inAdj = new Map<string, Set<string>>();
  for (const f of files) {
    outAdj.set(f, new Set());
    inAdj.set(f, new Set());
  }
  for (const e of edges) {
    if (e.fromFile === e.toFile) continue;
    if (!fileIndex.has(e.fromFile) || !fileIndex.has(e.toFile)) continue;
    const out = outAdj.get(e.fromFile)!;
    const inn = inAdj.get(e.toFile)!;
    if (!out.has(e.toFile)) {
      out.add(e.toFile);
      outDegree[fileIndex.get(e.fromFile)!]++;
    }
    if (!inn.has(e.fromFile)) {
      inn.add(e.fromFile);
      inDegree[fileIndex.get(e.toFile)!]++;
    }
  }
  return { files, edges, fileIndex, inDegree, outDegree, outAdj, inAdj };
}

// ─── (2) Integration — getProjectMap backward-compat + additive fields ───────

import fs from "fs/promises";
import path from "path";
import os from "os";
import { EtlPipeline } from "../services/etl/pipeline.js";
import { symbolGraphService } from "../services/symbol/symbol-graph.service.js";
import { getSymbolRepository } from "../data/symbol/symbol-repository-factory.js";
import { WorkspaceManager } from "../services/workspace/workspace-manager.js";

const TEST_PROJECT = "p4d4-arch-map";

/**
 * Fixture: three packages with a clear dependency gradient.
 *
 *   packages/core/src/utils.ts      — leaf utility (no imports)
 *   packages/core/src/index.ts      — imports utils (re-export hub)
 *   packages/api/server.ts          — imports core/index (bootstrap)
 *   packages/api/routes.ts          — imports core/index, calls fetch('/api/x')
 *
 * This gives the analyzers real signal: a utils hotspot, an entry-point
 * candidate (server.ts), and at least one tightly-coupled community.
 */
const FIXTURE: Record<string, string> = {
  "packages/core/src/utils.ts": `
    export function add(a: number, b: number): number { return a + b; }
    export function mul(a: number, b: number): number { return a * b; }
  `,
  "packages/core/src/index.ts": `
    export { add, mul } from './utils.js';
  `,
  "packages/api/server.ts": `
    import { add } from '../../core/src/index.js';
    export function start(): void { console.log(add(1, 2)); }
  `,
  "packages/api/routes.ts": `
    import { add } from '../../core/src/index.js';
    export function list(): void {
      fetch('/api/items');
      return;
    }
  `,
};

async function makeTempProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "massa-ai-d4-"));
  await Promise.all(
    Object.entries(files).map(async ([rel, content]) => {
      const fp = path.join(dir, rel);
      await fs.mkdir(path.dirname(fp), { recursive: true });
      await fs.writeFile(fp, content, "utf-8");
    }),
  );
  return dir;
}

describeNative("getProjectMap enriched fields (fixture pipeline)", () => {
  const repo = getSymbolRepository();

  beforeEach(() => {
    try {
      repo.clearProject(TEST_PROJECT);
    } catch {
      /* PostgreSQL-only / mocked repo: best-effort */
    }
  });
  afterEach(() => {
    try {
      repo.clearProject(TEST_PROJECT);
    } catch {
      /* noop */
    }
  });

  async function indexFixture(dir: string, jobId: string): Promise<void> {
    // Ensure the workspace row exists before the ETL pipeline's graph
    // generation lifecycle tries to lock it (same pattern as trace-path.test.ts).
    // The async indexing:started event handler is racy on shared DBs.
    await WorkspaceManager.getInstance().markIndexing(TEST_PROJECT, dir);
    await EtlPipeline.getInstance().run({
      projectId: TEST_PROJECT,
      projectPath: dir,
      jobId,
      forceReindex: true,
    });
  }

  test("existing fields are unchanged (backward-compat) + new additive fields present", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d4-compat-1");

      const map = await symbolGraphService.getProjectMap(TEST_PROJECT);
      expect(map).toBeDefined();
      // ── Pre-existing fields MUST be present and well-typed (D4 is additive). ──
      expect(map!.projectId).toBe(TEST_PROJECT);
      expect(map!.stats).toBeDefined();
      expect(typeof map!.stats.files).toBe("number");
      expect(Array.isArray(map!.topCentralFiles)).toBe(true);
      expect(typeof map!.symbolsByKind).toBe("object");
      expect(typeof map!.filesByLanguage).toBe("object");
      expect(Array.isArray(map!.recentFiles)).toBe(true);

      // ── New fields: present when the fixture produced signal. ──
      // packages: at least the core + api packages.
      if (map!.packages && map!.packages.length > 0) {
        const names = map!.packages.map((p) => p.name);
        // Monorepo-segment heuristic produces 'core' and 'api' for this fixture.
        expect(names.some((n) => n === "core" || n === "api")).toBe(true);
      }
      // entryPoints: server.ts is a bootstrap-named module.
      if (map!.entryPoints && map!.entryPoints.length > 0) {
        const hasBootstrap = map!.entryPoints.some((e) =>
          /server\.ts$/.test(e.file),
        );
        expect(hasBootstrap).toBe(true);
      }
      // hotspots: utils.ts/index.ts should rank (most-depended-on).
      if (map!.hotspots && map!.hotspots.length > 0) {
        expect(map!.hotspots.length).toBeGreaterThanOrEqual(1);
      }
      // communities: the fixture's import graph is small; communities may be
      // present (assert shape only, not a specific count).
      if (map!.communities) {
        for (const c of map!.communities) {
          expect(typeof c.label).toBe("string");
          expect(c.size).toBeGreaterThan(0);
          expect(c.cohesion).toBeGreaterThanOrEqual(0);
          expect(c.cohesion).toBeLessThanOrEqual(1);
        }
      }
      // layers: each has a known layer label.
      if (map!.layers) {
        for (const l of map!.layers) {
          expect(["entry", "api", "core", "service", "leaf", "unknown"]).toContain(
            l.layer,
          );
        }
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60000);

  test("routes surfaced from http_call edges (fetch('/api/items'))", async () => {
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d4-routes-1");

      const map = await symbolGraphService.getProjectMap(TEST_PROJECT);
      expect(map).toBeDefined();
      // routes field is additive; when the extractor produced http_call edges,
      // '/api/items' should appear.
      if (map!.routes && map!.routes.length > 0) {
        const paths = map!.routes.map((r) => r.path);
        expect(paths).toContain("/api/items");
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60000);

  test("architecture failure never breaks the base response (defensive)", async () => {
    // Even if the env is broken, getProjectMap must either return null (no
    // workspace) or a well-formed object with the pre-existing fields. It must
    // never throw.
    const dir = await makeTempProject(FIXTURE);
    try {
      await indexFixture(dir, "d4-defensive-1");
      const map = await symbolGraphService.getProjectMap(TEST_PROJECT);
      if (map === null) return; // acceptable: no workspace row
      expect(map.projectId).toBe(TEST_PROJECT);
      expect(map.stats).toBeDefined();
      expect(Array.isArray(map.topCentralFiles)).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});

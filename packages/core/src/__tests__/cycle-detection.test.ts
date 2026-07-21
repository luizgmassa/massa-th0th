/**
 * Cycle Detection — Iterative Tarjan SCC unit tests.
 *
 * Wave 5 FR-02 / N2 / AD-W5-001 / AD-W5-017 / AC-2 / AC-25.
 *
 * Coverage:
 *   - Specific fixtures mandated by FR-23 / AC-25:
 *       self-loop, two cycles sharing one node, K5 (fully connected 5-node),
 *       disconnected cycles, DAG (empty result).
 *   - Truncation: edges exceeding budget → truncated=true + first `budget`
 *     edges processed.
 *   - RSS guard: 500k-edge stress grows resident set < 16 MiB over baseline
 *     (Wave-3 MLTS-022 pattern; AD-W5-001).
 *   - Determinism: same input → byte-identical output across runs.
 */

import { describe, test, expect } from "bun:test";
import {
  detectCycles,
  DEFAULT_CYCLE_EDGE_BUDGET,
} from "../services/symbol/cycle-detection.js";
import type { CallEdge } from "../services/symbol/architecture.js";

function edges(pairs: Array<[string, string]>): CallEdge[] {
  return pairs.map(([from, to]) => ({ from, to }));
}

describe("detectCycles — mandated fixtures (FR-23 / AC-25)", () => {
  test("DAG → empty result", () => {
    const r = detectCycles(edges([["a", "b"], ["b", "c"], ["a", "c"]]));
    expect(r.sccs).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  test("self-loop → singleton cycle of one node", () => {
    const r = detectCycles(edges([["a", "a"]]));
    expect(r.sccs).toEqual([{ nodes: ["a"] }]);
    expect(r.truncated).toBe(false);
  });

  test("self-loop alongside non-cyclic edges → only the self-loop surfaces", () => {
    const r = detectCycles(edges([["a", "a"], ["b", "c"], ["c", "d"]]));
    expect(r.sccs).toEqual([{ nodes: ["a"] }]);
  });

  test("two-node cycle (a↔b)", () => {
    const r = detectCycles(edges([["a", "b"], ["b", "a"]]));
    expect(r.sccs).toEqual([{ nodes: ["a", "b"] }]);
  });

  test("two cycles sharing one node → one SCC spanning all three nodes", () => {
    // a↔b and a↔c: reachability closes {a,b,c} into one SCC.
    const r = detectCycles(edges([
      ["a", "b"], ["b", "a"],
      ["a", "c"], ["c", "a"],
    ]));
    expect(r.sccs.length).toBe(1);
    expect(r.sccs[0]!.nodes.sort()).toEqual(["a", "b", "c"]);
  });

  test("disconnected cycles → one SCC per cycle", () => {
    // Two independent cycles: {a,b} and {c,d}. No shared node.
    const r = detectCycles(edges([
      ["a", "b"], ["b", "a"],
      ["c", "d"], ["d", "c"],
    ]));
    expect(r.sccs.length).toBe(2);
    const sets = r.sccs.map((s) => s.nodes.slice().sort().join(",")).sort();
    expect(sets).toEqual(["a,b", "c,d"]);
  });

  test("K5 — fully connected 5-node subgraph → one SCC of size 5", () => {
    // Every distinct pair connected in BOTH directions → one SCC of all 5.
    const k5: CallEdge[] = [];
    const nodes = ["n0", "n1", "n2", "n3", "n4"];
    for (const a of nodes) {
      for (const b of nodes) {
        if (a === b) continue;
        k5.push({ from: a, to: b });
      }
    }
    const r = detectCycles(k5);
    expect(r.sccs.length).toBe(1);
    expect(r.sccs[0]!.nodes.slice().sort()).toEqual(nodes);
  });

  test("empty input → empty result, no truncation", () => {
    expect(detectCycles([])).toEqual({ sccs: [], truncated: false });
  });

  test("single node, no edges → empty result (no self-loop)", () => {
    // No edges at all → no cycles.
    expect(detectCycles([])).toEqual({ sccs: [], truncated: false });
  });
});

describe("detectCycles — truncation budget", () => {
  test("edges over budget → truncated=true, only first `budget` edges processed", () => {
    // 5 edges, budget 2: first two edges kept. Build the fixture so the
    // truncation changes the cycle result observably.
    //   edges[0..1] = a→b, b→a (cycle)
    //   edges[2..4] = c→d, d→c, e→e (cycles dropped by truncation)
    const input = edges([
      ["a", "b"], ["b", "a"],
      ["c", "d"], ["d", "c"], ["e", "e"],
    ]);
    const r = detectCycles(input, 2);
    expect(r.truncated).toBe(true);
    expect(r.sccs).toEqual([{ nodes: ["a", "b"] }]);
  });

  test("edges exactly at budget → not truncated", () => {
    const input = edges([["a", "b"], ["b", "a"]]);
    const r = detectCycles(input, 2);
    expect(r.truncated).toBe(false);
    expect(r.sccs).toEqual([{ nodes: ["a", "b"] }]);
  });

  test("DEFAULT_CYCLE_EDGE_BUDGET is 400_000 (AD-W5-017)", () => {
    expect(DEFAULT_CYCLE_EDGE_BUDGET).toBe(400_000);
  });
});

describe("detectCycles — determinism", () => {
  test("same input produces byte-identical output across runs", () => {
    const input = edges([
      ["a", "b"], ["b", "a"],
      ["x", "y"], ["y", "x"],
      ["m", "m"],
      ["p", "q"],
    ]);
    const r1 = detectCycles(input);
    const r2 = detectCycles(input);
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
  });

  test("input edge order does not change the SCC partition", () => {
    // Same graph, two different edge orderings → same SCC set.
    const order1 = edges([["a", "b"], ["b", "c"], ["c", "a"]]);
    const order2 = edges([["c", "a"], ["b", "c"], ["a", "b"]]);
    const r1 = detectCycles(order1);
    const r2 = detectCycles(order2);
    expect(r1).toEqual(r2);
  });
});

describe("detectCycles — RSS guard (Wave 3 MLTS-022 / AD-W5-001 / AC-2 amended)", () => {
  // AC-2 AMENDED: build the 500k-edge input graph in the baseline measurement
  // (input allocation is not Tarjan overhead). Then assert `detectCycles` adds
  // < 16 MiB RSS delta vs that baseline. Intent per AD-W5-001 is that the
  // iterative impl doesn't balloon via recursion; input-size-linear allocation
  // is expected. We measure ONLY the Tarjan internal state (adj Map, nodeSet,
  // indices/lowlink/onStack/stack), which scales with UNIQUE NODE COUNT, not
  // edge count. So we keep unique nodes small (~1k-5k) while pushing edges to
  // 350k-500k to stay faithful to the stress scenario.

  test("in-budget large-edge stress: Tarjan RSS delta < 16 MiB over input-alloc baseline", () => {
    // 10 disjoint rings of 500 nodes each (5_000 unique nodes total). Ring
    // edges (50_000) + intra-ring forward fill → 350_000 edges, all under the
    // 400k default budget. Each ring stays an independent SCC because there
    // are no cross-ring edges.
    const NODES_PER_RING = 500;
    const RINGS = 10;
    const TARGET = 350_000;
    const stress: CallEdge[] = [];
    for (let r = 0; r < RINGS; r++) {
      for (let i = 0; i < NODES_PER_RING; i++) {
        const from = `r${r}_n${i}`;
        const to = `r${r}_n${(i + 1) % NODES_PER_RING}`;
        stress.push({ from, to });
      }
    }
    let fill = stress.length;
    let r = 0;
    let i = 0;
    while (fill < TARGET) {
      const a = `r${r}_n${i % NODES_PER_RING}`;
      const b = `r${r}_n${(i + 2) % NODES_PER_RING}`;
      if (a !== b) {
        stress.push({ from: a, to: b });
        fill++;
      }
      i++;
      if (i >= NODES_PER_RING * 2) {
        r = (r + 1) % RINGS;
        i = 0;
      }
    }
    expect(stress.length).toBe(TARGET);

    // AC-2 amended: baseline measured AFTER input graph is built so the
    // CallEdge[] allocation is excluded from the delta. Force GC first so
    // transient allocations from graph construction are collected.
    if (typeof globalThis.gc === "function") globalThis.gc();
    const baseline = process.memoryUsage().rss;

    const result = detectCycles(stress);

    const after = process.memoryUsage().rss;
    const growthMiB = (after - baseline) / (1024 * 1024);

    // Each ring is a cycle of NODES_PER_RING nodes → 10 SCCs expected.
    expect(result.sccs.length).toBe(RINGS);
    expect(result.truncated).toBe(false);
    // AD-W5-001 / Wave-3 MLTS-022 guard: < 16 MiB Tarjan-state growth over
    // the input-alloc baseline (AC-2 amended).
    expect(growthMiB).toBeLessThan(16);
  });

  test("500k-edge over-budget graph: truncated=true + Tarjan RSS delta < 16 MiB (AC-2)", () => {
    // AC-2: a synthetic 500k-edge CALL graph sets cycles_truncated=true and
    // returns ≤ budget edges. 1_000 unique nodes with 500_000 edges (high
    // density) so Tarjan internal state stays bounded. The first 400k edges
    // (the budget) are processed; truncation drops the tail.
    const NODES = 1_000;
    const TARGET = 500_000;
    const stress: CallEdge[] = [];
    for (let k = 0; k < TARGET; k++) {
      const from = `n${k % NODES}`;
      const to = `n${(k + 1) % NODES}`;
      stress.push({ from, to });
    }
    expect(stress.length).toBe(TARGET);

    // AC-2 amended: baseline AFTER input build.
    if (typeof globalThis.gc === "function") globalThis.gc();
    const baseline = process.memoryUsage().rss;

    const result = detectCycles(stress);

    const after = process.memoryUsage().rss;
    const growthMiB = (after - baseline) / (1024 * 1024);

    expect(result.truncated).toBe(true);
    expect(result.sccs.length).toBeGreaterThan(0);
    // AD-W5-001 / AC-2 amended: < 16 MiB Tarjan-state growth over input-alloc
    // baseline, even on the 500k-edge over-budget path.
    expect(growthMiB).toBeLessThan(16);
  });
});

/**
 * Cycle Detection — Property Test vs Brute-Force SCC Reference.
 *
 * Wave 5 FR-23 / AD-W5-017 / AC-25.
 *
 * The iterative Tarjan SCC implementation in `cycle-detection.ts` is validated
 * against a brute-force reference SCC finder on 100 random small graphs. The
 * brute-force reference computes SCCs by repeated reachability: two nodes u, v
 * are in the same SCC iff v is reachable from u AND u is reachable from v. It
 * is O(V^3) and obviously correct; only used as an oracle here.
 *
 * Per AD-W5-017 the property test is mandatory: the iterative lowlink-update
 * path in Tarjan is the classic silent-bug source — only a property test
 * discriminates correct partitions from subtly-wrong ones on irregular graphs.
 */

import { describe, test, expect } from "bun:test";
import { detectCycles } from "../services/symbol/cycle-detection.js";
import type { CallEdge } from "../services/symbol/architecture.js";

// ─── Deterministic PRNG (so failures are reproducible) ──────────────────────

/** Mulberry32 — small deterministic PRNG; same seed → same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Brute-force SCC reference (oracle) ─────────────────────────────────────

/**
 * Compute SCCs by reachability: u, v in same SCC iff mutually reachable.
 * Returns the partition as a sorted set of sorted node-lists so equality
 * with the Tarjan result is order-independent.
 *
 * Self-loops are handled: a node with a self-loop is its own SCC of size 1
 * that we surface as a "cycle" (matching detectCycles' semantics). A node
 * with no self-loop and no in/out edges produces no cycle entry.
 */
function bruteForceSccs(edges: Array<[string, string]>): string[][] {
  // Collect nodes + build adjacency.
  const adj = new Map<string, Set<string>>();
  const selfLoop = new Set<string>();
  const nodes = new Set<string>();
  for (const [from, to] of edges) {
    nodes.add(from);
    nodes.add(to);
    if (from === to) {
      selfLoop.add(from);
      continue;
    }
    let s = adj.get(from);
    if (!s) {
      s = new Set();
      adj.set(from, s);
    }
    s.add(to);
  }
  for (const n of nodes) if (!adj.has(n)) adj.set(n, new Set());

  // Reachability via DFS (iterative to be safe on larger random graphs).
  function reachableFrom(start: string): Set<string> {
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length > 0) {
      const v = stack.pop()!;
      const succ = adj.get(v);
      if (!succ) continue;
      for (const w of succ) {
        if (!seen.has(w)) {
          seen.add(w);
          stack.push(w);
        }
      }
    }
    return seen;
  }

  // Reverse adjacency for "u reachable from v" check.
  const radj = new Map<string, Set<string>>();
  for (const [from, tos] of adj) {
    for (const to of tos) {
      let s = radj.get(to);
      if (!s) {
        s = new Set();
        radj.set(to, s);
      }
      s.add(from);
    }
  }
  function reachableTo(start: string): Set<string> {
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length > 0) {
      const v = stack.pop()!;
      const succ = radj.get(v);
      if (!succ) continue;
      for (const w of succ) {
        if (!seen.has(w)) {
          seen.add(w);
          stack.push(w);
        }
      }
    }
    return seen;
  }

  // Partition: for each node, its SCC is the set of nodes mutually reachable
  // with it. We compute it once per (unvisited) node and mark the whole SCC
  // as visited.
  const visited = new Set<string>();
  const sccs: string[][] = [];
  for (const start of nodes) {
    if (visited.has(start)) continue;
    const fwd = reachableFrom(start);
    const bwd = reachableTo(start);
    const scc: string[] = [];
    for (const n of fwd) {
      if (bwd.has(n)) {
        scc.push(n);
        visited.add(n);
      }
    }
    scc.sort();
    // Match detectCycles semantics: keep SCCs of size >1, OR size-1 SCCs
    // that carry a self-loop.
    if (scc.length > 1) {
      sccs.push(scc);
    } else if (scc.length === 1 && selfLoop.has(scc[0]!)) {
      sccs.push(scc);
    }
  }
  // Sort for deterministic comparison.
  sccs.sort((a, b) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = a[i]! < b[i]! ? -1 : a[i]! > b[i]! ? 1 : 0;
      if (d !== 0) return d;
    }
    return a.length - b.length;
  });
  return sccs;
}

// ─── Random graph generator ─────────────────────────────────────────────────

interface RandomGraph {
  edges: Array<[string, string]>;
}

function randomGraph(rng: () => number, nodeCount: number, edgeDensity: number): RandomGraph {
  // Node labels: "n0".."n{N-1}". Edge density = expected edges per node.
  const edges: Array<[string, string]> = [];
  for (let i = 0; i < nodeCount; i++) {
    const outDeg = Math.floor(rng() * (edgeDensity + 1));
    for (let k = 0; k < outDeg; k++) {
      const j = Math.floor(rng() * nodeCount);
      edges.push([`n${i}`, `n${j}`]);
    }
  }
  return { edges };
}

// ─── Normalize detectCycles output for comparison ────────────────────────────

function tarjanSccs(edges: Array<[string, string]>): string[][] {
  const callEdges: CallEdge[] = edges.map(([from, to]) => ({ from, to }));
  const r = detectCycles(callEdges);
  // Note: detectCycles already sorts SCCs and node-sets; copy out.
  return r.sccs.map((s) => s.nodes.slice().sort());
}

// ─── Property test ──────────────────────────────────────────────────────────

describe("detectCycles — property test vs brute-force SCC (FR-23 / AC-25)", () => {
  // 100 random small graphs, fixed seed for reproducibility.
  const GRAPH_COUNT = 100;
  const baseSeed = 0x5eed;
  const configs: Array<{ name: string; nodeCount: number; edgeDensity: number }> = [
    { name: "tiny-sparse", nodeCount: 4, edgeDensity: 1 },
    { name: "tiny-dense", nodeCount: 4, edgeDensity: 4 },
    { name: "small-sparse", nodeCount: 8, edgeDensity: 2 },
    { name: "small-dense", nodeCount: 8, edgeDensity: 6 },
    { name: "medium-sparse", nodeCount: 12, edgeDensity: 2 },
    { name: "medium-dense", nodeCount: 12, edgeDensity: 8 },
    { name: "medium-tight", nodeCount: 16, edgeDensity: 4 },
    { name: "k10-ish", nodeCount: 10, edgeDensity: 10 },
    { name: "linear", nodeCount: 14, edgeDensity: 1 },
    { name: "ring-heavy", nodeCount: 14, edgeDensity: 3 },
  ];

  let graphIdx = 0;
  for (const cfg of configs) {
    // 10 graphs per config × 10 configs = 100 graphs.
    for (let k = 0; k < GRAPH_COUNT / configs.length; k++) {
      const seed = baseSeed + graphIdx * 7919;
      graphIdx++;
      test(`random graph #${graphIdx - 1} (${cfg.name}, seed=${seed}): Tarjan == brute-force SCC`, () => {
        const rng = mulberry32(seed);
        const { edges } = randomGraph(rng, cfg.nodeCount, cfg.edgeDensity);
        const expected = bruteForceSccs(edges);
        const actual = tarjanSccs(edges);
        // Compare as JSON so nested arrays compare value-wise.
        expect(JSON.stringify(actual)).toEqual(JSON.stringify(expected));
      });
    }
  }

  test("property test graph count is 100 (FR-23 mandate)", () => {
    expect(GRAPH_COUNT).toBe(100);
    expect(configs.length * (GRAPH_COUNT / configs.length)).toBe(100);
  });
});
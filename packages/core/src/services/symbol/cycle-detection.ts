/**
 * Cycle Detection — Iterative Tarjan Strongly Connected Components (SCC)
 *
 * Wave 5 FR-02 / N2 / AD-W5-001 / AD-W5-017.
 *
 * A pure, allocation-bounded SCC finder for the `cycles` aspect of the
 * architecture map. Iterative (explicit heap-allocated work stack) instead of
 * recursive to avoid the JS stack overflow that recursive Tarjan hits on deep
 * CALL graphs — the canonical failure mode called out in AD-W5-001 and gated
 * by the Wave-3 MLTS-022 RSS guard pattern.
 *
 * Output: SCCs of size >1, OR single-node SCCs that carry a self-loop. Both
 * are "cycles" semantically — a function that calls itself closes a cycle of
 * one node. The caller (architecture.ts) decorates each SCC with a stable id
 * + intra-SCC edge count.
 *
 * Budget: when `edges.length > budget`, the input is truncated to the first
 * `budget` edges and `truncated=true` is surfaced. The default budget (400k)
 * matches the iterative Tarjan edge ceiling (AD-W5-017) so the detector never
 * overflows the JS stack under the RSS guard.
 *
 * Determinism: node order inside each SCC, and SCC order in the result, are
 * both deterministic (sorted lexicographically) so snapshot fingerprinting and
 * tests are reproducible across runs.
 */

import type { CallEdge } from "./architecture.js";

// ─── Public result types (exported for B2/B3 consumption per AD-W5-020) ──────

/**
 * One strongly connected component, expressed as the sorted list of node ids
 * (file paths when the input edges are file-level CALL edges). Sorted for
 * deterministic snapshot fingerprinting.
 */
export interface SCC {
  nodes: string[];
}

/**
 * Result of {@link detectCycles}. `truncated=true` when the input exceeded the
 * budget; callers surface this as `cycles_truncated` on the architecture map.
 */
export interface DetectCyclesResult {
  sccs: SCC[];
  truncated: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Default edge budget (AD-W5-017). Matches the ceiling analyzed for the
 * iterative implementation under the Wave-3 MLTS-022 RSS guard (< 16 MiB
 * resident set growth over baseline on a 500k-edge stress).
 */
export const DEFAULT_CYCLE_EDGE_BUDGET = 400_000;

// ─── Iterative Tarjan ────────────────────────────────────────────────────────

type Frame = {
  /** The node this frame is processing. */
  v: string;
  /** Successor list (callers of v in the directed CALL graph). */
  succ: readonly string[];
  /** Index of the next successor to process (resume point after a recursion). */
  pi: number;
};

/**
 * Compute SCCs of a directed graph derived from `edges`. Returns SCCs of size
 * >1 plus single-node SCCs with a self-loop.
 *
 * @param edges  Directed edges. Endpoints are opaque node ids (file paths for
 *               the architecture use case). Self-edges `{from:x,to:x}` count
 *               as a cycle of size 1.
 * @param budget Hard cap on the number of edges processed. Edges beyond the
 *               budget are dropped and `truncated=true` is returned. Defaults
 *               to {@link DEFAULT_CYCLE_EDGE_BUDGET}.
 */
export function detectCycles(
  edges: ReadonlyArray<CallEdge>,
  budget: number = DEFAULT_CYCLE_EDGE_BUDGET,
): DetectCyclesResult {
  // Budget enforcement: drop trailing edges and flag truncation. We process
  // the FIRST `budget` edges (preserve insertion order so the caller's
  // ordering — e.g. sorted by from_file — is respected in the result).
  let truncated = false;
  let working: ReadonlyArray<CallEdge> = edges;
  if (edges.length > budget) {
    truncated = true;
    working = edges.slice(0, budget);
  }

  if (working.length === 0) return { sccs: [], truncated };

  // ── Build adjacency + self-loop set ──────────────────────────────────────
  // adj[v] = sorted unique successors of v. Self-loops are tracked separately
  // so we can flag size-1 SCCs that close a cycle on themselves.
  const adj = new Map<string, string[]>();
  const selfLoop = new Set<string>();
  const nodeSet = new Set<string>();
  for (const e of working) {
    nodeSet.add(e.from);
    nodeSet.add(e.to);
    if (e.from === e.to) {
      selfLoop.add(e.from);
      continue;
    }
    let arr = adj.get(e.from);
    if (!arr) {
      arr = [];
      adj.set(e.from, arr);
    }
    arr.push(e.to);
  }
  // Dedup successors per node so the iterative traversal does not re-queue
  // the same successor twice from the same parent.
  for (const [k, arr] of adj) {
    if (arr.length <= 1) continue;
    const uniq = Array.from(new Set(arr));
    if (uniq.length !== arr.length) adj.set(k, uniq);
  }

  // ── Tarjan state ────────────────────────────────────────────────────────
  let indexCounter = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const work: Frame[] = [];

  for (const start of nodeSet) {
    if (indices.has(start)) continue;
    work.push({ v: start, succ: adj.get(start) ?? EMPTY, pi: 0 });

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const { v, succ, pi } = frame;

      if (pi === 0) {
        // First visit: assign index + lowlink, push onto SCC stack.
        indices.set(v, indexCounter);
        lowlink.set(v, indexCounter);
        indexCounter++;
        stack.push(v);
        onStack.add(v);
      }

      let recursed = false;
      let i = pi;
      while (i < succ.length) {
        const w = succ[i];
        const wIdx = indices.get(w);
        if (wIdx === undefined) {
          // Successor not yet visited: recurse. Resume this frame at i+1
          // AFTER the child returns so its lowlink propagates here.
          frame.pi = i + 1;
          work.push({ v: w, succ: adj.get(w) ?? EMPTY, pi: 0 });
          recursed = true;
          break;
        } else if (onStack.has(w)) {
          // Back edge or cross edge to a node still on the stack: refine lowlink.
          const vl = lowlink.get(v)!;
          if (wIdx < vl) lowlink.set(v, wIdx);
        }
        i++;
      }
      if (recursed) continue;

      // Done processing all successors of v. If v is the root of an SCC,
      // pop the stack into a new SCC.
      const vIdx = indices.get(v)!;
      const vLow = lowlink.get(v)!;
      if (vLow === vIdx) {
        const component: string[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
          if (w === v) break;
        }
        sccs.push(component);
      }

      // Propagate lowlink to parent (if any).
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1];
        const pl = lowlink.get(parent.v)!;
        if (vLow < pl) lowlink.set(parent.v, vLow);
      }
    }
  }

  // ── Filter + sort for determinism ───────────────────────────────────────
  // Keep SCCs of size >1, OR size-1 SCCs with a self-loop (a function that
  // calls itself closes a cycle).
  const cyclic: string[][] = [];
  for (const c of sccs) {
    if (c.length > 1) {
      c.sort();
      cyclic.push(c);
    } else if (c.length === 1 && selfLoop.has(c[0])) {
      cyclic.push(c);
    }
  }
  // Sort SCCs by their first node so output is stable across run order.
  cyclic.sort((a, b) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = a[i] < b[i] ? -1 : a[i] > b[i] ? 1 : 0;
      if (d !== 0) return d;
    }
    return a.length - b.length;
  });

  return { sccs: cyclic.map((nodes) => ({ nodes })), truncated };
}

const EMPTY: readonly string[] = Object.freeze([]) as readonly string[];

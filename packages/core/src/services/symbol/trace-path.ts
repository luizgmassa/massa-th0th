/**
 * Trace Path Service (Phase 4 D2)
 *
 * Graph traversal over the typed structural edges emitted by D1
 * (CALLS / DATA_FLOWS / HTTP_CALLS / EMITS / LISTENS / IMPORTS).
 *
 * Given a seed symbol, performs a bounded, cycle-guarded BFS over the
 * edge graph filtered by `mode` (which edge types to follow) and
 * `direction` (outbound = what the seed reaches; inbound = what reaches
 * the seed; both = run each separately).
 *
 * Output is agent-consumable: a set of nodes (symbols with file:line)
 * and edges (type + route/event/param metadata), plus readable call
 * chains reconstructed from the BFS predecessor map.
 *
 * Cost is bounded by `maxDepth` (default 3, hard cap MAX_DEPTH) and a
 * visited set keyed on (FQN, depth) so cycles cannot loop forever.
 */

import { logger } from "@massa-th0th/shared";
import { getSymbolRepository } from "../../data/sqlite/symbol-repository-factory.js";
import { symbolGraphService } from "./symbol-graph.service.js";
import type { EdgeType, EdgeResult } from "./symbol-graph.service.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type TraceDirection = "outbound" | "inbound" | "both";
export type TraceMode = "calls" | "data_flow" | "cross_service" | "all";

export interface TracePathOptions {
  /** Seed symbol — a bare name resolved against definitions, OR a FQN
   * ('rel/path.ts#Name') used directly. */
  symbol: string;
  /** Alias kept for clarity; merged with `symbol`. */
  function_name?: string;
  /** Explicit FQN — when set, skips name resolution entirely. */
  qualifiedName?: string;
  projectId: string;
  direction?: TraceDirection;
  mode?: TraceMode;
  /** Max BFS depth. Default 3, hard-capped at MAX_DEPTH. */
  depth?: number;
  /** Include test files in the traversal. Default false. */
  include_tests?: boolean;
  /** Explicit edge-type override; wins over `mode`. */
  edge_types?: EdgeType[];
}

export interface TraceNode {
  /** Stable symbol id: either the resolved FQN or, for unresolved callees,
   * the bare name as it appeared in source. */
  fqn: string;
  name: string;
  file?: string;
  line?: number;
  /** Hop distance from the nearest seed (0 for seeds). */
  depth: number;
  /** True when this node lives in a test file. */
  isTest?: boolean;
  /** True when this node is one of the BFS seeds. */
  isSeed?: boolean;
}

export interface TraceEdge {
  type: EdgeType;
  from: string;
  to: string;
  fromFile: string;
  fromLine: number;
  /** Typed-edge metadata (route, event, paramIndex, argName, callerFqn, method...). */
  meta?: Record<string, unknown> | null;
}

export interface TracePathResult {
  projectId: string;
  symbol: string;
  mode: TraceMode;
  direction: TraceDirection;
  /** Edge types actually used for the traversal (resolved mode/explicit). */
  edgeTypes: EdgeType[];
  /** Seeds the BFS started from (may be >1 for ambiguous name). */
  seeds: string[];
  nodes: TraceNode[];
  edges: TraceEdge[];
  /** Readable call chains (one per reached leaf), e.g. "a() -> b() -> c()". */
  chains: string[];
  truncated: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DEPTH = 3;
const MAX_DEPTH = 6;
/** Safety ceiling on total visited nodes so a pathological fan-out graph
 * cannot exhaust memory/time. */
const MAX_NODES = 2000;

/** mode → edge types to follow. */
const MODE_EDGE_TYPES: Record<TraceMode, EdgeType[]> = {
  // calls: direct function/method call edges only.
  calls: ["call"],
  // data_flow: calls + value-propagation edges (identifier args).
  data_flow: ["call", "data_flow"],
  // cross_service: HTTP + async (emit/listen) + data-flow hops that cross
  // service boundaries. CALLS excluded — they stay in-process.
  cross_service: ["http_call", "emit", "listen", "data_flow"],
  // all: every typed edge.
  all: ["call", "data_flow", "http_call", "emit", "listen", "import", "type_ref", "extend", "implement"],
};

const TEST_FILE_RE = /(^|\/)(test|tests|spec|specs|__tests__)(\/|$)|(\.|_|-)(test|spec)\.(t|j)sx?$/i;

// ─── Service ──────────────────────────────────────────────────────────────────

export class TracePathService {
  private static instance: TracePathService | null = null;

  private constructor() {}

  static getInstance(): TracePathService {
    if (!TracePathService.instance) {
      TracePathService.instance = new TracePathService();
    }
    return TracePathService.instance;
  }

  /**
   * Resolve the seed symbol to one or more FQNs.
   *
   * Precedence:
   *   1. Explicit `qualifiedName` (used verbatim — single seed).
   *   2. `symbol`/`function_name` that looks like a FQN (contains '#').
   *   3. Name lookup against `findDefinitionsByName` → all matches (union BFS).
   *
   * Returns `[]` when nothing resolves; the caller surfaces a not-found hint.
   */
  async resolveSeeds(
    projectId: string,
    opts: TracePathOptions,
  ): Promise<{ fqn: string; name: string; file?: string; line?: number }[]> {
    const explicit = opts.qualifiedName ?? (opts.symbol?.includes("#") ? opts.symbol : undefined);
    if (explicit) {
      // name = the segment after '#'
      const name = explicit.includes("#") ? explicit.split("#").pop()! : explicit;
      return [{ fqn: explicit, name }];
    }

    const name = opts.symbol ?? opts.function_name;
    if (!name) return [];

    const repo = getSymbolRepository();
    let defs: { id: string; name: string; file_path: string; line_start: number }[] = [];
    try {
      defs = await repo.findDefinitionsByName(projectId, name);
    } catch {
      return [];
    }
    return defs.map((d) => ({ fqn: d.id, name: d.name, file: d.file_path, line: d.line_start }));
  }

  /**
   * Run the traversal. See {@link TracePathOptions} / {@link TracePathResult}.
   */
  async tracePath(opts: TracePathOptions): Promise<TracePathResult> {
    const projectId = opts.projectId;
    const direction: TraceDirection = opts.direction ?? "outbound";
    const mode: TraceMode = opts.mode ?? "calls";
    const includeTests = opts.include_tests ?? false;
    const requestedDepth = opts.depth ?? DEFAULT_DEPTH;
    const depth = Math.max(0, Math.min(MAX_DEPTH, requestedDepth));

    // Resolve edge types: explicit override > mode.
    const edgeTypes: EdgeType[] =
      opts.edge_types && opts.edge_types.length > 0 ? opts.edge_types : MODE_EDGE_TYPES[mode];

    // Resolve seeds.
    const seedDefs = await this.resolveSeeds(projectId, opts);
    const seeds = seedDefs.map((s) => s.fqn);

    const empty: TracePathResult = {
      projectId,
      symbol: opts.qualifiedName ?? opts.symbol ?? opts.function_name ?? "",
      mode,
      direction,
      edgeTypes,
      seeds,
      nodes: [],
      edges: [],
      chains: [],
      truncated: false,
    };

    if (seeds.length === 0) return empty;

    // Outbound and inbound are run independently (distinct edge queries), then
    // merged into a single node/edge set. `both` runs both halves.
    const doOutbound = direction === "outbound" || direction === "both";
    const doInbound = direction === "inbound" || direction === "both";

    const nodes = new Map<string, TraceNode>();
    const edges: TraceEdge[] = [];
    const seenEdge = new Set<string>();
    let truncated = false;

    const addNode = (n: TraceNode) => {
      if (nodes.size >= MAX_NODES && !nodes.has(n.fqn)) {
        truncated = true;
        return false;
      }
      if (!nodes.has(n.fqn)) nodes.set(n.fqn, n);
      return true;
    };
    const addEdge = (e: TraceEdge) => {
      const key = `${e.type}|${e.from}|${e.to}|${e.fromFile}:${e.fromLine}`;
      if (seenEdge.has(key)) return;
      seenEdge.add(key);
      edges.push(e);
    };

    // Seed nodes at depth 0.
    const seedLookup = new Map(seedDefs.map((s) => [s.fqn, s]));
    for (const fqn of seeds) {
      const def = seedLookup.get(fqn)!;
      const ok = addNode({
        fqn,
        name: def.name,
        file: def.file,
        line: def.line,
        depth: 0,
        isSeed: true,
        isTest: def.file ? TEST_FILE_RE.test(def.file) : false,
      });
      if (!ok) break;
    }

    if (doOutbound) {
      await this.bfs(projectId, seeds, edgeTypes, "outbound", depth, includeTests, addNode, addEdge, () => (truncated = true));
    }
    if (doInbound) {
      await this.bfs(projectId, seeds, edgeTypes, "inbound", depth, includeTests, addNode, addEdge, () => (truncated = true));
    }

    // Drop test-file nodes when the caller excluded tests (seeds are always kept).
    const finalNodes = Array.from(nodes.values()).filter(
      (n) => includeTests || !n.isTest || n.isSeed,
    );

    // Build readable chains from the edge predecessor relationships.
    const chains = this.buildChains(seeds, edges);

    const result: TracePathResult = {
      projectId,
      symbol: opts.qualifiedName ?? opts.symbol ?? opts.function_name ?? "",
      mode,
      direction,
      edgeTypes,
      seeds,
      nodes: finalNodes,
      edges,
      chains,
      truncated,
    };

    logger.debug("TracePathService: trace complete", {
      projectId,
      seeds: seeds.length,
      nodes: finalNodes.length,
      edges: edges.length,
      chains: chains.length,
      truncated,
    });

    return result;
  }

  // ─── BFS core ───────────────────────────────────────────────────────────────

  /**
   * Breadth-first traversal. `addNode`/`addEdge` mutators are injected so the
   * outbound and inbound passes share one node/edge set. The visited set is
   * keyed on FQN (not FQN+depth) so each symbol is expanded at most once —
   * depth is still tracked per-node for reporting.
   *
   * Outbound: follow edges where the seed-side symbol is the `fromSymbol`
   * (caller / source). The reached node is the edge's `targetFqn`.
   * Inbound: follow edges where the seed-side symbol is the `toSymbol`
   * (callee / target). The reached node is the edge's source FQN.
   */
  private async bfs(
    projectId: string,
    seeds: string[],
    edgeTypes: EdgeType[],
    dir: "outbound" | "inbound",
    maxDepth: number,
    includeTests: boolean,
    addNode: (n: TraceNode) => boolean,
    addEdge: (e: TraceEdge) => void,
    markTruncated: () => void,
  ): Promise<void> {
    const visited = new Set<string>();
    // queue entries: the FQN to expand + its depth.
    const queue: Array<{ fqn: string; depth: number }> = seeds.map((fqn) => ({ fqn, depth: 0 }));

    while (queue.length > 0) {
      const { fqn, depth } = queue.shift()!;
      if (visited.has(fqn)) continue;
      if (depth >= maxDepth) {
        visited.add(fqn); // mark expanded to avoid re-queuing
        continue;
      }
      visited.add(fqn);

      let edges: EdgeResult[] = [];
      try {
        edges = await symbolGraphService.getEdges(projectId, {
          types: edgeTypes,
          direction: dir === "outbound" ? "outgoing" : "incoming",
          ...(dir === "outbound" ? { fromSymbol: fqn } : { toSymbol: fqn }),
        });
      } catch {
        // best-effort: a failed query for one node should not abort the walk.
        continue;
      }

      for (const e of edges) {
        // ── Symbol-level filtering ─────────────────────────────────────────
        // `findEdges` filters `fromSymbol` by FILE, not by caller FQN (a
        // pre-existing D1 limitation — see SIDE FINDING #1). So a query for
        // chain.ts#alpha returns every call edge in chain.ts. We refine to
        // symbol-level here: only follow an edge when it genuinely originates
        // from (outbound) or terminates at (inbound) the current FQN.
        if (dir === "outbound") {
          const caller = e.meta?.callerFqn;
          // When the extractor stamped a callerFqn, require an exact match.
          // When it did not (rare for non-call edges), fall back to accepting
          // the edge so unresolved-but-plausible hops still surface.
          if (typeof caller === "string" && caller && caller !== fqn) continue;
        } else {
          // Inbound: the edge must target the current FQN exactly.
          if (e.targetFqn !== fqn) continue;
        }

        // Determine the "other end" of this edge relative to the current node.
        // For HTTP_CALL / EMITS / external calls the callee is often NOT a
        // project symbol (e.g. `fetch('/api/x')`) — there is no targetFqn. In
        // that case the route/event string is the meaningful destination: use
        // it as a synthetic leaf id so the edge is still recorded.
        let otherFqn: string | undefined;
        if (dir === "outbound") {
          otherFqn = e.targetFqn ?? this.syntheticTarget(e);
        } else {
          otherFqn = this.extractCallerFqn(e, fqn);
        }
        const isSelfHop = otherFqn === fqn;

        // Edge bookkeeping — record the edge even for unresolved/leaf targets,
        // so HTTP routes and event names are always surfaced.
        if (!isSelfHop && otherFqn) {
          const fromFqn = dir === "outbound" ? fqn : otherFqn;
          const toFqn = dir === "outbound" ? otherFqn : fqn;
          addEdge({
            type: e.refKind as EdgeType,
            from: fromFqn,
            to: toFqn,
            fromFile: e.fromFile,
            fromLine: e.fromLine,
            meta: e.meta ?? null,
          });
        }

        // No hop target (or self) → this edge is a leaf; nothing to enqueue.
        if (!otherFqn || isSelfHop) continue;

        // Test-file gate: never traverse INTO a test file when excluded.
        const isTest = TEST_FILE_RE.test(e.fromFile);
        if (!includeTests && isTest) continue;

        if (!visited.has(otherFqn)) {
          const ok = addNode({
            fqn: otherFqn,
            name: this.fqnToName(otherFqn),
            file: e.fromFile,
            line: e.fromLine,
            depth: depth + 1,
            isTest,
          });
          if (!ok) {
            markTruncated();
            return;
          }
          queue.push({ fqn: otherFqn, depth: depth + 1 });
        }
      }
    }
  }

  /**
   * For an inbound edge, the "other end" is the caller. The D1 extractor stamps
   * `meta.callerFqn` on CALL edges; fall back to the edge's symbol name when no
   * FQN is recorded (e.g. cross-file calls that did not resolve).
   */
  private extractCallerFqn(e: EdgeResult, currentFqn: string): string | undefined {
    const caller = e.meta?.callerFqn;
    if (typeof caller === "string" && caller) return caller;
    // For non-CALL typed edges inbound, there is no caller concept — skip.
    // Return undefined so the BFS does not fabricate a hop.
    return undefined;
  }

  /**
   * Build a synthetic leaf id for edges whose callee is not a project symbol
   * (HTTP routes, event names, external globals). Keeps the edge + its
   * meaningful metadata in the result instead of dropping it.
   */
  private syntheticTarget(e: EdgeResult): string | undefined {
    const route = e.meta?.route;
    if (typeof route === "string" && route) return `http:${route}`;
    const event = e.meta?.event;
    if (typeof event === "string" && event) return `event:${event}`;
    // Fall back to the bare callee name so the edge is at least labeled.
    return e.symbolName ? `${e.refKind}:${e.symbolName}` : undefined;
  }

  /** Derive a short display name from a FQN ('path/file.ts#Name' → 'Name'). */
  private fqnToName(fqn: string): string {
    return fqn.includes("#") ? fqn.split("#").pop()! : fqn;
  }

  /**
   * Reconstruct readable call chains (root → leaf) from the edge set, scoped to
   * the seed roots. A leaf is any node that is never a `from` in the edge set.
   *
   * Bounded: the DFS carries a walk budget (MAX_CHAIN_WALKS) and stops as soon
   * as enough chains are collected, so a dense hub topology cannot explode the
   * recursion before the final `slice(0, 50)` cap.
   */
  private buildChains(seeds: string[], edges: TraceEdge[]): string[] {
    if (edges.length === 0) return [];

    const seedSet = new Set(seeds);
    // adjacency: from -> [to, ...] over typed edges.
    const adj = new Map<string, string[]>();
    const whoHasChild = new Set<string>();
    for (const e of edges) {
      const arr = adj.get(e.from) ?? [];
      arr.push(e.to);
      adj.set(e.from, arr);
      whoHasChild.add(e.from);
    }

    const CHAIN_CAP = 50;
    // Walk budget bounds the total number of recursive walk() invocations so a
    // pathological fan-out (dense hub) can't blow up before the slice cap.
    const MAX_WALKS = 5000;
    const chains: string[] = [];
    const seen = new Set<string>();
    let walks = 0;

    const walk = (fqn: string, path: string[]) => {
      // Stop once we have enough chains OR the walk budget is exhausted.
      if (chains.length >= CHAIN_CAP) return;
      if (walks >= MAX_WALKS) return;
      walks++;
      const key = path.join("→");
      if (seen.has(key)) return;
      seen.add(key);
      const next = adj.get(fqn);
      if (!next || next.length === 0 || !whoHasChild.has(fqn)) {
        // leaf
        if (path.length > 1) chains.push(path.map((n) => this.fqnToName(n)).join(" → "));
        return;
      }
      for (const child of next) {
        if (chains.length >= CHAIN_CAP || walks >= MAX_WALKS) return;
        // cycle guard inside a single chain
        if (path.includes(child)) {
          const cycled = [...path, `${this.fqnToName(child)}↺`];
          chains.push(cycled.map((n) => n).join(" → "));
          continue;
        }
        walk(child, [...path, child]);
      }
    };

    for (const seed of seeds) {
      if (chains.length >= CHAIN_CAP) break;
      if (seedSet.has(seed) && whoHasChild.has(seed)) walk(seed, [seed]);
    }

    // Cap and dedupe-ish.
    return chains.slice(0, CHAIN_CAP);
  }
}

export const tracePathService = TracePathService.getInstance();

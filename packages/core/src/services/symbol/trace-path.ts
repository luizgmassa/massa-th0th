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
import { getSymbolRepository } from "../../data/symbol/symbol-repository-factory.js";
import { symbolGraphService } from "./symbol-graph.service.js";
import type { EdgeType, EdgeResult } from "./symbol-graph.service.js";
import { definitionLookupService, type DefinitionLookupResult } from "./definition-lookup.js";

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
  /**
   * Wall-clock budget (ms) for the traversal. If the BFS exceeds this it aborts
   * with `truncated=true` and whatever nodes/edges it has collected so far.
   * Additive to MAX_DEPTH / MAX_NODES. Default 5s (generous vs typical sub-
   * second walks). Injectable clock is for deterministic tests.
   */
  deadlineMs?: number;
  /** Injectable clock (defaults to Date.now) for deterministic deadline tests. */
  now?: () => number;
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
  /**
   * N4: pre-clamp total of unique node FQNs (the count we would have returned
   * if MAX_NODES did not apply). `nodes_shown = nodes.length` and
   * `nodes_omitted = nodes_total - nodes_shown` are derivable on the same
   * code path as the displayed list.
   */
  nodes_total: number;
  nodes_shown: number;
  nodes_omitted: number;
  /** Exact FQN lookup result; ambiguity is explicit and always has zero traversal. */
  identityResolution?: Exclude<DefinitionLookupResult, { status: "bare" }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DEPTH = 3;
const MAX_DEPTH = 6;
/** Safety ceiling on total visited nodes so a pathological fan-out graph
 * cannot exhaust memory/time. */
const MAX_NODES = 2000;
/**
 * Default wall-clock budget for a single tracePath() call. Additive to
 * MAX_DEPTH / MAX_NODES: a runaway traversal aborts with partial results
 * instead of hanging the agent. 5s is generous vs typical sub-second walks,
 * so unset behaviour is unchanged for normal queries.
 */
const DEFAULT_TRAVERSAL_DEADLINE_MS = 5_000;

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

  constructor(private readonly identityLookup = definitionLookupService) {}

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
    return (await this.resolveSeedResult(projectId, opts)).seeds;
  }

  private async resolveSeedResult(projectId: string, opts: TracePathOptions): Promise<{
    seeds: { fqn: string; name: string; file?: string; line?: number }[];
    identityResolution?: Exclude<DefinitionLookupResult, { status: "bare" }>;
  }> {
    const explicit = opts.qualifiedName ?? ((opts.symbol?.indexOf("#") ?? -1) > 0 ? opts.symbol : undefined);
    if (explicit) {
      const lookup = await this.identityLookup.lookup(projectId, explicit);
      return { identityResolution: lookup as Exclude<DefinitionLookupResult, { status: "bare" }>, seeds: lookup.status === "resolved" ? [{
        fqn: lookup.definition.id,
        name: lookup.definition.name,
        file: lookup.definition.file_path,
        line: lookup.definition.line_start,
      }] : [] };
    }

    const name = opts.symbol ?? opts.function_name;
    if (!name) return { seeds: [] };

    try {
      const lookup = await this.identityLookup.lookup(projectId, name);
      const defs = lookup.status === "bare" ? lookup.definitions : [];
      return { seeds: defs.map((d) => ({ fqn: d.id, name: d.name, file: d.file_path, line: d.line_start })) };
    } catch {
      return { seeds: [] };
    }
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
    // Wall-clock deadline: an additive guard so a runaway traversal aborts with
    // partial results instead of hanging. The default is generous; normal
    // queries never reach it. The clock is injectable for deterministic tests.
    const now = opts.now ?? Date.now;
    const deadlineAt = now() + (opts.deadlineMs ?? DEFAULT_TRAVERSAL_DEADLINE_MS);

    // Resolve edge types: explicit override > mode.
    const edgeTypes: EdgeType[] =
      opts.edge_types && opts.edge_types.length > 0 ? opts.edge_types : MODE_EDGE_TYPES[mode];

    // Resolve seeds.
    const seedResult = await this.resolveSeedResult(projectId, opts);
    const seedDefs = seedResult.seeds;
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
      nodes_total: 0,
      nodes_shown: 0,
      nodes_omitted: 0,
      ...(seedResult.identityResolution ? { identityResolution: seedResult.identityResolution } : {}),
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
    // N4: pre-clamp total of unique node FQNs. Increment on every NEW FQN
    // encountered (regardless of whether MAX_NODES let us store it) so
    // nodes_omitted = nodes_total - nodes_shown is derivable.
    let nodesTotal = 0;

    const addNode = (n: TraceNode) => {
      if (nodes.has(n.fqn)) return true;
      // New FQN — count it toward the pre-clamp total even if we reject it.
      nodesTotal++;
      if (nodes.size >= MAX_NODES) {
        truncated = true;
        return false;
      }
      nodes.set(n.fqn, n);
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
      await this.bfs(projectId, seeds, edgeTypes, "outbound", depth, includeTests, addNode, addEdge, () => (truncated = true), deadlineAt, now);
    }
    if (doInbound) {
      await this.bfs(projectId, seeds, edgeTypes, "inbound", depth, includeTests, addNode, addEdge, () => (truncated = true), deadlineAt, now);
    }

    // Drop test-file nodes when the caller excluded tests (seeds are always kept).
    const finalNodes = Array.from(nodes.values()).filter(
      (n) => includeTests || !n.isTest || n.isSeed,
    );

    // Build readable chains from the edge predecessor relationships.
    const chains = this.buildChains(seeds, edges);

    const nodesShown = finalNodes.length;
    const nodesOmitted = Math.max(0, nodesTotal - nodesShown);

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
      nodes_total: nodesTotal,
      nodes_shown: nodesShown,
      nodes_omitted: nodesOmitted,
      ...(seedResult.identityResolution ? { identityResolution: seedResult.identityResolution } : {}),
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
    deadlineAt: number,
    now: () => number,
  ): Promise<void> {
    const visited = new Set<string>();
    // queue entries: the FQN to expand + its depth.
    // Mark visited ON ENQUEUE (not dequeue): hubs with many inbound edges would
    // otherwise be enqueued once per incoming edge, each spawning a redundant
    // DB getEdges round-trip before the dequeue-time dedupe catches it.
    const queue: Array<{ fqn: string; depth: number }> = [];
    for (const seed of seeds) {
      if (visited.has(seed)) continue;
      visited.add(seed);
      queue.push({ fqn: seed, depth: 0 });
    }

    while (queue.length > 0) {
      const { fqn, depth } = queue.shift()!;
      if (depth >= maxDepth) {
        continue; // already marked visited at enqueue; no re-queue possible
      }
      // Wall-clock deadline: abort mid-traversal with partial results so a
      // runaway walk never hangs the agent. O(1) per iteration. The already-
      // collected nodes/edges are preserved by the caller.
      if (now() >= deadlineAt) {
        markTruncated();
        return;
      }

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
        // The caller-FQN predicate is now pushed into the SQL layer
        // (`findEdges` filters `meta.callerFqn` when the seed FQN carries a
        // `#Name`), so outbound edges returned here already originate from the
        // current FQN when the extractor stamped a callerFqn. We keep only a
        // defensive assert: an edge whose callerFqn is present AND mismatches
        // must not have passed the SQL filter — drop it defensively rather
        // than `continue` on the common path.
        if (dir === "outbound") {
          const caller = e.meta?.callerFqn;
          // Defensive only: the SQL filter already excluded mismatches when
          // the seed FQN had a '#Name'. Edges with no callerFqn (non-call
          // typed edges) are still accepted so unresolved hops surface.
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
          // Mark visited ON ENQUEUE so a hub referenced by N edges from the
          // current frontier is queued at most once (no duplicate DB round-trips).
          visited.add(otherFqn);
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

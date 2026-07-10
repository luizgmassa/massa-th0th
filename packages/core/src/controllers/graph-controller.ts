/**
 * Graph Controller
 *
 * Orchestration layer for Symbol Graph traversal tools. Today it fronts
 * trace_path (Phase 4 D2); future graph-walk tools (impact_analysis,
 * architecture-map) land here too so they share seed-resolution and
 * result-shaping logic.
 *
 * The controller keeps the tool handlers thin: input validation +
 * result formatting live here, while the BFS traversal is owned by
 * {@link TracePathService}.
 */

import { logger } from "@massa-th0th/shared";
import { tracePathService } from "../services/symbol/trace-path.js";
import type {
  TracePathOptions,
  TracePathResult,
  TraceDirection,
  TraceMode,
} from "../services/symbol/trace-path.js";
import type { EdgeType } from "../services/symbol/symbol-graph.service.js";

export interface TracePathInput {
  projectId: string;
  function_name?: string;
  symbol?: string;
  qualifiedName?: string;
  direction?: TraceDirection;
  mode?: TraceMode;
  depth?: number;
  include_tests?: boolean;
  edge_types?: EdgeType[];
}

export interface TracePathOutput {
  projectId: string;
  symbol: string;
  mode: TraceMode;
  direction: TraceDirection;
  edgeTypes: EdgeType[];
  seeds: string[];
  truncated: boolean;
  nodeCount: number;
  edgeCount: number;
  chains: string[];
  nodes: TracePathResult["nodes"];
  edges: TracePathResult["edges"];
  /** Surfaced when the seed did not resolve — agent-actionable hint. */
  notFoundHint?: string;
}

export class GraphController {
  private static instance: GraphController | null = null;

  private constructor() {}

  static getInstance(): GraphController {
    if (!GraphController.instance) {
      GraphController.instance = new GraphController();
    }
    return GraphController.instance;
  }

  /**
   * Validate input, run the traversal via {@link TracePathService}, and shape
   * the result for tool/API consumers. Returns `{ found: false, hint }` when
   * the seed resolves to nothing (rather than an empty success).
   */
  async tracePath(input: TracePathInput): Promise<
    | { found: true; result: TracePathOutput }
    | { found: false; hint: string; symbol: string; projectId: string }
  > {
    const projectId = input.projectId;
    const seed = input.function_name ?? input.symbol ?? input.qualifiedName;

    if (!projectId) throw new Error("projectId is required");
    if (!seed) throw new Error("function_name (or symbol/qualifiedName) is required");

    const t0 = performance.now();

    const result = await tracePathService.tracePath({
      symbol: input.function_name ?? input.symbol ?? "",
      function_name: input.function_name,
      qualifiedName: input.qualifiedName,
      projectId,
      direction: input.direction,
      mode: input.mode,
      depth: input.depth,
      include_tests: input.include_tests,
      edge_types: input.edge_types,
    });

    logger.info("GraphController: trace_path", {
      projectId,
      symbol: seed,
      mode: result.mode,
      direction: result.direction,
      seeds: result.seeds.length,
      nodes: result.nodes.length,
      edges: result.edges.length,
      durationMs: Math.round(performance.now() - t0),
    });

    if (result.seeds.length === 0) {
      return {
        found: false,
        symbol: seed,
        projectId,
        hint:
          "Use search_definitions(search=...) to find the exact name, or pass a fully-qualified name (qualifiedName='rel/path.ts#Name').",
      };
    }

    return {
      found: true,
      result: {
        projectId: result.projectId,
        symbol: result.symbol,
        mode: result.mode,
        direction: result.direction,
        edgeTypes: result.edgeTypes,
        seeds: result.seeds,
        truncated: result.truncated,
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
        chains: result.chains,
        nodes: result.nodes,
        edges: result.edges,
      },
    };
  }
}

/**
 * Trace Path Tool (trace_path)
 *
 * Trace paths through the code graph from a seed symbol, following typed
 * structural edges (CALLS / DATA_FLOWS / HTTP_CALLS / EMITS / LISTENS).
 *
 * Modes:
 *   - calls        → follow CALL edges (who calls whom)
 *   - data_flow    → follow CALL + DATA_FLOW edges (value propagation)
 *   - cross_service→ follow HTTP_CALL + EMITS + LISTENS + DATA_FLOW edges
 *   - all          → follow every typed edge
 *
 * Direction: outbound (what the seed reaches) | inbound (what reaches the
 * seed) | both. Default outbound.
 *
 * Use INSTEAD OF grep for callers, dependencies, impact analysis, or data
 * flow tracing — it walks the indexed graph with cycle + depth bounds.
 */

import { IToolHandler, ToolResponse } from "@massa-th0th/shared";
import { tracePathService } from "../services/symbol/trace-path.js";
import type { EdgeType } from "../services/symbol/symbol-graph.service.js";
import { serializeToolResponse } from "./serialize.js";

interface TracePathParams {
  projectId: string;
  /** Seed symbol — bare name or FQN. */
  function_name?: string;
  symbol?: string;
  qualifiedName?: string;
  direction?: "outbound" | "inbound" | "both";
  mode?: "calls" | "data_flow" | "cross_service" | "all";
  depth?: number;
  include_tests?: boolean;
  edge_types?: EdgeType[];
  format?: "json" | "toon";
}

export class TracePathTool implements IToolHandler {
  name = "trace_path";
  description =
    "Trace paths through the code graph from a seed symbol, following typed edges (CALLS/DATA_FLOWS/HTTP_CALLS/EMITS/LISTENS). " +
    "Modes: calls (callers/callees), data_flow (value propagation), cross_service (HTTP/async hops), all. " +
    "Direction: outbound (what it reaches) | inbound (what reaches it) | both. " +
    "Use INSTEAD OF grep for callers, dependencies, impact analysis, or data flow tracing.";

  inputSchema = {
    type: "object",
    properties: {
      function_name: {
        type: "string",
        description: "Seed symbol name (bare name resolved against definitions). Aliases: symbol, qualifiedName.",
      },
      symbol: { type: "string", description: "Alias for function_name." },
      qualifiedName: {
        type: "string",
        description: "Fully-qualified name (e.g. 'services/search/rlm.ts#ContextualSearchRLM') — skips name resolution.",
      },
      projectId: { type: "string", description: "The project ID to trace in" },
      direction: {
        type: "string",
        enum: ["outbound", "inbound", "both"],
        default: "outbound",
        description: "outbound = what the seed calls/flows to; inbound = what calls/flows into it; both = run each.",
      },
      mode: {
        type: "string",
        enum: ["calls", "data_flow", "cross_service", "all"],
        default: "calls",
        description:
          "calls: follow CALL edges. data_flow: CALL + DATA_FLOW. cross_service: HTTP_CALL + EMITS + LISTENS + DATA_FLOW. all: every typed edge.",
      },
      depth: {
        type: "number",
        description: "Max BFS depth (default 3, hard cap 6 to bound cost).",
        default: 3,
      },
      include_tests: {
        type: "boolean",
        default: false,
        description: "Whether to traverse into test files (default false).",
      },
      edge_types: {
        type: "array",
        items: { type: "string" },
        description: "Explicit edge-type override (wins over mode): call|data_flow|http_call|emit|listen|import|type_ref|extend|implement.",
      },
      format: {
        type: "string",
        enum: ["json", "toon"],
        description: "Output format (json or toon). Default: json.",
        default: "json",
      },
    },
    required: ["projectId", "function_name"],
  };

  async handle(params: unknown): Promise<ToolResponse> {
    const p = params as TracePathParams;
    const { format = "json" } = p;
    const seed = p.function_name ?? p.symbol ?? p.qualifiedName;
    if (!seed) {
      return { success: false, error: "function_name (or symbol/qualifiedName) is required" };
    }
    if (!p.projectId) {
      return { success: false, error: "projectId is required" };
    }

    try {
      const result = await tracePathService.tracePath({
        symbol: p.function_name ?? p.symbol ?? "",
        function_name: p.function_name,
        qualifiedName: p.qualifiedName,
        projectId: p.projectId,
        direction: p.direction,
        mode: p.mode,
        depth: p.depth,
        include_tests: p.include_tests,
        edge_types: p.edge_types,
      });

      if (result.seeds.length === 0) {
        return {
          success: false,
          error: `Symbol '${seed}' not found in project '${p.projectId}'.`,
          data: {
            hint:
              "Use search_definitions(search=...) to find the exact name, then pass it to trace_path. " +
              "Or pass a fully-qualified name (qualifiedName='rel/path.ts#Name') to skip name resolution.",
          },
        };
      }

      return serializeToolResponse(
        {
          projectId: result.projectId,
          symbol: result.symbol,
          mode: result.mode,
          direction: result.direction,
          edgeTypes: result.edgeTypes,
          seeds: result.seeds,
          truncated: result.truncated,
          nodeCount: result.nodes.length,
          edgeCount: result.edges.length,
          nodes: result.nodes,
          edges: result.edges.map((e) => ({
            type: e.type,
            from: e.from,
            to: e.to,
            fromFile: e.fromFile,
            fromLine: e.fromLine,
            meta: e.meta,
          })),
          chains: result.chains,
        },
        { format },
      );
    } catch (error) {
      return {
        success: false,
        error: `Failed to trace path: ${(error as Error).message}`,
      };
    }
  }
}

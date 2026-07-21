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
import { validateEnum, ToolError } from "./enum-validation.js";
import { getActiveGeneration, assertGenerationNotStale } from "../services/symbol/active-generation.js";

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
  /** Wall-clock budget (ms) bounding the traversal. Default 5000. */
  deadline_ms?: number;
  format?: "json" | "toon";
  fields?: string[];
  /**
   * N1 (WAVE4-N1): optional precondition — the client's last-known
   * `activatedGraphGenerationId`. If it mismatches the current active
   * generation, the tool throws a 412 teaching error. Opt-in: omitted →
   * no precondition.
   */
  ifNoneMatch?: string;
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
      deadline_ms: {
        type: "number",
        default: 5000,
        description:
          "Wall-clock budget (ms) bounding the graph traversal. If exceeded the walk aborts with truncated=true and partial nodes/edges. Default 5000.",
      },
      format: {
        type: "string",
        enum: ["json", "toon"],
        description: "Output format (json or toon). Default: json.",
        default: "json",
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description:
          "Projection — keep only these keys (dotted paths supported, e.g. ['nodes.symbol']). Absent/empty → full data.",
      },
      ifNoneMatch: {
        type: "string",
        description:
          "Optional precondition: the client's last-known `activatedGraphGenerationId`. If it mismatches the current active generation, the tool returns a 412 teaching error.",
      },
    },
    required: ["projectId", "function_name"],
  };

  async handle(params: unknown): Promise<ToolResponse> {
    const p = params as TracePathParams;
    const { format = "json", fields } = p;
    const seed = p.function_name ?? p.symbol ?? p.qualifiedName;
    if (!seed) {
      return { success: false, error: "function_name (or symbol/qualifiedName) is required" };
    }
    if (!p.projectId) {
      return { success: false, error: "projectId is required" };
    }
    const direction = validateEnum<"outbound" | "inbound" | "both">(
      "direction",
      p.direction ?? "outbound",
      ["outbound", "inbound", "both"] as const,
    );
    const mode = validateEnum<"calls" | "data_flow" | "cross_service" | "all">(
      "mode",
      p.mode ?? "calls",
      ["calls", "data_flow", "cross_service", "all"] as const,
    );

    // N1 (WAVE4-N1): surface the active graph generation id + opt-in stale
    // precondition. The lookup is cheap; the precondition is opt-in.
    const activatedGraphGenerationId = await getActiveGeneration(p.projectId);
    try {
      assertGenerationNotStale(p.ifNoneMatch, activatedGraphGenerationId);
    } catch (e) {
      if (e instanceof ToolError) {
        return { success: false, error: e.message };
      }
      throw e;
    }

    try {
      const result = await tracePathService.tracePath({
        symbol: p.function_name ?? p.symbol ?? "",
        function_name: p.function_name,
        qualifiedName: p.qualifiedName,
        projectId: p.projectId,
        direction,
        mode,
        depth: p.depth,
        include_tests: p.include_tests,
        edge_types: p.edge_types,
        deadlineMs: p.deadline_ms,
      });

      if (result.seeds.length === 0) {
        return {
          success: false,
          error: `Symbol '${seed}' not found in project '${p.projectId}'.`,
          data: {
            hint:
              "Use search_definitions(search=...) to find the exact name, then pass it to trace_path. " +
              "Or pass a fully-qualified name (qualifiedName='rel/path.ts#Name') to skip name resolution.",
            // N1 (WAVE4-N1): still surface the generation id on the not-found path.
            activatedGraphGenerationId,
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
          nodes_total: result.nodes_total,
          nodes_shown: result.nodes_shown,
          nodes_omitted: result.nodes_omitted,
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
          // N1 (WAVE4-N1): the active graph generation id at query time.
          activatedGraphGenerationId,
        },
        { format, fields },
      );
    } catch (error) {
      return {
        success: false,
        error: `Failed to trace path: ${(error as Error).message}`,
      };
    }
  }
}

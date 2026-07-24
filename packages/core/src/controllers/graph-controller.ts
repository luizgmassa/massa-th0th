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

import { logger } from "@massa-ai/shared";
import { tracePathService } from "../services/symbol/trace-path.js";
import type {
  TracePathOptions,
  TracePathResult,
  TraceDirection,
  TraceMode,
} from "../services/symbol/trace-path.js";
import type { EdgeType } from "../services/symbol/symbol-graph.service.js";
import { impactAnalysisService } from "../services/symbol/impact-analysis.js";
import type {
  ImpactAnalysisOptions,
  ImpactAnalysisResult,
  ImpactScope,
} from "../services/symbol/impact-analysis.js";
import type { DefinitionLookupResult } from "../services/symbol/definition-lookup.js";
import { toSymbolIdentityResolution } from "../services/symbol/definition-lookup.js";
import type { SymbolIdentityResolution } from "@massa-ai/shared";

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
  nodes_total: number;
  nodes_shown: number;
  nodes_omitted: number;
  nodeCount: number;
  edgeCount: number;
  chains: string[];
  nodes: TracePathResult["nodes"];
  edges: TracePathResult["edges"];
  identity?: SymbolIdentityResolution;
  /** Surfaced when the seed did not resolve — agent-actionable hint. */
  notFoundHint?: string;
}

export interface ImpactAnalysisInput {
  projectId: string;
  projectPath: string;
  scope?: ImpactScope;
  base_branch?: string;
  since?: string;
  depth?: number;
  paths?: string[];
  /** Injectable diff runner (tests). */
  diffRunner?: ImpactAnalysisOptions["diffRunner"];
}

export interface ImpactAnalysisOutput {
  projectId: string;
  scope: ImpactScope;
  baseBranch?: string;
  since?: string;
  depth: number;
  changedFileCount: number;
  changedFiles: ImpactAnalysisResult["changedFiles"];
  impactedCount: number;
  truncated: boolean;
  impacted: ImpactAnalysisResult["impacted"];
  untrackedFiltered: number;
  impacted_total: number;
  impacted_shown: number;
  impacted_omitted: number;
  note?: string;
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
    | { found: false; hint: string; symbol: string; projectId: string; identityResolution?: Exclude<DefinitionLookupResult, { status: "bare" }> }
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
        ...(result.identityResolution ? { identityResolution: result.identityResolution } : {}),
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
        nodes_total: result.nodes_total,
        nodes_shown: result.nodes_shown,
        nodes_omitted: result.nodes_omitted,
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
        chains: result.chains,
        nodes: result.nodes,
        edges: result.edges,
        ...(result.identityResolution
          ? { identity: toSymbolIdentityResolution(result.identityResolution) }
          : {}),
      },
    };
  }

  /**
   * Run impact analysis via {@link ImpactAnalysisService}: scoped git diff →
   * changed files → reverse traversal of importers + references → ranked
   * impacted symbols. Returns the raw service result shaped for tool/API
   * consumers.
   */
  async analyzeImpact(input: ImpactAnalysisInput): Promise<ImpactAnalysisOutput> {
    if (!input.projectId) throw new Error("projectId is required");
    if (!input.projectPath) throw new Error("projectPath is required");

    const t0 = performance.now();

    const result = await impactAnalysisService.analyze({
      projectId: input.projectId,
      projectPath: input.projectPath,
      scope: input.scope ?? "unstaged",
      baseBranch: input.base_branch,
      since: input.since,
      depth: input.depth,
      paths: input.paths,
      diffRunner: input.diffRunner,
    });

    logger.info("GraphController: impact_analysis", {
      projectId: input.projectId,
      scope: result.scope,
      changedFiles: result.changedFiles.length,
      impacted: result.impacted.length,
      truncated: result.truncated,
      durationMs: Math.round(performance.now() - t0),
    });

    return {
      projectId: result.projectId,
      scope: result.scope,
      baseBranch: result.baseBranch,
      since: result.since,
      depth: result.depth,
      changedFileCount: result.changedFiles.length,
      changedFiles: result.changedFiles,
      impactedCount: result.impacted.length,
      truncated: result.truncated,
      impacted: result.impacted,
      untrackedFiltered: result.untrackedFiltered,
      impacted_total: result.impacted_total,
      impacted_shown: result.impacted_shown,
      impacted_omitted: result.impacted_omitted,
      note: result.note,
    };
  }
}

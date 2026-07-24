/**
 * Get Architecture Tool (get_architecture) — Wave 5 FR-01 / FR-02.
 *
 * Returns the architecture map for a project: packages, entry points, routes,
 * hotspots, communities, layers, and opt-in `cycles` (iterative Tarjan SCC
 * over CALL edges). Mirrors the existing `project_map` tool but with opt-in
 * aspects and a teaching-error-first contract (unknown aspect → 400 listing
 * valid values, Wave 4 N6 parity).
 *
 * Input:  { projectId, projectPath?, aspects?, centralityLimit?, format?, fields? }
 * Output: serialized ArchitectureMap (cycles + cycles_truncated present only
 *         when `aspects` includes "cycles").
 */

import { IToolHandler, ToolResponse } from "@massa-ai/shared";
import { symbolGraphService } from "../services/symbol/symbol-graph.service.js";
import { serializeToolResponse } from "./serialize.js";
import { ToolError } from "./enum-validation.js";
import { VALID_ARCHITECTURE_ASPECTS } from "../services/symbol/architecture.js";

interface GetArchitectureParams {
  projectId: string;
  /** Absolute path to the project working tree (for auto-reindex; optional). */
  projectPath?: string;
  /** Opt-in aspects. Only "cycles" today. Unknown → teaching error. */
  aspects?: string[];
  /** Max number of top central files to include. Default 20. */
  centralityLimit?: number;
  format?: "json" | "toon" | "tree";
  fields?: string[];
}

export class GetArchitectureTool implements IToolHandler {
  name = "get_architecture";
  description =
    "Get the architecture map for a project: packages, entry points, routes, hotspots, communities, layers, and opt-in cycles (Tarjan SCC over CALL edges). " +
    "Pass aspects:[\"cycles\"] to surface strongly connected components (file-level call cycles). Unknown aspect values return a teaching error listing valid values.";

  inputSchema = {
    type: "object",
    properties: {
      projectId: {
        type: "string",
        description: "The project ID (as registered via index_project).",
      },
      projectPath: {
        type: "string",
        description:
          "Absolute path to the project working tree. Optional; used only for auto-reindex triggers.",
      },
      aspects: {
        type: "array",
        items: { type: "string" },
        description:
          "Opt-in aspects. Only \"cycles\" today: runs iterative Tarjan SCC over CALL edges and returns { cycles, cycles_truncated }. Unknown values return a 400 teaching error listing valid values.",
      },
      centralityLimit: {
        type: "number",
        description: "Max number of top central files to include. Default 20.",
        default: 20,
      },
      format: {
        type: "string",
        enum: ["json", "toon", "tree"],
        description:
          "Output format. 'json' (default) emits the raw object. 'toon' encodes it. 'tree' (Wave 5 FR-06) emits a text-indented grouped model via the shared groupRowsByPrefix helper (groups hotspots by file). Default: json.",
        default: "json",
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description:
          "Projection — keep only these keys (dotted paths supported). Absent/empty → full data.",
      },
    },
    required: ["projectId"],
  };

  async handle(params: unknown): Promise<ToolResponse> {
    const p = params as GetArchitectureParams;
    const { format = "json", fields } = p;
    if (!p.projectId) {
      return { success: false, error: "projectId is required" };
    }

    // Validate aspects (teaching error before any DB work — Wave 4 N6 parity).
    if (p.aspects !== undefined) {
      for (const a of p.aspects) {
        if (!VALID_ARCHITECTURE_ASPECTS.includes(a as (typeof VALID_ARCHITECTURE_ASPECTS)[number])) {
          return {
            success: false,
            error: `Invalid aspects value: ${String(a)}. Valid values: ${VALID_ARCHITECTURE_ASPECTS.join(", ")}.`,
          };
        }
      }
    }

    const centralityLimit = p.centralityLimit ?? 20;

    try {
      const map = await symbolGraphService.getArchitecture(p.projectId, {
        aspects: p.aspects,
        centralityLimit,
      });
      if (!map) {
        return {
          success: false,
          error: `Project '${p.projectId}' not found or has no indexed files.`,
        };
      }
      // Wave 5 FR-07: tree format groups hotspots by file via the shared
      // groupRowsByPrefix helper. json/toon unchanged when tree not selected.
      const groupOpts =
        format === "tree" ? { format, fields, groupBy: { file: "file" } } : { format, fields };
      return serializeToolResponse(map, groupOpts);
    } catch (error) {
      // ToolError (teaching error from the service or the validator) →
      // surface the message verbatim so the MCP transport maps it to 400.
      if (error instanceof ToolError) {
        return { success: false, error: error.message };
      }
      return {
        success: false,
        error: `Failed to get architecture: ${(error as Error).message}`,
      };
    }
  }
}
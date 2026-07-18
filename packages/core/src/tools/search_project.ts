/**
 * Search Project Tool
 *
 * Thin MCP tool layer — validates input and delegates to SearchController.
 * All business logic lives in controllers/search-controller.ts.
 */

import { IToolHandler, ToolResponse } from "@massa-th0th/shared";
import { logger } from "@massa-th0th/shared";
import { SearchController } from "../controllers/search-controller.js";
import { serializeToolResponse } from "./serialize.js";

interface SearchProjectParams {
  query: string;
  projectId: string;
  projectPath?: string;
  maxResults?: number;
  minScore?: number;
  responseMode?: "summary" | "full" | "enriched";
  autoReindex?: boolean;
  include?: string[];
  exclude?: string[];
  explainScores?: boolean;
  format?: "json" | "toon";
  sessionId?: string;
  fields?: string[];
}

export class SearchProjectTool implements IToolHandler {
  name = "search_project";
  description =
    "Search for code in an indexed project using semantic and keyword search";
  inputSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (natural language or keywords)",
      },
      projectId: {
        type: "string",
        description: "Project ID to search in",
      },
      projectPath: {
        type: "string",
        description: "Project path (required for autoReindex)",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results to return",
        default: 10,
      },
      minScore: {
        type: "number",
        description: "Minimum relevance score (0-1)",
        default: 0.3,
      },
      responseMode: {
        type: "string",
        enum: ["summary", "full", "enriched"],
        description:
          "Response format: 'summary' (preview only), 'full' (full content), 'enriched' (full content + fileImports + parentSymbol)",
        default: "summary",
      },
      autoReindex: {
        type: "boolean",
        description:
          "Automatically reindex if project index is stale (can increase latency)",
        default: false,
      },
      include: {
        type: "array",
        items: { type: "string" },
        description:
          "Glob patterns to include (e.g., ['src/components/**/*.tsx', 'src/utils/**'])",
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description:
          "Glob patterns to exclude (e.g., ['**/*.test.*', '**/*.spec.*'])",
      },
      explainScores: {
        type: "boolean",
        description:
          "Include detailed score breakdown (vector, keyword, RRF components)",
        default: false,
      },
      format: {
        type: "string",
        enum: ["json", "toon"],
        description: "Output format (json or toon)",
        default: "toon",
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description:
          "Projection — keep only these keys (dotted paths supported, e.g. ['nodes.symbol']). Absent/empty → full data.",
      },
      sessionId: {
        type: "string",
        description: "Session ID for search hook scoping (enables session memory persistence)",
      },
    },
    required: ["query", "projectId"],
  };

  private controller: SearchController;

  constructor() {
    this.controller = SearchController.getInstance();
  }

  async handle(params: unknown): Promise<ToolResponse> {
    const p = params as SearchProjectParams;
    const format = p.format || "toon";
    const { fields } = p;

    try {
      const result = await this.controller.searchProject(p);

      return serializeToolResponse(result, { format, fields });
    } catch (error) {
      logger.error("Failed to search project", error as Error, {
        query: p.query,
        projectId: p.projectId,
      });

      return {
        success: false,
        error: `Failed to search project: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

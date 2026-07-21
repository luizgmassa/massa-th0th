/**
 * Search Definitions Tool (search_definitions)
 *
 * Browse symbols (functions, classes, types, etc.) in a project.
 * Uses the Symbol Graph's PostgreSQL index for fast, exact results.
 */

import {
  IToolHandler,
  STRUCTURAL_SYMBOL_KINDS,
  STRUCTURAL_SYMBOL_KIND_SCHEMA,
  ToolResponse,
} from "@massa-th0th/shared";
import { symbolGraphService } from "../services/symbol/symbol-graph.service.js";
import { validateEnum, ToolError } from "./enum-validation.js";
import { getActiveGeneration, assertGenerationNotStale } from "../services/symbol/active-generation.js";

interface SearchDefinitionsParams {
  projectId: string;
  query?: string;
  kind?: string[];
  file?: string;
  exportedOnly?: boolean;
  maxResults?: number;
  /**
   * N1 (WAVE4-N1): optional precondition — the client's last-known
   * `activatedGraphGenerationId`. If it mismatches the current active
   * generation, the tool throws a 412 teaching error. Opt-in: omitted →
   * no precondition.
   */
  ifNoneMatch?: string;
}

export class SearchDefinitionsTool implements IToolHandler {
  name = "search_definitions";
  description =
    "Search for symbol definitions (functions, classes, variables, types, interfaces) in an indexed project. Returns name, kind, file location, and doc comments.";

  inputSchema = {
    type: "object",
    properties: {
      projectId: {
        type: "string",
        description: "The project ID to search in",
      },
      query: {
        type: "string",
        description: "Substring search on symbol name (case-insensitive)",
      },
      kind: {
        type: "array",
        items: STRUCTURAL_SYMBOL_KIND_SCHEMA,
        description: "Filter by symbol kind",
      },
      file: {
        type: "string",
        description: "Filter by file path (relative to project root)",
      },
      exportedOnly: {
        type: "boolean",
        description: "Return only exported symbols",
        default: false,
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results to return (default: 20)",
        default: 20,
      },
      ifNoneMatch: {
        type: "string",
        description:
          "Optional precondition: the client's last-known `activatedGraphGenerationId`. If it mismatches the current active generation, the tool returns a 412 teaching error.",
      },
    },
    required: ["projectId"],
  };

  async handle(params: unknown): Promise<ToolResponse> {
    const {
      projectId,
      query,
      kind,
      file,
      exportedOnly = false,
      maxResults = 20,
      ifNoneMatch,
    } = params as SearchDefinitionsParams;

    // Validate each kind entry against the 18 canonical structural kinds.
    // Empty/missing kind is allowed (no filter); an invalid kind string
    // teaching-errors immediately with the full valid-values list.
    const validatedKind = kind
      ? kind.map((k) =>
          validateEnum<typeof STRUCTURAL_SYMBOL_KINDS[number]>(
            "kind",
            k,
            STRUCTURAL_SYMBOL_KINDS,
          ),
        )
      : undefined;

    // N1 (WAVE4-N1): surface the active graph generation id + opt-in stale
    // precondition. search_definitions reads the symbol graph, so it
    // participates; search_code is excluded (vector + keyword only).
    const activatedGraphGenerationId = await getActiveGeneration(projectId);
    try {
      assertGenerationNotStale(ifNoneMatch, activatedGraphGenerationId);
    } catch (e) {
      if (e instanceof ToolError) {
        return { success: false, error: e.message };
      }
      throw e;
    }

    try {
      const { definitions, total, total_exact } = await symbolGraphService.listDefinitions(projectId, {
        search: query,
        kind: validatedKind,
        file,
        exportedOnly,
        limit: maxResults,
      });
      const shown = definitions.length;
      const omitted = Math.max(0, total - shown);

      return {
        success: true,
        data: {
          definitions: definitions.map((d) => ({
            fqn: d.fqn,
            name: d.name,
            kind: d.kind,
            file: d.file,
            lineStart: d.lineStart,
            lineEnd: d.lineEnd,
            exported: d.exported,
            docComment: d.docComment,
            centralityScore: d.centralityScore,
          })),
          // N4 (WAVE4-N4): pre-LIMIT total, post-LIMIT shown, omitted = total - shown.
          // `total` is the exact count of matching definitions BEFORE the SQL LIMIT
          // (computed via SELECT COUNT(*) on the same WHERE clauses) for ≤100k
          // workspaces. For >100k match sets, T10 emits the sentinel cap (100000)
          // with `definitions_total_exact: false` — `total` is a floor, not exact.
          definitions_total: total,
          definitions_shown: shown,
          definitions_omitted: omitted,
          definitions_total_exact: total_exact,
          // Legacy `total` kept for back-compat with callers that read the old shape.
          // Equals `definitions_shown` (the page length) — matches the prior contract.
          total: shown,
          projectId,
          query: query ?? null,
          // N1 (WAVE4-N1): the active graph generation id at query time.
          activatedGraphGenerationId,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to search definitions: ${(error as Error).message}`,
      };
    }
  }
}

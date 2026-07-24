/**
 * Get References Tool (get_references)
 *
 * Find all usage sites of a symbol across the project.
 * Returns file, line, usage kind, and code context snippets.
 */

import { IToolHandler, ToolResponse } from "@massa-ai/shared";
import { symbolGraphService } from "../services/symbol/symbol-graph.service.js";
import { ToolError } from "./enum-validation.js";
import { serializeToolResponse } from "./serialize.js";
import { getActiveGeneration, assertGenerationNotStale } from "../services/symbol/active-generation.js";

interface GetReferencesParams {
  projectId: string;
  symbolName: string;
  fqn?: string;
  maxResults?: number;
  /**
   * N1 (WAVE4-N1): optional precondition — the client's last-known
   * `activatedGraphGenerationId`. If it mismatches the current active
   * generation, the tool throws a 412 teaching error. Opt-in: omitted →
   * no precondition.
   */
  ifNoneMatch?: string;
  format?: "json" | "toon" | "tree";
  fields?: string[];
}

export class GetReferencesTool implements IToolHandler {
  name = "get_references";
  description =
    "Find all references (usages) of a symbol in the project. Returns file paths, line numbers, reference kinds (call/import/type_ref/extend/implement), and code context.";

  inputSchema = {
    type: "object",
    properties: {
      projectId: {
        type: "string",
        description: "The project ID to search in",
      },
      symbolName: {
        type: "string",
        description: "Name of the symbol to find references for",
      },
      fqn: {
        type: "string",
        description:
          "Fully-qualified name (e.g. 'services/search/rlm.ts#ContextualSearchRLM') to disambiguate when multiple definitions share the same name",
      },
      maxResults: {
        type: "number",
        description: "Maximum references to return (default: 50)",
        default: 50,
      },
      ifNoneMatch: {
        type: "string",
        description:
          "Optional precondition: the client's last-known `activatedGraphGenerationId`. If it mismatches the current active generation, the tool returns a 412 teaching error.",
      },
      format: {
        type: "string",
        enum: ["json", "toon", "tree"],
        description:
          "Output format. 'json' (default) emits the raw object. 'toon' encodes it. 'tree' (Wave 5 FR-06) emits a text-indented grouped model via the shared groupRowsByPrefix helper (groups references by file). Default: json.",
        default: "json",
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description:
          "Projection — keep only these keys (dotted paths supported). Absent/empty → full data.",
      },
    },
    required: ["projectId", "symbolName"],
  };

  async handle(params: unknown): Promise<ToolResponse> {
    const {
      projectId,
      symbolName,
      fqn,
      maxResults = 50,
      ifNoneMatch,
      format = "json",
      fields,
    } = params as GetReferencesParams;

    // N1 (WAVE4-N1): surface the active graph generation id + opt-in stale
    // precondition. get_references reads the symbol graph, so it participates.
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
      const refs = await symbolGraphService.getReferences(projectId, symbolName, fqn);
      const limited = refs.slice(0, maxResults);

      // Group by file for readability
      const byFile = new Map<string, typeof limited>();
      for (const ref of limited) {
        const arr = byFile.get(ref.fromFile) ?? [];
        arr.push(ref);
        byFile.set(ref.fromFile, arr);
      }

      const data = {
        symbolName,
        fqn: fqn ?? null,
        total: refs.length,
        shown: limited.length,
        // N4 (WAVE4-N4): omitted = total - shown. The repo returns the full
        // match set (no SQL LIMIT on the references path); the tool slices to
        // maxResults. omitted is the count dropped by the client-facing cap.
        omitted: refs.length - limited.length,
        references: limited.map((r) => ({
          fromFile: r.fromFile,
          fromLine: r.fromLine,
          refKind: r.refKind,
          context: r.context,
        })),
        byFile: Object.fromEntries(
          Array.from(byFile.entries()).map(([file, fileRefs]) => [
            file,
            fileRefs.map((r) => ({ line: r.fromLine, kind: r.refKind })),
          ]),
        ),
        projectId,
        // N1 (WAVE4-N1): the active graph generation id at query time.
        activatedGraphGenerationId,
      };
      // Wave 5 FR-07: tree format groups references by file via the shared
      // groupRowsByPrefix helper. json/toon unchanged when tree not selected.
      const groupOpts =
        format === "tree"
          ? { format, fields, groupBy: { file: "fromFile" } }
          : { format, fields };
      return serializeToolResponse(data, groupOpts);
    } catch (error) {
      return {
        success: false,
        error: `Failed to get references: ${(error as Error).message}`,
      };
    }
  }
}

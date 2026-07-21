/**
 * Impact Analysis Tool (impact_analysis)
 *
 * Analyze a git diff and report which symbols are impacted (callers/dependents
 * of the changed code), ranked by a risk score that blends PageRank centrality
 * (blast radius) with graph proximity (closer = riskier).
 *
 * Scope:
 *   - unstaged  → working-tree changes
 *   - staged    → cached/index changes
 *   - committed → diff vs base_branch (default main), or commits since a ref/date
 *
 * The tool runs a SCOPED `git diff --name-only` (never the whole repo), maps the
 * changed files to their symbols, then reverse-traverses the file-import graph
 * + symbol references to find impacted consumers, and ranks them.
 *
 * Use to answer "if I change X, what else breaks / needs re-testing?" without
 * grepping the whole codebase.
 */

import { IToolHandler, ToolResponse } from "@massa-th0th/shared";
import { impactAnalysisService } from "../services/symbol/impact-analysis.js";
import type { ImpactScope } from "../services/symbol/impact-analysis.js";
import { serializeToolResponse } from "./serialize.js";
import { validateEnum, ToolError } from "./enum-validation.js";
import { getActiveGeneration, assertGenerationNotStale } from "../services/symbol/active-generation.js";

interface ImpactAnalysisParams {
  projectId: string;
  /** Absolute path to the project working tree (where git runs). */
  projectPath?: string;
  scope?: ImpactScope;
  base_branch?: string;
  since?: string;
  depth?: number;
  paths?: string[];
  /** Wall-clock budget (ms) bounding the reverse-BFS. Default 5000. */
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

export class ImpactAnalysisTool implements IToolHandler {
  name = "impact_analysis";
  description =
    "Analyze a git diff and report impacted symbols (callers/dependents of changed code) ranked by centrality-weighted risk. " +
    "Scope: unstaged | staged | committed (vs base_branch/since). " +
    "Answers 'what else breaks if I change X?' without grepping the whole repo.";

  inputSchema = {
    type: "object",
    properties: {
      projectId: { type: "string", description: "The project ID to analyze" },
      projectPath: {
        type: "string",
        description: "Absolute path to the project working tree (where `git` runs). Required for the diff.",
      },
      scope: {
        type: "string",
        enum: ["unstaged", "staged", "committed", "all"],
        default: "unstaged",
        description:
          "unstaged = working-tree changes (+ untracked new files); staged = index (+ untracked); committed = diff vs base_branch (or since); all = committed + unstaged + untracked, deduped.",
      },
      base_branch: {
        type: "string",
        default: "main",
        description: "For committed scope: diff against this branch (default main).",
      },
      since: {
        type: "string",
        description: "For committed scope: commits since this ref/date (e.g. '2026-07-01' or a SHA). Wins over base_branch.",
      },
      depth: {
        type: "number",
        description: "How far to propagate impact through the reverse import graph (default 2, hard cap 4).",
        default: 2,
      },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Optional filter — only analyze these changed relative paths.",
      },
      deadline_ms: {
        type: "number",
        default: 5000,
        description:
          "Wall-clock budget (ms) bounding the reverse-import-graph traversal. If exceeded the walk aborts with truncated=true and partial impacted symbols. Default 5000.",
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
          "Projection — keep only these keys (dotted paths supported, e.g. ['impacted.symbol']). Absent/empty → full data.",
      },
      ifNoneMatch: {
        type: "string",
        description:
          "Optional precondition: the client's last-known `activatedGraphGenerationId`. If it mismatches the current active generation, the tool returns a 412 teaching error.",
      },
    },
    required: ["projectId", "projectPath"],
  };

  async handle(params: unknown): Promise<ToolResponse> {
    const p = params as ImpactAnalysisParams;
    const { format = "json", fields } = p;
    if (!p.projectId) {
      return { success: false, error: "projectId is required" };
    }
    if (!p.projectPath) {
      return {
        success: false,
        error:
          "projectPath is required (absolute path to the working tree where `git` runs).",
      };
    }
    const scope: ImpactScope = validateEnum<ImpactScope>(
      "scope",
      p.scope ?? "unstaged",
      ["unstaged", "staged", "committed", "all"] as const,
    );

    // N1 (WAVE4-N1): surface the active graph generation id + opt-in stale
    // precondition. The lookup is cheap (single row from workspaces); the
    // precondition is opt-in (omitted ifNoneMatch → no throw). The 412
    // teaching error is thrown BEFORE the expensive git diff + reverse BFS.
    // Catch the ToolError here so the MCP transport sees a structured
    // {success:false, error, statusCode} response (not an uncaught throw).
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
      const result = await impactAnalysisService.analyze({
        projectId: p.projectId,
        projectPath: p.projectPath,
        scope,
        baseBranch: p.base_branch,
        since: p.since,
        depth: p.depth,
        paths: p.paths,
        deadlineMs: p.deadline_ms,
      });

      if (result.changedFiles.length === 0) {
        return serializeToolResponse(
          {
            projectId: result.projectId,
            scope: result.scope,
            changedFiles: [],
            impacted: [],
            truncated: false,
            untrackedFiltered: result.untrackedFiltered,
            impacted_total: result.impacted_total,
            impacted_shown: result.impacted_shown,
            impacted_omitted: result.impacted_omitted,
            // N1 (WAVE4-N1): the active graph generation id at query time.
            activatedGraphGenerationId,
            note: result.note,
            hint:
              "No indexed source files in the diff. Check scope/base_branch, or index the project first (index_project).",
          },
          { format, fields },
        );
      }

      return serializeToolResponse(
        {
          projectId: result.projectId,
          scope: result.scope,
          baseBranch: result.baseBranch,
          since: result.since,
          depth: result.depth,
          changedFileCount: result.changedFiles.length,
          changedFiles: result.changedFiles,
          impactedCount: result.impacted.length,
          truncated: result.truncated,
          untrackedFiltered: result.untrackedFiltered,
          impacted_total: result.impacted_total,
          impacted_shown: result.impacted_shown,
          impacted_omitted: result.impacted_omitted,
          // N1 (WAVE4-N1): the active graph generation id at query time.
          activatedGraphGenerationId,
          impacted: result.impacted.map((s) => ({
            symbol: s.name,
            fqn: s.fqn,
            file: s.file,
            line: s.line,
            depth: s.depth,
            centrality: s.centrality,
            risk: s.risk,
            reason: s.reason,
            via: s.via,
          })),
        },
        { format, fields },
      );
    } catch (error) {
      return {
        success: false,
        error: `Failed to analyze impact: ${(error as Error).message}`,
      };
    }
  }
}

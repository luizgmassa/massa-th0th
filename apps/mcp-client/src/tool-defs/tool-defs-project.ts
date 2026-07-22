/**
 * Tool Definitions — Project / Index tools
 *
 * Extracted from tool-definitions.ts (Wave 6 N31, T12).
 * Tools: index, index_status, list_projects, project_map, get_architecture,
 *        reset_project, reindex, read_file, rename_project, merge_projects
 */

import type { ToolDefinition } from "../tool-definitions.js";

export const PROJECT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "index",
    description:
      "Index a project directory for contextual code search with semantic embeddings",
    apiEndpoint: "/api/v1/project/index",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "Absolute path to the project directory to index",
        },
        projectId: {
          type: "string",
          description:
            "Unique identifier for the project (defaults to directory name)",
        },
        forceReindex: {
          type: "boolean",
          description: "Force reindex even if project already exists",
          default: false,
        },
        warmCache: {
          type: "boolean",
          description:
            "Pre-cache common queries after indexing for faster initial searches",
          default: false,
        },
        warmupQueries: {
          type: "array",
          items: { type: "string" },
          description:
            "Custom queries to pre-cache (uses defaults if not provided)",
        },
      },
      required: ["projectPath"],
    },
  },
  {
    name: "index_status",
    description:
      "Get durable background-index status. Completed structural jobs include activatedGraphGenerationId and parserDiagnostics with exact aggregate diagnosticsCount, recoveredFiles, hardFailureFiles, staleFiles, and language counts; raw per-file diagnostics are not expanded.",
    apiEndpoint: "/api/v1/project/index/status/:jobId",
    apiMethod: "GET",
    inputSchema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Job ID returned from index",
        },
      },
      required: ["jobId"],
    },
  },
  {
    name: "list_projects",
    description:
      "List all indexed projects with their status (pending/indexing/indexed/error), file counts, symbol counts, and last indexed time.",
    apiEndpoint: "/api/v1/workspace/list",
    apiMethod: "GET",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "indexing", "indexed", "error", "all"],
          description: "Filter by workspace status. Defaults to 'all'.",
          default: "all",
        },
      },
    },
  },
  {
    name: "project_map",
    description:
      "Aggregate view of one active graph generation: identity, exact parser-diagnostic summary, stats, PageRank backbone, symbol counts using the canonical 18-kind schema-v2 taxonomy, extension distribution, and recent files. Raw per-file diagnostics are not expanded. Use this as a one-shot project summary.",
    apiEndpoint: "/api/v1/workspace/:id/map",
    apiMethod: "GET",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The project ID (as registered via index_project).",
        },
        centralityLimit: {
          type: "number",
          description: "Max number of top central files to include. Default 20.",
          default: 20,
        },
        recentLimit: {
          type: "number",
          description: "Max number of recently indexed files to include. Default 10.",
          default: 10,
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_architecture",
    description:
      "Get the architecture map for a project: packages, entry points, routes, hotspots, communities, layers, and opt-in cycles (Tarjan SCC over CALL edges). " +
      "Pass aspects:[\"cycles\"] to surface strongly connected components (file-level call cycles). Unknown aspect values return a teaching error listing valid values.",
    apiEndpoint: "/api/v1/project/:id/architecture",
    apiMethod: "GET",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The project ID (as registered via index_project).",
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
          description: "Output format (json, toon, or tree). Default: json.",
          default: "json",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Projection — keep only these keys (dotted paths supported). Absent/empty → full data.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "reset_project",
    description:
      "Delete all indexed data for a project: vector embeddings, symbol graph (definitions/references/imports/centrality), and stored memories. " +
      "Use before a full reindex or to free space. Each scope (vectors, symbols, memories) can be toggled independently.",
    apiEndpoint: "/api/v1/project/reset",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "The project ID to reset",
        },
        clearVectors: {
          type: "boolean",
          description: "Delete vector embeddings used for semantic search (default: true)",
          default: true,
        },
        clearSymbols: {
          type: "boolean",
          description: "Delete symbol graph: definitions, references, imports, file index, centrality scores (default: true)",
          default: true,
        },
        clearMemories: {
          type: "boolean",
          description: "Delete stored memories for this project (default: true)",
          default: true,
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "read_file",
    description: "Read a specific file (or line range) with symbol metadata and imports. Use instead of Read/grep when you have filePath+lineStart+lineEnd from a search result.",
    apiEndpoint: "/api/v1/file/read",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "File path (absolute or relative to project root)" },
        projectId: { type: "string", description: "Project ID for symbol metadata" },
        offset: { type: "number", description: "1-indexed start line (alternative to lineStart)" },
        limit: { type: "number", description: "Number of lines to return (alternative to lineEnd)" },
        lineStart: { type: "number", description: "First line to read (1-indexed)" },
        lineEnd: { type: "number", description: "Last line to read (1-indexed)" },
        compress: { type: "boolean", description: "Auto-compress content > 100 lines (default: true)", default: true },
        targetRatio: { type: "number", description: "Compression target ratio (0.3 = 70% reduction)", default: 0.3 },
        format: { type: "string", enum: ["json", "toon"], description: "Output format", default: "json" },
        fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Projection — keep only these keys (dotted paths supported, e.g. ['nodes.symbol']). Absent/empty → full data.",
        },
        includeSymbols: { type: "boolean", description: "Include symbol definitions/references (default: true)", default: true },
        includeImports: { type: "boolean", description: "Extract file imports (default: true)", default: true },
      },
      required: ["filePath"],
    },
  },
  {
    name: "reindex",
    description: "Force full reindex of a project workspace. Use when autoReindex (configurable via search.autoReindexMaxFiles, default 200) is insufficient after a large refactor. Requires the project's absolute path.",
    apiEndpoint: "/api/v1/workspace/:id/reindex",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project ID" },
        projectPath: { type: "string", description: "Absolute path to project directory" },
      },
      required: ["id", "projectPath"],
    },
  },
  {
    name: "rename_project",
    description:
      "Rename a project identity transactionally. Default dryRun=true previews " +
      "canonical roots, per-store counts, conflicts, and a planHash. To apply, " +
      "call again with dryRun=false, a caller-chosen operationId (idempotency " +
      "key), and the preview's planHash as expectedPlanHash. The retired source " +
      "ID remains a working alias.",
    apiEndpoint: "/api/v1/project/rename",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        sourceProjectId: {
          type: "string",
          description: "Current project ID to rename from",
        },
        targetProjectId: {
          type: "string",
          description: "New project ID (must be unused and never retired)",
        },
        dryRun: {
          type: "boolean",
          description:
            "Preview only (default true). Set false with operationId + expectedPlanHash to apply.",
        },
        operationId: {
          type: "string",
          description: "Idempotency key, required when dryRun=false",
        },
        expectedPlanHash: {
          type: "string",
          description: "planHash from the dryRun preview, required when dryRun=false",
        },
      },
      required: ["sourceProjectId", "targetProjectId"],
    },
  },
  {
    name: "merge_projects",
    description:
      "Merge one project identity into another transactionally (same canonical " +
      "root required). Default dryRun=true previews counts, conflicts, and a " +
      "planHash. To apply, call again with dryRun=false, a caller-chosen " +
      "operationId, and the preview's planHash as expectedPlanHash. The retired " +
      "source ID remains a working alias.",
    apiEndpoint: "/api/v1/project/merge",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        sourceProjectId: {
          type: "string",
          description: "Project ID to merge from (retired afterwards)",
        },
        targetProjectId: {
          type: "string",
          description: "Live project ID to merge into",
        },
        dryRun: {
          type: "boolean",
          description:
            "Preview only (default true). Set false with operationId + expectedPlanHash to apply.",
        },
        operationId: {
          type: "string",
          description: "Idempotency key, required when dryRun=false",
        },
        expectedPlanHash: {
          type: "string",
          description: "planHash from the dryRun preview, required when dryRun=false",
        },
      },
      required: ["sourceProjectId", "targetProjectId"],
    },
  },
];
/**
 * Tool Definitions — Search / Symbol-graph tools
 *
 * Extracted from tool-definitions.ts (Wave 6 N31, T11).
 * Tools: search, search_definitions, get_references, go_to_definition,
 *        trace_path, impact_analysis, symbol_snippet
 */

import {
  STRUCTURAL_FQN_DESCRIPTION,
  STRUCTURAL_SYMBOL_KIND_SCHEMA,
} from "@massa-ai/shared";
import type { ToolDefinition } from "../tool-definitions.js";

export const SEARCH_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search",
    description:
      "Search for code in an indexed project using semantic and keyword search",
    apiEndpoint: "/api/v1/search/project",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (natural language or keywords)",
        },
        projectId: { type: "string", description: "Project ID to search in" },
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
            "Response format: 'summary' (preview only, saves 70% tokens), 'full' (includes content), or 'enriched' (full + fileImports + parentSymbol in one call)",
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
        sessionId: {
          type: "string",
          description: "Synapse session ID from synapse_session. Activates cognitive modulation: task alignment, agent affinity, working-memory boost.",
        },
        format: {
          type: "string",
          enum: ["json", "toon", "tree"],
          description:
            "Output format. 'json' (default) emits the raw object. 'toon' encodes it. 'tree' (Wave 5 FR-06) emits a text-indented grouped model via the shared groupRowsByPrefix helper. Default: json.",
          default: "json",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Projection — keep only these keys (dotted paths supported, e.g. ['nodes.symbol']). Absent/empty → full data.",
        },
      },
      required: ["query", "projectId"],
    },
  },
  {
    name: "search_definitions",
    description:
      "Search for symbol definitions (functions, classes, variables, types, interfaces) in an indexed project. Returns name, kind, file location, line numbers, and doc comments.",
    apiEndpoint: "/api/v1/symbol/definitions",
    apiMethod: "GET",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "The project ID to search in",
        },
        search: {
          type: "string",
          description: "Substring search on symbol name (case-insensitive)",
        },
        kind: {
          anyOf: [
            STRUCTURAL_SYMBOL_KIND_SCHEMA,
            {
              type: "array",
              items: STRUCTURAL_SYMBOL_KIND_SCHEMA,
            },
          ],
          description:
            "One canonical graph schema v2 symbol kind, or an array of kinds. Arrays are serialized as comma-separated query values.",
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
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          default: 20,
        },
        ifNoneMatch: {
          type: "string",
          description:
            "Optional precondition: the client's last-known `activatedGraphGenerationId`. If it mismatches the current active generation, the tool returns a 412 teaching error.",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_references",
    description:
      `Find all references to a symbol across the active graph generation. ${STRUCTURAL_FQN_DESCRIPTION}`,
    apiEndpoint: "/api/v1/symbol/references",
    apiMethod: "GET",
    inputSchema: {
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
          description: STRUCTURAL_FQN_DESCRIPTION,
        },
        limit: {
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
    },
  },
  {
    name: "go_to_definition",
    description:
      `Find a definition in the active graph generation. ${STRUCTURAL_FQN_DESCRIPTION}`,
    apiEndpoint: "/api/v1/symbol/definition",
    apiMethod: "GET",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "The project ID to search in",
        },
        symbolName: {
          type: "string",
          description: `Bare symbol name or structural FQN. ${STRUCTURAL_FQN_DESCRIPTION}`,
        },
        fromFile: {
          type: "string",
          description:
            "Relative path of the file where the symbol is used. Helps prioritize the correct definition when multiple exist.",
        },
      },
      required: ["projectId", "symbolName"],
    },
  },
  {
    name: "trace_path",
    description:
      "Trace paths through the code graph from a seed symbol, following typed edges (CALLS/DATA_FLOWS/HTTP_CALLS/EMITS/LISTENS). " +
      "Modes: calls (callers/callees), data_flow (value propagation), cross_service (HTTP/async hops), all. " +
      "Direction: outbound (what it reaches) | inbound (what reaches it) | both. " +
      `Use INSTEAD OF grep for callers, dependencies, impact analysis, or data flow tracing. ${STRUCTURAL_FQN_DESCRIPTION}`,
    apiEndpoint: "/api/v1/symbol/trace",
    apiMethod: "GET",
    inputSchema: {
      type: "object",
      properties: {
        function_name: {
          type: "string",
          description: "Seed symbol name (bare name resolved against definitions). Aliases: symbol, qualifiedName.",
        },
        symbol: { type: "string", description: "Alias for function_name." },
        qualifiedName: {
          type: "string",
          description: STRUCTURAL_FQN_DESCRIPTION,
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
          enum: ["json", "toon", "tree"],
          description:
            "Output format. 'json' (default) emits the raw object. 'toon' encodes it. 'tree' (Wave 5 FR-06) emits a text-indented grouped model via the shared groupRowsByPrefix helper (groups nodes by file). Default: json.",
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
      required: ["projectId"],
      anyOf: [
        { required: ["function_name"] },
        { required: ["symbol"] },
        { required: ["qualifiedName"] },
      ],
    },
  },
  {
    name: "impact_analysis",
    description:
      "Analyze a git diff and report impacted symbols (callers/dependents of changed code) ranked by centrality-weighted risk. " +
      "Scope: unstaged | staged | committed (vs base_branch/since). " +
      "Answers 'what else breaks if I change X?' without grepping the whole repo.",
    apiEndpoint: "/api/v1/symbol/impact",
    apiMethod: "POST",
    inputSchema: {
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
          description: "unstaged = working-tree changes (+ untracked new files); staged = index (+ untracked); committed = diff vs base_branch (or since); all = committed + unstaged + untracked, deduped.",
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
          enum: ["json", "toon", "tree"],
          description:
            "Output format. 'json' (default) emits the raw object. 'toon' encodes it. 'tree' (Wave 5 FR-06) emits a text-indented grouped model via the shared groupRowsByPrefix helper (groups impacted symbols by file prefix). Default: json.",
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
    },
  },
  {
    name: "symbol_snippet",
    description: "Get raw code snippet by file + line range from an indexed project.",
    apiEndpoint: "/api/v1/symbol/snippet",
    apiMethod: "GET",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        file: { type: "string", description: "Relative file path" },
        lineStart: { type: "number" },
        lineEnd: { type: "number" },
      },
      required: ["projectId", "file"],
    },
  },
];
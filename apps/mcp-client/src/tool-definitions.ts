/**
 * Tool Definitions for MCP Client
 *
 * Define as ferramentas expostas ao MCP host (OpenCode/Claude)
 * e o mapeamento para endpoints da Tools API.
 */

import {
  STRUCTURAL_FQN_DESCRIPTION,
  STRUCTURAL_SYMBOL_KIND_SCHEMA,
} from "@massa-th0th/shared";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  apiEndpoint: string;
  apiMethod: "GET" | "POST";
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
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
      },
      required: ["query", "projectId"],
    },
  },
  {
    name: "remember",
    description:
      "Store memory in the PostgreSQL-backed hierarchical memory system",
    apiEndpoint: "/api/v1/memory/store",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Content to store" },
        type: {
          type: "string",
          enum: ["critical", "conversation", "code", "decision", "pattern"],
          description: "Type of memory",
        },
        userId: { type: "string", description: "User ID" },
        projectId: { type: "string", description: "Project ID" },
        sessionId: { type: "string", description: "Session ID" },
        agentId: {
          type: "string",
          description:
            "Agent ID (e.g., orchestrator, implementer, architect, optimizer)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization",
        },
        importance: {
          type: "number",
          description: "Importance score (0-1)",
          default: 0.5,
        },
        format: {
          type: "string",
          enum: ["json", "toon"],
          description: "Output format (json or toon)",
          default: "toon",
        },
      },
      required: ["content", "type"],
    },
  },
  {
    name: "recall",
    description:
      "Search stored memories across sessions using semantic search (recovers context from previous conversations)",
    apiEndpoint: "/api/v1/memory/search",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (what to remember)",
        },
        userId: { type: "string", description: "Filter by user ID" },
        projectId: { type: "string", description: "Filter by project ID" },
        sessionId: { type: "string", description: "Filter by session ID" },
        agentId: {
          type: "string",
          description:
            "Filter by agent ID (orchestrator, implementer, architect, optimizer)",
        },
        types: {
          type: "array",
          items: {
            type: "string",
            enum: ["critical", "conversation", "code", "decision", "pattern"],
          },
          description: "Filter by memory types",
        },
        limit: {
          type: "number",
          description: "Maximum results to return",
          default: 10,
        },
        minImportance: {
          type: "number",
          description: "Minimum importance (0-1)",
          default: 0.3,
        },
        includePersistent: {
          type: "boolean",
          description: "Include persistent memories from other sessions",
          default: true,
        },
        format: {
          type: "string",
          enum: ["json", "toon"],
          description: "Output format (json or toon)",
          default: "toon",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_update",
    description:
      "Update an existing memory by id (content, importance, or tags). Content changes are re-embedded.",
    apiEndpoint: "/api/v1/memory/update",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID of the memory to update" },
        content: {
          type: "string",
          description: "New content (re-embedded when set)",
        },
        importance: {
          type: "number",
          description: "New importance score (0-1)",
          minimum: 0,
          maximum: 1,
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags (replace existing unless mergeTags is true)",
        },
        mergeTags: {
          type: "boolean",
          description: "Union tags with existing instead of replacing",
          default: false,
        },
        format: {
          type: "string",
          enum: ["json", "toon"],
          description: "Output format (json or toon)",
          default: "toon",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_delete",
    description:
      "Delete a memory by id (hard delete). Also removes its graph edges.",
    apiEndpoint: "/api/v1/memory/delete",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID of the memory to delete" },
        format: {
          type: "string",
          enum: ["json", "toon"],
          description: "Output format (json or toon)",
          default: "toon",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "list_checkpoints",
    description:
      "List saved task checkpoints (versioned TASK state). Filter by task ID, project, or type. These are task-progress snapshots, not session-continuity snapshots (see compact_snapshot).",
    apiEndpoint: "/api/v1/checkpoints/list",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Filter by task ID" },
        projectId: { type: "string", description: "Filter by project ID" },
        checkpointType: {
          type: "string",
          enum: ["auto", "manual", "milestone"],
          description: "Filter by checkpoint type",
        },
        includeExpired: {
          type: "boolean",
          description: "Include expired checkpoints",
          default: false,
        },
        limit: { type: "number", description: "Max results to return", default: 10 },
        format: {
          type: "string",
          enum: ["json", "toon"],
          description: "Output format (json or toon)",
          default: "toon",
        },
      },
      required: [],
    },
  },
  {
    name: "create_checkpoint",
    description:
      "Create a checkpoint to save current task progress — versioned TASK state (progress, decisions, files) for resumption or rollback. Distinct from compact_snapshot (SESSION continuity across /compact).",
    apiEndpoint: "/api/v1/checkpoints/create",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Unique identifier for the task" },
        description: {
          type: "string",
          description: "Human-readable description of the task",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "failed", "paused"],
          description: "Current task status",
          default: "in_progress",
        },
        currentStep: { type: "string", description: "Current step name" },
        progressPercent: {
          type: "number",
          description: "Overall progress percentage (0-100)",
          default: 0,
        },
        totalSteps: { type: "number", description: "Total steps", default: 0 },
        completedSteps: { type: "number", description: "Completed steps", default: 0 },
        checkpointType: {
          type: "string",
          enum: ["manual", "milestone"],
          description: "Checkpoint type (milestone has longer TTL)",
          default: "manual",
        },
        agentId: { type: "string", description: "Agent creating the checkpoint" },
        projectId: { type: "string", description: "Project ID" },
        memoryIds: {
          type: "array",
          items: { type: "string" },
          description: "Memory IDs related to this task",
        },
        fileChanges: {
          type: "array",
          items: { type: "string" },
          description: "File paths modified during this task",
        },
        decisions: {
          type: "array",
          items: { type: "string" },
          description: "Memory IDs of decisions made",
        },
        learnings: {
          type: "array",
          items: { type: "string" },
          description: "Key learnings or insights",
        },
        nextAction: {
          type: "string",
          description: "Next action to take when restoring",
        },
        pendingValidations: {
          type: "array",
          items: { type: "string" },
          description: "Validations still pending",
        },
        format: {
          type: "string",
          enum: ["json", "toon"],
          description: "Output format (json or toon)",
          default: "toon",
        },
      },
      required: ["taskId", "description"],
    },
  },
  {
    name: "restore_checkpoint",
    description:
      "Restore a saved task checkpoint — returns TASK state (progress, decisions, agent state) plus memory/file integrity checks. Distinct from compact_snapshot (SESSION continuity, not task state).",
    apiEndpoint: "/api/v1/checkpoints/restore",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        checkpointId: {
          type: "string",
          description: "Checkpoint ID to restore (omit to use taskId)",
        },
        taskId: {
          type: "string",
          description: "Restore the latest checkpoint for this task",
        },
        format: {
          type: "string",
          enum: ["json", "toon"],
          description: "Output format (json or toon)",
          default: "toon",
        },
      },
      required: [],
    },
  },
  {
    name: "compress",
    description:
      "Compress context using semantic compression (keeps structure, removes details)",
    apiEndpoint: "/api/v1/context/compress",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Content to compress" },
        strategy: {
          type: "string",
          enum: [
            "code_structure",
            "conversation_summary",
            "semantic_dedup",
            "hierarchical",
          ],
          description: "Compression strategy",
          default: "code_structure",
        },
        targetRatio: {
          type: "number",
          description:
            "Target compression ratio (0-1, e.g., 0.7 = 70% reduction)",
          default: 0.7,
        },
        language: {
          type: "string",
          description: "Programming language (for code compression)",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "optimized_context",
    description:
      "Retrieve and compress context with maximum token efficiency (search + compress)",
    apiEndpoint: "/api/v1/context/optimized",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to find relevant context",
        },
        projectId: {
          type: "string",
          description: "Project ID for code context",
        },
        projectPath: {
          type: "string",
          description: "Project path (for auto-reindex)",
        },
        maxTokens: {
          type: "number",
          description: "Maximum tokens in returned context",
          default: 4000,
        },
        maxResults: {
          type: "number",
          description: "Maximum search results to include",
          default: 5,
        },
        format: {
          type: "string",
          enum: ["json", "toon"],
          description: "Output format (json or toon). Default: json.",
          default: "json",
        },
      },
      required: ["query", "projectId"],
    },
  },
  {
    name: "analytics",
    description:
      "Get search analytics and performance metrics (usage patterns, cache performance, etc)",
    apiEndpoint: "/api/v1/analytics",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["summary", "project", "query", "cache", "recent"],
          description:
            "Type of analytics: 'summary' (overall), 'project' (specific project), 'query' (specific query), 'cache' (cache performance), 'recent' (recent searches)",
        },
        projectId: {
          type: "string",
          description:
            "Project ID. Required for type='project'. Optional for type='cache' (omit for global cache stats across all projects; provide to scope to one project). Optional for type='query'/'recent'.",
        },
        query: {
          type: "string",
          description: "Search query (required for type='query')",
        },
        limit: {
          type: "number",
          description:
            "Limit for results (default: 10 for most, 50 for recent)",
          default: 10,
        },
      },
        required: ["type"],
    },
  },

  // ── Symbol Graph tools ──────────────────────────────────────────────────

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
        format: {
          type: "string",
          enum: ["json", "toon"],
          description: "Output format (json or toon). Default: json.",
          default: "json",
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
          enum: ["unstaged", "staged", "committed"],
          default: "unstaged",
          description: "unstaged = working-tree changes; staged = index; committed = diff vs base_branch (or since).",
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
        format: {
          type: "string",
          enum: ["json", "toon"],
          description: "Output format (json or toon). Default: json.",
          default: "json",
        },
      },
      required: ["projectId", "projectPath"],
    },
  },

  // ── Project reset ───────────────────────────────────────────────────────

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
        includeSymbols: { type: "boolean", description: "Include symbol definitions/references (default: true)", default: true },
        includeImports: { type: "boolean", description: "Extract file imports (default: true)", default: true },
      },
      required: ["filePath"],
    },
  },
  {
    name: "synapse_session",
    description: "Create/resume a Synapse cognitive session. Returns sessionId to pass as sessionId on every search. Activates task alignment, agent affinity, working-memory buffer. Name by intent: 'debug-auth', 'feature-payment'.",
    apiEndpoint: "/api/v1/synapse/session",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Reuse existing session ID (omit to auto-generate)" },
        agentId: { type: "string", description: "Stable agent identifier", default: "claude-code" },
        workspaceId: { type: "string", description: "Project ID this session is scoped to" },
        taskContext: { type: "string", description: "One-sentence description of the current task" },
        ttlMs: { type: "number", description: "Session TTL in ms (default: 1h)", default: 3600000 },
      },
      required: [],
    },
  },
  {
    name: "synapse_prime",
    description: "Seed the Synapse working-memory buffer with recalled memories before searching. Call at session start with recall results.",
    apiEndpoint: "/api/v1/synapse/session/:id/prime",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID from synapse_session" },
        entries: { type: "array", description: "Search results to seed into the buffer", items: { type: "object" } },
      },
      required: ["id", "entries"],
    },
  },
  {
    name: "synapse_access",
    description: "Record file access for affinity scoring — boosts that file in future searches. Call after reading or editing a file.",
    apiEndpoint: "/api/v1/synapse/session/:id/access",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID" },
        memoryId: { type: "string", description: "Chunk ID that was accessed" },
      },
      required: ["id", "memoryId"],
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
  {
    name: "memory_list",
    description: "Browse stored memories by type/importance without a semantic query (audit mode). Use recall for semantic search.",
    apiEndpoint: "/api/v1/memory/list",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        type: { type: "string", description: "critical | decision | pattern | code | conversation" },
        minImportance: { type: "number", default: 0 },
        limit: { type: "number", default: 50 },
        offset: { type: "number", default: 0 },
      },
      required: [],
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
    name: "hook_ingest",
    description:
      "Passively ingest a batch of lifecycle events (session-start, user-prompt, pre/post-tool-use, pre-compact, session-end) as Observations. Fire-and-forget; consolidated into memories later by the LLM bridge. Useful for non-Claude hosts.",
    apiEndpoint: "/api/v1/hook/batch",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          description: "Lifecycle events to ingest (validated atomically)",
          items: {
            type: "object",
            properties: {
              event: {
                type: "string",
                enum: [
                  "session-start",
                  "user-prompt",
                  "pre-tool-use",
                  "post-tool-use",
                  "pre-compact",
                  "session-end",
                ],
              },
              projectId: { type: "string" },
              sessionId: { type: "string" },
              payload: { type: "object", description: "Event-specific payload" },
              importance: { type: "number", minimum: 0, maximum: 1 },
              agentId: { type: "string" },
              ts: { type: "number", description: "Epoch ms (defaults to now)" },
            },
            required: ["event", "projectId", "payload"],
          },
        },
      },
      required: ["events"],
    },
  },
  {
    name: "compact_snapshot",
    description:
      "Build a reference-based compaction snapshot — bounded <~2KB table-of-contents with runnable recall/search calls for the current session's observations (SESSION continuity, not task state). Zero information loss — raw events stay in PostgreSQL; the snapshot points to them. Distinct from checkpoints (which version task progress). Optionally persists the snapshot as an observation of category 'compaction-snapshots'. Use on /compact or PreCompact for session continuity.",
    apiEndpoint: "/api/v1/hook/compact-snapshot",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID to build the snapshot for",
        },
        projectId: {
          type: "string",
          description: "Project ID (defaults to 'default')",
        },
        persist: {
          type: "boolean",
          default: false,
          description:
            "If true, persist the snapshot as an observation of category 'compaction-snapshots'",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "bootstrap",
    description:
      "Scan a project (git log, README, docs, package manifests, top central files from PageRank) and create LLM-summarized seed memories so an agent begins with usable context. Idempotent — skips if already bootstrapped unless force=true. LLM-off degrades silently to rule-based seeds. Never throws.",
    apiEndpoint: "/api/v1/bootstrap",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project identifier" },
        projectPath: {
          type: "string",
          description: "Project root path (defaults to server cwd)",
        },
        force: {
          type: "boolean",
          default: false,
          description: "Refresh even if already bootstrapped",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "handoff_begin",
    description:
      "Begin a cross-session handoff: leave a structured record (summary, open questions, next steps, files) for a later agent to discover on session start. The handoff is persisted in the Handoff table AND dual-written as a searchable memory (FTS-discoverable). Optional LLM summary-polish (default-off). Never throws.",
    apiEndpoint: "/api/v1/handoff/begin",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project identifier (required)" },
        sourceSessionId: { type: "string", description: "Session leaving the handoff" },
        targetAgent: { type: "string", description: "Target agent name (omit = broadcast)" },
        summary: { type: "string", description: "Handoff summary (max 1024 chars; empty = auto-polish when LLM on)" },
        openQuestions: { type: "array", items: { type: "string" } },
        nextSteps: { type: "array", items: { type: "string" } },
        files: { type: "array", items: { type: "string" } },
      },
      required: ["projectId"],
    },
  },
  {
    name: "handoff_accept",
    description:
      "Accept an open handoff by id. Flips status open→accepted, sets accepted_at, emits handoff:accepted. Missing/expired/already-accepted/project-mismatch ids return a clear {ok:false, reason}. Never throws.",
    apiEndpoint: "/api/v1/handoff/accept",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Handoff id (required)" },
        projectId: { type: "string", description: "Optional project scope check" },
      },
      required: ["id"],
    },
  },
  {
    name: "handoff_cancel",
    description:
      "Cancel (expire) an open handoff by id. Flips status open→expired (no event). Same failure semantics as accept on missing/non-open/project-mismatch. Never throws.",
    apiEndpoint: "/api/v1/handoff/cancel",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Handoff id (required)" },
        projectId: { type: "string", description: "Optional project scope check" },
      },
      required: ["id"],
    },
  },
  {
    name: "handoff_list_pending",
    description:
      "List open handoffs for a project (optionally filtered by target agent), ordered oldest-first. The recall-path surfacing primitive for auto-inject on session start. Never throws.",
    apiEndpoint: "/api/v1/handoff/list",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project identifier (required)" },
        targetAgent: { type: "string", description: "Optional target agent filter" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "list_proposals",
    description:
      "List pending auto-improvement proposals for a project (newest-first). The review-gate surfacing primitive: proposals are generated by the auto-improve loop from recurring patterns (repeated queries, hot files, common fixes). Never throws.",
    apiEndpoint: "/api/v1/proposal/list",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project identifier (required)" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "approve_proposal",
    description:
      "Approve a pending auto-improvement proposal by id. Applies the proposed memory edit, flips status pending→approved, and emits memory:auto-improved. Missing/non-pending/project-mismatch/apply-failed ids return a clear {ok:false, reason}. Never throws.",
    apiEndpoint: "/api/v1/proposal/approve",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Proposal id (required)" },
        projectId: { type: "string", description: "Optional project scope check" },
        source: {
          type: "string",
          enum: ["llm", "rule-based"],
          description: "Origin of the proposal (audit; default rule-based)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "reject_proposal",
    description:
      "Reject a pending auto-improvement proposal by id. Flips status pending→rejected (no memory edit applied, no event emitted). Same failure semantics as approve on missing/non-pending/project-mismatch. Never throws.",
    apiEndpoint: "/api/v1/proposal/reject",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Proposal id (required)" },
        projectId: { type: "string", description: "Optional project scope check" },
        reason: { type: "string", description: "Optional rejection reason (audit)" },
      },
      required: ["id"],
    },
  },
  {
    name: "execute",
    description:
      "Run code in a detected polyglot sandbox runtime (js/ts/python/shell/ruby/go/rust/php/perl/r). " +
      "Returns stdout/stderr. Local-dev trust model: code runs on the host as the current user — " +
      "no OS-level isolation. Timeout default 30s, cap 300s. Pass `intent` to trim large outputs.",
    apiEndpoint: "/api/v1/executor/execute",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          enum: ["javascript", "typescript", "python", "shell", "ruby", "go", "rust", "php", "perl", "r"],
          description: "Language/runtime to execute the code in.",
        },
        code: { type: "string", description: "Source code to execute." },
        timeout: { type: "number", description: "Max runtime in ms (default 30000, cap 300000)." },
        background: { type: "boolean", description: "Detach instead of killing on timeout (default false).", default: false },
        cwd: { type: "string", description: "Working directory (defaults to project root)." },
        intent: {
          type: "string",
          description: "Optional query. When output > ~5KB, only sections matching this intent are returned.",
        },
      },
      required: ["language", "code"],
    },
  },
  {
    name: "execute_file",
    description:
      "Read a file into a sandboxed FILE_CONTENT variable and run code over it. Only what your code " +
      "prints enters the conversation. Enforces project-root containment + a secrets deny-glob by default.",
    apiEndpoint: "/api/v1/executor/execute_file",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative (or absolute, under root) file path." },
        language: {
          type: "string",
          enum: ["javascript", "typescript", "python", "shell", "ruby", "go", "rust", "php", "perl", "r"],
          description: "Language/runtime to execute the code in.",
        },
        code: {
          type: "string",
          description: "Code to run over the file. FILE_CONTENT (text) and file_path (absolute) are in scope.",
        },
        timeout: { type: "number", description: "Max runtime in ms (default 30000, cap 300000)." },
        intent: { type: "string", description: "Optional intent query to trim large outputs." },
      },
      required: ["path", "language", "code"],
    },
  },
  {
    name: "batch_execute",
    description:
      "Run N shell commands in parallel via run-pool (order-preserving, concurrency-capped). " +
      "Returns per-command stdout/stderr/exitCode in input order. Default concurrency = cpu count; " +
      "failures do not abort siblings.",
    apiEndpoint: "/api/v1/executor/batch_execute",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        commands: {
          type: "array",
          items: { type: "string" },
          description: "Shell commands to run (order is preserved in results).",
        },
        queries: {
          type: "array",
          items: { type: "string" },
          description: "Optional queries to scope auto-indexing of outputs (reserved; currently a no-op stub).",
        },
        timeout: { type: "number", description: "Per-command timeout in ms (default 30000)." },
        concurrency: { type: "number", description: "Max in-flight commands (default = host cpu count)." },
        cwd: { type: "string", description: "Working directory (defaults to project root)." },
        query_scope: { type: "string", description: "Optional scope label for the batch (diagnostics only)." },
      },
      required: ["commands"],
    },
  },
  {
    name: "fetch_and_index",
    description:
      "Fetch URL(s), convert HTML to markdown (JSON → key-path chunks), and " +
      "index them for search. SSRF-guarded: loopback/private/link-local/IMDS " +
      "IPs are blocked, including redirect-to-internal and DNS-rebind. Parallel " +
      "fetch (run-pool, cpu-capped), serial per-URL indexing. TTL-cached (~24h).",
    apiEndpoint: "/api/v1/web/fetch_and_index",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Single URL to fetch and index (single-shape).",
        },
        source: {
          type: "string",
          description: "Label for the indexed content when using single `url`.",
        },
        requests: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to fetch." },
              source: {
                type: "string",
                description: "Label for this URL's indexed content.",
              },
            },
            required: ["url"],
          },
          description:
            "Batch shape: array of {url, source?}. Use with concurrency>1 for " +
            "parallel fetch. Output preserves input order.",
        },
        concurrency: {
          type: "number",
          description:
            "Max URLs fetched in parallel (1-8, default 1). Capped by cpu count.",
        },
        force: {
          type: "boolean",
          description: "Skip cache and re-fetch even if recently indexed.",
        },
        ttl: {
          type: "number",
          description:
            "Override cache freshness window in ms (0 bypasses cache like force).",
        },
      },
    },
  },
];

/**
 * Get tool definition by name
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}

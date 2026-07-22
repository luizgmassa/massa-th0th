/**
 * Tool Definitions — Memory / Checkpoint tools
 *
 * Extracted from tool-definitions.ts (Wave 6 N31, T11).
 * Tools: remember, recall, memory_update, memory_delete, list_checkpoints,
 *        create_checkpoint, restore_checkpoint, compress, optimized_context,
 *        analytics, memory_list
 */

import type { ToolDefinition } from "../tool-definitions.js";

export const MEMORY_TOOL_DEFINITIONS: ToolDefinition[] = [
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
        fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Projection — keep only these keys (dotted paths supported, e.g. ['nodes.symbol']). Absent/empty → full data.",
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
        fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Projection — keep only these keys (dotted paths supported, e.g. ['nodes.symbol']). Absent/empty → full data.",
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
        fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Projection — keep only these keys (dotted paths supported, e.g. ['nodes.symbol']). Absent/empty → full data.",
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
        fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Projection — keep only these keys (dotted paths supported, e.g. ['nodes.symbol']). Absent/empty → full data.",
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
        fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Projection — keep only these keys (dotted paths supported, e.g. ['nodes.symbol']). Absent/empty → full data.",
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
        fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Projection — keep only these keys (dotted paths supported, e.g. ['nodes.symbol']). Absent/empty → full data.",
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
        fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Projection — keep only these keys (dotted paths supported, e.g. ['nodes.symbol']). Absent/empty → full data.",
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
];
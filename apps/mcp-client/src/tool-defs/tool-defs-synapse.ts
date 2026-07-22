/**
 * Tool Definitions — Synapse tools
 *
 * Extracted from tool-definitions.ts (Wave 6 N31, T12).
 * Tools: synapse_session, synapse_get, synapse_update, synapse_end,
 *        synapse_prime, synapse_access, synapse_prefetch, synapse_list,
 *        synapse_task_begin, synapse_task_end
 */

import type { ToolDefinition } from "../tool-definitions.js";

export const SYNAPSE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "synapse_session",
    description: "Create a Synapse cognitive session. Returns sessionId to pass as sessionId on every search. Activates task alignment, agent affinity, and optional working memory.",
    apiEndpoint: "/api/v1/synapse/session",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Override the generated session ID" },
        agentId: { type: "string", description: "Stable identifier of the calling agent" },
        workspaceId: { type: "string", description: "Project ID this session is scoped to" },
        taskContext: { type: "string", description: "One-sentence description of the current task" },
        ttlMs: { type: "number", description: "Session TTL in ms (default: 1h)", default: 3600000 },
        enableBuffer: { type: "boolean", description: "Enable working-memory buffer", default: true },
        bufferMaxSize: { type: "number", description: "Maximum working-memory entries" },
        bufferTtlMs: { type: "number", description: "Working-memory entry TTL in ms" },
        accessHistoryMaxEntries: { type: "number", description: "Maximum access-history entries" },
      },
      required: ["agentId"],
    },
  },
  {
    name: "synapse_get",
    description: "Inspect a Synapse session, including expiry, access history, and buffer state.",
    apiEndpoint: "/api/v1/synapse/session/:id",
    apiMethod: "GET",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Session ID" } },
      required: ["id"],
    },
  },
  {
    name: "synapse_update",
    description: "Replace a Synapse session task context and refresh its activity window.",
    apiEndpoint: "/api/v1/synapse/session/:id",
    apiMethod: "PATCH",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID" },
        taskContext: { type: "string", description: "Replacement task context" },
        taskEmbedding: { type: "array", items: { type: "number" }, description: "Precomputed task-context embedding" },
      },
      required: ["id", "taskContext"],
    },
  },
  {
    name: "synapse_end",
    description: "End and remove a Synapse session.",
    apiEndpoint: "/api/v1/synapse/session/:id",
    apiMethod: "DELETE",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Session ID" } },
      required: ["id"],
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
    name: "synapse_prefetch",
    description: "Build a prefetch query for an opened file and optionally prime matching entries into the session buffer.",
    apiEndpoint: "/api/v1/synapse/session/:id/prefetch",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID" },
        filePath: { type: "string", description: "Path of the file just opened" },
        symbols: { type: "array", items: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
        chains: { type: "array", items: { type: "string" } },
        maxResults: { type: "number" },
        minImportance: { type: "number" },
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" }, content: { type: "string" }, score: { type: "number" }, metadata: { type: "object" },
            },
            required: ["id", "content"],
          },
        },
      },
      required: ["id", "filePath"],
    },
  },
  {
    name: "synapse_list",
    description: "List the number of active Synapse sessions after evicting expired sessions.",
    apiEndpoint: "/api/v1/synapse/sessions",
    apiMethod: "GET",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "synapse_task_begin",
    description:
      "Begin a task envelope: create session → prime (if entries) → first search → prefetch first hit → record access. " +
      "Returns { sessionId, search, primed, partial, errors }. Session is always returned; partial=true + errors[] when a sub-step fails; search may be null when search failed. " +
      "Use synapse_task_end to clean up.",
    apiEndpoint: "/api/v1/synapse/task/begin",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Stable identifier of the calling agent" },
        taskContext: { type: "string", description: "One-sentence description of the current task" },
        workspaceId: { type: "string", description: "Project ID this session is scoped to" },
        query: { type: "string", description: "First search query" },
        projectId: { type: "string", description: "Project ID for the search" },
        entries: {
          type: "array",
          description: "Optional entries to prime the buffer with (from recall)",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              content: { type: "string" },
              score: { type: "number" },
              metadata: { type: "object" },
            },
            required: ["id", "content"],
          },
        },
        limit: { type: "number", description: "Max results for the first search (default 10)" },
      },
      required: ["agentId", "query", "projectId"],
    },
  },
  {
    name: "synapse_task_end",
    description:
      "End a Synapse task: compute summary (accessCount, topFiles) and DELETE the session. " +
      "Returns { sessionId, durationMs, accessCount, topFiles }. A follow-up GET on the session returns 404.",
    apiEndpoint: "/api/v1/synapse/task/:id/end",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID from synapse_task_begin" },
      },
      required: ["id"],
    },
  },
];
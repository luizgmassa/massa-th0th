/**
 * Synapse Routes
 *
 * Session lifecycle + working-memory buffer endpoints.
 * Closes the loop opened by IMP-7 (the search route accepts synapseSessionId
 * but until now there was no way for an external caller to create one).
 *
 *   POST   /api/v1/synapse/session            create session, return id
 *   GET    /api/v1/synapse/session/:id        inspect session state
 *   PATCH  /api/v1/synapse/session/:id        update taskContext / refresh TTL
 *   DELETE /api/v1/synapse/session/:id        end session
 *   POST   /api/v1/synapse/session/:id/prime  seed buffer with results
 *   POST   /api/v1/synapse/session/:id/access record an access for affinity
 *   GET    /api/v1/synapse/sessions           list active sessions (debug)
 */

import {
  getSessionRegistry,
  DEFAULT_BUFFER_CONFIG,
  buildPrefetchPlan,
  DEFAULT_PREFETCH_CONFIG,
  type PrefetchEntry,
} from "@massa-th0th/core/services";
import { SearchSource } from "@massa-th0th/shared";
import { Elysia, t } from "elysia";

const SessionInfoSchema = t.Object({
  sessionId: t.String(),
  agentId: t.String(),
  workspaceId: t.Optional(t.String()),
  taskContext: t.Optional(t.String()),
  createdAt: t.Number(),
  expiresAt: t.Number(),
  accessHistorySize: t.Number(),
  bufferEnabled: t.Boolean(),
  bufferSize: t.Optional(t.Number()),
});

function serializeSession(s: ReturnType<ReturnType<typeof getSessionRegistry>["get"]>) {
  if (!s) return null;
  return {
    sessionId: s.sessionId,
    agentId: s.agentId,
    workspaceId: s.workspaceId,
    taskContext: s.taskContext,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    accessHistorySize: s.accessHistory.size,
    bufferEnabled: !!s.buffer,
    bufferSize: s.buffer?.size(),
  };
}

function newSessionId(): string {
  return `syn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const synapseRoutes = new Elysia({ prefix: "/api/v1/synapse" })
  // ────────────────────────────────────────────────────────────────────────
  .post(
    "/session",
    ({ body }) => {
      const registry = getSessionRegistry();
      const sessionId = body.sessionId ?? newSessionId();
      const session = registry.create({
        sessionId,
        agentId: body.agentId,
        workspaceId: body.workspaceId,
        taskContext: body.taskContext,
        ttlMs: body.ttlMs,
        bufferConfig: body.enableBuffer
          ? {
              ...DEFAULT_BUFFER_CONFIG,
              maxSize: body.bufferMaxSize ?? DEFAULT_BUFFER_CONFIG.maxSize,
              ttlMs: body.bufferTtlMs ?? DEFAULT_BUFFER_CONFIG.ttlMs,
            }
          : undefined,
        accessHistoryMaxEntries: body.accessHistoryMaxEntries,
      });
      return { success: true, data: serializeSession(session) };
    },
    {
      body: t.Object({
        agentId: t.String({ description: "Stable identifier of the calling agent" }),
        sessionId: t.Optional(t.String({ description: "Override; otherwise a UUID-ish id is generated" })),
        workspaceId: t.Optional(t.String()),
        taskContext: t.Optional(
          t.String({ description: "Short description of what the agent is doing" }),
        ),
        ttlMs: t.Optional(t.Number({ description: "Custom TTL; default 1h" })),
        enableBuffer: t.Optional(t.Boolean({ default: true })),
        bufferMaxSize: t.Optional(t.Number()),
        bufferTtlMs: t.Optional(t.Number()),
        accessHistoryMaxEntries: t.Optional(t.Number()),
      }),
      detail: { tags: ["synapse"], summary: "Create Synapse session" },
    },
  )
  // ────────────────────────────────────────────────────────────────────────
  .get(
    "/session/:id",
    ({ params }) => {
      const session = getSessionRegistry().get(params.id);
      if (!session) {
        return { success: false, error: "Session not found or expired" };
      }
      return { success: true, data: serializeSession(session) };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ["synapse"], summary: "Get session state" },
    },
  )
  // ────────────────────────────────────────────────────────────────────────
  .patch(
    "/session/:id",
    ({ params, body }) => {
      const registry = getSessionRegistry();
      const updated = registry.updateTaskContext(
        params.id,
        body.taskContext,
        body.taskEmbedding,
      );
      if (!updated) {
        return { success: false, error: "Session not found or expired" };
      }
      return { success: true, data: serializeSession(updated) };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        taskContext: t.String({ description: "Replace the session task context" }),
        taskEmbedding: t.Optional(
          t.Array(t.Number(), { description: "Precomputed embedding of taskContext" }),
        ),
      }),
      detail: { tags: ["synapse"], summary: "Update session task context" },
    },
  )
  // ────────────────────────────────────────────────────────────────────────
  .delete(
    "/session/:id",
    ({ params }) => {
      const removed = getSessionRegistry().delete(params.id);
      return { success: removed };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ["synapse"], summary: "End session" },
    },
  )
  // ────────────────────────────────────────────────────────────────────────
  .post(
    "/session/:id/prime",
    ({ params, body }) => {
      const session = getSessionRegistry().get(params.id);
      if (!session) return { success: false, error: "Session not found or expired" };
      if (!session.buffer) {
        return { success: false, error: "Session has no working-memory buffer" };
      }
      const results = body.entries.map((e) => ({
        id: e.id,
        content: e.content,
        score: e.score ?? 0.7,
        source: SearchSource.VECTOR,
        metadata: (e.metadata ?? {}) as any,
      }));
      session.buffer.prime(results);
      return {
        success: true,
        data: {
          primed: results.length,
          bufferSize: session.buffer.size(),
        },
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        entries: t.Array(
          t.Object({
            id: t.String(),
            content: t.String(),
            score: t.Optional(t.Number()),
            metadata: t.Optional(t.Record(t.String(), t.Any())),
          }),
        ),
      }),
      detail: { tags: ["synapse"], summary: "Prime buffer with always-relevant entries" },
    },
  )
  // ────────────────────────────────────────────────────────────────────────
  .post(
    "/session/:id/access",
    ({ params, body }) => {
      const registry = getSessionRegistry();
      registry.recordAccess(params.id, body.memoryId);
      const session = registry.get(params.id);
      return {
        success: !!session,
        data: session
          ? { accessHistorySize: session.accessHistory.size }
          : { error: "Session not found or expired" },
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        memoryId: t.String({ description: "ID of the memory the agent accessed" }),
      }),
      detail: { tags: ["synapse"], summary: "Record access for agent-affinity scoring" },
    },
  )
  // ────────────────────────────────────────────────────────────────────────
  .post(
    "/session/:id/prefetch",
    async ({ params, body }) => {
      const session = getSessionRegistry().get(params.id);
      if (!session) {
        return { success: false, error: "Session not found or expired" };
      }
      if (!session.buffer) {
        return { success: false, error: "Session has no working-memory buffer" };
      }

      const config = {
        ...DEFAULT_PREFETCH_CONFIG,
        enabled: true,
        ...(body.chains ? { chains: body.chains } : {}),
        ...(body.maxResults != null ? { maxResults: body.maxResults } : {}),
        ...(body.minImportance != null ? { minImportance: body.minImportance } : {}),
      };

      const plan = buildPrefetchPlan(
        { filePath: body.filePath, symbols: body.symbols },
        config,
      );
      if (!plan.enabled) {
        return {
          success: true,
          data: { enabled: false, query: plan.query, primed: 0, reason: "no-topics" },
        };
      }

      // Caller-provided entries take precedence (allows agents that already
      // have memory hits to skip the fetch step).
      const entries: PrefetchEntry[] = body.entries ?? [];
      if (entries.length === 0) {
        return {
          success: true,
          data: {
            enabled: true,
            query: plan.query,
            chains: plan.chains,
            maxResults: plan.maxResults,
            primed: 0,
            note: "No entries provided. Issue a memory search with `query` and POST results back as `entries`.",
          },
        };
      }

      const results = entries.map((e) => ({
        id: e.id,
        content: e.content,
        score: e.score ?? 0.7,
        source: SearchSource.VECTOR,
        metadata: (e.metadata ?? {}) as any,
      }));
      session.buffer.prime(results);
      return {
        success: true,
        data: {
          enabled: true,
          query: plan.query,
          primed: results.length,
          bufferSize: session.buffer.size(),
        },
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        filePath: t.String({ description: "Path of the file just opened" }),
        symbols: t.Optional(
          t.Array(t.Object({ name: t.String() }), {
            description: "Optional: known symbol names from the file",
          }),
        ),
        chains: t.Optional(t.Array(t.String())),
        maxResults: t.Optional(t.Number()),
        minImportance: t.Optional(t.Number()),
        entries: t.Optional(
          t.Array(
            t.Object({
              id: t.String(),
              content: t.String(),
              score: t.Optional(t.Number()),
              metadata: t.Optional(t.Record(t.String(), t.Any())),
            }),
          ),
        ),
      }),
      detail: { tags: ["synapse"], summary: "Plan + execute prefetch for an opened file" },
    },
  )
  // ────────────────────────────────────────────────────────────────────────
  .get(
    "/sessions",
    () => {
      const registry = getSessionRegistry();
      registry.evictExpired();
      return { success: true, data: { activeCount: registry.size() } };
    },
    {
      detail: { tags: ["synapse"], summary: "List active session count" },
    },
  );

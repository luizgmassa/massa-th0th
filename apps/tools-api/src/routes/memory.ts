/**
 * Memory Routes
 *
 * POST /api/v1/memory/store  - Armazenar memória
 * POST /api/v1/memory/search - Buscar memórias
 * POST /api/v1/memory/list   - Listar memórias (sem busca semântica)
 */

import type { MemoryRow } from "@th0th-ai/core";
import {
  getMemoryRepository,
  SearchMemoriesTool,
  StoreMemoryTool,
  UpdateMemoryTool,
  DeleteMemoryTool,
} from "@th0th-ai/core";
import { logger } from "@th0th-ai/shared";
import { Elysia, t } from "elysia";

let storeMemoryTool: StoreMemoryTool | null = null;
let searchMemoriesTool: SearchMemoriesTool | null = null;
let updateMemoryTool: UpdateMemoryTool | null = null;
let deleteMemoryTool: DeleteMemoryTool | null = null;

function getStoreMemoryTool(): StoreMemoryTool {
  if (!storeMemoryTool) {
    storeMemoryTool = new StoreMemoryTool();
  }
  return storeMemoryTool;
}

function getSearchMemoriesTool(): SearchMemoriesTool {
  if (!searchMemoriesTool) {
    searchMemoriesTool = new SearchMemoriesTool();
  }
  return searchMemoriesTool;
}

function getUpdateMemoryTool(): UpdateMemoryTool {
  if (!updateMemoryTool) {
    updateMemoryTool = new UpdateMemoryTool();
  }
  return updateMemoryTool;
}

function getDeleteMemoryTool(): DeleteMemoryTool {
  if (!deleteMemoryTool) {
    deleteMemoryTool = new DeleteMemoryTool();
  }
  return deleteMemoryTool;
}

/** Convert a raw MemoryRow into the same shape the search endpoint returns. */
function formatRow(row: MemoryRow) {
  let tags: string[] = [];
  try {
    tags = row.tags ? JSON.parse(row.tags) : [];
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    content: row.content,
    type: row.type,
    level: row.level,
    agentId: row.agent_id,
    importance: row.importance,
    tags,
    score: row.importance, // no semantic score — use importance as proxy
    createdAt: new Date(row.created_at).toISOString(),
    accessCount: row.access_count,
  };
}

export const memoryRoutes = new Elysia({ prefix: "/api/v1/memory" })
  .post(
    "/store",
    async ({ body }) => {
      try {
        return await getStoreMemoryTool().handle(body);
      } catch (error) {
        logger.error("Failed to initialize StoreMemoryTool", error as Error);
        return {
          success: false,
          error: `Memory service unavailable: ${(error as Error).message}`,
        };
      }
    },
    {
      body: t.Object({
        content: t.String({
          description: "Content to store in memory",
          maxLength: 100000,
        }),
        type: t.Union(
          [
            t.Literal("critical"),
            t.Literal("conversation"),
            t.Literal("code"),
            t.Literal("decision"),
            t.Literal("pattern"),
          ],
          { description: "Type of memory" },
        ),
        userId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        sessionId: t.Optional(t.String()),
        agentId: t.Optional(t.String()),
        tags: t.Optional(t.Array(t.String())),
        importance: t.Optional(
          t.Number({ minimum: 0, maximum: 1, default: 0.5 }),
        ),
        linkTo: t.Optional(t.Array(t.String())),
        format: t.Optional(
          t.Union([t.Literal("json"), t.Literal("toon")], { default: "toon" }),
        ),
      }),
      detail: {
        tags: ["memory"],
        summary: "Store memory",
        description:
          "Store a new memory in the hierarchical memory system (local SQLite)",
      },
    },
  )
  .post(
    "/search",
    async ({ body }) => {
      try {
        return await getSearchMemoriesTool().handle(body);
      } catch (error) {
        logger.error("Failed to initialize SearchMemoriesTool", error as Error);
        return {
          success: false,
          error: `Memory service unavailable: ${(error as Error).message}`,
        };
      }
    },
    {
      body: t.Object({
        query: t.String({ description: "Search query (what to remember)" }),
        userId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        sessionId: t.Optional(t.String()),
        agentId: t.Optional(t.String()),
        types: t.Optional(
          t.Array(
            t.Union([
              t.Literal("critical"),
              t.Literal("conversation"),
              t.Literal("code"),
              t.Literal("decision"),
              t.Literal("pattern"),
            ]),
          ),
        ),
        limit: t.Optional(t.Number({ default: 10 })),
        minImportance: t.Optional(
          t.Number({ minimum: 0, maximum: 1, default: 0.3 }),
        ),
        includePersistent: t.Optional(t.Boolean({ default: true })),
        includeRelated: t.Optional(t.Boolean({ default: false })),
        format: t.Optional(
          t.Union([t.Literal("json"), t.Literal("toon")], { default: "toon" }),
        ),
      }),
      detail: {
        tags: ["memory"],
        summary: "Search memories",
        description:
          "Search stored memories using semantic search across sessions",
      },
    },
  )
  .post(
    "/update",
    async ({ body }) => {
      try {
        return await getUpdateMemoryTool().handle(body);
      } catch (error) {
        logger.error("Failed to initialize UpdateMemoryTool", error as Error);
        return {
          success: false,
          error: `Memory service unavailable: ${(error as Error).message}`,
        };
      }
    },
    {
      body: t.Object({
        id: t.String({ description: "ID of the memory to update" }),
        content: t.Optional(t.String({ description: "New content (re-embedded when set)" })),
        importance: t.Optional(
          t.Number({ minimum: 0, maximum: 1, description: "New importance score (0-1)" }),
        ),
        tags: t.Optional(
          t.Array(t.String(), {
            description: "Tags (replace existing unless mergeTags is true)",
          }),
        ),
        mergeTags: t.Optional(
          t.Boolean({ default: false, description: "Union tags with existing" }),
        ),
        format: t.Optional(
          t.Union([t.Literal("json"), t.Literal("toon")], { default: "toon" }),
        ),
      }),
      detail: {
        tags: ["memory"],
        summary: "Update memory",
        description:
          "Partially update a memory by id (content, importance, tags). Content changes are re-embedded.",
      },
    },
  )
  .post(
    "/delete",
    async ({ body }) => {
      try {
        return await getDeleteMemoryTool().handle(body);
      } catch (error) {
        logger.error("Failed to initialize DeleteMemoryTool", error as Error);
        return {
          success: false,
          error: `Memory service unavailable: ${(error as Error).message}`,
        };
      }
    },
    {
      body: t.Object({
        id: t.String({ description: "ID of the memory to delete" }),
        format: t.Optional(
          t.Union([t.Literal("json"), t.Literal("toon")], { default: "toon" }),
        ),
      }),
      detail: {
        tags: ["memory"],
        summary: "Delete memory",
        description:
          "Hard-delete a memory by id and sever its graph edges.",
      },
    },
  )
  .post(
    "/list",
    async ({ body }) => {
      try {
        const repo = getMemoryRepository() as any;
        const limit = body.limit ?? 50;
        const offset = body.offset ?? 0;
        let rows: MemoryRow[];
        let total: number;

        if (typeof repo.getDb === "function") {
          // SQLite path — raw SQL
          const db = repo.getDb();
          const conditions: string[] = [];
          const params: unknown[] = [];
          if (body.type) { conditions.push("type = ?"); params.push(body.type); }
          if (body.level !== undefined && body.level !== null) {
            conditions.push("level = ?");
            params.push(body.level);
          }
          if (body.minImportance) { conditions.push("importance >= ?"); params.push(body.minImportance); }
          const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
          total = (db.prepare(`SELECT COUNT(*) as n FROM memories ${where}`).get(...params) as any).n;
          rows = db.prepare(`SELECT id, content, type, level, user_id, session_id, project_id, agent_id, importance, tags, created_at, access_count, last_accessed FROM memories ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as MemoryRow[];
        } else {
          // PostgreSQL path — search method
          const all = await repo.search({
            types: body.type ? [body.type] : undefined,
            minImportance: body.minImportance ?? 0,
            includePersistent: true,
            limit: 10000,
          });
          const filtered =
            body.level !== undefined && body.level !== null
              ? all.filter((r: MemoryRow) => r.level === body.level)
              : all;
          total = filtered.length;
          rows = filtered.slice(offset, offset + limit);
        }

        return {
          success: true,
          data: { memories: rows.map(formatRow), total, limit, offset },
        };
      } catch (error) {
        logger.error("Failed to list memories", error as Error);
        return {
          success: false,
          error: `Failed to list memories: ${(error as Error).message}`,
        };
      }
    },
    {
      body: t.Object({
        type: t.Optional(
          t.Union([
            t.Literal("critical"),
            t.Literal("conversation"),
            t.Literal("code"),
            t.Literal("decision"),
            t.Literal("pattern"),
          ]),
        ),
        limit: t.Optional(t.Number({ default: 50, maximum: 500 })),
        offset: t.Optional(t.Number({ default: 0 })),
        minImportance: t.Optional(
          t.Number({ minimum: 0, maximum: 1, default: 0 }),
        ),
        level: t.Optional(
          t.Number({
            minimum: 1,
            maximum: 3,
            description: "Filter by memory level (1=Project, 2=User, 3=Session)",
          }),
        ),
      }),
      detail: {
        tags: ["memory"],
        summary: "List memories",
        description:
          "List stored memories with optional filters (type/level/minImportance, no semantic search, ordered by creation date)",
      },
    },
  );

/**
 * Memory Repository - PostgreSQL Implementation (raw SQL)
 *
 * All queries use $executeRaw / $queryRaw to avoid the Prisma 7.7.0 +
 * @prisma/adapter-pg + Bun incompatibility (isObjectEnumValue bug).
 *
 * ORM filter methods (findMany, updateMany, create, etc.) crash at runtime
 * with: "(0, Ao.isObjectEnumValue) is not a function".
 * Raw-SQL paths work correctly — both in the API server and in bun:test.
 */

import { logger, MemoryType } from "@massa-th0th/shared";
import { Prisma } from "../../generated/prisma/index.js";
import { getPrismaClient } from "../../services/query/prisma-client.js";
import type { PrismaClient } from "../../generated/prisma/index.js";
import type { InsertMemoryInput, MemoryRow, SearchFilters, UpdateMemoryPatch } from "./memory-repository.js";

// ── Raw row shape returned by $queryRaw ──────────────────────────────────────

interface RawMemory {
  id: string;
  content: string;
  type: string;
  level: number;
  user_id: string | null;
  session_id: string | null;
  project_id: string | null;
  agent_id: string | null;
  importance: number;
  // PostgreSQL text[] — under @prisma/adapter-pg the driver returns this as the
  // Postgres array-literal STRING `{"a","b"}` (not a JS array), because the
  // adapter does not map OID 1009 (text[]) to a native type. `parsePgTextArray`
  // converts that literal into a JS string[]. `null` stays null/[].
  tags: string[] | string | null;
  embedding: Buffer | null;
  metadata: unknown | null;
  created_at: Date;
  updated_at: Date;
  access_count: number;
  last_accessed: Date | null;
  pinned: boolean | number | null; // Phase 1
  deleted_at: Date | null; // Phase 1
}

/**
 * Parse a PostgreSQL text[] literal into a JS string[].
 *
 * The pg driver under @prisma/adapter-pg returns `text[]` columns as the raw
 * Postgres array-literal string, e.g. `{alpha,beta}` or `{"with,comma","quote"}`
 * (with inner quotes/escapes). Prisma cannot map OID 1009 natively, so we do it
 * here. Accepts: a JS array (passthrough), a Postgres literal string, or null.
 *
 * Examples:
 *   parsePgTextArray(["a","b"])          → ["a","b"]
 *   parsePgTextArray(`{alpha,beta}`)     → ["alpha","beta"]
 *   parsePgTextArray(`{"a,b","c"}`)      → ["a,b","c"]
 *   parsePgTextArray(`{}`)               → []
 *   parsePgTextArray(null)               → []
 */
function parsePgTextArray(v: string[] | string | null | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== "string") return [];
  const s = v.trim();
  if (s === "{}" || s === "") return [];
  // Must be wrapped in braces.
  if (!(s.startsWith("{") && s.endsWith("}"))) return [];
  const inner = s.slice(1, -1);
  // No members (shouldn't happen after the {} check, but be safe).
  if (inner === "") return [];
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  let escape = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  // Treat the unquoted token `NULL` (case-insensitive) as empty/null element.
  return out.map((t) => (t.toUpperCase() === "NULL" && !inQuotes ? "" : t));
}

export class MemoryRepositoryPg {
  private static instance: MemoryRepositoryPg | null = null;
  private prisma: PrismaClient;

  private constructor() {
    this.prisma = getPrismaClient();
    logger.info("MemoryRepositoryPg initialized (PostgreSQL, raw SQL)");
  }

  static getInstance(): MemoryRepositoryPg {
    if (!MemoryRepositoryPg.instance) {
      MemoryRepositoryPg.instance = new MemoryRepositoryPg();
    }
    return MemoryRepositoryPg.instance;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Convert a raw DB row to the MemoryRow interface used by the rest of the app. */
  private toMemoryRow(m: RawMemory): MemoryRow {
    const tagsArr = parsePgTextArray(m.tags);
    return {
      id: m.id,
      content: m.content,
      type: m.type,
      level: m.level,
      user_id: m.user_id,
      session_id: m.session_id,
      project_id: m.project_id,
      agent_id: m.agent_id,
      importance: m.importance,
      tags: JSON.stringify(tagsArr),
      embedding: m.embedding,
      metadata: m.metadata ? JSON.stringify(m.metadata) : null,
      created_at: m.created_at instanceof Date ? m.created_at.getTime() : Number(m.created_at),
      updated_at: m.updated_at instanceof Date ? m.updated_at.getTime() : Number(m.updated_at),
      access_count: m.access_count,
      last_accessed: m.last_accessed instanceof Date ? m.last_accessed.getTime() : (m.last_accessed ? Number(m.last_accessed) : null),
      pinned: m.pinned === true || m.pinned === 1 ? 1 : 0,
      deleted_at: m.deleted_at instanceof Date ? m.deleted_at.getTime() : (m.deleted_at ? Number(m.deleted_at) : null),
    };
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  /**
   * Insert a new memory using raw SQL ($executeRaw).
   * Bypasses Prisma ORM to avoid the isObjectEnumValue Bun incompatibility.
   */
  async insert(input: InsertMemoryInput): Promise<void> {
    const now = new Date();
    const embeddingBuf = input.embedding && input.embedding.length > 0
      ? Buffer.from(new Float32Array(input.embedding).buffer)
      : null;
    const metadataJson = JSON.stringify(input.metadata || { type: input.type, importance: input.importance });
    const tagsArray = input.tags ?? [];

    await this.prisma.$executeRaw`
      INSERT INTO memories (
        id, content, type, level,
        user_id, session_id, project_id, agent_id,
        importance, tags, embedding, metadata,
        created_at, updated_at, access_count, pinned
      ) VALUES (
        ${input.id},
        ${input.content},
        ${input.type},
        ${input.level},
        ${input.userId ?? null},
        ${input.sessionId ?? null},
        ${input.projectId ?? null},
        ${input.agentId ?? null},
        ${input.importance},
        ${tagsArray},
        ${embeddingBuf},
        ${metadataJson}::jsonb,
        ${now},
        ${now},
        0,
        ${input.pinned === true}
      )
    `;
  }

  /**
   * Get a single memory by ID.
   */
  async getById(id: string): Promise<MemoryRow | null> {
    const rows = await this.prisma.$queryRaw<RawMemory[]>`
      SELECT id, content, type, level,
             user_id, session_id, project_id, agent_id,
             importance, tags, embedding, metadata,
             created_at, updated_at, access_count, last_accessed,
             pinned, deleted_at
      FROM memories
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ? this.toMemoryRow(rows[0]) : null;
  }

  /**
   * Search memories with filters (used by MemoryConsolidationJob, etc.)
   */
  async search(filters: SearchFilters): Promise<MemoryRow[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`importance >= ${filters.minImportance}`,
      // Phase 1: never return soft-deleted rows from recall.
      Prisma.sql`deleted_at IS NULL`,
    ];

    if (filters.userId)    conditions.push(Prisma.sql`user_id = ${filters.userId}`);
    if (filters.sessionId) conditions.push(Prisma.sql`session_id = ${filters.sessionId}`);
    if (filters.projectId) conditions.push(Prisma.sql`project_id = ${filters.projectId}`);
    if (filters.agentId)   conditions.push(Prisma.sql`agent_id = ${filters.agentId}`);

    if (filters.types && filters.types.length > 0) {
      conditions.push(Prisma.sql`type = ANY(${filters.types}::text[])`);
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const rows = await this.prisma.$queryRaw<RawMemory[]>`
      SELECT id, content, type, level,
             user_id, session_id, project_id, agent_id,
             importance, tags, embedding, metadata,
             created_at, updated_at, access_count, last_accessed,
             pinned, deleted_at
      FROM memories
      ${whereClause}
      ORDER BY importance DESC, created_at DESC
      LIMIT ${filters.limit}
    `;

    return rows.map(r => this.toMemoryRow(r));
  }

  /**
   * Full-text search: word-level ILIKE OR matching, with scope filters.
   * Mirrors the SQLite FTS5 behaviour: each whitespace-separated token is
   * searched independently; results are returned if ANY token matches.
   */
  async fullTextSearch(
    query: string,
    limit: number,
    filters?: {
      userId?: string;
      sessionId?: string;
      projectId?: string;
      agentId?: string;
      minImportance?: number;
      types?: MemoryType[];
    },
  ): Promise<MemoryRow[]> {
    // Split the query into individual tokens and build per-token ILIKE clauses.
    // Each token is escaped for ILIKE special chars (%, _) so stray underscores
    // in random strings don't act as wildcards.
    const tokens = query.trim().split(/\s+/).filter((t) => t.length > 0);
    const escaped = tokens.map((t) => `%${t.replace(/[%_\\]/g, '\\$&')}%`);

    // Build: (content ILIKE 'token1' OR content ILIKE 'token2' …)
    const tokenClauses: Prisma.Sql[] = escaped.map(
      (pat) => Prisma.sql`content ILIKE ${pat}`,
    );
    const contentCondition = Prisma.sql`(${Prisma.join(tokenClauses, ' OR ')})`;

    const conditions: Prisma.Sql[] = [contentCondition];
    // Phase 1: never return soft-deleted rows from recall.
    conditions.push(Prisma.sql`deleted_at IS NULL`);

    if (filters?.userId)        conditions.push(Prisma.sql`user_id = ${filters.userId}`);
    if (filters?.sessionId)     conditions.push(Prisma.sql`session_id = ${filters.sessionId}`);
    if (filters?.projectId)     conditions.push(Prisma.sql`project_id = ${filters.projectId}`);
    if (filters?.agentId)       conditions.push(Prisma.sql`agent_id = ${filters.agentId}`);
    if (filters?.minImportance != null) conditions.push(Prisma.sql`importance >= ${filters.minImportance}`);
    if (filters?.types && filters.types.length > 0)
      conditions.push(Prisma.sql`type = ANY(${filters.types}::text[])`);

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}
      AND NOT EXISTS (
        SELECT 1 FROM memory_edges me
        WHERE me.to_id = memories.id AND me.edge_type = 'SUPERSEDES'
      )`;

    const rows = await this.prisma.$queryRaw<RawMemory[]>`
      SELECT id, content, type, level,
             user_id, session_id, project_id, agent_id,
             importance, tags, embedding, metadata,
             created_at, updated_at, access_count, last_accessed,
             pinned, deleted_at
      FROM memories
      ${whereClause}
      ORDER BY importance DESC, created_at DESC
      LIMIT ${limit}
    `;

    return rows.map(r => this.toMemoryRow(r));
  }

  /**
   * Update importance score.
   */
  async updateImportance(id: string, importance: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE memories SET importance = ${importance}, updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  /**
   * Increment access count and set last_accessed timestamp.
   */
  async incrementAccessCount(id: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE memories
      SET access_count = access_count + 1,
          last_accessed = NOW()
      WHERE id = ${id}
    `;
  }

  /**
   * Delete a memory by ID.
   */
  async delete(id: string): Promise<void> {
    await this.prisma.$executeRaw`DELETE FROM memories WHERE id = ${id}`;
  }

  /**
   * Delete a memory by ID. Returns true if a row was deleted.
   * Uses RETURNING so an absent id reports false (idempotent).
   */
  async deleteById(id: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      DELETE FROM memories WHERE id = ${id} RETURNING id
    `;
    return rows.length > 0;
  }

  /**
   * Partially update a memory. Only provided fields are changed.
   * PostgreSQL uses ILIKE (no external FTS table), so no FTS reindex needed.
   * Returns true if a row was updated.
   */
  async update(id: string, patch: UpdateMemoryPatch): Promise<boolean> {
    const sets: Prisma.Sql[] = [];
    if (patch.content !== undefined) sets.push(Prisma.sql`content = ${patch.content}`);
    if (patch.importance !== undefined) sets.push(Prisma.sql`importance = ${patch.importance}`);
    if (patch.tags !== undefined) sets.push(Prisma.sql`tags = ${patch.tags}`);
    if (patch.embedding !== undefined) {
      const buf = Buffer.from(new Float32Array(patch.embedding).buffer);
      sets.push(Prisma.sql`embedding = ${buf}`);
    }
    if (patch.pinned !== undefined) sets.push(Prisma.sql`pinned = ${patch.pinned === true}`);

    if (sets.length === 0) {
      const row = await this.getById(id);
      return row !== null;
    }
    sets.push(Prisma.sql`updated_at = NOW()`);

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE memories SET ${Prisma.join(sets, ", ")} WHERE id = ${id} RETURNING id
    `;
    return rows.length > 0;
  }

  /**
   * Soft-delete a single memory by id (Phase 1). Sets `deleted_at`; the row
   * is hidden from recall by the `deleted_at IS NULL` filters. Returns true
   * only if a previously-live row was tombstoned. Idempotent.
   */
  async softDeleteById(id: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE memories
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING id
    `;
    return rows.length > 0;
  }

  /**
   * Delete all memories for a project. Returns the count deleted.
   */
  async deleteByProject(projectId: string): Promise<number> {
    const result = await this.prisma.$executeRaw`
      DELETE FROM memories WHERE project_id = ${projectId}
    `;
    return result;
  }

  /**
   * List memories with pagination.
   */
  async list(limit: number, offset: number): Promise<MemoryRow[]> {
    const rows = await this.prisma.$queryRaw<RawMemory[]>`
      SELECT id, content, type, level,
             user_id, session_id, project_id, agent_id,
             importance, tags, embedding, metadata,
             created_at, updated_at, access_count, last_accessed,
             pinned, deleted_at
      FROM memories
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map(r => this.toMemoryRow(r));
  }

  /**
   * Find recent memories that contain a given tag, scoped to session/project,
   * within a time window. Used by CoRetrievalHook to find co-session memories.
   */
  async findRecentByTag(
    tag: string,
    opts: {
      sessionId?: string;
      projectId?: string;
      excludeId?: string;
      sinceMs: number;
      limit: number;
    },
  ): Promise<Array<{ id: string }>> {
    const since = new Date(opts.sinceMs);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`${tag} = ANY(tags)`,
      Prisma.sql`created_at >= ${since}`,
    ];

    if (opts.sessionId)  conditions.push(Prisma.sql`session_id = ${opts.sessionId}`);
    if (opts.projectId)  conditions.push(Prisma.sql`project_id = ${opts.projectId}`);
    if (opts.excludeId)  conditions.push(Prisma.sql`id != ${opts.excludeId}`);

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM memories
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${opts.limit}
    `;
    return rows;
  }

  /**
   * Find recent memories that have an embedding, for cosine-similarity
   * comparisons in RelationExtractor. Scoped to a project when provided.
   */
  async findRecentWithEmbeddings(
    excludeId: string,
    projectId: string | null,
    limit: number,
  ): Promise<MemoryRow[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`id != ${excludeId}`,
      Prisma.sql`embedding IS NOT NULL`,
      Prisma.sql`deleted_at IS NULL`,
    ];

    if (projectId) {
      conditions.push(Prisma.sql`(project_id = ${projectId} OR project_id IS NULL)`);
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const rows = await this.prisma.$queryRaw<RawMemory[]>`
      SELECT id, content, type, level,
             user_id, session_id, project_id, agent_id,
             importance, tags, embedding, metadata,
             created_at, updated_at, access_count, last_accessed,
             pinned, deleted_at
      FROM memories
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(r => this.toMemoryRow(r));
  }

  /**
   * List live, non-pinned memories with embeddings older than `staleSinceMs`
   * for the consolidation job (Phase 1). Bounded by `limit`.
   */
  async listConsolidationCandidates(staleSinceMs: number, limit = 200): Promise<MemoryRow[]> {
    const stale = new Date(staleSinceMs);
    const rows = await this.prisma.$queryRaw<RawMemory[]>`
      SELECT id, content, type, level,
             user_id, session_id, project_id, agent_id,
             importance, tags, embedding, metadata,
             created_at, updated_at, access_count, last_accessed,
             pinned, deleted_at
      FROM memories
      WHERE deleted_at IS NULL
        AND pinned = false
        AND embedding IS NOT NULL
        AND created_at < ${stale}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(r => this.toMemoryRow(r));
  }

  /**
   * No-op — connection is managed by the singleton PrismaClient.
   */
  async close(): Promise<void> {}
}

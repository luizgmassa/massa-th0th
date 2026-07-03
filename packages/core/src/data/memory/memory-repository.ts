/**
 * Memory Repository
 *
 * Data-access layer for the memories SQLite database.
 * Owns DB initialization, schema creation, migrations, and all raw SQL.
 * No business logic — that lives in MemoryService and MemoryController.
 */

import { config, logger, MemoryLevel, MemoryType } from "@massa-th0th/shared";
import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";

// ── Row types ────────────────────────────────────────────────

export interface MemoryRow {
  id: string;
  content: string;
  type: string;
  level: number;
  user_id: string | null;
  session_id: string | null;
  project_id: string | null;
  agent_id: string | null;
  importance: number;
  tags: string; // JSON array
  embedding: Buffer | null;
  metadata: string | null; // JSON
  created_at: number;
  updated_at: number;
  access_count: number;
  last_accessed: number | null;
  /** Pinned memories are decay-exempt (Phase 1). 0/1. */
  pinned: number;
  /** Soft-delete tombstone (Phase 1). Null = live. */
  deleted_at: number | null;
}

export interface InsertMemoryInput {
  id: string;
  content: string;
  type: MemoryType;
  level: MemoryLevel;
  userId?: string;
  sessionId?: string;
  projectId?: string;
  agentId?: string;
  importance: number;
  tags: string[];
  embedding: number[];
  metadata?: Record<string, unknown>;
  /** Pinned memories are decay-exempt. Default false. */
  pinned?: boolean;
}

export interface SearchFilters {
  userId?: string;
  sessionId?: string;
  projectId?: string;
  agentId?: string;
  types?: MemoryType[];
  minImportance: number;
  includePersistent: boolean;
  limit: number;
}

export interface UpdateMemoryPatch {
  content?: string;
  importance?: number;
  tags?: string[];
  /** Re-computed embedding; required when content changes (caller's responsibility). */
  embedding?: number[];
  /** Toggle pinned status (Phase 1). */
  pinned?: boolean;
}

// ── Repository ───────────────────────────────────────────────

export class MemoryRepository {
  private static instance: MemoryRepository | null = null;
  private db!: Database;

  private constructor() {
    this.initialize();
  }

  static getInstance(): MemoryRepository {
    if (!MemoryRepository.instance) {
      MemoryRepository.instance = new MemoryRepository();
    }
    return MemoryRepository.instance;
  }

  /** Expose the raw database for transactional use (e.g. consolidation job). */
  getDb(): Database {
    return this.db;
  }

  // ── Initialization & Migrations ────────────────────────────

  private initialize(): void {
    const dataDir = config.get("dataDir");
    const dbPath = path.join(dataDir, "memories.db");

    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);

    // Check if table exists and needs migration BEFORE creating it
    const migrationCols: string[] = [];
    try {
      const tables = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'",
        )
        .all() as any[];

      if (tables.length > 0) {
        const columns = this.db
          .prepare("PRAGMA table_info(memories)")
          .all() as any[];
        if (!columns.some((col: any) => col.name === "agent_id")) {
          migrationCols.push("agent_id");
        }
        // Phase 1: pinned + deleted_at (additive).
        if (!columns.some((col: any) => col.name === "pinned")) {
          migrationCols.push("pinned");
        }
        if (!columns.some((col: any) => col.name === "deleted_at")) {
          migrationCols.push("deleted_at");
        }
      }
    } catch {
      // Ignore errors, will create table below
    }

    // Create memories table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        level INTEGER NOT NULL,
        user_id TEXT,
        session_id TEXT,
        project_id TEXT,
        agent_id TEXT,
        importance REAL DEFAULT 0.5,
        tags TEXT,
        embedding BLOB,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0,
        deleted_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
      CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_level ON memories(level);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        tags,
        content='memories',
        content_rowid='rowid'
      );

      -- Phase 1: the read-side SUPERSEDES filter joins memory_edges. This is
      -- the SAME memories.db file GraphStore opens, but a process that never
      -- instantiates GraphStore (e.g. memory-only tests) would otherwise see
      -- "no such table: memory_edges". CREATE TABLE IF NOT EXISTS is a no-op
      -- when GraphStore has already created it, so this is safe to mirror here.
      CREATE TABLE IF NOT EXISTS memory_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        evidence TEXT,
        auto_extracted INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(source_id, target_id, relation_type)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_target ON memory_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_type ON memory_edges(relation_type);
    `);

    // Run additive migrations if needed
    if (migrationCols.includes("agent_id")) {
      logger.info("Migrating database: adding agent_id column");
      this.db.exec("ALTER TABLE memories ADD COLUMN agent_id TEXT");
    }
    if (migrationCols.includes("pinned")) {
      logger.info("Migrating database: adding pinned column");
      this.db.exec(
        "ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (migrationCols.includes("deleted_at")) {
      logger.info("Migrating database: adding deleted_at column");
      this.db.exec("ALTER TABLE memories ADD COLUMN deleted_at INTEGER");
    }

    // Always ensure indexes exist
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id)",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_memories_deleted_at ON memories(deleted_at)",
    );

    // Always ensure agent_id index exists
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id)",
    );

    logger.info("MemoryRepository initialized", { dbPath });
  }

  // ── CRUD ───────────────────────────────────────────────────

  /**
   * Insert a new memory and index it for FTS.
   */
  insert(input: InsertMemoryInput): void {
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, content, type, level,
        user_id, session_id, project_id, agent_id,
        importance, tags, embedding, metadata,
        created_at, updated_at, pinned, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `);

    stmt.run(
      input.id,
      input.content,
      input.type,
      input.level,
      input.userId || null,
      input.sessionId || null,
      input.projectId || null,
      input.agentId || null,
      input.importance,
      JSON.stringify(input.tags),
      Buffer.from(new Float32Array(input.embedding).buffer),
      JSON.stringify(
        input.metadata || {
          type: input.type,
          importance: input.importance,
          agentId: input.agentId,
        },
      ),
      now,
      now,
      input.pinned ? 1 : 0,
    );

    // Index in FTS5
    this.db
      .prepare(
        `INSERT INTO memories_fts (rowid, content, tags)
         SELECT rowid, content, tags FROM memories WHERE id = ?`,
      )
      .run(input.id);
  }

  /**
   * Full-text search with dynamic filtering.
   * Returns raw rows (no scoring applied).
   */
  fullTextSearch(
    query: string,
    limitOrFilters: number | SearchFilters,
    maybeFilters?: Omit<SearchFilters, "limit" | "includePersistent">,
  ): MemoryRow[] {
    const filters: SearchFilters =
      typeof limitOrFilters === "number"
        ? {
            userId: maybeFilters?.userId,
            sessionId: maybeFilters?.sessionId,
            projectId: maybeFilters?.projectId,
            agentId: maybeFilters?.agentId,
            types: maybeFilters?.types,
            minImportance: maybeFilters?.minImportance ?? 0,
            includePersistent: true,
            limit: limitOrFilters,
          }
        : limitOrFilters;

    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.userId) {
      conditions.push("m.user_id = ?");
      params.push(filters.userId);
    }

    if (filters.projectId) {
      conditions.push("m.project_id = ?");
      params.push(filters.projectId);
    }

    if (filters.agentId) {
      conditions.push("(m.agent_id = ? OR m.agent_id IS NULL)");
      params.push(filters.agentId);
    }

    if (filters.types && filters.types.length > 0) {
      conditions.push(`m.type IN (${filters.types.map(() => "?").join(",")})`);
      params.push(...filters.types);
    }

    conditions.push("m.importance >= ?");
    params.push(filters.minImportance);

    // Phase 1: never return soft-deleted rows from recall.
    conditions.push("m.deleted_at IS NULL");

    if (!filters.includePersistent && filters.sessionId) {
      conditions.push("m.session_id = ?");
      params.push(filters.sessionId);
    } else if (filters.includePersistent) {
      conditions.push("(m.level <= ? OR (m.level = ? AND m.session_id = ?))");
      params.push(
        MemoryLevel.USER,
        MemoryLevel.SESSION,
        filters.sessionId || "",
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Convert query to OR-based FTS5 syntax for better recall.
    // Each term is wrapped in double quotes to prevent FTS5 from
    // interpreting special characters (e.g. "-" as NOT operator).
    // Without quoting, "Agente-GT" would be parsed as "Agente NOT column:GT"
    // causing "no such column: GT" errors.
    const ftsTokens = query
      .trim()
      .replace(/[^\w\s]/gi, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t.replace(/"/g, '""')}"`);

    const ftsQuery = ftsTokens.join(" OR ");
    const hasFts = ftsQuery.length > 0;

    const sql = `
      SELECT
        m.id, m.content, m.type, m.level,
        m.user_id, m.session_id, m.project_id, m.agent_id,
        m.importance, m.tags, m.embedding,
        m.created_at, m.access_count, m.last_accessed,
        m.pinned, m.deleted_at
      FROM memories m
      ${hasFts ? "JOIN memories_fts fts ON m.rowid = fts.rowid" : ""}
      ${whereClause}
      ${hasFts ? "AND fts.content MATCH ?" : ""}
      AND NOT EXISTS (
        SELECT 1 FROM memory_edges me
        WHERE me.target_id = m.id AND me.relation_type = 'SUPERSEDES'
      )
      ORDER BY ${hasFts ? "rank," : ""} m.importance DESC, m.created_at DESC
      LIMIT ?
    `;

    if (hasFts) params.push(ftsQuery);
    params.push(filters.limit);

    return this.db.prepare(sql).all(...params) as MemoryRow[];
  }

  getById(id: string): MemoryRow | null {
    return this.db
      .prepare(
        `SELECT id, content, type, level, importance, tags, embedding, metadata,
                created_at, updated_at, access_count, last_accessed,
                user_id, session_id, project_id, agent_id,
                pinned, deleted_at
         FROM memories WHERE id = ?`,
      )
      .get(id) as MemoryRow | null;
  }

  /**
   * Delete all memories belonging to a project.
   * Returns the number of rows deleted.
   */
  deleteByProject(projectId: string): number {
    // Remove from FTS index first (content table trigger would do this, but
    // the FTS table is an external-content table so we must do it manually).
    this.db
      .prepare(
        `INSERT INTO memories_fts(memories_fts, rowid, content, tags)
         SELECT 'delete', m.rowid, m.content, m.tags
         FROM memories m WHERE m.project_id = ?`,
      )
      .run(projectId);

    const result = this.db
      .prepare(`DELETE FROM memories WHERE project_id = ?`)
      .run(projectId);

    return result.changes;
  }

  /**
   * Soft-delete a single memory by id (Phase 1). Sets `deleted_at` and removes
   * the row from the FTS index so it stops matching recall, but keeps the row
   * for potential restore. Returns true if a live row was tombstoned.
   * Idempotent: re-deleting an already-tombstoned (or missing) row returns false.
   */
  softDeleteById(id: string): boolean {
    // Only tombstone live rows (deleted_at IS NULL).
    const live = this.db
      .prepare(
        `SELECT 1 FROM memories WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id);
    if (!live) return false;

    // Remove from FTS so the tombstoned row stops matching queries.
    this.db
      .prepare(
        `INSERT INTO memories_fts(memories_fts, rowid, content, tags)
         SELECT 'delete', rowid, content, tags FROM memories WHERE id = ?`,
      )
      .run(id);

    this.db
      .prepare(`UPDATE memories SET deleted_at = ?, updated_at = ? WHERE id = ?`)
      .run(Date.now(), Date.now(), id);
    return true;
  }

  /**
   * Delete a single memory by id (HARD delete — back-compat with Phase 0).
   * Also removes its FTS index entry (external-content table → manual).
   * Returns true if a row was deleted. Callers that want soft-delete
   * (tombstone) semantics should use `softDeleteById`.
   */
  deleteById(id: string): boolean {
    this.db
      .prepare(
        `INSERT INTO memories_fts(memories_fts, rowid, content, tags)
         SELECT 'delete', rowid, content, tags FROM memories WHERE id = ?`,
      )
      .run(id);

    const result = this.db
      .prepare(`DELETE FROM memories WHERE id = ?`)
      .run(id);

    return result.changes > 0;
  }

  /**
   * Partially update a memory. Only provided fields are changed.
   * When content or tags change, the FTS index entry is rebuilt
   * (external-content table → delete-then-insert around the row update).
   * Returns true if a row was updated.
   */
  update(id: string, patch: UpdateMemoryPatch): boolean {
    const sets: string[] = [];
    const params: any[] = [];
    let ftsDirty = false;

    if (patch.content !== undefined) {
      sets.push("content = ?");
      params.push(patch.content);
      ftsDirty = true;
    }
    if (patch.importance !== undefined) {
      sets.push("importance = ?");
      params.push(patch.importance);
    }
    if (patch.tags !== undefined) {
      sets.push("tags = ?");
      params.push(JSON.stringify(patch.tags));
      ftsDirty = true;
    }
    if (patch.embedding !== undefined) {
      sets.push("embedding = ?");
      params.push(Buffer.from(new Float32Array(patch.embedding).buffer));
    }
    if (patch.pinned !== undefined) {
      sets.push("pinned = ?");
      params.push(patch.pinned ? 1 : 0);
    }

    if (sets.length === 0) {
      // Nothing to change — report existence so callers can distinguish
      // "no-op on existing row" from "missing id".
      return this.getById(id) !== null;
    }

    sets.push("updated_at = ?");
    params.push(Date.now());

    // FTS external-content: delete the OLD entry before the row changes.
    if (ftsDirty) {
      this.db
        .prepare(
          `INSERT INTO memories_fts(memories_fts, rowid, content, tags)
           SELECT 'delete', rowid, content, tags FROM memories WHERE id = ?`,
        )
        .run(id);
    }

    params.push(id);
    const result = this.db
      .prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);

    // FTS external-content: insert the NEW entry after the row changes.
    if (result.changes > 0 && ftsDirty) {
      this.db
        .prepare(
          `INSERT INTO memories_fts(rowid, content, tags)
           SELECT rowid, content, tags FROM memories WHERE id = ?`,
        )
        .run(id);
    }

    return result.changes > 0;
  }

  /**
   * Batch-update access counts for retrieved memories.
   */
  updateAccessCounts(memoryIds: string[]): void {
    if (memoryIds.length === 0) return;

    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE memories
      SET access_count = access_count + 1,
          last_accessed = ?
      WHERE id = ?
    `);

    const transaction = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        stmt.run(now, id);
      }
    });

    transaction(memoryIds);
  }

  incrementAccessCount(memoryId: string): void {
    this.updateAccessCounts([memoryId]);
  }

  /**
   * List live, non-pinned memories with embeddings older than `staleSinceMs`
   * for the consolidation job (Phase 1). Candidates have `deleted_at IS NULL`
   * and `pinned = 0`. Bounded by `limit`.
   */
  listConsolidationCandidates(staleSinceMs: number, limit = 200): MemoryRow[] {
    return this.db
      .prepare(
        `SELECT id, content, type, level,
                user_id, session_id, project_id, agent_id,
                importance, tags, embedding, metadata,
                created_at, updated_at, access_count, last_accessed,
                pinned, deleted_at
         FROM memories
         WHERE deleted_at IS NULL
           AND pinned = 0
           AND embedding IS NOT NULL
           AND created_at < ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(staleSinceMs, limit) as MemoryRow[];
  }
}

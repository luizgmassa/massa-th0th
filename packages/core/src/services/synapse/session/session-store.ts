/**
 * SessionStore — durable persistence for Synapse agent sessions (Phase 1).
 *
 * Borrows ai-memory's writer/reader discipline: the in-memory Map stays the
 * hot cache, and a write-through store persists enough state to survive a
 * process restart. The load-bearing durable state is:
 *   - scalar session fields (agentId, workspaceId, taskContext, ttl, timestamps)
 *   - accessHistory (memoryId → count, LRU-bounded) — drives agent-affinity
 *   - taskTokens (pre-tokenized taskContext) and taskEmbedding
 *   - a best-effort buffer snapshot (the WorkingMemoryBuffer is a hot cache;
 *     on reload the session is created with a fresh buffer that refills
 *     naturally, so only a JSON snapshot is persisted for diagnostics/future
 *     restore — see assumption in design.md).
 *
 * Backend: SQLite-canonical (sessions are agent-runtime state, not analytics).
 * A `MemorySessionStore` (no-op) is provided for ephemeral/test runs and as a
 * fallback when the SQLite DB cannot be opened.
 */

import { config, logger } from "@massa-th0th/shared";
import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";
import type { AgentSession } from "../types.js";
import type { WorkingMemoryBufferConfig } from "../buffer/working-memory-buffer.js";

const TOKEN_RE = /[a-z0-9_]{2,}/g;

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const m of text.toLowerCase().matchAll(TOKEN_RE)) out.add(m[0]);
  return out;
}

// ── Store interface ─────────────────────────────────────────────────────────

export interface SessionStore {
  save(session: AgentSession): void;
  load(sessionId: string): AgentSession | null;
  delete(sessionId: string): void;
  /** Persist one access-history touch (LRU recency is encoded by row order). */
  recordAccess(sessionId: string, memoryId: string, count: number): void;
}

// ── No-op store (ephemeral / test fallback) ─────────────────────────────────

export class MemorySessionStore implements SessionStore {
  save(): void {}
  load(): AgentSession | null { return null; }
  delete(): void {}
  recordAccess(): void {}
}

// ── SQLite store ────────────────────────────────────────────────────────────

interface SessionRow {
  session_id: string;
  agent_id: string;
  workspace_id: string | null;
  task_context: string | null;
  task_tokens: string | null; // JSON array
  task_embedding: Buffer | null;
  ttl_ms: number;
  created_at: number;
  expires_at: number;
  access_history_limit: number;
  buffer_config: string | null; // JSON
  buffer_snapshot: string | null; // JSON (best-effort)
  updated_at: number;
}

interface AccessRow {
  memory_id: string;
  access_count: number;
  last_accessed_at: number;
}

export class SqliteSessionStore implements SessionStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    const dataDir = config.get("dataDir") as string;
    this.dbPath = dbPath ?? path.join(dataDir, "synapse-sessions.db");
  }

  /** Lazy-open so constructing the store is side-effect-free (and testable). */
  private getDB(): Database {
    if (this.db) return this.db;
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.db = new Database(this.dbPath);
      this.db.exec("PRAGMA busy_timeout = 3000");
      this.db.exec("PRAGMA journal_mode = WAL");
      this.createSchema();
      logger.info("SqliteSessionStore initialized", { dbPath: this.dbPath });
    } catch (e) {
      logger.warn("SqliteSessionStore init failed — sessions will be ephemeral", {
        dbPath: this.dbPath,
        error: (e as Error).message,
      });
      this.db = null;
      throw e;
    }
    return this.db!;
  }

  private createSchema(): void {
    const db = this.getDB();
    db.exec(`
      CREATE TABLE IF NOT EXISTS synapse_sessions (
        session_id   TEXT PRIMARY KEY,
        agent_id     TEXT NOT NULL,
        workspace_id TEXT,
        task_context TEXT,
        task_tokens  TEXT,
        task_embedding BLOB,
        ttl_ms       INTEGER NOT NULL,
        created_at   INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        access_history_limit INTEGER NOT NULL,
        buffer_config TEXT,
        buffer_snapshot TEXT,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_syn_sessions_expires ON synapse_sessions(expires_at);

      CREATE TABLE IF NOT EXISTS synapse_access_history (
        session_id TEXT NOT NULL,
        memory_id  TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, memory_id)
      );
      CREATE INDEX IF NOT EXISTS idx_syn_access_session ON synapse_access_history(session_id);
    `);
  }

  save(session: AgentSession): void {
    try {
      const db = this.getDB();
      const now = Date.now();
      const taskTokens = session.taskTokens ? JSON.stringify(Array.from(session.taskTokens)) : null;
      const taskEmbedding = session.taskEmbedding
        ? Buffer.from(new Float32Array(session.taskEmbedding as number[]).buffer)
        : null;
      const bufferConfig = session.buffer
        ? JSON.stringify(session.buffer.config)
        : null;
      const bufferSnapshot = session.buffer ? JSON.stringify(this.snapshotBuffer(session)) : null;

      db.prepare(
        `INSERT INTO synapse_sessions (
          session_id, agent_id, workspace_id, task_context, task_tokens, task_embedding,
          ttl_ms, created_at, expires_at, access_history_limit, buffer_config, buffer_snapshot,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          agent_id = excluded.agent_id,
          workspace_id = excluded.workspace_id,
          task_context = excluded.task_context,
          task_tokens = excluded.task_tokens,
          task_embedding = excluded.task_embedding,
          ttl_ms = excluded.ttl_ms,
          expires_at = excluded.expires_at,
          access_history_limit = excluded.access_history_limit,
          buffer_config = excluded.buffer_config,
          buffer_snapshot = excluded.buffer_snapshot,
          updated_at = excluded.updated_at`,
      ).run(
        session.sessionId,
        session.agentId,
        session.workspaceId ?? null,
        session.taskContext ?? null,
        taskTokens,
        taskEmbedding,
        session.ttlMs,
        session.createdAt,
        session.expiresAt,
        session.accessHistoryLimit,
        bufferConfig,
        bufferSnapshot,
        now,
      );

      // Persist access history (replace strategy: clear + reinsert the LRU head).
      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM synapse_access_history WHERE session_id = ?`).run(session.sessionId);
        const stmt = db.prepare(
          `INSERT INTO synapse_access_history (session_id, memory_id, access_count, last_accessed_at)
           VALUES (?, ?, ?, ?)`,
        );
        let ts = now;
        for (const [memoryId, count] of session.accessHistory) {
          stmt.run(session.sessionId, memoryId, count, ts);
        }
      });
      tx();
    } catch (e) {
      logger.warn("SessionStore.save failed (best-effort)", {
        sessionId: session.sessionId,
        error: (e as Error).message,
      });
    }
  }

  load(sessionId: string): AgentSession | null {
    try {
      const db = this.getDB();
      const row = db
        .prepare(`SELECT * FROM synapse_sessions WHERE session_id = ?`)
        .get(sessionId) as SessionRow | null;
      if (!row) return null;

      const taskTokens = row.task_tokens
        ? new Set<string>(JSON.parse(row.task_tokens) as string[])
        : undefined;
      let taskEmbedding: Float32Array | number[] | undefined;
      if (row.task_embedding) {
        const u8 = new Uint8Array(
          row.task_embedding.buffer,
          row.task_embedding.byteOffset,
          row.task_embedding.byteLength,
        );
        taskEmbedding = Array.from(new Float32Array(u8.buffer, u8.byteOffset, u8.length / 4));
      }

      // Rebuild accessHistory as a Map preserving insertion order (LRU recency).
      const accessRows = db
        .prepare(
          `SELECT memory_id, access_count FROM synapse_access_history WHERE session_id = ?`,
        )
        .all(sessionId) as AccessRow[];
      const accessHistory = new Map<string, number>();
      for (const r of accessRows) accessHistory.set(r.memory_id, r.access_count);

      // Buffer: best-effort snapshot is stored but the live WorkingMemoryBuffer
      // is not reconstructed here — the caller wires a fresh buffer (it refills
      // naturally as the agent works). See design.md assumption.
      const session: AgentSession = {
        sessionId: row.session_id,
        agentId: row.agent_id,
        workspaceId: row.workspace_id ?? undefined,
        taskContext: row.task_context ?? undefined,
        taskTokens,
        taskEmbedding,
        ttlMs: row.ttl_ms,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        accessHistory,
        accessHistoryLimit: row.access_history_limit,
        buffer: undefined,
      };
      return session;
    } catch (e) {
      logger.warn("SessionStore.load failed (best-effort)", {
        sessionId,
        error: (e as Error).message,
      });
      return null;
    }
  }

  delete(sessionId: string): void {
    try {
      const db = this.getDB();
      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM synapse_sessions WHERE session_id = ?`).run(sessionId);
        db.prepare(`DELETE FROM synapse_access_history WHERE session_id = ?`).run(sessionId);
      });
      tx();
    } catch (e) {
      logger.warn("SessionStore.delete failed (best-effort)", {
        sessionId,
        error: (e as Error).message,
      });
    }
  }

  recordAccess(sessionId: string, memoryId: string, count: number): void {
    try {
      const db = this.getDB();
      db.prepare(
        `INSERT INTO synapse_access_history (session_id, memory_id, access_count, last_accessed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, memory_id) DO UPDATE SET
           access_count = excluded.access_count,
           last_accessed_at = excluded.last_accessed_at`,
      ).run(sessionId, memoryId, count, Date.now());
    } catch (e) {
      logger.warn("SessionStore.recordAccess failed (best-effort)", {
        sessionId, memoryId, error: (e as Error).message,
      });
    }
  }

  /** Best-effort buffer snapshot — scalars only (token Sets are regenerable). */
  private snapshotBuffer(session: AgentSession): unknown {
    const buf = session.buffer as any;
    if (!buf || !buf.entries) return null;
    const out: any[] = [];
    for (const [id, entry] of buf.entries as Map<string, any>) {
      out.push({
        id,
        addedAt: entry.addedAt,
        lastAccessedAt: entry.lastAccessedAt,
        baselineScore: entry.baselineScore,
        result: entry.result,
      });
    }
    return { entries: out, config: buf.config };
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

let cachedStore: SessionStore | null = null;

/** Returns a SqliteSessionStore, falling back to MemorySessionStore on failure. */
export function getSessionStore(): SessionStore {
  if (cachedStore) return cachedStore;
  try {
    cachedStore = new SqliteSessionStore();
    // Probe the DB opens; if it throws, fall back.
    (cachedStore as SqliteSessionStore).save({
      sessionId: "__probe__",
      agentId: "__probe__",
      ttlMs: 1,
      createdAt: 0,
      expiresAt: 0,
      accessHistory: new Map(),
      accessHistoryLimit: 1,
    } as AgentSession);
    (cachedStore as SqliteSessionStore).delete("__probe__");
  } catch {
    logger.warn("SqliteSessionStore unavailable — using ephemeral MemorySessionStore");
    cachedStore = new MemorySessionStore();
  }
  return cachedStore;
}

/** Test hook: reset the cached store. */
export function resetSessionStore(): void {
  cachedStore = null;
}

// Re-export for the registry to build a buffer on load if desired.
export type { WorkingMemoryBufferConfig };
export { tokenize };

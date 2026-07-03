/**
 * HandoffRepository — durable persistence for cross-session handoffs
 * (Phase 6, G2).
 *
 * A handoff is a structured "pass this forward" record left by one agent
 * (session A) for a later agent (session B). It carries a summary, open
 * questions, next steps, and referenced files. The status state machine
 * is open → accepted | expired (both terminal).
 *
 * Backend: SQLite-canonical (same posture as ObservationStore /
 * SessionStore / JobStore — handoffs are agent-runtime state, not
 * analytics queried cross-project on PG). A MemoryHandoffStore (in-memory)
 * is provided as a test / fallback impl. PG parity is provided via the
 * additive Prisma `Handoff` model in packages/core/prisma/schema.prisma;
 * a future PgHandoffStore can use it. The factory never short-circuits on
 * `isPostgresEnabled()`.
 */

import { config, logger } from "@massa-th0th/shared";
import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";

// ── Types ───────────────────────────────────────────────────────────────────

export const HANDOFF_STATUSES = ["open", "accepted", "expired"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export interface HandoffRecord {
  id: string;
  projectId: string;
  sourceSessionId: string | null;
  targetAgent: string | null;
  summary: string;
  openQuestions: string[];
  nextSteps: string[];
  files: string[];
  status: HandoffStatus;
  createdAt: number;
  acceptedAt: number | null;
}

/** Internal row shape (snake_case JSON cols are stored stringified). */
interface HandoffRow {
  id: string;
  project_id: string;
  source_session_id: string | null;
  target_agent: string | null;
  summary: string;
  open_questions_json: string;
  next_steps_json: string;
  files_json: string;
  status: string;
  created_at: number;
  accepted_at: number | null;
}

function parseJsonArray(raw: string): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function rowToHandoff(r: HandoffRow): HandoffRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    sourceSessionId: r.source_session_id,
    targetAgent: r.target_agent,
    summary: r.summary,
    openQuestions: parseJsonArray(r.open_questions_json),
    nextSteps: parseJsonArray(r.next_steps_json),
    files: parseJsonArray(r.files_json),
    status: (HANDOFF_STATUSES as readonly string[]).includes(r.status)
      ? (r.status as HandoffStatus)
      : "open",
    createdAt: r.created_at,
    acceptedAt: r.accepted_at,
  };
}

// ── Store interface ─────────────────────────────────────────────────────────

export interface HandoffStore {
  insert(h: HandoffRecord): void;
  getById(id: string): HandoffRecord | null;
  listPending(projectId: string, targetAgent?: string | null): HandoffRecord[];
  setStatus(
    id: string,
    status: "accepted" | "expired",
    acceptedAt?: number,
  ): HandoffRecord | null;
  /** Test/diagnostic helper. */
  journalMode(): string;
}

// ── In-memory store (ephemeral / test fallback) ─────────────────────────────

export class MemoryHandoffStore implements HandoffStore {
  public rows: HandoffRecord[] = [];
  insert(h: HandoffRecord): void {
    this.rows.push({ ...h });
  }
  getById(id: string): HandoffRecord | null {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  listPending(projectId: string, targetAgent?: string | null): HandoffRecord[] {
    return this.rows
      .filter(
        (r) =>
          r.projectId === projectId &&
          r.status === "open" &&
          (targetAgent === undefined || targetAgent === null
            ? true
            : r.targetAgent === targetAgent || r.targetAgent === null),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({ ...r }));
  }
  setStatus(
    id: string,
    status: "accepted" | "expired",
    acceptedAt?: number,
  ): HandoffRecord | null {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    r.status = status;
    if (status === "accepted") r.acceptedAt = acceptedAt ?? Date.now();
    return { ...r };
  }
  journalMode(): string {
    return "memory";
  }
}

// ── SQLite store ────────────────────────────────────────────────────────────

export class SqliteHandoffStore implements HandoffStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    const dataDir = config.get("dataDir") as string;
    this.dbPath = dbPath ?? path.join(dataDir, "handoffs.db");
  }

  /** Lazy-open so constructing the store is side-effect-free (and testable). */
  private getDB(): Database {
    if (this.db) return this.db;
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.db = new Database(this.dbPath);
      // Cross-cutting §4: WAL + busy_timeout protect readers from contention.
      this.db.exec("PRAGMA busy_timeout = 3000");
      this.db.exec("PRAGMA journal_mode = WAL");
      this.createSchema();
      logger.info("SqliteHandoffStore initialized", { dbPath: this.dbPath });
    } catch (e) {
      logger.warn("SqliteHandoffStore init failed — handoffs will be ephemeral", {
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
      CREATE TABLE IF NOT EXISTS handoffs (
        id                   TEXT PRIMARY KEY,
        project_id           TEXT NOT NULL,
        source_session_id    TEXT,
        target_agent         TEXT,
        summary              TEXT NOT NULL DEFAULT '',
        open_questions_json  TEXT NOT NULL DEFAULT '[]',
        next_steps_json      TEXT NOT NULL DEFAULT '[]',
        files_json           TEXT NOT NULL DEFAULT '[]',
        status               TEXT NOT NULL DEFAULT 'open',
        created_at           INTEGER NOT NULL,
        accepted_at          INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_handoffs_project_status ON handoffs(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_handoffs_target_agent ON handoffs(target_agent, status);
      CREATE INDEX IF NOT EXISTS idx_handoffs_created ON handoffs(created_at DESC);
    `);
  }

  insert(h: HandoffRecord): void {
    const db = this.getDB();
    db.run(
      `INSERT INTO handoffs
        (id, project_id, source_session_id, target_agent, summary,
         open_questions_json, next_steps_json, files_json, status,
         created_at, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        h.id,
        h.projectId,
        h.sourceSessionId,
        h.targetAgent,
        h.summary,
        JSON.stringify(h.openQuestions || []),
        JSON.stringify(h.nextSteps || []),
        JSON.stringify(h.files || []),
        h.status,
        h.createdAt,
        h.acceptedAt,
      ],
    );
  }

  getById(id: string): HandoffRecord | null {
    const db = this.getDB();
    const row = db
      .query(
        `SELECT id, project_id, source_session_id, target_agent, summary,
                open_questions_json, next_steps_json, files_json, status,
                created_at, accepted_at
         FROM handoffs WHERE id = ?`,
      )
      .get(id) as HandoffRow | null;
    return row ? rowToHandoff(row) : null;
  }

  listPending(projectId: string, targetAgent?: string | null): HandoffRecord[] {
    const db = this.getDB();
    let sql: string;
    let params: (string | number | null)[];
    if (targetAgent === undefined || targetAgent === null) {
      sql = `SELECT id, project_id, source_session_id, target_agent, summary,
                    open_questions_json, next_steps_json, files_json, status,
                    created_at, accepted_at
             FROM handoffs
             WHERE project_id = ? AND status = 'open'
             ORDER BY created_at ASC`;
      params = [projectId];
    } else {
      sql = `SELECT id, project_id, source_session_id, target_agent, summary,
                    open_questions_json, next_steps_json, files_json, status,
                    created_at, accepted_at
             FROM handoffs
             WHERE project_id = ? AND status = 'open'
               AND (target_agent = ? OR target_agent IS NULL)
             ORDER BY created_at ASC`;
      params = [projectId, targetAgent];
    }
    const rows = db.query(sql).all(...params) as HandoffRow[];
    return rows.map(rowToHandoff);
  }

  setStatus(
    id: string,
    status: "accepted" | "expired",
    acceptedAt?: number,
  ): HandoffRecord | null {
    const db = this.getDB();
    if (status === "accepted") {
      const ts = acceptedAt ?? Date.now();
      db.run(
        `UPDATE handoffs SET status = 'accepted', accepted_at = ?
         WHERE id = ? AND status = 'open'`,
        [ts, id],
      );
    } else {
      db.run(
        `UPDATE handoffs SET status = 'expired'
         WHERE id = ? AND status = 'open'`,
        [id],
      );
    }
    return this.getById(id);
  }

  journalMode(): string {
    const db = this.getDB();
    const row = db.query("PRAGMA journal_mode").get() as { journal_mode?: string } | null;
    return row?.journal_mode ?? "unknown";
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

let cachedStore: HandoffStore | null = null;

/**
 * Returns a SqliteHandoffStore, falling back to MemoryHandoffStore on
 * failure. Mirrors getObservationStore() / getSessionStore() / getJobStore().
 */
export function getHandoffStore(): HandoffStore {
  if (cachedStore) return cachedStore;
  try {
    const store = new SqliteHandoffStore();
    // Probe: force the DB to open + create the schema. If it throws, fall back.
    store.journalMode();
    cachedStore = store;
  } catch {
    logger.warn("SqliteHandoffStore unavailable — using ephemeral MemoryHandoffStore");
    cachedStore = new MemoryHandoffStore();
  }
  return cachedStore;
}

/** Test hook: reset the cached store so a test can inject a fresh instance. */
export function resetHandoffStore(): void {
  cachedStore = null;
}

/** Generate a handoff id. Exposed for deterministic tests. */
export function newHandoffId(now: number = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `handoff_${now}_${rand}`;
}

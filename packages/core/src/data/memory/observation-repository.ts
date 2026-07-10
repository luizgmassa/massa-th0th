/**
 * ObservationRepository — durable persistence for passive lifecycle captures
 * (Phase 3, G1).
 *
 * Observations are agent-runtime telemetry produced by the hook-ingestion
 * pipeline (session-start, user-prompt, pre/post-tool-use, pre-compact,
 * session-end). They are the raw feed the consolidation bridge summarizes into
 * structured memories via the Phase-1 llm-client + consolidator.
 *
 * Backend: SQLite-canonical (same posture as SessionStore / JobStore —
 * observations are high-write runtime state, not analytics queried
 * cross-project on PG). A MemoryObservationStore (no-op) is provided as a test
 * / fallback impl. PG parity is provided via the additive Prisma `Observation`
 * model in packages/core/prisma/schema.prisma; a future PgObservationStore can
 * use it. The factory never short-circuits on `isPostgresEnabled()`.
 */

import { config, logger } from "@massa-th0th/shared";
import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * The six lifecycle event kinds accepted by the hook ingestion pipeline.
 * These are the raw hook trigger names (backward-compatible — never remove).
 */
export const LIFECYCLE_EVENTS = [
  "session-start",
  "user-prompt",
  "pre-tool-use",
  "post-tool-use",
  "pre-compact",
  "session-end",
] as const;
export type LifecycleEventKind = (typeof LIFECYCLE_EVENTS)[number];

/**
 * Expanded observation category taxonomy (Phase 3, C1).
 *
 * While `source` is the raw hook trigger (one of LIFECYCLE_EVENTS), `category`
 * is the *derived* semantic classification of what the observation captures.
 * Ported fresh (not copied) from context-mode's ~30-category set. The extractor
 * derives the category from (source, payload) — see ObservationExtractor.
 *
 * The 6 lifecycle kinds map to categories via extraction; legacy observations
 * without a category fall back to "lifecycle-raw".
 */
export const OBSERVATION_CATEGORIES = [
  // File / code activity
  "files-read",
  "files-written",
  "file-search",
  "tool-calls",
  // Version control
  "git-changes",
  // Task / plan state
  "tasks",
  "plan-changes",
  // Errors & resolution
  "errors",
  "error-resolution",
  "iteration-loop",
  // Decisions & constraints
  "decisions",
  "constraints",
  "rejected-approaches",
  // User interaction
  "user-prompts",
  "intent",
  "goal",
  "role",
  "blocked-on",
  // Rules & skills
  "rules",
  "skills-invoked",
  "subagents-spawned",
  // Environment
  "env-changes",
  "cwd-changes",
  "session-settings",
  // External references & data
  "external-refs",
  "web-fetch",
  "searches",
  // Memory & compaction
  "memories-stored",
  "compaction-snapshots",
  "mcp-calls",
  // Agent telemetry
  "agent-findings",
  "cost-telemetry",
  // Fallback for legacy/uncategorized observations
  "lifecycle-raw",
] as const;
export type ObservationCategory = (typeof OBSERVATION_CATEGORIES)[number];

export interface Observation {
  id: string;
  projectId: string;
  sessionId: string | null;
  source: LifecycleEventKind;
  /**
   * Derived semantic category (Phase 3, C1). Optional for backward compat:
   * legacy rows / stores that pre-date the column fall back to "lifecycle-raw".
   */
  category?: ObservationCategory;
  /** Stringified JSON payload (size-capped by the service before insert). */
  payloadJson: string;
  importance: number;
  createdAt: number;
}

export interface ObservationRow {
  id: string;
  project_id: string;
  session_id: string | null;
  source: string;
  category: string | null;
  payload_json: string;
  importance: number;
  created_at: number;
}

function rowToObservation(r: ObservationRow): Observation {
  return {
    id: r.id,
    projectId: r.project_id,
    sessionId: r.session_id,
    source: r.source as LifecycleEventKind,
    category: (r.category as ObservationCategory | null) ?? undefined,
    payloadJson: r.payload_json,
    importance: r.importance,
    createdAt: r.created_at,
  };
}

// ── Store interface ─────────────────────────────────────────────────────────

export interface ObservationStore {
  insert(obs: Observation): void;
  listRecent(projectId: string, limit: number): Observation[];
  /** List observations for a session (newest-first). Phase 3 C1 — for snapshots. */
  listBySession(sessionId: string, limit: number): Observation[];
  countByProject(projectId: string): number;
  /** Test/diagnostic helper. */
  journalMode(): string;
}

// ── No-op store (ephemeral / test fallback) ─────────────────────────────────

export class MemoryObservationStore implements ObservationStore {
  public rows: Observation[] = [];
  insert(obs: Observation): void {
    this.rows.push(obs);
  }
  listRecent(projectId: string, limit: number): Observation[] {
    return this.rows
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
  listBySession(sessionId: string, limit: number): Observation[] {
    return this.rows
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
  countByProject(projectId: string): number {
    return this.rows.filter((r) => r.projectId === projectId).length;
  }
  journalMode(): string {
    return "memory";
  }
}

// ── SQLite store ────────────────────────────────────────────────────────────

export class SqliteObservationStore implements ObservationStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    const dataDir = config.get("dataDir") as string;
    this.dbPath = dbPath ?? path.join(dataDir, "observations.db");
  }

  /** Lazy-open so constructing the store is side-effect-free (and testable). */
  private getDB(): Database {
    if (this.db) return this.db;
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.db = new Database(this.dbPath);
      // Cross-cutting §4: WAL + busy_timeout protect readers from the
      // fire-hose and from SQLITE_BUSY under contention.
      this.db.exec("PRAGMA busy_timeout = 3000");
      this.db.exec("PRAGMA journal_mode = WAL");
      this.createSchema();
      logger.info("SqliteObservationStore initialized", { dbPath: this.dbPath });
    } catch (e) {
      logger.warn("SqliteObservationStore init failed — observations will be ephemeral", {
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
      CREATE TABLE IF NOT EXISTS observations (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL,
        session_id   TEXT,
        source       TEXT NOT NULL,
        category     TEXT,
        payload_json TEXT NOT NULL,
        importance   REAL NOT NULL,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_obs_project_created ON observations(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_obs_session ON observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_obs_session_created ON observations(session_id, created_at DESC);
    `);
    // Migration: add category column if missing (existing DBs predating C1).
    try {
      const cols = db.query("PRAGMA table_info(observations)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "category")) {
        db.exec("ALTER TABLE observations ADD COLUMN category TEXT");
      }
    } catch {
      // PRAGMA table_info is safe; ignore any edge case.
    }
  }

  insert(obs: Observation): void {
    const db = this.getDB();
    db.run(
      `INSERT INTO observations (id, project_id, session_id, source, category, payload_json, importance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        obs.id,
        obs.projectId,
        obs.sessionId,
        obs.source,
        obs.category ?? null,
        obs.payloadJson,
        obs.importance,
        obs.createdAt,
      ],
    );
  }

  listRecent(projectId: string, limit: number): Observation[] {
    const db = this.getDB();
    const rows = db
      .query(
        `SELECT id, project_id, session_id, source, category, payload_json, importance, created_at
         FROM observations
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(projectId, Math.max(0, Math.floor(limit))) as ObservationRow[];
    return rows.map(rowToObservation);
  }

  listBySession(sessionId: string, limit: number): Observation[] {
    const db = this.getDB();
    const rows = db
      .query(
        `SELECT id, project_id, session_id, source, category, payload_json, importance, created_at
         FROM observations
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(sessionId, Math.max(0, Math.floor(limit))) as ObservationRow[];
    return rows.map(rowToObservation);
  }

  countByProject(projectId: string): number {
    const db = this.getDB();
    const row = db
      .query("SELECT COUNT(*) AS n FROM observations WHERE project_id = ?")
      .get(projectId) as { n: number } | null;
    return row?.n ?? 0;
  }

  journalMode(): string {
    const db = this.getDB();
    const row = db.query("PRAGMA journal_mode").get() as { journal_mode?: string } | null;
    return row?.journal_mode ?? "unknown";
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

let cachedStore: ObservationStore | null = null;

/**
 * Returns a SqliteObservationStore, falling back to MemoryObservationStore on
 * failure. Mirrors getSessionStore() / getJobStore().
 */
export function getObservationStore(): ObservationStore {
  if (cachedStore) return cachedStore;
  try {
    const store = new SqliteObservationStore();
    // Probe: force the DB to open + create the schema. If it throws, fall back.
    store.countByProject("__probe__");
    cachedStore = store;
  } catch {
    logger.warn("SqliteObservationStore unavailable — using ephemeral MemoryObservationStore");
    cachedStore = new MemoryObservationStore();
  }
  return cachedStore;
}

/** Test hook: reset the cached store so a test can inject a fresh instance. */
export function resetObservationStore(): void {
  cachedStore = null;
}

/** Generate an observation id. Exposed for deterministic tests. */
export function newObservationId(now: number = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `obs_${now}_${rand}`;
}

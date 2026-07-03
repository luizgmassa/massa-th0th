/**
 * ProposalRepository — durable persistence for auto-improvement proposals
 * (Phase 5, G7).
 *
 * A proposal is a pending memory edit suggested by the auto-improvement
 * loop's pattern detection (repeated queries, frequently-referenced files,
 * common fixes). The status state machine is pending → approved | rejected
 * (both terminal). Approved proposals are applied to the memory store;
 * rejected proposals are retained for the audit trail.
 *
 * Backend: SQLite-canonical (same posture as HandoffStore /
 * ObservationStore / SessionStore / JobStore — proposals are agent-runtime
 * state, not analytics queried cross-project on PG). A
 * MemoryProposalStore (in-memory) is provided as a test / fallback impl.
 * PG parity is provided via the additive Prisma `Proposal` model in
 * packages/core/prisma/schema.prisma; a future PgProposalStore can use it.
 * The factory never short-circuits on `isPostgresEnabled()`.
 */

import { config, logger } from "@massa-th0th/shared";
import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";

// ── Types ───────────────────────────────────────────────────────────────────

export const PROPOSAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_KINDS = [
  "memory.create",
  "memory.update",
  "memory.tag",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/**
 * Typed edit payload. The shape is intentionally a small union so the
 * apply step can dispatch on `kind` without re-parsing.
 */
export interface CreateMemoryPayload {
  content: string;
  type?: string; // MemoryType literal; defaults applied by the job if absent
  level?: number; // MemoryLevel value; defaults applied by the job if absent
  importance?: number;
  tags?: string[];
}

export interface UpdateMemoryPayload {
  content?: string;
  importance?: number;
  tags?: string[];
}

export interface TagMemoryPayload {
  tags: string[]; // merged into the target memory's tags
}

export type ProposalPayload = CreateMemoryPayload | UpdateMemoryPayload | TagMemoryPayload;

export interface ProposalRecord {
  id: string;
  projectId: string;
  kind: ProposalKind;
  targetMemoryId: string | null;
  payload: ProposalPayload;
  rationale: string;
  status: ProposalStatus;
  createdAt: number;
  decidedAt: number | null;
}

/** Internal row shape. */
interface ProposalRow {
  id: string;
  project_id: string;
  kind: string;
  target_memory_id: string | null;
  payload_json: string;
  rationale: string;
  status: string;
  created_at: number;
  decided_at: number | null;
}

function parsePayload(raw: string): ProposalPayload {
  if (!raw) return { content: "" } as CreateMemoryPayload;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object") return v as ProposalPayload;
  } catch {
    /* fall through */
  }
  return { content: "" } as CreateMemoryPayload;
}

function rowToProposal(r: ProposalRow): ProposalRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: (PROPOSAL_KINDS as readonly string[]).includes(r.kind)
      ? (r.kind as ProposalKind)
      : "memory.create",
    targetMemoryId: r.target_memory_id,
    payload: parsePayload(r.payload_json),
    rationale: r.rationale ?? "",
    status: (PROPOSAL_STATUSES as readonly string[]).includes(r.status)
      ? (r.status as ProposalStatus)
      : "pending",
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  };
}

// ── Store interface ─────────────────────────────────────────────────────────

export interface ProposalStore {
  insert(p: ProposalRecord): void;
  getById(id: string): ProposalRecord | null;
  listPending(projectId: string): ProposalRecord[];
  setStatus(
    id: string,
    status: "approved" | "rejected",
    decidedAt?: number,
  ): ProposalRecord | null;
  /** Test/diagnostic helper. */
  journalMode(): string;
}

// ── In-memory store (ephemeral / test fallback) ─────────────────────────────

export class MemoryProposalStore implements ProposalStore {
  public rows: ProposalRecord[] = [];
  insert(p: ProposalRecord): void {
    this.rows.push({ ...p });
  }
  getById(id: string): ProposalRecord | null {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  listPending(projectId: string): ProposalRecord[] {
    return this.rows
      .filter((r) => r.projectId === projectId && r.status === "pending")
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ ...r }));
  }
  setStatus(
    id: string,
    status: "approved" | "rejected",
    decidedAt?: number,
  ): ProposalRecord | null {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    r.status = status;
    r.decidedAt = decidedAt ?? Date.now();
    return { ...r };
  }
  journalMode(): string {
    return "memory";
  }
}

// ── SQLite store ────────────────────────────────────────────────────────────

export class SqliteProposalStore implements ProposalStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    const dataDir = config.get("dataDir") as string;
    this.dbPath = dbPath ?? path.join(dataDir, "proposals.db");
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
      logger.info("SqliteProposalStore initialized", { dbPath: this.dbPath });
    } catch (e) {
      logger.warn("SqliteProposalStore init failed — proposals will be ephemeral", {
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
      CREATE TABLE IF NOT EXISTS proposals (
        id               TEXT PRIMARY KEY,
        project_id       TEXT NOT NULL,
        kind             TEXT NOT NULL,
        target_memory_id TEXT,
        payload_json     TEXT NOT NULL,
        rationale        TEXT NOT NULL DEFAULT '',
        status           TEXT NOT NULL DEFAULT 'pending',
        created_at       INTEGER NOT NULL,
        decided_at       INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_proposals_project_status ON proposals(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at DESC);
    `);
  }

  insert(p: ProposalRecord): void {
    const db = this.getDB();
    db.run(
      `INSERT INTO proposals
        (id, project_id, kind, target_memory_id, payload_json, rationale,
         status, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.id,
        p.projectId,
        p.kind,
        p.targetMemoryId,
        JSON.stringify(p.payload ?? {}),
        p.rationale ?? "",
        p.status,
        p.createdAt,
        p.decidedAt,
      ],
    );
  }

  getById(id: string): ProposalRecord | null {
    const db = this.getDB();
    const row = db
      .query(
        `SELECT id, project_id, kind, target_memory_id, payload_json, rationale,
                status, created_at, decided_at
         FROM proposals WHERE id = ?`,
      )
      .get(id) as ProposalRow | null;
    return row ? rowToProposal(row) : null;
  }

  listPending(projectId: string): ProposalRecord[] {
    const db = this.getDB();
    const rows = db
      .query(
        `SELECT id, project_id, kind, target_memory_id, payload_json, rationale,
                status, created_at, decided_at
         FROM proposals
         WHERE project_id = ? AND status = 'pending'
         ORDER BY created_at DESC`,
      )
      .all(projectId) as ProposalRow[];
    return rows.map(rowToProposal);
  }

  setStatus(
    id: string,
    status: "approved" | "rejected",
    decidedAt?: number,
  ): ProposalRecord | null {
    const db = this.getDB();
    const ts = decidedAt ?? Date.now();
    db.run(
      `UPDATE proposals SET status = ?, decided_at = ?
       WHERE id = ? AND status = 'pending'`,
      [status, ts, id],
    );
    return this.getById(id);
  }

  journalMode(): string {
    const db = this.getDB();
    const row = db.query("PRAGMA journal_mode").get() as { journal_mode?: string } | null;
    return row?.journal_mode ?? "unknown";
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

let cachedStore: ProposalStore | null = null;

/**
 * Returns a SqliteProposalStore, falling back to MemoryProposalStore on
 * failure. Mirrors getHandoffStore() / getObservationStore().
 */
export function getProposalStore(): ProposalStore {
  if (cachedStore) return cachedStore;
  try {
    const store = new SqliteProposalStore();
    // Probe: force the DB to open + create the schema. If it throws, fall back.
    store.journalMode();
    cachedStore = store;
  } catch {
    logger.warn("SqliteProposalStore unavailable — using ephemeral MemoryProposalStore");
    cachedStore = new MemoryProposalStore();
  }
  return cachedStore;
}

/** Test hook: reset the cached store so a test can inject a fresh instance. */
export function resetProposalStore(): void {
  cachedStore = null;
}

/** Generate a proposal id. Exposed for deterministic tests. */
export function newProposalId(now: number = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `proposal_${now}_${rand}`;
}

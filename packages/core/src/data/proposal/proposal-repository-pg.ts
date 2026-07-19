/** PostgreSQL implementation of the durable asynchronous ProposalStore contract. */

import type { PrismaClient } from "../../generated/prisma/index.js";
import { getPrismaClient } from "../../services/query/prisma-client.js";
import {
  searchBackendUnavailable,
  storeCorruption,
} from "../../services/search/search-diagnostics.js";
import {
  PROPOSAL_KINDS,
  PROPOSAL_STATUSES,
  type ProposalKind,
  type ProposalPayload,
  type ProposalRecord,
  type ProposalStatus,
  type ProposalStore,
} from "./proposal-contract.js";

interface PgProposalRow {
  id: string;
  project_id: string;
  kind: string;
  target_memory_id: string | null;
  payload_json: string;
  rationale: string;
  status: string;
  created_at: Date;
  decided_at: Date | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parsePayload(raw: string, kind: ProposalKind): ProposalPayload {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw storeCorruption("proposal.payload_json", error);
  }
  if (!isRecord(value)) {
    throw storeCorruption("proposal.payload_json", new TypeError("expected object"));
  }

  let valid = false;
  if (kind === "memory.create") {
    valid =
      validKeys(value, ["content", "type", "level", "importance", "tags"]) &&
      typeof value.content === "string" &&
      (value.type === undefined || typeof value.type === "string") &&
      (value.level === undefined || typeof value.level === "number") &&
      (value.importance === undefined || typeof value.importance === "number") &&
      (value.tags === undefined || stringArray(value.tags));
  } else if (kind === "memory.update") {
    valid =
      validKeys(value, ["content", "importance", "tags"]) &&
      Object.keys(value).length > 0 &&
      (value.content === undefined || typeof value.content === "string") &&
      (value.importance === undefined || typeof value.importance === "number") &&
      (value.tags === undefined || stringArray(value.tags));
  } else {
    valid = validKeys(value, ["tags"]) && stringArray(value.tags);
  }
  if (!valid) {
    throw storeCorruption("proposal.payload_json", new TypeError("invalid proposal payload"));
  }
  return value as ProposalPayload;
}

function timestamp(value: unknown, field: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw storeCorruption(`proposal.${field}`, new TypeError("expected valid date"));
  }
  return value.getTime();
}

function toRecord(row: PgProposalRow): ProposalRecord {
  if (!(PROPOSAL_KINDS as readonly string[]).includes(row.kind)) {
    throw storeCorruption("proposal.kind", new TypeError("invalid kind"));
  }
  if (!(PROPOSAL_STATUSES as readonly string[]).includes(row.status)) {
    throw storeCorruption("proposal.status", new TypeError("invalid status"));
  }
  const decidedAt = timestamp(row.decided_at, "decided_at", true);
  if ((row.status === "pending") !== (decidedAt === null)) {
    throw storeCorruption("proposal.decided_at", new TypeError("status/date mismatch"));
  }
  const kind = row.kind as ProposalKind;
  return {
    id: row.id,
    projectId: row.project_id,
    kind,
    targetMemoryId: row.target_memory_id,
    payload: parsePayload(row.payload_json, kind),
    rationale: row.rationale,
    status: row.status as ProposalStatus,
    createdAt: timestamp(row.created_at, "created_at")!,
    decidedAt,
  };
}

export class PgProposalStore implements ProposalStore {
  private prisma!: PrismaClient;
  private mirror = new Map<string, ProposalRecord>();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  constructor(client?: PrismaClient) {
    if (client) this.prisma = client;
  }

  private getClient(): PrismaClient {
    if (!this.prisma) this.prisma = getPrismaClient();
    return this.prisma;
  }

  private ensureHydrated(): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    if (this.hydrating) return this.hydrating;
    this.hydrating = (async () => {
      try {
        let rows: PgProposalRow[];
        try {
          rows = await this.getClient().$queryRaw<PgProposalRow[]>`
            SELECT id, project_id, kind, target_memory_id, payload_json,
                   rationale, status, created_at, decided_at FROM proposals`;
        } catch (error) {
          throw searchBackendUnavailable("proposal_store", error);
        }
        this.mirror = new Map(rows.map((row) => [row.id, toRecord(row)]));
        this.hydrated = true;
      } finally {
        this.hydrating = null;
      }
    })();
    return this.hydrating;
  }

  async insert(record: ProposalRecord): Promise<void> {
    await this.ensureHydrated();
    const captured = structuredClone(record);
    try {
      await this.getClient().$executeRaw`
        INSERT INTO proposals (
          id, project_id, kind, target_memory_id, payload_json, rationale,
          status, created_at, decided_at
        ) VALUES (
          ${captured.id}, ${captured.projectId}, ${captured.kind},
          ${captured.targetMemoryId}, ${JSON.stringify(captured.payload)},
          ${captured.rationale}, ${captured.status}, ${new Date(captured.createdAt)},
          ${captured.decidedAt === null ? null : new Date(captured.decidedAt)}
        )`;
    } catch (error) {
      throw searchBackendUnavailable("proposal_store", error);
    }
    this.mirror.set(record.id, captured);
  }

  async getById(id: string): Promise<ProposalRecord | null> {
    await this.ensureHydrated();
    const record = this.mirror.get(id);
    return record ? structuredClone(record) : null;
  }

  async listPending(projectId: string): Promise<ProposalRecord[]> {
    await this.ensureHydrated();
    return [...this.mirror.values()]
      .filter((record) => record.projectId === projectId && record.status === "pending")
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((record) => structuredClone(record));
  }

  async setStatus(
    id: string,
    status: "approved" | "rejected",
    decidedAt?: number,
  ): Promise<ProposalRecord | null> {
    await this.ensureHydrated();
    const current = this.mirror.get(id);
    if (!current) return null;
    if (current.status !== "pending") return structuredClone(current);

    let rows: PgProposalRow[];
    try {
      rows = await this.getClient().$queryRaw<PgProposalRow[]>`
        UPDATE proposals
        SET status = ${status}, decided_at = ${new Date(decidedAt ?? Date.now())}
        WHERE id = ${id} AND status = 'pending'
        RETURNING id, project_id, kind, target_memory_id, payload_json,
                  rationale, status, created_at, decided_at`;
      if (!rows[0]) {
        rows = await this.getClient().$queryRaw<PgProposalRow[]>`
          SELECT id, project_id, kind, target_memory_id, payload_json,
                 rationale, status, created_at, decided_at
          FROM proposals WHERE id = ${id}`;
      }
    } catch (error) {
      throw searchBackendUnavailable("proposal_store", error);
    }
    if (!rows[0]) return null;
    const persisted = toRecord(rows[0]);
    this.mirror.set(id, persisted);
    return structuredClone(persisted);
  }

  async journalMode(): Promise<string> {
    await this.ensureHydrated();
    return "postgres";
  }

  async __hydrate(): Promise<void> {
    await this.ensureHydrated();
  }

  async __drain(): Promise<void> {
    await this.ensureHydrated();
  }
}

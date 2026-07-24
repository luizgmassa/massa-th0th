/**
 * OperationLogRepository — PostgreSQL implementation (raw SQL).
 *
 * Raw SQL mirrors the rest of the data layer (memory/keyword/symbol repos)
 * to avoid the Prisma 7.7.0 + @prisma/adapter-pg + Bun isObjectEnumValue
 * incompatibility documented in `memory-repository-pg.ts`.
 *
 * FAIL-SAFE CONTRACT: `recordOperation` MUST NEVER throw back at a
 * destructive call site. An audit-log failure (DB down, malformed JSON,
 * pool exhaustion, …) is logged and swallowed so the destructive op the
 * row describes still completes. Without this guarantee, a broken audit
 * table would block every reset/purge — which defeats the purpose of an
 * audit trail that must always let the primary action run.
 */

import { logger } from "@massa-ai/shared";
import type { PrismaClient } from "../../generated/prisma/index.js";
import { getPrismaClient } from "../../services/query/prisma-client.js";
import { UNKNOWN_ACTOR } from "./operation-log-contract.js";
import type {
  OperationLogRepository,
  OperationLogRow,
  RecordOperationInput,
} from "./operation-log-contract.js";

interface RawOperationLogRow {
  id: bigint | number;
  occurred_at: Date;
  actor_type: string;
  actor_id: string;
  project_id: string | null;
  op: string;
  scope: unknown;
  result: string;
  meta: unknown;
  error: string | null;
}

function toRow(row: RawOperationLogRow): OperationLogRow {
  const scope =
    row.scope && typeof row.scope === "object"
      ? (row.scope as Record<string, unknown>)
      : {};
  const meta =
    row.meta && typeof row.meta === "object"
      ? (row.meta as Record<string, unknown>)
      : {};
  const occurredAt =
    row.occurred_at instanceof Date
      ? row.occurred_at.getTime()
      : Number(row.occurred_at);
  return {
    id: String(row.id),
    occurredAt,
    actorType: row.actor_type,
    actorId: row.actor_id,
    projectId: row.project_id,
    op: row.op,
    scope,
    result: row.result as OperationLogRow["result"],
    meta,
    error: row.error,
  };
}

function scopeJson(scope: RecordOperationInput["scope"]): string {
  try {
    return JSON.stringify(scope ?? {});
  } catch {
    return "{}";
  }
}

function metaJson(meta: RecordOperationInput["meta"]): string {
  try {
    return JSON.stringify(meta ?? {});
  } catch {
    return "{}";
  }
}

export class OperationLogRepositoryPg implements OperationLogRepository {
  private static instance: OperationLogRepositoryPg | null = null;
  private prisma!: PrismaClient;

  private constructor() {
    logger.info("OperationLogRepositoryPg initialized (PostgreSQL, raw SQL)");
  }

  static getInstance(): OperationLogRepositoryPg {
    if (!OperationLogRepositoryPg.instance) {
      OperationLogRepositoryPg.instance = new OperationLogRepositoryPg();
    }
    return OperationLogRepositoryPg.instance;
  }

  /** Test-only singleton reset. */
  static resetInstance(): void {
    OperationLogRepositoryPg.instance = null;
  }

  private getClient(): PrismaClient {
    if (!this.prisma) this.prisma = getPrismaClient();
    return this.prisma;
  }

  /**
   * Insert one audit row. Fail-safe: any error is logged and swallowed so
   * the destructive caller always proceeds. The returned promise resolves
   * (never rejects) — callers can `await` it for ordering without a
   * try/catch, or fire-and-forget it.
   */
  async recordOperation(input: RecordOperationInput): Promise<void> {
    const actorType = input.actorType ?? UNKNOWN_ACTOR.actorType;
    const actorId = input.actorId ?? UNKNOWN_ACTOR.actorId;
    const projectId = input.projectId ?? null;
    const scope = scopeJson(input.scope);
    const meta = metaJson(input.meta);
    const error = input.error ?? null;

    try {
      await this.getClient().$executeRaw`
        INSERT INTO operation_log (
          actor_type, actor_id, project_id, op, scope, result, meta, error
        ) VALUES (
          ${actorType}, ${actorId}, ${projectId}, ${input.op},
          ${scope}::jsonb, ${input.result}, ${meta}::jsonb, ${error}
        )
      `;
    } catch (err) {
      // FAIL-SAFE: never propagate. The destructive op that triggered this
      // audit row MUST complete regardless of audit-table health.
      logger.warn("OperationLog: recordOperation failed (best-effort, swallowed)", {
        op: input.op,
        projectId,
        result: input.result,
        error: (err as Error).message,
      });
    }
  }

  /** Read path — most-recent-first. Throws on DB error (read-only callers). */
  async listByProject(projectId: string, limit = 100): Promise<OperationLogRow[]> {
    const rows = await this.getClient().$queryRaw<RawOperationLogRow[]>`
      SELECT id, occurred_at, actor_type, actor_id, project_id,
             op, scope, result, meta, error
      FROM operation_log
      WHERE project_id = ${projectId}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
    return rows.map(toRow);
  }
}

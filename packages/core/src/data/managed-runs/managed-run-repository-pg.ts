/**
 * Managed Run Repository — PostgreSQL CAS implementation.
 *
 * Wave 5 FR-08 / FR-09 / FR-10 / FR-20 / AD-W5-004 / AD-W5-013 / AD-W5-014.
 *
 * Mirrors the proven graph_generations lease pattern (Wave 3 MLTS-011 /
 * `graph-generation-repository-pg.ts`) but for the standalone
 * `managed_runs` table. The lease is a process-writer concept (indexing run),
 * decoupled from the immutable graph_generation snapshot (AD-W5-004).
 *
 * Reaper (AD-W5-013): every begin() first UPDATEs expired active rows to
 * 'aborted' inside the same transaction as the INSERT. This is load-bearing
 * for the partial UNIQUE index `managed_runs_one_active_per_project_kind`
 * (project_id, run_kind WHERE status='active'): without the reaper, a stale-
 * but-active row orphaned by SIGKILL would block a new acquire forever. The
 * reaper clears that row first, then the INSERT wins the partial unique race.
 * PostgreSQL rejects `clock_timestamp()` in index predicates (not IMMUTABLE)
 * so the partial unique is `status='active'` only — the time check is applied
 * at query time in `getActive()` (AD-W5-014).
 *
 * getActive pin (AD-W5-014): `WHERE status='active' AND lease_expires_at >
 * clock_timestamp() ORDER BY lease_expires_at DESC LIMIT 1` exactly. A stale-
 * but-active row is NOT returned; the caller observes "no live run" and the
 * next begin() reaper cleans it up.
 *
 * Race contract (AC-22): two concurrent begin() calls — exactly one returns
 * `acquired`, the other returns `busy` with the winner's runId. The
 * INSERT uses `ON CONFLICT (project_id, run_kind) WHERE status='active' DO
 * NOTHING` so the loser is a clean no-op (0 rows returned) rather than a
 * unique-violation statement-abort — Prisma's pg adapter cannot ROLLBACK TO
 * SAVEPOINT transparently, so ON CONFLICT DO NOTHING keeps the transaction
 * clean. The loser then SELECTs the winner's row to surface `busy`. No 500,
 * no `could not serialize access`.
 */

import { randomUUID } from "node:crypto";
import { getPrismaClient } from "../../services/query/prisma-client.js";
import type {
  AbortManagedRunOutcome,
  ActiveManagedRun,
  BeginManagedRunInput,
  BeginManagedRunOutcome,
  CompleteManagedRunOutcome,
  FileCursor,
  HeartbeatManagedRunOutcome,
  ManagedRunKind,
  ManagedRunLease,
  ManagedRunRepository,
} from "./managed-run-contract.js";

const DEFAULT_LEASE_TTL_MS = 90_000; // FR-09: 90s expiry.
const MIN_LEASE_TTL_MS = 1_000; // 1s floor — anything shorter is a misconfig.
const MAX_LEASE_TTL_MS = 300_000; // 5min ceiling (matches graph-generation).
const HEARTBEAT_TTL_MS = 90_000; // Each heartbeat renewal window.

const MAX_PROJECT_ID = 512;
const MAX_EVENT_ID = 2_000;
const MAX_CONTENT_HASH = 2_000;
const MAX_LEASE_TOKEN = 512;

type TransactionClient = Parameters<Parameters<ReturnType<typeof getPrismaClient>["$transaction"]>[0]>[0];

interface ManagedRunRow {
  id: bigint;
  project_id: string;
  run_kind: string;
  event_id: string;
  content_hash: string | null;
  file_cursor: FileCursor | null;
  status: string;
  lease_token: string | null;
  lease_expires_at: Date | null;
  heartbeat_at: Date | null;
  created_at: bigint;
  completed_at: bigint | null;
}

function boundedText(value: string, label: string, max: number): string {
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > max || normalized.includes("\0")) {
    throw new TypeError(`${label} must contain -${max} safe characters`);
  }
  return normalized;
}

function validateTtl(ttlMs: number | undefined): number {
  const ttl = ttlMs ?? DEFAULT_LEASE_TTL_MS;
  if (!Number.isInteger(ttl) || ttl < MIN_LEASE_TTL_MS || ttl > MAX_LEASE_TTL_MS) {
    throw new RangeError(`leaseTtlMs must be ${MIN_LEASE_TTL_MS}-${MAX_LEASE_TTL_MS}`);
  }
  return ttl;
}

function validateBegin(input: BeginManagedRunInput): {
  projectId: string;
  runKind: ManagedRunKind;
  eventId: string;
  contentHash: string | null;
  leaseTtlMs: number;
} {
  const projectId = boundedText(input.projectId, "projectId", MAX_PROJECT_ID);
  const eventId = boundedText(input.eventId, "eventId", MAX_EVENT_ID);
  const contentHash = input.contentHash !== undefined
    ? boundedText(input.contentHash, "contentHash", MAX_CONTENT_HASH)
    : null;
  const leaseTtlMs = validateTtl(input.leaseTtlMs);
  return { projectId, runKind: input.runKind, eventId, contentHash, leaseTtlMs };
}

function toLease(row: ManagedRunRow, leaseToken: string): ManagedRunLease {
  return {
    runId: row.id.toString(),
    projectId: row.project_id,
    runKind: row.run_kind as ManagedRunKind,
    leaseToken,
    leaseExpiresAt: row.lease_expires_at!.getTime(),
    eventId: row.event_id,
    ...(row.content_hash !== null && { contentHash: row.content_hash }),
  };
}

function toActive(row: ManagedRunRow): ActiveManagedRun {
  return {
    runId: row.id.toString(),
    projectId: row.project_id,
    runKind: row.run_kind as ManagedRunKind,
    eventId: row.event_id,
    contentHash: row.content_hash,
    fileCursor: row.file_cursor,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at!.getTime(),
    heartbeatAt: row.heartbeat_at?.getTime() ?? null,
    createdAt: Number(row.created_at),
  };
}

export class ManagedRunRepositoryPg implements ManagedRunRepository {
  private static instance: ManagedRunRepositoryPg | null = null;

  static getInstance(): ManagedRunRepositoryPg {
    return this.instance ??= new ManagedRunRepositoryPg();
  }

  /** @internal test seam for injecting a mock client. */
  static _resetForTesting(): void { this.instance = null; }

  async begin(rawInput: BeginManagedRunInput): Promise<BeginManagedRunOutcome> {
    const input = validateBegin(rawInput);
    const leaseToken = randomUUID();
    return getPrismaClient().$transaction(async (tx) => {
      // ── Reaper (AD-W5-013): flip expired active rows for this (project, kind) to 'aborted'.
      // Best-effort: if zero rows match, this is a no-op. Runs inside the same
      // transaction as the INSERT so the partial UNIQUE on active rows is
      // satisfiable for the new row.
      await tx.$executeRaw`
        UPDATE managed_runs
        SET status = 'aborted', completed_at = ${Date.now()}
        WHERE project_id = ${input.projectId}
          AND run_kind = ${input.runKind}
          AND status = 'active'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at <= clock_timestamp()
      `;

      // ── Look for an existing live active row (AD-W5-014 pin). If one exists
      // and is still live, surface `busy` without attempting the INSERT. This
      // is the fast path: a loser that ran after the winner's INSERT commits
      // observes the live row and returns `busy` without touching the
      // partial unique.
      const live = await tx.$queryRaw<ManagedRunRow[]>`
        SELECT id, project_id, run_kind, event_id, content_hash, file_cursor,
               status, lease_token, lease_expires_at, heartbeat_at,
               created_at, completed_at
        FROM managed_runs
        WHERE project_id = ${input.projectId}
          AND run_kind = ${input.runKind}
          AND status = 'active'
          AND lease_expires_at > clock_timestamp()
        ORDER BY lease_expires_at DESC
        LIMIT 1
      `;
      if (live[0]) {
        return {
          status: "busy",
          activeRunId: live[0].id.toString(),
          leaseExpiresAt: live[0].lease_expires_at!.getTime(),
        };
      }

      // ── Acquire: INSERT with ON CONFLICT DO NOTHING on the partial unique
      // (project_id, run_kind) WHERE status='active'. This is the race-decider:
      // if a concurrent begin() won between our reaper and our INSERT, this
      // INSERT is a no-op (0 rows returned) and we fall through to SELECT the
      // winner. ON CONFLICT avoids the unique-violation statement-abort that
      // would otherwise poison the transaction (Prisma cannot ROLLBACK TO
      // SAVEPOINT transparently across the adapter). AC-22: no 500, no
      // `could not serialize access`.
      const created_at = Date.now();
      const inserted = await tx.$queryRaw<ManagedRunRow[]>`
        INSERT INTO managed_runs (
          project_id, run_kind, event_id, content_hash, file_cursor,
          status, lease_token, lease_expires_at, heartbeat_at,
          created_at, completed_at
        ) VALUES (
          ${input.projectId}, ${input.runKind}, ${input.eventId}, ${input.contentHash}, NULL,
          'active', ${leaseToken},
          clock_timestamp() + (${input.leaseTtlMs} * interval '1 millisecond'),
          clock_timestamp(), ${created_at}, NULL
        )
        ON CONFLICT (project_id, run_kind) WHERE status = 'active' DO NOTHING
        RETURNING id, project_id, run_kind, event_id, content_hash, file_cursor,
                  status, lease_token, lease_expires_at, heartbeat_at,
                  created_at, completed_at
      `;
      if (inserted[0]) {
        return { status: "acquired", lease: toLease(inserted[0], leaseToken) };
      }

      // ── Lost the race: the winner's row is now active. SELECT it without
      // touching the partial unique. The transaction is clean (ON CONFLICT
      // DO NOTHING did not abort), so this SELECT succeeds.
      const winner = await tx.$queryRaw<ManagedRunRow[]>`
        SELECT id, project_id, run_kind, event_id, content_hash, file_cursor,
               status, lease_token, lease_expires_at, heartbeat_at,
               created_at, completed_at
        FROM managed_runs
        WHERE project_id = ${input.projectId}
          AND run_kind = ${input.runKind}
          AND status = 'active'
        ORDER BY lease_expires_at DESC
        LIMIT 1
      `;
      if (!winner[0]) {
        // No active row + our INSERT returned 0 rows: the partial unique must
        // have blocked us, but we can't find the blocker. This is a logic
        // error — fail loud rather than silently returning busy with no id.
        throw new Error(`managed_runs_begin_no_winner:${input.projectId}:${input.runKind}`);
      }
      return {
        status: "busy",
        activeRunId: winner[0].id.toString(),
        leaseExpiresAt: winner[0].lease_expires_at!.getTime(),
      };
    });
  }

  async heartbeat(lease: ManagedRunLease, leaseTtlMs?: number): Promise<HeartbeatManagedRunOutcome> {
    const ttl = validateTtl(leaseTtlMs ?? HEARTBEAT_TTL_MS);
    const leaseToken = boundedText(lease.leaseToken, "leaseToken", MAX_LEASE_TOKEN);
    const renewed = await getPrismaClient().$queryRaw<Array<{ lease_expires_at: Date }>>`
      UPDATE managed_runs
      SET lease_expires_at = clock_timestamp() + (${ttl} * interval '1 millisecond'),
          heartbeat_at = clock_timestamp()
      WHERE id = ${BigInt(lease.runId)}
        AND project_id = ${lease.projectId}
        AND run_kind = ${lease.runKind}
        AND lease_token = ${leaseToken}
        AND status = 'active'
        AND lease_expires_at > clock_timestamp()
      RETURNING lease_expires_at
    `;
    if (!renewed[0]) return { status: "lease_lost" };
    return { status: "renewed", leaseExpiresAt: renewed[0].lease_expires_at.getTime() };
  }

  async complete(lease: ManagedRunLease, fileCursor?: FileCursor): Promise<CompleteManagedRunOutcome> {
    const leaseToken = boundedText(lease.leaseToken, "leaseToken", MAX_LEASE_TOKEN);
    const cursorJson = fileCursor ?? null;
    const updated = await getPrismaClient().$queryRaw<Array<{ id: bigint }>>`
      UPDATE managed_runs
      SET status = 'completed',
          completed_at = ${Date.now()},
          lease_token = NULL,
          lease_expires_at = NULL,
          file_cursor = ${cursorJson}::jsonb
      WHERE id = ${BigInt(lease.runId)}
        AND project_id = ${lease.projectId}
        AND run_kind = ${lease.runKind}
        AND lease_token = ${leaseToken}
        AND status = 'active'
      RETURNING id
    `;
    if (!updated[0]) return { status: "lease_lost" };
    return { status: "completed", runId: updated[0].id.toString() };
  }

  async abort(lease: ManagedRunLease): Promise<AbortManagedRunOutcome> {
    const leaseToken = boundedText(lease.leaseToken, "leaseToken", MAX_LEASE_TOKEN);
    const updated = await getPrismaClient().$queryRaw<Array<{ id: bigint }>>`
      UPDATE managed_runs
      SET status = 'aborted',
          completed_at = ${Date.now()},
          lease_token = NULL,
          lease_expires_at = NULL
      WHERE id = ${BigInt(lease.runId)}
        AND project_id = ${lease.projectId}
        AND run_kind = ${lease.runKind}
        AND lease_token = ${leaseToken}
        AND status = 'active'
      RETURNING id
    `;
    if (!updated[0]) return { status: "lease_lost" };
    return { status: "aborted", runId: updated[0].id.toString() };
  }

  async getActive(projectId: string, runKind: ManagedRunKind): Promise<ActiveManagedRun | null> {
    const rows = await getPrismaClient().$queryRaw<ManagedRunRow[]>`
      SELECT id, project_id, run_kind, event_id, content_hash, file_cursor,
             status, lease_token, lease_expires_at, heartbeat_at,
             created_at, completed_at
      FROM managed_runs
      WHERE project_id = ${projectId}
        AND run_kind = ${runKind}
        AND status = 'active'
        AND lease_expires_at > clock_timestamp()
      ORDER BY lease_expires_at DESC
      LIMIT 1
    `;
    return rows[0] ? toActive(rows[0]) : null;
  }
}
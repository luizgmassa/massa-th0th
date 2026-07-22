/**
 * Managed Run Contract — Wave 5 FR-08 / FR-09 / FR-20 / FR-26 / AD-W5-013 /
 * AD-W5-014 / AD-W5-020.
 *
 * Public TypeScript contract for the {@link ManagedRunRepository}. B2/B3
 * (and any downstream consumer) imports these interfaces verbatim — no
 * re-implementation. Interface drift fails the batch per FR-26 / AC-28.
 *
 * The repository unifies an indexing lease (CAS acquire/heartbeat/release)
 * with idempotent event_id dedup + FileCursor resume (FR-09 / FR-10). It
 * mirrors the proven graph_generations lease pattern (Wave 3 MLTS-011) but
 * is decoupled from the immutable snapshot row (AD-W5-004): an indexing run
 * is a process-writer concept with a different lifecycle than a generation
 * snapshot.
 *
 * Reaper contract (AD-W5-013): every {@link ManagedRunRepository.begin} call
 * first issues
 *   UPDATE managed_runs SET status='aborted'
 *   WHERE project_id=? AND run_kind=? AND status='active'
 *     AND lease_expires_at <= clock_timestamp()
 * inside the same transaction as the subsequent INSERT, BEFORE attempting to
 * acquire. Stale-but-active rows (orphaned by SIGKILL) are flipped to
 * 'aborted' so the partial UNIQUE index `managed_runs_one_active_per_project_kind`
 * (active rows only) stays satisfiable for the new row. Tested by AC-22.
 *
 * Race contract (AC-22): the INSERT uses `ON CONFLICT (project_id, run_kind)
 * WHERE status='active' DO NOTHING` so a concurrent winner is observed as a
 * clean no-op (0 rows returned) rather than a unique-violation
 * statement-abort — Prisma's pg adapter cannot ROLLBACK TO SAVEPOINT
 * transparently, so ON CONFLICT DO NOTHING keeps the transaction clean. The
 * loser then SELECTs the winner's row to surface `busy` with the winner's
 * runId. No 500, no `could not serialize access`.
 *
 * getActive pin (AD-W5-014): {@link ManagedRunRepository.getActive} filters
 * by `status='active' AND lease_expires_at > clock_timestamp()
 * ORDER BY lease_expires_at DESC LIMIT 1` exactly. A stale-but-active row
 * must NOT be returned as "the active run" — the caller would see a live run
 * that has already expired. Tested by AC-22.
 */

/** Run kind recognized by the `managed_runs.run_kind` CHECK constraint. */
export type ManagedRunKind = "indexing" | "reindex" | "maintenance";

/** Status values recognized by the `managed_runs.status` CHECK constraint. */
export type ManagedRunStatus = "active" | "completed" | "failed" | "aborted";

/**
 * Resumable cursor persisted on `managed_runs.file_cursor` (FR-10).
 * `path` is the relative project path of the next unprocessed file; `offset`
 * is an opaque progress marker (file-size bytes already applied, for the
 * common case where each file is a single event).
 */
export interface FileCursor {
  path: string;
  offset: number;
}

/** Lease token + expiry returned by a successful `begin()`. */
export interface ManagedRunLease {
  /** managed_runs.id (BigInt serial). */
  runId: string;
  projectId: string;
  runKind: ManagedRunKind;
  /** Random UUID token; required for heartbeat/complete/abort. */
  leaseToken: string;
  /** epoch ms — when the lease expires unless renewed. */
  leaseExpiresAt: number;
  /** The event_id this run was acquired under (FR-10 idempotency key). */
  eventId: string;
  /** Optional content_hash captured at acquire time. */
  contentHash?: string;
}

export interface BeginManagedRunInput {
  projectId: string;
  runKind: ManagedRunKind;
  /** FR-10 idempotency key (caller computes SHA-256(source_record || content_hash)). */
  eventId: string;
  /** Optional content_hash at acquire time. */
  contentHash?: string;
  /** Lease TTL in ms; 90s default matches FR-09. Bounded 1s..5min. */
  leaseTtlMs?: number;
}

/**
 * Outcome of {@link ManagedRunRepository.begin}.
 *
 * - `acquired`: this caller won the race; `lease` is valid.
 * - `busy`: another live run holds the lease for this (projectId, runKind);
 *   `activeRunId` is the existing run's id (for the 409 body); no 500.
 */
export type BeginManagedRunOutcome =
  | { status: "acquired"; lease: ManagedRunLease }
  | { status: "busy"; activeRunId: string; leaseExpiresAt: number };

/** Outcome of {@link ManagedRunRepository.heartbeat}. */
export type HeartbeatManagedRunOutcome =
  | { status: "renewed"; leaseExpiresAt: number }
  | { status: "lease_lost" };

/** Outcome of {@link ManagedRunRepository.complete}. */
export type CompleteManagedRunOutcome =
  | { status: "completed"; runId: string }
  | { status: "lease_lost" };

/** Outcome of {@link ManagedRunRepository.abort}. */
export type AbortManagedRunOutcome =
  | { status: "aborted"; runId: string }
  | { status: "lease_lost" };

/**
 * Snapshot of the live active run for a (projectId, runKind), or `null` when
 * none exists. The filter is pinned per AD-W5-014:
 *
 *   SELECT * FROM managed_runs
 *   WHERE project_id = $1 AND run_kind = $2
 *     AND status = 'active'
 *     AND lease_expires_at > clock_timestamp()
 *   ORDER BY lease_expires_at DESC
 *   LIMIT 1
 *
 * A stale-but-active row (lease_expires_at <= clock_timestamp()) is NOT
 * returned; the caller must observe "no live run" rather than a row that
 * looks live but is already expired. The reaper in begin() is responsible
 * for flipping those rows to 'aborted' on the next acquire attempt.
 */
export interface ActiveManagedRun {
  runId: string;
  projectId: string;
  runKind: ManagedRunKind;
  eventId: string;
  contentHash: string | null;
  fileCursor: FileCursor | null;
  leaseToken: string | null;
  leaseExpiresAt: number;
  heartbeatAt: number | null;
  createdAt: number;
}

/**
 * Repository contract for managed_runs (FR-08 / FR-09 / FR-20 / FR-26).
 * Mirrors the CAS-lease shape of `GraphGenerationRepository` but decoupled
 * from the immutable snapshot row (AD-W5-004).
 *
 * Implementation: `managed-run-repository-pg.ts`.
 */
export interface ManagedRunRepository {
  /**
   * Acquire a managed_runs lease for (projectId, runKind). Runs the reaper
   * first (AD-W5-013): UPDATE expired active→aborted in the same transaction
   * as the INSERT, so the partial UNIQUE on active rows stays satisfiable.
   *
   * Race contract (AC-22): two concurrent `begin()` calls on the same
   * (projectId, runKind) — exactly one returns `acquired`, the other returns
   * `busy` with the winner's runId. No 500, no `could not serialize access`.
   */
  begin(input: BeginManagedRunInput): Promise<BeginManagedRunOutcome>;

  /**
   * Renew the lease. Returns `lease_lost` when the token is unknown, the
   * lease has already expired, or the run is no longer 'active'.
   */
  heartbeat(lease: ManagedRunLease, leaseTtlMs?: number): Promise<HeartbeatManagedRunOutcome>;

  /**
   * Mark the run `completed` and persist the final FileCursor. Idempotent
   * re-acquire is not supported (a new event_id is required).
   */
  complete(lease: ManagedRunLease, fileCursor?: FileCursor): Promise<CompleteManagedRunOutcome>;

  /**
   * Persist an intermediate FileCursor mid-run (FR-10 resume). Called by the
   * ETL load stage after each file-batch lands so a crash/restart resumes
   * from the last committed file. Best-effort: a `lease_lost` outcome is
   * logged but not thrown (the pipeline's heartbeat loop will abort the run
   * separately). The cursor write happens AFTER the vector load commits
   * (AD-W5-016) so kill-mid-load leaves the cursor at the previous file —
   * restart re-processes the killed file (vectors upsert idempotently via
   * deterministic doc ids).
   */
  updateFileCursor(lease: ManagedRunLease, fileCursor: FileCursor): Promise<HeartbeatManagedRunOutcome>;

  /**
   * Mark the run `failed` (status='aborted'). Used by the ETL pipeline's
   * catch path on lease_lost or terminal error.
   */
  abort(lease: ManagedRunLease): Promise<AbortManagedRunOutcome>;

  /**
   * Pinned filter per AD-W5-014 (see {@link ActiveManagedRun}). Returns the
   * one live active run, or `null` if none.
   */
  getActive(projectId: string, runKind: ManagedRunKind): Promise<ActiveManagedRun | null>;
}
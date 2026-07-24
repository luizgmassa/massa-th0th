/**
 * ICheckpointStore — storage contract for task/INDEX state checkpoints.
 *
 * Structural gap #16: checkpoints were PostgreSQL-only (raw legacy local database inside
 * CheckpointManager). This interface decouples the storage backend from the
 * CheckpointManager domain facade so a Postgres deployment can persist
 * checkpoints in the same backend as the rest of the data plane (one-backend
 * rule, mirroring getMemoryRepository / getScheduledJobStore / getSessionStore).
 *
 * Mostly SYNCHRONOUS: create_checkpoint / list_checkpoints + AutoCheckpointer
 * call these methods without await (create/list stay sync, matching the
 * PostgreSQL store). `restoreCheckpoint` + `countExistingMemoryIds` ARE async
 * (Promise-returning) so the PG backend can run a real `SELECT id FROM
 * memories WHERE id IN (...)` memory-existence check on the restore path
 * (was a no-op under PG). The single production restore caller
 * (restore_checkpoint tool handler) already awaits. The PG store otherwise
 * honors the sync discipline with an in-memory mirror hydrated from PG on
 * first use + write-through fire-and-forget persists — the same discipline as
 * PgSynapseSessionStore / PgScheduledJobStore. Callers that must observe
 * persisted rows immediately after a process restart await `ensureReady()`
 * before reading (sync backends resolve immediately).
 */

import type {
  TaskCheckpoint,
  TaskState,
  CheckpointType,
  RestoreResult,
} from "@massa-ai/shared";

export interface CheckpointMetadata {
  id: string;
  taskId: string;
  taskDescription?: string;
  agentId?: string;
  projectId?: string;
  checkpointType: CheckpointType;
  parentCheckpointId?: string;
  createdAt: number;
  expiresAt?: number;
  compressedSizeBytes: number;
  memoryCount: number;
  fileChangeCount: number;
}

export interface ListCheckpointsOptions {
  taskId?: string;
  projectId?: string;
  checkpointType?: CheckpointType;
  includeExpired?: boolean;
  limit?: number;
  offset?: number;
}

export interface CreateCheckpointOptions {
  agentId?: string;
  projectId?: string;
  checkpointType?: CheckpointType;
  memoryIds?: string[];
  fileChanges?: string[];
  parentCheckpointId?: string;
  /** TTL in milliseconds (default: 7 days). */
  ttlMs?: number;
}

export interface CheckpointStats {
  totalCheckpoints: number;
  byType: Record<string, number>;
  totalSizeBytes: number;
  oldestCheckpointAge?: number;
}

export interface ICheckpointStore {
  /** Create + persist a checkpoint; returns the created checkpoint. */
  createCheckpoint(
    state: TaskState,
    options?: CreateCheckpointOptions,
  ): TaskCheckpoint;

  /** Get a checkpoint by ID (with deserialized state). */
  getCheckpoint(checkpointId: string): TaskCheckpoint | null;

  /** List checkpoints (with deserialized state). */
  listCheckpoints(options?: ListCheckpointsOptions): TaskCheckpoint[];

  /** List checkpoint metadata without deserializing state (lazy deserialization). */
  listCheckpointsMetadata(options?: ListCheckpointsOptions): CheckpointMetadata[];

  /** Get just the deserialized state for a checkpoint (lazy deserialization). */
  getCheckpointState(checkpointId: string): TaskState | null;

  /** Get the latest non-expired checkpoint for a task. */
  getLatestCheckpoint(taskId: string): TaskCheckpoint | null;

  /** Delete a checkpoint by ID; returns true if a row was removed. */
  deleteCheckpoint(checkpointId: string): boolean;

  /** Purge expired checkpoints; returns the count removed. */
  purgeExpired(): number;

  /** Aggregate stats. */
  getStats(): CheckpointStats;

  /**
   * Count how many of the given memory ids still exist. Used by the restore
   * integrity check (valid vs missing referenced memories). Backends that cannot
   * reach the memories table return all ids as existing (best-effort — never
   * blocks a restore). Returns a Promise so the PG backend can run a real
   * `SELECT id FROM memories WHERE id IN (...)` via prisma; the PostgreSQL backend
   * resolves immediately (it wraps its synchronous result in Promise.resolve).
   */
  countExistingMemoryIds(memoryIds: string[]): Promise<string[]>;

  /**
   * Await backend readiness before a read (hydration race fix, #16/#18).
   * Sync backends (PostgreSQL) resolve immediately. The PG backend awaits its
   * mirror hydration so the first read after a process restart observes
   * persisted rows.
   */
  ensureReady(): Promise<void>;

  /** Release resources (PostgreSQL closes the DB handle; PG flushes writes). */
  close(): void;
}

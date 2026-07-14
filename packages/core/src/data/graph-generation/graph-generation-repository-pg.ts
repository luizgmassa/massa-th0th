import { randomUUID } from "node:crypto";
import { getPrismaClient } from "../../services/query/prisma-client.js";
import type {
  AbortGraphGenerationOutcome,
  ActivateGraphGenerationOutcome,
  BeginGraphGenerationInput,
  BeginGraphGenerationOutcome,
  CleanupSupersededOptions,
  CompleteGraphGenerationOutcome,
  GenerationCounts,
  GraphGenerationLease,
  GraphGenerationRepository,
  HeartbeatGraphGenerationOutcome,
} from "./graph-generation-contract.js";

const MIN_LEASE_TTL_MS = 100;
const MAX_LEASE_TTL_MS = 300_000;
const MAX_EXPECTED_FILES = 1_000_000;
const MAX_FAILURE_REASON = 2_000;

type TransactionClient = Parameters<Parameters<ReturnType<typeof getPrismaClient>["$transaction"]>[0]>[0];

interface WorkspaceLockRow {
  project_id: string;
  active_graph_generation_id: string | null;
  pending_graph_generation_id: string | null;
  graph_lease_token: string | null;
  graph_lease_expires_at: Date | null;
}

interface GenerationLockRow {
  id: string;
  project_id: string;
  status: string;
  expected_active_id: string | null;
  lease_token: string | null;
  lease_expires_at: Date | null;
  fingerprint: string;
  input_snapshot_hash: string;
  expected_files_count: number;
}

interface CountRow {
  files: number;
  completed_files: number;
  definitions: number;
  references: number;
  imports: number;
  centrality: number;
  diagnostics: number;
  recovered: number;
  hard_failures: number;
  stale_files: number;
  invalid_files: number;
}

function boundedText(value: string, label: string, max = 512): string {
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > max || normalized.includes("\0")) {
    throw new TypeError(`${label} must contain 1-${max} safe characters`);
  }
  return normalized;
}

function validateTtl(ttlMs: number): number {
  if (!Number.isInteger(ttlMs) || ttlMs < MIN_LEASE_TTL_MS || ttlMs > MAX_LEASE_TTL_MS) {
    throw new RangeError(`leaseTtlMs must be ${MIN_LEASE_TTL_MS}-${MAX_LEASE_TTL_MS}`);
  }
  return ttlMs;
}

function validateBegin(input: BeginGraphGenerationInput): BeginGraphGenerationInput {
  if (!Number.isInteger(input.expectedFilesCount) || input.expectedFilesCount < 0 || input.expectedFilesCount > MAX_EXPECTED_FILES) {
    throw new RangeError(`expectedFilesCount must be 0-${MAX_EXPECTED_FILES}`);
  }
  return {
    ...input,
    projectId: boundedText(input.projectId, "projectId"),
    fingerprint: boundedText(input.fingerprint, "fingerprint", 2_000),
    inputSnapshotHash: boundedText(input.inputSnapshotHash, "inputSnapshotHash", 2_000),
    leaseTtlMs: validateTtl(input.leaseTtlMs),
  };
}

function counts(row: CountRow): GenerationCounts {
  return {
    files: Number(row.files),
    definitions: Number(row.definitions),
    references: Number(row.references),
    imports: Number(row.imports),
    centrality: Number(row.centrality),
    diagnostics: Number(row.diagnostics),
    recovered: Number(row.recovered),
    hardFailures: Number(row.hard_failures),
    staleFiles: Number(row.stale_files),
  };
}

function incompleteReasons(row: CountRow, expectedFiles: number): string[] {
  const reasons: string[] = [];
  if (Number(row.files) !== expectedFiles) reasons.push("file_count_mismatch");
  if (Number(row.invalid_files) > 0) reasons.push("invalid_parser_status");
  if (Number(row.hard_failures) > 0) reasons.push("hard_failures");
  if (Number(row.stale_files) > 0) reasons.push("stale_files");
  return reasons;
}

async function lockWorkspace(tx: TransactionClient, projectId: string): Promise<WorkspaceLockRow> {
  const rows = await tx.$queryRaw<WorkspaceLockRow[]>`
    SELECT project_id, active_graph_generation_id, pending_graph_generation_id,
           graph_lease_token, graph_lease_expires_at
    FROM workspaces WHERE project_id = ${projectId} FOR UPDATE
  `;
  if (!rows[0]) throw new Error(`graph_generation_workspace_missing:${projectId}`);
  return rows[0];
}

async function lockGeneration(tx: TransactionClient, projectId: string, generationId: string): Promise<GenerationLockRow | null> {
  const rows = await tx.$queryRaw<GenerationLockRow[]>`
    SELECT id, project_id, status, expected_active_id, lease_token, lease_expires_at,
           fingerprint, input_snapshot_hash, expected_files_count
    FROM graph_generations
    WHERE project_id = ${projectId} AND id = ${generationId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function generationCounts(tx: TransactionClient, projectId: string, generationId: string): Promise<CountRow> {
  const rows = await tx.$queryRaw<CountRow[]>`
    SELECT
      (SELECT count(*)::integer FROM symbol_files WHERE project_id = ${projectId} AND generation_id = ${generationId}) AS files,
      (SELECT count(*)::integer FROM symbol_files WHERE project_id = ${projectId} AND generation_id = ${generationId} AND parser_status IN ('ok','recovered') AND NOT is_stale) AS completed_files,
      (SELECT count(*)::integer FROM symbol_definitions WHERE project_id = ${projectId} AND generation_id = ${generationId}) AS definitions,
      (SELECT count(*)::integer FROM symbol_references WHERE project_id = ${projectId} AND generation_id = ${generationId}) AS references,
      (SELECT count(*)::integer FROM symbol_imports WHERE project_id = ${projectId} AND generation_id = ${generationId}) AS imports,
      (SELECT count(*)::integer FROM symbol_centrality WHERE project_id = ${projectId} AND generation_id = ${generationId}) AS centrality,
      (SELECT COALESCE(sum(parser_error_count), 0)::integer FROM symbol_files WHERE project_id = ${projectId} AND generation_id = ${generationId}) AS diagnostics,
      (SELECT count(*)::integer FROM symbol_files WHERE project_id = ${projectId} AND generation_id = ${generationId} AND parser_status = 'recovered') AS recovered,
      (SELECT count(*)::integer FROM symbol_files WHERE project_id = ${projectId} AND generation_id = ${generationId} AND parser_status IN ('failed','unsupported')) AS hard_failures,
      (SELECT count(*)::integer FROM symbol_files WHERE project_id = ${projectId} AND generation_id = ${generationId} AND is_stale) AS stale_files,
      (SELECT count(*)::integer FROM symbol_files WHERE project_id = ${projectId} AND generation_id = ${generationId} AND parser_status NOT IN ('ok','recovered')) AS invalid_files
  `;
  return rows[0]!;
}

async function deleteChildren(tx: TransactionClient, projectId: string, generationId: string): Promise<void> {
  await tx.$executeRaw`DELETE FROM symbol_references WHERE project_id = ${projectId} AND generation_id = ${generationId}`;
  await tx.$executeRaw`DELETE FROM symbol_imports WHERE project_id = ${projectId} AND generation_id = ${generationId}`;
  await tx.$executeRaw`DELETE FROM symbol_centrality WHERE project_id = ${projectId} AND generation_id = ${generationId}`;
  await tx.$executeRaw`DELETE FROM symbol_definitions WHERE project_id = ${projectId} AND generation_id = ${generationId}`;
  await tx.$executeRaw`DELETE FROM symbol_files WHERE project_id = ${projectId} AND generation_id = ${generationId}`;
}

function leaseMatches(workspace: WorkspaceLockRow, generation: GenerationLockRow | null, lease: GraphGenerationLease): boolean {
  return Boolean(
    generation && generation.status === "pending" &&
    workspace.pending_graph_generation_id === lease.generationId &&
    workspace.graph_lease_token === lease.leaseToken &&
    generation.lease_token === lease.leaseToken &&
    generation.expected_active_id === lease.expectedActiveGenerationId &&
    generation.fingerprint === lease.fingerprint &&
    generation.input_snapshot_hash === lease.inputSnapshotHash &&
    generation.expected_files_count === lease.expectedFilesCount,
  );
}

export class GraphGenerationRepositoryPg implements GraphGenerationRepository {
  private static instance: GraphGenerationRepositoryPg | null = null;

  static getInstance(): GraphGenerationRepositoryPg {
    return this.instance ??= new GraphGenerationRepositoryPg();
  }

  async begin(rawInput: BeginGraphGenerationInput): Promise<BeginGraphGenerationOutcome> {
    const input = validateBegin(rawInput);
    const generationId = randomUUID();
    const leaseToken = randomUUID();
    return getPrismaClient().$transaction(async (tx) => {
      const workspace = await lockWorkspace(tx, input.projectId);
      if (workspace.active_graph_generation_id !== input.expectedActiveGenerationId) {
        return { status: "stale_active", activeGenerationId: workspace.active_graph_generation_id };
      }

      if (workspace.pending_graph_generation_id) {
        const prior = await lockGeneration(tx, input.projectId, workspace.pending_graph_generation_id);
        if (!prior || prior.status !== "pending" || prior.lease_token !== workspace.graph_lease_token) {
          throw new Error(`graph_generation_pending_invariant:${input.projectId}`);
        }
        const live = await tx.$queryRaw<Array<{ live: boolean }>>`
          SELECT (${workspace.graph_lease_expires_at}::timestamp > clock_timestamp()
            AND ${prior.lease_expires_at}::timestamp > clock_timestamp()) AS live
        `;
        if (live[0]?.live) {
          return { status: "busy", generationId: prior.id, leaseExpiresAt: prior.lease_expires_at!.getTime() };
        }
        await deleteChildren(tx, input.projectId, prior.id);
        await tx.$executeRaw`
          UPDATE graph_generations SET status = 'failed', failure_reason = 'lease_expired',
            lease_token = NULL, lease_expires_at = NULL, completed_at = COALESCE(completed_at, clock_timestamp())
          WHERE project_id = ${input.projectId} AND id = ${prior.id} AND status = 'pending'
        `;
        await tx.$executeRaw`
          UPDATE workspaces SET pending_graph_generation_id = NULL, graph_lease_token = NULL,
            graph_lease_expires_at = NULL, graph_lease_heartbeat_at = NULL
          WHERE project_id = ${input.projectId}
        `;
      }

      const inserted = await tx.$queryRaw<Array<{ lease_expires_at: Date }>>`
        INSERT INTO graph_generations (
          id, project_id, status, fingerprint, input_snapshot_hash, expected_active_id,
          lease_token, lease_expires_at, expected_files_count, started_at
        ) VALUES (
          ${generationId}, ${input.projectId}, 'pending', ${input.fingerprint}, ${input.inputSnapshotHash},
          ${input.expectedActiveGenerationId}, ${leaseToken},
          clock_timestamp() + (${input.leaseTtlMs} * interval '1 millisecond'),
          ${input.expectedFilesCount}, clock_timestamp()
        ) RETURNING lease_expires_at
      `;
      await tx.$executeRaw`
        UPDATE workspaces SET pending_graph_generation_id = ${generationId}, graph_lease_token = ${leaseToken},
          graph_lease_expires_at = ${inserted[0]!.lease_expires_at}, graph_lease_heartbeat_at = clock_timestamp()
        WHERE project_id = ${input.projectId}
      `;
      return {
        status: "acquired",
        lease: {
          projectId: input.projectId,
          generationId,
          leaseToken,
          expectedActiveGenerationId: input.expectedActiveGenerationId,
          fingerprint: input.fingerprint,
          inputSnapshotHash: input.inputSnapshotHash,
          expectedFilesCount: input.expectedFilesCount,
          leaseExpiresAt: inserted[0]!.lease_expires_at.getTime(),
        },
      };
    });
  }

  async heartbeat(lease: GraphGenerationLease, leaseTtlMs: number): Promise<HeartbeatGraphGenerationOutcome> {
    const ttl = validateTtl(leaseTtlMs);
    return getPrismaClient().$transaction(async (tx) => {
      const workspace = await lockWorkspace(tx, lease.projectId);
      const generation = await lockGeneration(tx, lease.projectId, lease.generationId);
      if (!leaseMatches(workspace, generation, lease)) return { status: "lease_lost" };
      const renewed = await tx.$queryRaw<Array<{ lease_expires_at: Date }>>`
        UPDATE graph_generations SET lease_expires_at = clock_timestamp() + (${ttl} * interval '1 millisecond')
        WHERE project_id = ${lease.projectId} AND id = ${lease.generationId} AND status = 'pending'
          AND lease_token = ${lease.leaseToken} AND lease_expires_at > clock_timestamp()
          AND ${workspace.graph_lease_expires_at}::timestamp > clock_timestamp()
        RETURNING lease_expires_at
      `;
      if (!renewed[0]) return { status: "lease_lost" };
      await tx.$executeRaw`
        UPDATE workspaces SET graph_lease_expires_at = ${renewed[0].lease_expires_at},
          graph_lease_heartbeat_at = clock_timestamp()
        WHERE project_id = ${lease.projectId} AND pending_graph_generation_id = ${lease.generationId}
          AND graph_lease_token = ${lease.leaseToken}
      `;
      return { status: "renewed", leaseExpiresAt: renewed[0].lease_expires_at.getTime() };
    });
  }

  async complete(lease: GraphGenerationLease): Promise<CompleteGraphGenerationOutcome> {
    return getPrismaClient().$transaction(async (tx) => {
      const workspace = await lockWorkspace(tx, lease.projectId);
      const generation = await lockGeneration(tx, lease.projectId, lease.generationId);
      if (!leaseMatches(workspace, generation, lease)) return { status: "lease_lost" };
      const live = await tx.$queryRaw<Array<{ live: boolean }>>`
        SELECT (${workspace.graph_lease_expires_at}::timestamp > clock_timestamp()
          AND ${generation!.lease_expires_at}::timestamp > clock_timestamp()) AS live
      `;
      if (!live[0]?.live) return { status: "lease_lost" };
      if (workspace.active_graph_generation_id !== generation!.expected_active_id) {
        return { status: "stale_active", activeGenerationId: workspace.active_graph_generation_id };
      }
      const row = await generationCounts(tx, lease.projectId, lease.generationId);
      const resultCounts = counts(row);
      const reasons = incompleteReasons(row, generation!.expected_files_count);
      const updated = await tx.$queryRaw<Array<{ completed_at: Date | null }>>`
        UPDATE graph_generations SET completed_files_count = ${row.completed_files}, files_count = ${row.files},
          definitions_count = ${row.definitions}, references_count = ${row.references}, imports_count = ${row.imports},
          centrality_count = ${row.centrality}, diagnostics_count = ${row.diagnostics}, recovered_count = ${row.recovered},
          hard_failures_count = ${row.hard_failures}, stale_files_count = ${row.stale_files},
          completed_at = CASE WHEN ${reasons.length === 0} THEN clock_timestamp() ELSE NULL END
        WHERE project_id = ${lease.projectId} AND id = ${lease.generationId} AND status = 'pending'
        RETURNING completed_at
      `;
      return reasons.length > 0
        ? { status: "incomplete", counts: resultCounts, reasons }
        : { status: "complete", counts: resultCounts, completedAt: updated[0]!.completed_at!.getTime() };
    });
  }

  async activate(lease: GraphGenerationLease): Promise<ActivateGraphGenerationOutcome> {
    return getPrismaClient().$transaction(async (tx) => {
      const workspace = await lockWorkspace(tx, lease.projectId);
      const generation = await lockGeneration(tx, lease.projectId, lease.generationId);
      if (!leaseMatches(workspace, generation, lease)) return { status: "lease_lost" };
      if (workspace.active_graph_generation_id !== generation!.expected_active_id) {
        return { status: "stale_active", activeGenerationId: workspace.active_graph_generation_id };
      }
      const live = await tx.$queryRaw<Array<{ live: boolean }>>`
        SELECT (${workspace.graph_lease_expires_at}::timestamp > clock_timestamp()
          AND ${generation!.lease_expires_at}::timestamp > clock_timestamp()) AS live
      `;
      if (!live[0]?.live) return { status: "lease_lost" };
      const row = await generationCounts(tx, lease.projectId, lease.generationId);
      const resultCounts = counts(row);
      const reasons = incompleteReasons(row, generation!.expected_files_count);
      if (reasons.length > 0) return { status: "incomplete", counts: resultCounts, reasons };

      const oldActive = workspace.active_graph_generation_id;
      if (oldActive) {
        await tx.$executeRaw`
          UPDATE graph_generations SET status = 'superseded', superseded_at = clock_timestamp()
          WHERE project_id = ${lease.projectId} AND id = ${oldActive} AND status = 'active'
        `;
      }
      await tx.$executeRaw`
        UPDATE graph_generations SET status = 'active', lease_token = NULL, lease_expires_at = NULL,
          completed_files_count = ${row.completed_files}, files_count = ${row.files}, definitions_count = ${row.definitions},
          references_count = ${row.references}, imports_count = ${row.imports}, centrality_count = ${row.centrality},
          diagnostics_count = ${row.diagnostics}, recovered_count = ${row.recovered},
          hard_failures_count = ${row.hard_failures}, stale_files_count = ${row.stale_files},
          completed_at = COALESCE(completed_at, clock_timestamp()), activated_at = clock_timestamp()
        WHERE project_id = ${lease.projectId} AND id = ${lease.generationId} AND status = 'pending'
      `;
      await tx.$executeRaw`
        UPDATE workspaces SET active_graph_generation_id = ${lease.generationId}, pending_graph_generation_id = NULL,
          graph_lease_token = NULL, graph_lease_expires_at = NULL, graph_lease_heartbeat_at = NULL,
          active_files_count = ${row.files}, active_definitions_count = ${row.definitions},
          active_references_count = ${row.references}, active_imports_count = ${row.imports},
          active_centrality_count = ${row.centrality}, active_diagnostics_count = ${row.diagnostics},
          active_recovered_count = ${row.recovered}, active_hard_failures_count = ${row.hard_failures},
          active_stale_files_count = ${row.stale_files}
        WHERE project_id = ${lease.projectId} AND pending_graph_generation_id = ${lease.generationId}
          AND graph_lease_token = ${lease.leaseToken}
      `;
      return { status: "activated", generationId: lease.generationId, supersededGenerationId: oldActive, counts: resultCounts };
    });
  }

  async abort(lease: GraphGenerationLease, reason: string): Promise<AbortGraphGenerationOutcome> {
    const failureReason = boundedText(reason, "reason", MAX_FAILURE_REASON);
    return getPrismaClient().$transaction(async (tx) => {
      const workspace = await lockWorkspace(tx, lease.projectId);
      const generation = await lockGeneration(tx, lease.projectId, lease.generationId);
      if (!leaseMatches(workspace, generation, lease)) return { status: "lease_lost" };
      const live = await tx.$queryRaw<Array<{ live: boolean }>>`
        SELECT (${workspace.graph_lease_expires_at}::timestamp > clock_timestamp()
          AND ${generation!.lease_expires_at}::timestamp > clock_timestamp()) AS live
      `;
      if (!live[0]?.live) return { status: "lease_lost" };
      await deleteChildren(tx, lease.projectId, lease.generationId);
      await tx.$executeRaw`
        UPDATE graph_generations SET status = 'failed', failure_reason = ${failureReason},
          lease_token = NULL, lease_expires_at = NULL, completed_at = COALESCE(completed_at, clock_timestamp())
        WHERE project_id = ${lease.projectId} AND id = ${lease.generationId} AND status = 'pending'
      `;
      await tx.$executeRaw`
        UPDATE workspaces SET pending_graph_generation_id = NULL, graph_lease_token = NULL,
          graph_lease_expires_at = NULL, graph_lease_heartbeat_at = NULL
        WHERE project_id = ${lease.projectId} AND pending_graph_generation_id = ${lease.generationId}
          AND graph_lease_token = ${lease.leaseToken}
      `;
      return { status: "aborted", generationId: lease.generationId };
    });
  }

  async cleanupSuperseded(projectId: string, options: CleanupSupersededOptions = {}): Promise<number> {
    const normalizedProjectId = boundedText(projectId, "projectId");
    const retained = [...new Set(options.retainedGenerationIds ?? [])];
    const rows = await getPrismaClient().$queryRaw<Array<{ count: number }>>`
      WITH deleted AS (
        DELETE FROM graph_generations g
        WHERE g.project_id = ${normalizedProjectId} AND g.status = 'superseded'
          AND NOT (g.id = ANY(${retained}::text[]))
          AND NOT EXISTS (
            SELECT 1 FROM workspaces w WHERE w.project_id = g.project_id
              AND (w.active_graph_generation_id = g.id OR w.pending_graph_generation_id = g.id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM symbol_files f WHERE f.project_id = g.project_id
              AND f.last_known_good_generation_id = g.id
          )
        RETURNING 1
      ) SELECT count(*)::integer AS count FROM deleted
    `;
    return Number(rows[0]?.count ?? 0);
  }
}

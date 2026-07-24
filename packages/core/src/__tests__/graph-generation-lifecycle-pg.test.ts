import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import type {
  GraphGenerationLease,
  GraphGenerationRepository,
} from "../data/graph-generation/graph-generation-contract.js";

const expectedAdminUrl = "postgresql://test@127.0.0.1:5433/postgres";
const integrationRequested = process.env.RUN_GRAPH_GENERATION_LIFECYCLE === "1" &&
  process.env.MASSA_AI_DEDICATED === "1";
const databaseName = `massa_graph_lifecycle_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const projectId = "lifecycle-project";
const legacyGenerationId = "legacy-lifecycle";

let admin: Client | undefined;
let db: Client | undefined;
let repository: GraphGenerationRepository;
let ownsDatabase = false;
let previousDatabaseUrl: string | undefined;

function migrations(): string[] {
  const root = join(import.meta.dir, "../../prisma/migrations");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((directory) => readFileSync(join(root, directory, "migration.sql"), "utf8"));
}

async function resetWorkspace(): Promise<void> {
  await db!.query(`TRUNCATE TABLE workspaces CASCADE`);
  await db!.query(
    `INSERT INTO workspaces (project_id, project_path, display_name, status, updated_at)
     VALUES ($1, '/tmp/lifecycle-project', 'Lifecycle', 'indexed', NOW())`,
    [projectId],
  );
  await db!.query(
    `INSERT INTO graph_generations (
       id, project_id, status, fingerprint, input_snapshot_hash,
       expected_files_count, completed_files_count, started_at, completed_at, activated_at
     ) VALUES ($1, $2, 'active', 'legacy:v1', 'snapshot:legacy', 0, 0, NOW(), NOW(), NOW())`,
    [legacyGenerationId, projectId],
  );
  await db!.query(
    `UPDATE workspaces SET active_graph_generation_id = $1 WHERE project_id = $2`,
    [legacyGenerationId, projectId],
  );
}

async function begin(expectedFilesCount = 1, expectedActiveGenerationId: string | null = legacyGenerationId) {
  const outcome = await repository.begin({
    projectId,
    expectedActiveGenerationId,
    fingerprint: "structural:v2",
    inputSnapshotHash: `snapshot:${randomUUID()}`,
    expectedFilesCount,
    leaseTtlMs: 60_000,
  });
  expect(outcome.status).toBe("acquired");
  if (outcome.status !== "acquired") throw new Error(`expected acquired, got ${outcome.status}`);
  return outcome.lease;
}

function wrongToken(lease: GraphGenerationLease): GraphGenerationLease {
  return { ...lease, leaseToken: `wrong-${lease.leaseToken}` };
}

async function insertRecoveredFile(lease: GraphGenerationLease, path = "src/a.ts"): Promise<void> {
  await db!.query(
    `INSERT INTO symbol_files (
       project_id, generation_id, relative_path, content_hash, mtime, size, indexed_at,
       symbol_count, chunk_count, language, grammar_version, query_pack_version,
       resolver_version, parser_status, parser_error_count, diagnostics, is_stale
     ) VALUES ($1, $2, $3, 'hash-a', 1, 10, NOW(), 1, 0, 'typescript', 'g1', 'q1', 'r1',
       'recovered', 2, '[{"severity":"recovered"}]'::jsonb, false)`,
    [projectId, lease.generationId, path],
  );
}

async function insertCompleteGraph(lease: GraphGenerationLease): Promise<void> {
  await insertRecoveredFile(lease);
  await db!.query(
    `INSERT INTO symbol_definitions (
       id, project_id, generation_id, file_path, name, kind, line_start, line_end,
       exported, indexed_at, qualified_name, legacy_fqn
     ) VALUES ('src/a.ts#A', $1, $2, 'src/a.ts', 'A', 'class', 1, 2, true, NOW(), 'A', 'src/a.ts#A')`,
    [projectId, lease.generationId],
  );
  await db!.query(
    `INSERT INTO symbol_references (
       project_id, generation_id, from_file, from_line, symbol_name, target_fqn, ref_kind
     ) VALUES ($1, $2, 'src/a.ts', 2, 'A', 'src/a.ts#A', 'call')`,
    [projectId, lease.generationId],
  );
  await db!.query(
    `INSERT INTO symbol_imports (
       project_id, generation_id, from_file, specifier, imported_names, is_external, is_type_only
     ) VALUES ($1, $2, 'src/a.ts', './b', ARRAY['B'], false, false)`,
    [projectId, lease.generationId],
  );
  await db!.query(
    `INSERT INTO symbol_centrality (project_id, generation_id, file_path, score, updated_at)
     VALUES ($1, $2, 'src/a.ts', 0.75, NOW())`,
    [projectId, lease.generationId],
  );
}

beforeAll(async () => {
  if (!integrationRequested) return;
  const isDarwinArm64 = process.platform === "darwin" && process.arch === "arm64";
  const isLinuxX64 = process.platform === "linux" && process.arch === "x64";
  if (!isDarwinArm64 && !isLinuxX64) {
    throw new Error(`graph-generation lifecycle PG tests require macOS arm64 or Linux glibc x64, got ${process.platform}/${process.arch}`);
  }
  expect(process.env.GRAPH_GENERATION_TEST_ADMIN_URL).toBe(expectedAdminUrl);
  expect(databaseName).toMatch(/^massa_graph_lifecycle_[a-zA-Z0-9_]+$/);

  admin = new Client({ connectionString: expectedAdminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  ownsDatabase = true;

  const databaseUrl = `postgresql://test@127.0.0.1:5433/${databaseName}`;
  db = new Client({ connectionString: databaseUrl });
  await db.connect();
  for (const migration of migrations()) await db.query(migration);

  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const prisma = await import("../services/query/prisma-client.js");
  prisma._resetPrismaForTesting();
  const lifecycle = await import("../data/graph-generation/graph-generation-repository-pg.js");
  repository = lifecycle.GraphGenerationRepositoryPg.getInstance();
});

beforeEach(async () => {
  if (integrationRequested) await resetWorkspace();
});

afterAll(async () => {
  if (!integrationRequested) return;
  const { disconnectPrisma } = await import("../services/query/prisma-client.js");
  await disconnectPrisma();
  await db?.end();
  if (admin && ownsDatabase) {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await admin.query(`DROP DATABASE "${databaseName}"`);
    ownsDatabase = false;
  }
  await admin?.end();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

describe.skipIf(!integrationRequested)("owned PostgreSQL graph-generation lifecycle", () => {
  test("coordinator waits for a held cross-process owner then acquires durably", async () => {
    const held = await begin();
    const { GraphGenerationCoordinator } = await import("../services/etl/graph-generation-coordinator.js");
    const coordinator = new GraphGenerationCoordinator(repository);
    const release = new Promise<void>((resolve, reject) => setTimeout(() => {
      repository.abort(held, "test_owner_finished").then(() => resolve(), reject);
    }, 150));
    const acquired = await coordinator.begin({
      projectId, expectedActiveGenerationId: legacyGenerationId,
      fingerprint: "structural:v2", inputSnapshotHash: "snapshot:waiter", expectedFilesCount: 1,
    });
    await release;
    expect(acquired.generationId).not.toBe(held.generationId);
    expect((await db!.query(`SELECT pending_graph_generation_id FROM workspaces WHERE project_id=$1`, [projectId])).rows[0].pending_graph_generation_id).toBe(acquired.generationId);
  });

  test("serializes competing begin calls as acquired then busy", async () => {
    const [first, second] = await Promise.all([
      repository.begin({
        projectId, expectedActiveGenerationId: legacyGenerationId, fingerprint: "v2",
        inputSnapshotHash: "snapshot:a", expectedFilesCount: 1, leaseTtlMs: 60_000,
      }),
      repository.begin({
        projectId, expectedActiveGenerationId: legacyGenerationId, fingerprint: "v2",
        inputSnapshotHash: "snapshot:b", expectedFilesCount: 1, leaseTtlMs: 60_000,
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual(["acquired", "busy"]);
    expect((await db!.query(`SELECT count(*)::int AS count FROM graph_generations WHERE project_id = $1 AND status = 'pending'`, [projectId])).rows[0].count).toBe(1);
  });

  test("rejects wrong-token and expired heartbeats", async () => {
    const lease = await begin();
    const renewed = await repository.heartbeat(lease, 60_000);
    expect(renewed.status).toBe("renewed");
    if (renewed.status === "renewed") expect(renewed.leaseExpiresAt).toBeGreaterThan(lease.leaseExpiresAt);
    expect((await repository.heartbeat(wrongToken(lease), 60_000)).status).toBe("lease_lost");
    expect((await repository.complete({ ...lease, inputSnapshotHash: "snapshot:tampered" })).status).toBe("lease_lost");
    await db!.query(`UPDATE workspaces SET graph_lease_expires_at = NOW() - INTERVAL '1 second' WHERE project_id = $1`, [projectId]);
    await db!.query(`UPDATE graph_generations SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [lease.generationId]);
    expect((await repository.heartbeat(lease, 60_000)).status).toBe("lease_lost");
  });

  test("takes over an expired lease, retains failure metadata, and removes abandoned rows", async () => {
    const abandoned = await begin();
    await insertRecoveredFile(abandoned, "src/abandoned.ts");
    await db!.query(`UPDATE workspaces SET graph_lease_expires_at = NOW() - INTERVAL '1 second' WHERE project_id = $1`, [projectId]);
    await db!.query(`UPDATE graph_generations SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [abandoned.generationId]);
    const takeover = await begin();
    expect(takeover.generationId).not.toBe(abandoned.generationId);
    expect(takeover.fingerprint).toBe(abandoned.fingerprint);
    expect((await db!.query(
      `SELECT status, failure_reason, lease_token FROM graph_generations WHERE id = $1`,
      [abandoned.generationId],
    )).rows[0]).toEqual({ status: "failed", failure_reason: "lease_expired", lease_token: null });
    expect((await db!.query(`SELECT count(*)::int AS count FROM symbol_files WHERE generation_id = $1`, [abandoned.generationId])).rows[0].count).toBe(0);
  });

  test("expired owners cannot abort or mutate pending state", async () => {
    const lease = await begin();
    await insertRecoveredFile(lease);
    await db!.query(`UPDATE workspaces SET graph_lease_expires_at = NOW() - INTERVAL '1 second' WHERE project_id = $1`, [projectId]);
    await db!.query(`UPDATE graph_generations SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [lease.generationId]);
    expect((await repository.abort(lease, "too late")).status).toBe("lease_lost");
    expect((await db!.query(`SELECT count(*)::int AS count FROM symbol_files WHERE generation_id = $1`, [lease.generationId])).rows[0].count).toBe(1);
    expect((await db!.query(`SELECT pending_graph_generation_id FROM workspaces WHERE project_id = $1`, [projectId])).rows[0].pending_graph_generation_id).toBe(lease.generationId);
  });

  test("reports missing, hard-failed, and recovered completeness distinctly", async () => {
    const missing = await begin();
    expect((await repository.complete(missing)).status).toBe("incomplete");
    await repository.abort(missing, "missing");

    const failed = await begin();
    await db!.query(
      `INSERT INTO symbol_files (project_id, generation_id, relative_path, content_hash, mtime, indexed_at, parser_status, parser_error_count)
       VALUES ($1, $2, 'src/fail.ts', 'hash', 1, NOW(), 'failed', 1)`,
      [projectId, failed.generationId],
    );
    const hard = await repository.complete(failed);
    expect(hard.status).toBe("incomplete");
    if (hard.status === "incomplete") expect(hard.counts.hardFailures).toBe(1);
    await repository.abort(failed, "hard failure");

    const recovered = await begin();
    await insertRecoveredFile(recovered);
    const complete = await repository.complete(recovered);
    expect(complete.status).toBe("complete");
    if (complete.status === "complete") {
      expect(complete.counts.recovered).toBe(1);
      expect(complete.counts.diagnostics).toBe(2);
      expect(complete.counts.hardFailures).toBe(0);
    }
  });

  test("activates by CAS and recomputes every active count from owned rows", async () => {
    const lease = await begin();
    await insertCompleteGraph(lease);
    expect((await repository.complete(lease)).status).toBe("complete");
    await db!.query(`UPDATE graph_generations SET files_count = 999, definitions_count = 999 WHERE id = $1`, [lease.generationId]);
    const activated = await repository.activate(lease);
    expect(activated.status).toBe("activated");
    if (activated.status === "activated") {
      expect(activated.supersededGenerationId).toBe(legacyGenerationId);
      expect(activated.counts).toEqual({ files: 1, definitions: 1, references: 1, imports: 1, centrality: 1, diagnostics: 2, recovered: 1, hardFailures: 0, staleFiles: 0 });
    }
    const workspace = (await db!.query(`SELECT * FROM workspaces WHERE project_id = $1`, [projectId])).rows[0];
    expect(workspace.active_graph_generation_id).toBe(lease.generationId);
    expect(workspace.pending_graph_generation_id).toBeNull();
    expect(workspace.graph_lease_token).toBeNull();
    expect([workspace.active_files_count, workspace.active_definitions_count, workspace.active_references_count,
      workspace.active_imports_count, workspace.active_centrality_count, workspace.active_diagnostics_count,
      workspace.active_recovered_count, workspace.active_hard_failures_count, workspace.active_stale_files_count])
      .toEqual([1, 1, 1, 1, 1, 2, 1, 0, 0]);
  });

  test("rejects stale expected-active activation without changing visible state", async () => {
    const lease = await begin();
    await insertRecoveredFile(lease);
    expect((await repository.complete(lease)).status).toBe("complete");
    await db!.query(
      `INSERT INTO graph_generations (id, project_id, status, fingerprint, input_snapshot_hash, started_at, completed_at, activated_at)
       VALUES ('newer-active', $1, 'superseded', 'v3', 'snapshot:newer', NOW(), NOW(), NOW())`,
      [projectId],
    );
    await db!.query(`UPDATE graph_generations SET status = 'superseded' WHERE id = $1`, [legacyGenerationId]);
    await db!.query(`UPDATE graph_generations SET status = 'active' WHERE id = 'newer-active'`);
    await db!.query(`UPDATE workspaces SET active_graph_generation_id = 'newer-active' WHERE project_id = $1`, [projectId]);
    const outcome = await repository.activate(lease);
    expect(outcome.status).toBe("stale_active");
    expect((await db!.query(`SELECT active_graph_generation_id FROM workspaces WHERE project_id = $1`, [projectId])).rows[0].active_graph_generation_id).toBe("newer-active");
  });

  test("allows only one terminal owner transition and rejects wrong-token abort", async () => {
    const lease = await begin();
    await insertRecoveredFile(lease);
    expect((await repository.complete(lease)).status).toBe("complete");
    expect((await repository.abort(wrongToken(lease), "not owner")).status).toBe("lease_lost");
    const outcomes = await Promise.all([
      repository.activate(lease),
      repository.abort(lease, "cancelled concurrently"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "activated" || outcome.status === "aborted")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "lease_lost")).toHaveLength(1);
    expect((await db!.query(`SELECT active_graph_generation_id FROM workspaces WHERE project_id = $1`, [projectId])).rows[0].active_graph_generation_id)
      .toBe(outcomes.some((outcome) => outcome.status === "activated") ? lease.generationId : legacyGenerationId);
  });

  test("abort deletes all pending graph rows while retaining active visibility and failure metadata", async () => {
    const lease = await begin();
    await insertCompleteGraph(lease);
    expect((await repository.abort(lease, "cancelled")).status).toBe("aborted");
    for (const table of ["symbol_files", "symbol_definitions", "symbol_references", "symbol_imports", "symbol_centrality"]) {
      expect((await db!.query(`SELECT count(*)::int AS count FROM ${table} WHERE generation_id = $1`, [lease.generationId])).rows[0].count).toBe(0);
    }
    expect((await db!.query(`SELECT status, failure_reason FROM graph_generations WHERE id = $1`, [lease.generationId])).rows[0])
      .toEqual({ status: "failed", failure_reason: "cancelled" });
    expect((await db!.query(`SELECT active_graph_generation_id, pending_graph_generation_id FROM workspaces WHERE project_id = $1`, [projectId])).rows[0])
      .toEqual({ active_graph_generation_id: legacyGenerationId, pending_graph_generation_id: null });
  });

  test("concurrent activation attempts permit exactly one owner transition", async () => {
    const lease = await begin();
    await insertRecoveredFile(lease);
    expect((await repository.complete(lease)).status).toBe("complete");
    const outcomes = await Promise.all([repository.activate(lease), repository.activate(lease)]);
    expect(outcomes.filter((outcome) => outcome.status === "activated")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "lease_lost")).toHaveLength(1);
  });

  test("cleanup removes only unretained superseded generations", async () => {
    await db!.query(
      `INSERT INTO graph_generations (id, project_id, status, fingerprint, input_snapshot_hash, started_at, completed_at, superseded_at)
       VALUES
         ('old-delete', $1, 'superseded', 'v0', 's0', NOW(), NOW(), NOW()),
         ('old-retain', $1, 'superseded', 'v0', 's1', NOW(), NOW(), NOW()),
         ('old-lkg', $1, 'superseded', 'v0', 's2', NOW(), NOW(), NOW())`,
      [projectId],
    );
    await db!.query(
      `INSERT INTO symbol_files (project_id, generation_id, relative_path, content_hash, mtime, indexed_at, parser_status, last_known_good_generation_id)
       VALUES ($1, $2, 'src/active.ts', 'hash', 1, NOW(), 'ok', 'old-lkg')`,
      [projectId, legacyGenerationId],
    );
    const pending = await begin();
    const removed = await repository.cleanupSuperseded(projectId, { retainedGenerationIds: ["old-retain"] });
    expect(removed).toBe(1);
    const ids = (await db!.query(`SELECT id FROM graph_generations WHERE project_id = $1 ORDER BY id`, [projectId])).rows.map((row) => row.id);
    expect(ids).toContain(legacyGenerationId);
    expect(ids).toContain(pending.generationId);
    expect(ids).toContain("old-retain");
    expect(ids).toContain("old-lkg");
    expect(ids).not.toContain("old-delete");
  });
});

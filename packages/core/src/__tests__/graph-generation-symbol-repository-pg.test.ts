import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import type { GraphGenerationLease } from "../data/graph-generation/graph-generation-contract.js";

const adminUrl = "postgresql://test@127.0.0.1:5433/postgres";
const requested = process.env.RUN_GRAPH_GENERATION_SYMBOL_REPOSITORY === "1" &&
  process.env.MASSA_TH0TH_DEDICATED === "1";
const databaseName = `massa_graph_symbol_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const projectId = "generation-symbol-project";
const activeId = "generation-active";
const pendingId = "generation-pending";
const leaseToken = "pending-owner-token";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

type Lookup =
  | { found: true; ambiguous: false; definition: { id: string } }
  | { found: false; ambiguous: false; fqn?: string; legacyFqn?: string; candidates: [] }
  | { found: false; ambiguous: true; legacyFqn: string; candidates: Array<{ fqn: string; file: string; qualifiedName: string; kind: string; signatureHash: string }> };

interface Task12Repository {
  getFile(projectId: string, path: string): Promise<{ content_hash: string } | null>;
  searchDefinitions(projectId: string, query?: string): Promise<Array<{ id: string }>>;
  getReferences(projectId: string, symbol: string): Promise<Array<{ from_file: string; target_fqn?: string }>>;
  getImportsFrom(projectId: string, path: string): Promise<Array<{ specifier: string }>>;
  getTopCentralFiles(projectId: string): Promise<Array<{ file_path: string; score: number }>>;
  getProjectMapAggregates(projectId: string): Promise<{ symbolsByKind: Record<string, number>; filesByLanguage: Record<string, number> }>;
  writeFileGeneration(input: { lease: GraphGenerationLease; file: Record<string, unknown>; definitions: Record<string, unknown>[]; references: Record<string, unknown>[]; imports: Record<string, unknown>[] }): Promise<{ status: string }>;
  copyFileGeneration(lease: GraphGenerationLease, sourceGenerationId: string, path: string): Promise<{ status: string }>;
  deleteFileGeneration(lease: GraphGenerationLease, path: string): Promise<{ status: string }>;
  markFileStaleGeneration(lease: GraphGenerationLease, path: string, input: { lastKnownGoodGenerationId: string; diagnostics: Record<string, unknown>[]; parserErrorCount: number }): Promise<{ status: string }>;
  updateCentralityGeneration(lease: GraphGenerationLease, entries: Array<{ filePath: string; score: number }>): Promise<{ status: string }>;
  resolveDefinitionFqn(projectId: string, fqn: string): Promise<Lookup>;
  getActiveGraphSnapshot(projectId: string): Promise<{ generationId: string; counts: Record<string, number>; diagnostics: { recovered: number; hardFailures: number; staleFiles: number; errors: number } }>;
  writeFileSymbols(projectId: string, path: string, definitions: Record<string, unknown>[], references: Record<string, unknown>[], imports: Record<string, unknown>[]): Promise<void>;
  updateCentrality(projectId: string, scores: Map<string, number>): Promise<void>;
}

let admin: Client | undefined;
let db: Client | undefined;
let repository: Task12Repository;
let previousDatabaseUrl: string | undefined;
let ownsDatabase = false;

function migrations(): string[] {
  const root = join(import.meta.dir, "../../prisma/migrations");
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    .map((directory) => readFileSync(join(root, directory, "migration.sql"), "utf8"));
}

function lease(overrides: Partial<GraphGenerationLease> = {}): GraphGenerationLease {
  return {
    projectId, generationId: pendingId, leaseToken, fingerprint: "structural:v2",
    inputSnapshotHash: "snapshot:v2", expectedActiveGenerationId: activeId,
    expectedFilesCount: 2, leaseExpiresAt: Date.now() + 60_000, ...overrides,
  };
}

async function seedFile(generationId: string, path: string, hash: string, status = "ok", errors = 0, stale = false) {
  await db!.query(
    `INSERT INTO symbol_files (project_id,generation_id,relative_path,content_hash,mtime,size,indexed_at,symbol_count,chunk_count,language,grammar_version,query_pack_version,resolver_version,parser_status,parser_error_count,diagnostics,is_stale,last_known_good_generation_id,last_successful_at)
     VALUES ($1,$2,$3,$4,1,10,NOW(),1,0,'typescript','g1','q1','r1',$5,$6,$7::jsonb,$8,$2,NOW())`,
    [projectId, generationId, path, hash, status, errors, JSON.stringify(errors ? [{ code: `${generationId}-diagnostic` }] : []), stale],
  );
}

async function seedDefinition(generationId: string, id: string, file: string, qualifiedName: string, legacyFqn: string, hash = hashA) {
  await db!.query(
    `INSERT INTO symbol_definitions (id,project_id,generation_id,file_path,name,kind,line_start,line_end,exported,indexed_at,qualified_name,canonical_signature,signature_hash,legacy_fqn)
     VALUES ($1,$2,$3,$4,$5,'function',1,2,true,NOW(),$6,$7,$8,$9)`,
    [id, projectId, generationId, file, qualifiedName.split(".").at(-1), qualifiedName, `function:${qualifiedName}`, hash, legacyFqn],
  );
}

async function resetFixture() {
  await db!.query(`TRUNCATE TABLE workspaces CASCADE`);
  await db!.query(`INSERT INTO workspaces (project_id,project_path,status,updated_at) VALUES ($1,'/tmp/generation-symbol','indexed',NOW())`, [projectId]);
  await db!.query(
    `INSERT INTO graph_generations (id,project_id,status,fingerprint,input_snapshot_hash,expected_active_id,lease_token,lease_expires_at,expected_files_count,started_at,completed_at,activated_at)
     VALUES ($1,$3,'active','structural:v1','snapshot:v1',NULL,NULL,NULL,1,NOW(),NOW(),NOW()),
            ($2,$3,'pending','structural:v2','snapshot:v2',$1,$4,NOW()+INTERVAL '5 minutes',2,NOW(),NULL,NULL)`,
    [activeId, pendingId, projectId, leaseToken],
  );
  await db!.query(
    `UPDATE workspaces SET active_graph_generation_id=$1,pending_graph_generation_id=$2,graph_lease_token=$3,graph_lease_expires_at=NOW()+INTERVAL '5 minutes',graph_lease_heartbeat_at=NOW() WHERE project_id=$4`,
    [activeId, pendingId, leaseToken, projectId],
  );
  await seedFile(activeId, "src/active.ts", "active-hash");
  await seedDefinition(activeId, `src/active.ts#Active~function~${hashA}`, "src/active.ts", "Active", "src/active.ts#Active");
  await db!.query(`INSERT INTO symbol_references (project_id,generation_id,from_file,from_line,symbol_name,target_fqn,ref_kind) VALUES ($1,$2,'src/active.ts',2,'Active',$3,'call')`, [projectId, activeId, `src/active.ts#Active~function~${hashA}`]);
  await db!.query(`INSERT INTO symbol_imports (project_id,generation_id,from_file,specifier,imported_names,is_external,is_type_only) VALUES ($1,$2,'src/active.ts','./active',ARRAY['Active'],false,false)`, [projectId, activeId]);
  await db!.query(`INSERT INTO symbol_centrality (project_id,generation_id,file_path,score,updated_at) VALUES ($1,$2,'src/active.ts',0.25,NOW())`, [projectId, activeId]);
}

beforeAll(async () => {
  if (!requested) return;
  expect(process.platform).toBe("darwin");
  expect(process.arch).toBe("arm64");
  expect(process.env.GRAPH_GENERATION_TEST_ADMIN_URL).toBe(adminUrl);
  admin = new Client({ connectionString: adminUrl });
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
  const module = await import("../data/symbol/symbol-repository-pg.js");
  repository = module.SymbolRepositoryPg.getInstance() as unknown as Task12Repository;
});

beforeEach(async () => { if (requested) await resetFixture(); });

afterAll(async () => {
  if (!requested) return;
  const { disconnectPrisma } = await import("../services/query/prisma-client.js");
  await disconnectPrisma();
  await db?.end();
  if (admin && ownsDatabase) {
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [databaseName]);
    await admin.query(`DROP DATABASE "${databaseName}"`);
  }
  await admin?.end();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

describe.skipIf(!requested)("owned PostgreSQL generation-scoped symbol repository", () => {
  test("real ETL stages activate recovered syntax before durable terminal visibility and reconcile deletion", async () => {
    await db!.query(`UPDATE workspaces SET pending_graph_generation_id=NULL,graph_lease_token=NULL,graph_lease_expires_at=NULL,graph_lease_heartbeat_at=NULL WHERE project_id=$1`, [projectId]);
    await db!.query(`DELETE FROM graph_generations WHERE project_id=$1 AND id=$2`, [projectId, pendingId]);
    const { EtlPipeline } = await import("../services/etl/pipeline.js");
    const { ParseStage } = await import("../services/etl/stages/parse.js");
    const { ResolveStage } = await import("../services/etl/stages/resolve.js");
    const { LoadStage } = await import("../services/etl/stages/load.js");
    const { indexJobTracker } = await import("../services/jobs/index-job-tracker.js");
    const pipeline = EtlPipeline.getInstance() as any;
    const originals = { parse: pipeline.parse, resolve: pipeline.resolve, load: pipeline.load };
    const projectPath = await fs.mkdtemp(join(os.tmpdir(), "task013-real-etl-"));
    await fs.mkdir(join(projectPath, "src"));
    await fs.writeFile(join(projectPath, "src/active.ts"), "export const active = 1;\n");
    await db!.query(`UPDATE workspaces SET project_path=$2 WHERE project_id=$1`, [projectId, projectPath]);
    const emptyStructure = { symbols: [], edges: [], imports: [] };
    pipeline.parse = new ParseStage({ parse: async () => ({
      status: "recovered", structure: emptyStructure, diagnosticCount: 14,
      diagnostics: Array.from({ length: 10 }, (_, index) => ({ code: `test_recovered_${index}`, severity: "recovered", message: "recovered syntax" })),
    }) });
    pipeline.resolve = new ResolveStage(repository as never);
    const load = new LoadStage() as any;
    load.vectorStore = { addDocuments: async () => {}, deleteByProject: async () => {} };
    load.keywordSearch = { addBatch: async () => {}, deleteByProject: async () => {} };
    pipeline.load = load;
    const events: string[] = [];
    const { eventBus } = await import("../services/events/event-bus.js");
    let observedJobId = "";
    let resolveDurableEvent!: () => void;
    const durableEvent = new Promise<void>((resolve) => { resolveDurableEvent = resolve; });
    const unsubscribe = eventBus.subscribe("indexing:completed", (event) => {
      void db!.query(`SELECT status,activated_graph_generation_id FROM index_jobs WHERE job_id=$1`, [observedJobId]).then(({ rows }) => {
        events.push(`completed:${event.activatedGraphGenerationId}:${rows[0]?.status}:${rows[0]?.activated_graph_generation_id}`);
        resolveDurableEvent();
      });
    });
    try {
      const job = indexJobTracker.createJob(projectId, projectPath);
      observedJobId = job.jobId;
      indexJobTracker.updateStatus(job.jobId, "running");
      const result = await pipeline.run({ projectId, projectPath, jobId: job.jobId });
      await durableEvent;
      expect(events).toEqual([`completed:${result.activatedGraphGenerationId}:completed:${result.activatedGraphGenerationId}`]);
      expect(indexJobTracker.getJob(job.jobId)?.result?.activatedGraphGenerationId).toBe(result.activatedGraphGenerationId);
      expect((await repository.getFile(projectId, "src/active.ts"))?.content_hash).toHaveLength(64);
      expect((await db!.query(`SELECT parser_status,parser_error_count,jsonb_array_length(diagnostics)::int detail_count FROM symbol_files WHERE project_id=$1 AND generation_id=$2`, [projectId, result.activatedGraphGenerationId])).rows[0])
        .toEqual({ parser_status: "recovered", parser_error_count: 14, detail_count: 10 });
      expect(indexJobTracker.getJob(job.jobId)?.result?.parserDiagnostics).toEqual({
        diagnosticsCount: 14, recoveredFiles: 1, hardFailureFiles: 0, staleFiles: 0, languages: { TypeScript: 1 },
      });

      await fs.unlink(join(projectPath, "src/active.ts"));
      const deleteJob = indexJobTracker.createJob(projectId, projectPath);
      observedJobId = deleteJob.jobId;
      indexJobTracker.updateStatus(deleteJob.jobId, "running");
      await pipeline.run({ projectId, projectPath, jobId: deleteJob.jobId });
      expect(await repository.getFile(projectId, "src/active.ts")).toBeNull();
    } finally {
      unsubscribe();
      pipeline.parse = originals.parse; pipeline.resolve = originals.resolve; pipeline.load = originals.load;
      await fs.rm(projectPath, { recursive: true, force: true });
    }
  });

  test("real ETL stages keep the old graph visible when a full structural parse fails", async () => {
    await db!.query(`UPDATE workspaces SET pending_graph_generation_id=NULL,graph_lease_token=NULL,graph_lease_expires_at=NULL,graph_lease_heartbeat_at=NULL WHERE project_id=$1`, [projectId]);
    await db!.query(`DELETE FROM graph_generations WHERE project_id=$1 AND id=$2`, [projectId, pendingId]);
    const { EtlPipeline } = await import("../services/etl/pipeline.js");
    const { ParseStage } = await import("../services/etl/stages/parse.js");
    const pipeline = EtlPipeline.getInstance() as any;
    const originalParse = pipeline.parse;
    const projectPath = await fs.mkdtemp(join(os.tmpdir(), "task013-hard-failure-"));
    await fs.writeFile(join(projectPath, "broken.ts"), "export const broken = true;\n");
    await db!.query(`UPDATE workspaces SET project_path=$2 WHERE project_id=$1`, [projectId, projectPath]);
    pipeline.parse = new ParseStage({ parse: async () => ({
      status: "failed", failureKind: "parser", diagnosticCount: 1,
      diagnostics: [{ code: "test_hard_failure", severity: "error", message: "hard failure" }],
    }) });
    try {
      await expect(pipeline.run({ projectId, projectPath, jobId: `hard-${randomUUID()}` })).rejects.toThrow("Structural parse failed");
      expect((await db!.query(`SELECT active_graph_generation_id,pending_graph_generation_id FROM workspaces WHERE project_id=$1`, [projectId])).rows[0])
        .toEqual({ active_graph_generation_id: activeId, pending_graph_generation_id: null });
      expect((await repository.getFile(projectId, "src/active.ts"))?.content_hash).toBe("active-hash");
    } finally {
      pipeline.parse = originalParse;
      await fs.rm(projectPath, { recursive: true, force: true });
    }
  });

  test("real ETL stages activate multiple incremental failures as stale LKG files and recover them", async () => {
    await db!.query(`UPDATE workspaces SET pending_graph_generation_id=NULL,graph_lease_token=NULL,graph_lease_expires_at=NULL,graph_lease_heartbeat_at=NULL WHERE project_id=$1`, [projectId]);
    await db!.query(`DELETE FROM graph_generations WHERE project_id=$1 AND id=$2`, [projectId, pendingId]);
    await seedFile(activeId, "a.ts", "old-a");
    await seedFile(activeId, "b.ts", "old-b");
    const { EtlPipeline } = await import("../services/etl/pipeline.js");
    const { ParseStage } = await import("../services/etl/stages/parse.js");
    const { ResolveStage } = await import("../services/etl/stages/resolve.js");
    const { LoadStage } = await import("../services/etl/stages/load.js");
    const pipeline = EtlPipeline.getInstance() as any;
    const originals = { parse: pipeline.parse, resolve: pipeline.resolve, load: pipeline.load };
    const projectPath = await fs.mkdtemp(join(os.tmpdir(), "task013-incremental-"));
    await fs.writeFile(join(projectPath, "a.ts"), "export const changedA = true;\n");
    await fs.writeFile(join(projectPath, "b.ts"), "export const changedB = true;\n");
    await db!.query(`UPDATE workspaces SET project_path=$2 WHERE project_id=$1`, [projectId, projectPath]);
    const emptyStructure = { symbols: [], edges: [], imports: [] };
    const load = new LoadStage() as any;
    load.vectorStore = { addDocuments: async () => {}, deleteByProject: async () => {} };
    load.keywordSearch = { addBatch: async () => {}, deleteByProject: async () => {} };
    pipeline.resolve = new ResolveStage(repository as never);
    pipeline.load = load;
    try {
      pipeline.parse = new ParseStage({ parse: async () => ({
        status: "failed", failureKind: "parser", diagnosticCount: 14,
        diagnostics: Array.from({ length: 10 }, (_, index) => ({
          code: `incremental_failure_${index}`, severity: "error", message: "incremental failure",
          span: { startByte: index, endByte: index + 1, start: { row: index, column: 0 }, end: { row: index, column: 1 } },
        })),
      }) });
      const stale = await pipeline.run({
        projectId, projectPath, jobId: `stale-${randomUUID()}`, filesToProcess: ["a.ts", "b.ts"],
      });
      expect(stale.parserDiagnostics).toEqual({ diagnosticsCount: 28, recoveredFiles: 0, hardFailureFiles: 2, staleFiles: 2, languages: { typescript: 2 } });
      expect((await db!.query(`SELECT count(*)::int count FROM symbol_files WHERE generation_id=$1 AND is_stale`, [stale.activatedGraphGenerationId])).rows[0].count).toBe(2);
      expect((await db!.query(`SELECT parser_error_count,jsonb_array_length(diagnostics)::int detail_count,diagnostics->0->'span' AS first_span FROM symbol_files WHERE generation_id=$1 AND is_stale ORDER BY relative_path`, [stale.activatedGraphGenerationId])).rows)
        .toEqual(Array.from({ length: 2 }, () => ({ parser_error_count: 14, detail_count: 10, first_span: { startByte: 0, endByte: 1, start: { row: 0, column: 0 }, end: { row: 0, column: 1 } } })));

      pipeline.parse = new ParseStage({ parse: async () => ({
        status: "ok", structure: emptyStructure, diagnosticCount: 0, diagnostics: [],
      }) });
      const recovered = await pipeline.run({
        projectId, projectPath, jobId: `recover-${randomUUID()}`, filesToProcess: ["a.ts", "b.ts"],
      });
      expect((await db!.query(`SELECT count(*)::int count FROM symbol_files WHERE generation_id=$1 AND is_stale`, [recovered.activatedGraphGenerationId])).rows[0].count).toBe(0);
      expect((await db!.query(`SELECT count(*)::int count FROM symbol_files WHERE generation_id=$1`, [recovered.activatedGraphGenerationId])).rows[0].count).toBe(2);
    } finally {
      pipeline.parse = originals.parse; pipeline.resolve = originals.resolve; pipeline.load = originals.load;
      await fs.rm(projectPath, { recursive: true, force: true });
    }
  });

  test("real discovery and stages abort unreadable and mid-run stale snapshots without completion", async () => {
    await db!.query(`UPDATE workspaces SET pending_graph_generation_id=NULL,graph_lease_token=NULL,graph_lease_expires_at=NULL,graph_lease_heartbeat_at=NULL WHERE project_id=$1`, [projectId]);
    await db!.query(`DELETE FROM graph_generations WHERE project_id=$1 AND id=$2`, [projectId, pendingId]);
    const { EtlPipeline } = await import("../services/etl/pipeline.js");
    const { ParseStage } = await import("../services/etl/stages/parse.js");
    const { ResolveStage } = await import("../services/etl/stages/resolve.js");
    const { LoadStage } = await import("../services/etl/stages/load.js");
    const { eventBus } = await import("../services/events/event-bus.js");
    const pipeline = EtlPipeline.getInstance() as any;
    const originals = { parse: pipeline.parse, resolve: pipeline.resolve, load: pipeline.load };
    const completed: string[] = [];
    const unsubscribe = eventBus.subscribe("indexing:completed", (event) => completed.push(event.jobId));
    const emptyStructure = { symbols: [], edges: [], imports: [] };
    const projectPath = await fs.mkdtemp(join(os.tmpdir(), "task013-faults-"));
    await db!.query(`UPDATE workspaces SET project_path=$2 WHERE project_id=$1`, [projectId, projectPath]);
    pipeline.parse = new ParseStage({ parse: async () => ({ status: "ok", structure: emptyStructure, diagnosticCount: 0, diagnostics: [] }) });
    pipeline.resolve = new ResolveStage(repository as never);
    try {
      await fs.symlink(join(projectPath, "missing-target"), join(projectPath, "unreadable.ts"));
      const unreadableJob = `unreadable-${randomUUID()}`;
      await expect(pipeline.run({ projectId, projectPath, jobId: unreadableJob })).rejects.toThrow("required_file_unreadable:unreadable.ts");
      expect(completed).not.toContain(unreadableJob);
      await fs.unlink(join(projectPath, "unreadable.ts"));

      await fs.writeFile(join(projectPath, "changed.ts"), "export const before = 1;\n");
      const load = new LoadStage() as any;
      load.vectorStore = { addDocuments: async () => { await fs.writeFile(join(projectPath, "changed.ts"), "export const after = 2;\n"); } };
      load.keywordSearch = { addBatch: async () => {} };
      pipeline.load = load;
      const staleJob = `stale-snapshot-${randomUUID()}`;
      await expect(pipeline.run({ projectId, projectPath, jobId: staleJob })).rejects.toThrow("graph_generation_stale_snapshot");
      expect(completed).not.toContain(staleJob);
      expect((await db!.query(`SELECT active_graph_generation_id,pending_graph_generation_id FROM workspaces WHERE project_id=$1`, [projectId])).rows[0])
        .toEqual({ active_graph_generation_id: activeId, pending_graph_generation_id: null });
    } finally {
      unsubscribe();
      pipeline.parse = originals.parse; pipeline.resolve = originals.resolve; pipeline.load = originals.load;
      await fs.rm(projectPath, { recursive: true, force: true });
    }
  });

  test("pipeline waits for interrupted work to settle before abort cleanup and emits no completion", async () => {
    await db!.query(`UPDATE workspaces SET pending_graph_generation_id=NULL,graph_lease_token=NULL,graph_lease_expires_at=NULL,graph_lease_heartbeat_at=NULL WHERE project_id=$1`, [projectId]);
    await db!.query(`DELETE FROM graph_generations WHERE project_id=$1 AND id=$2`, [projectId, pendingId]);
    const { EtlPipeline } = await import("../services/etl/pipeline.js");
    const { ParseStage } = await import("../services/etl/stages/parse.js");
    const { ResolveStage } = await import("../services/etl/stages/resolve.js");
    const { LoadStage } = await import("../services/etl/stages/load.js");
    const { GraphGenerationRepositoryPg } = await import("../data/graph-generation/graph-generation-repository-pg.js");
    const { eventBus } = await import("../services/events/event-bus.js");
    const graphRepository = GraphGenerationRepositoryPg.getInstance();
    const pipeline = EtlPipeline.getInstance() as any;
    const originals = { parse: pipeline.parse, resolve: pipeline.resolve, load: pipeline.load };
    const projectPath = await fs.mkdtemp(join(os.tmpdir(), "task013-interrupt-"));
    await fs.writeFile(join(projectPath, "interrupt.ts"), "export const interrupt = 1;\n");
    await db!.query(`UPDATE workspaces SET project_path=$2 WHERE project_id=$1`, [projectId, projectPath]);
    const completed: string[] = [];
    const unsubscribe = eventBus.subscribe("indexing:completed", (event) => completed.push(event.jobId));
    let externalSettled = false;
    const load = new LoadStage() as any;
    load.vectorStore = { addDocuments: async () => {} };
    load.keywordSearch = { addBatch: async () => {} };
    pipeline.parse = new ParseStage({ parse: async () => {
      const row = (await db!.query(`SELECT g.id,g.fingerprint,g.input_snapshot_hash,g.expected_active_id,g.expected_files_count,w.graph_lease_token,EXTRACT(EPOCH FROM w.graph_lease_expires_at)*1000 lease_expires_at FROM workspaces w JOIN graph_generations g ON g.id=w.pending_graph_generation_id WHERE w.project_id=$1`, [projectId])).rows[0];
      await graphRepository.abort({ projectId, generationId: row.id, leaseToken: row.graph_lease_token, fingerprint: row.fingerprint, inputSnapshotHash: row.input_snapshot_hash, expectedActiveGenerationId: row.expected_active_id, expectedFilesCount: row.expected_files_count, leaseExpiresAt: Number(row.lease_expires_at) }, "test_interruption");
      await new Promise((resolve) => setTimeout(resolve, 20));
      externalSettled = true;
      return { status: "ok", structure: { symbols: [], edges: [], imports: [] }, diagnosticCount: 0, diagnostics: [] };
    } });
    pipeline.resolve = new ResolveStage(repository as never); pipeline.load = load;
    const jobId = `interrupt-${randomUUID()}`;
    try {
      await expect(pipeline.run({ projectId, projectPath, jobId })).rejects.toThrow();
      expect(externalSettled).toBe(true);
      expect(completed).not.toContain(jobId);
      expect((await db!.query(`SELECT active_graph_generation_id,pending_graph_generation_id FROM workspaces WHERE project_id=$1`, [projectId])).rows[0])
        .toEqual({ active_graph_generation_id: activeId, pending_graph_generation_id: null });
      expect((await db!.query(`SELECT count(*)::int count FROM symbol_files WHERE project_id=$1 AND generation_id<>$2`, [projectId, activeId])).rows[0].count).toBe(0);
    } finally {
      unsubscribe(); pipeline.parse = originals.parse; pipeline.resolve = originals.resolve; pipeline.load = originals.load;
      await fs.rm(projectPath, { recursive: true, force: true });
    }
  });

  test("pipeline refreshes stale active state after another owner activates", async () => {
    await db!.query(`UPDATE workspaces SET pending_graph_generation_id=NULL,graph_lease_token=NULL,graph_lease_expires_at=NULL,graph_lease_heartbeat_at=NULL WHERE project_id=$1`, [projectId]);
    await db!.query(`DELETE FROM graph_generations WHERE project_id=$1 AND id=$2`, [projectId, pendingId]);
    const { GraphGenerationRepositoryPg } = await import("../data/graph-generation/graph-generation-repository-pg.js");
    const graphRepository = GraphGenerationRepositoryPg.getInstance();
    const owner = await graphRepository.begin({ projectId, expectedActiveGenerationId: activeId, fingerprint: "owner", inputSnapshotHash: "owner-snapshot", expectedFilesCount: 1, leaseTtlMs: 60_000 });
    expect(owner.status).toBe("acquired"); if (owner.status !== "acquired") return;
    expect((await repository.copyFileGeneration(owner.lease, activeId, "src/active.ts")).status).toBe("copied");
    const { EtlPipeline } = await import("../services/etl/pipeline.js");
    const { ParseStage } = await import("../services/etl/stages/parse.js");
    const { ResolveStage } = await import("../services/etl/stages/resolve.js");
    const { LoadStage } = await import("../services/etl/stages/load.js");
    const pipeline = EtlPipeline.getInstance() as any;
    const originals = { parse: pipeline.parse, resolve: pipeline.resolve, load: pipeline.load };
    const projectPath = await fs.mkdtemp(join(os.tmpdir(), "task013-stale-active-"));
    await fs.writeFile(join(projectPath, "active.ts"), "export const fresh = 1;\n");
    await db!.query(`UPDATE workspaces SET project_path=$2 WHERE project_id=$1`, [projectId, projectPath]);
    const load = new LoadStage() as any; load.vectorStore = { addDocuments: async () => {} }; load.keywordSearch = { addBatch: async () => {} };
    pipeline.parse = new ParseStage({ parse: async () => ({ status: "ok", structure: { symbols: [], edges: [], imports: [] }, diagnosticCount: 0, diagnostics: [] }) });
    pipeline.resolve = new ResolveStage(repository as never); pipeline.load = load;
    const ownerActivation = new Promise<void>((resolve, reject) => setTimeout(() => {
      graphRepository.complete(owner.lease).then(() => graphRepository.activate(owner.lease)).then(() => resolve(), reject);
    }, 100));
    try {
      const result = await pipeline.run({ projectId, projectPath, jobId: `waiter-${randomUUID()}` });
      await ownerActivation;
      expect(result.activatedGraphGenerationId).not.toBe(owner.lease.generationId);
      expect((await db!.query(`SELECT active_graph_generation_id FROM workspaces WHERE project_id=$1`, [projectId])).rows[0].active_graph_generation_id).toBe(result.activatedGraphGenerationId);
    } finally {
      pipeline.parse = originals.parse; pipeline.resolve = originals.resolve; pipeline.load = originals.load;
      await fs.rm(projectPath, { recursive: true, force: true });
    }
  });

  test("durably round-trips parser summary with activated identity and accepts old NULL rows", async () => {
    const { PgJobStore } = await import("../services/jobs/index-job-store-pg.js");
    const store = new PgJobStore();
    const jobId = `task013-job-${randomUUID()}`;
    store.save({
      jobId, projectId, projectPath: "/tmp/generation-symbol", status: "completed",
      progress: { current: 1, total: 1, percentage: 100 },
      result: { filesIndexed: 1, chunksIndexed: 0, errors: 0, duration: 1, activatedGraphGenerationId: activeId,
        parserDiagnostics: { diagnosticsCount: 17, recoveredFiles: 2, hardFailureFiles: 1, staleFiles: 1, languages: { typescript: 2, python: 1 } } },
      createdAt: new Date(), completedAt: new Date(),
    });
    await store.__drain(jobId);
    const row = await db!.query(`SELECT status,activated_graph_generation_id,parser_diagnostics_count,parser_recovered_files,parser_hard_failure_files,parser_stale_files,parser_language_counts FROM index_jobs WHERE job_id=$1`, [jobId]);
    expect(row.rows[0]).toEqual({ status: "completed", activated_graph_generation_id: activeId, parser_diagnostics_count: 17,
      parser_recovered_files: 2, parser_hard_failure_files: 1, parser_stale_files: 1, parser_language_counts: { typescript: 2, python: 1 } });
    const hydrated = new PgJobStore();
    await hydrated.__drain();
    await (hydrated as any).ensureHydrated();
    expect(hydrated.get(jobId)?.result?.parserDiagnostics).toEqual({ diagnosticsCount: 17, recoveredFiles: 2, hardFailureFiles: 1, staleFiles: 1, languages: { typescript: 2, python: 1 } });

    const legacyId = `legacy-job-${randomUUID()}`;
    await db!.query(`INSERT INTO index_jobs (job_id,project_id,project_path,status,created_at) VALUES ($1,$2,'/tmp/legacy','completed',1)`, [legacyId, projectId]);
    const legacy = new PgJobStore(); await (legacy as any).ensureHydrated();
    expect(legacy.get(legacyId)?.result).toBeUndefined();
  });

  test("copies an unchanged last-known-good file into pending ownership", async () => {
    expect((await repository.copyFileGeneration(lease(), activeId, "src/active.ts")).status).toBe("copied");
    const counts = await db!.query(`SELECT
      (SELECT count(*) FROM symbol_files WHERE generation_id=$1 AND relative_path='src/active.ts')::int files,
      (SELECT count(*) FROM symbol_definitions WHERE generation_id=$1 AND file_path='src/active.ts')::int defs,
      (SELECT count(*) FROM symbol_references WHERE generation_id=$1 AND from_file='src/active.ts')::int refs,
      (SELECT count(*) FROM symbol_imports WHERE generation_id=$1 AND from_file='src/active.ts')::int imports,
      (SELECT count(*) FROM symbol_centrality WHERE generation_id=$1 AND file_path='src/active.ts')::int centrality`, [pendingId]);
    expect(counts.rows[0]).toEqual({ files: 1, defs: 1, refs: 1, imports: 1, centrality: 1 });
    expect((await repository.copyFileGeneration(lease(), activeId, "src/missing.ts")).status).toBe("missing");
  });

  test("keeps pending files, definitions, edges, imports, centrality, and aggregates invisible", async () => {
    await seedFile(pendingId, "src/pending.ts", "pending-hash", "recovered", 3);
    await seedDefinition(pendingId, `src/pending.ts#Pending~function~${hashB}`, "src/pending.ts", "Pending", "src/pending.ts#Pending", hashB);
    await db!.query(`INSERT INTO symbol_references (project_id,generation_id,from_file,from_line,symbol_name,target_fqn,ref_kind) VALUES ($1,$2,'src/pending.ts',2,'Pending','src/pending.ts#Pending','call')`, [projectId, pendingId]);
    await db!.query(`INSERT INTO symbol_imports (project_id,generation_id,from_file,specifier,imported_names,is_external,is_type_only) VALUES ($1,$2,'src/pending.ts','./pending',ARRAY['Pending'],false,false)`, [projectId, pendingId]);
    await db!.query(`INSERT INTO symbol_centrality (project_id,generation_id,file_path,score,updated_at) VALUES ($1,$2,'src/pending.ts',9,NOW())`, [projectId, pendingId]);
    expect(await repository.getFile(projectId, "src/pending.ts")).toBeNull();
    expect(await repository.searchDefinitions(projectId, "Pending")).toEqual([]);
    expect(await repository.getReferences(projectId, "Pending")).toEqual([]);
    expect(await repository.getImportsFrom(projectId, "src/pending.ts")).toEqual([]);
    expect((await repository.getTopCentralFiles(projectId)).map((row) => row.file_path)).toEqual(["src/active.ts"]);
    expect(await repository.getProjectMapAggregates(projectId)).toMatchObject({ symbolsByKind: { function: 1 }, filesByLanguage: { ts: 1 } });
  });

  test("atomically replaces one pending file and removes its stale edges", async () => {
    const base = { project_id: projectId, file_path: "src/new.ts", exported: true, indexed_at: Date.now() };
    const write = (name: string) => repository.writeFileGeneration({ lease: lease(), file: { project_id: projectId, relative_path: "src/new.ts", content_hash: name, mtime: 1, size: 10, indexed_at: Date.now(), symbol_count: 1, chunk_count: 0, language: "typescript", grammar_version: "g1", query_pack_version: "q1", resolver_version: "r1", parser_status: "ok", parser_error_count: 0, diagnostics: [] }, definitions: [{ ...base, id: `src/new.ts#${name}`, name, kind: "function", line_start: 1, line_end: 2, qualified_name: name, legacy_fqn: `src/new.ts#${name}` }], references: [{ project_id: projectId, from_file: "src/new.ts", from_line: 2, symbol_name: name, target_fqn: `src/new.ts#${name}`, ref_kind: "call" }], imports: [{ project_id: projectId, from_file: "src/new.ts", specifier: `./${name}`, imported_names: [name], is_external: false, is_type_only: false }] });
    expect((await write("Old")).status).toBe("written");
    expect((await write("New")).status).toBe("written");
    const rows = await db!.query(`SELECT (SELECT count(*) FROM symbol_definitions WHERE generation_id=$1 AND file_path='src/new.ts')::int defs,(SELECT count(*) FROM symbol_references WHERE generation_id=$1 AND from_file='src/new.ts')::int refs,(SELECT count(*) FROM symbol_imports WHERE generation_id=$1 AND from_file='src/new.ts')::int imports`, [pendingId]);
    expect(rows.rows[0]).toEqual({ defs: 1, refs: 1, imports: 1 });
    expect((await db!.query(`SELECT name FROM symbol_definitions WHERE generation_id=$1 AND file_path='src/new.ts'`, [pendingId])).rows[0].name).toBe("New");
  });

  test("rejects wrong token, generation, fingerprint, snapshot, and expired owners without mutation", async () => {
    const input = { file: { project_id: projectId, relative_path: "src/forbidden.ts", content_hash: "x", mtime: 1, size: 1, indexed_at: Date.now(), symbol_count: 0, chunk_count: 0 }, definitions: [], references: [], imports: [] };
    for (const bad of [lease({ leaseToken: "wrong" }), lease({ generationId: activeId }), lease({ fingerprint: "wrong" }), lease({ inputSnapshotHash: "wrong" })]) {
      expect((await repository.writeFileGeneration({ lease: bad, ...input })).status).toBe("lease_lost");
    }
    await db!.query(`UPDATE workspaces SET graph_lease_expires_at=NOW()-INTERVAL '1 second' WHERE project_id=$1`, [projectId]);
    expect((await repository.writeFileGeneration({ lease: lease(), ...input })).status).toBe("lease_lost");
    expect((await db!.query(`SELECT count(*)::int count FROM symbol_files WHERE relative_path='src/forbidden.ts'`)).rows[0].count).toBe(0);
  });

  test("resolves exact modern ids before exact legacy aliases and never by substring", async () => {
    const modern = `src/active.ts#Exact~function~${hashB}`;
    await seedDefinition(activeId, modern, "src/active.ts", "Exact", "src/active.ts#Exact", hashB);
    await seedDefinition(activeId, `src/active.ts#Other~function~${hashA}`, "src/active.ts", "Other", modern, hashA);
    expect(await repository.resolveDefinitionFqn(projectId, modern)).toMatchObject({ found: true, ambiguous: false, definition: { id: modern } });
    expect(await repository.resolveDefinitionFqn(projectId, "Exact")).toMatchObject({ found: false, ambiguous: false });
  });

  test("returns deterministic active-only legacy ambiguity candidates", async () => {
    const alias = "legacy/shared.ts#run";
    const z = `src/z.ts#Z.run~function~${hashB}`;
    const a = `src/a.ts#A.run~function~${hashA}`;
    await seedFile(activeId, "src/a.ts", "a"); await seedFile(activeId, "src/z.ts", "z"); await seedFile(pendingId, "src/p.ts", "p");
    await seedDefinition(activeId, z, "src/z.ts", "Z.run", alias, hashB);
    await seedDefinition(activeId, a, "src/a.ts", "A.run", alias, hashA);
    await seedDefinition(pendingId, `src/p.ts#P.run~function~${hashA}`, "src/p.ts", "P.run", alias, hashA);
    const result = await repository.resolveDefinitionFqn(projectId, alias);
    expect(result).toMatchObject({ found: false, ambiguous: true, legacyFqn: alias });
    if (!result.found && result.ambiguous) expect(result.candidates.map((candidate) => candidate.fqn)).toEqual([a, z]);
  });

  test("scopes centrality writes and active diagnostic/count snapshots", async () => {
    expect((await repository.updateCentralityGeneration(lease(), [{ filePath: "src/pending.ts", score: 0.99 }])).status).toBe("written");
    await seedFile(pendingId, "src/pending.ts", "p", "recovered", 4, true);
    expect((await repository.getTopCentralFiles(projectId)).map((row) => row.file_path)).toEqual(["src/active.ts"]);
    expect(await repository.getActiveGraphSnapshot(projectId)).toMatchObject({ generationId: activeId, counts: { files: 1, definitions: 1, references: 1, imports: 1, centrality: 1 }, diagnostics: { recovered: 0, hardFailures: 0, staleFiles: 0, errors: 0 }, languages: { typescript: 1 } });
    await db!.query(`UPDATE graph_generations SET status='superseded' WHERE id=$1`, [activeId]);
    await db!.query(`UPDATE graph_generations SET status='active',completed_at=NOW(),activated_at=NOW() WHERE id=$1`, [pendingId]);
    await db!.query(`UPDATE workspaces SET active_graph_generation_id=$1,pending_graph_generation_id=NULL,graph_lease_token=NULL,graph_lease_expires_at=NULL,graph_lease_heartbeat_at=NULL WHERE project_id=$2`, [pendingId, projectId]);
    expect(await repository.getActiveGraphSnapshot(projectId)).toMatchObject({
      generationId: pendingId, diagnostics: { recovered: 1, hardFailures: 0, staleFiles: 1, errors: 4 }, languages: { typescript: 1 },
    });
  });

  test("deletes only the owned pending file graph", async () => {
    await seedFile(pendingId, "src/deleted.ts", "d");
    await seedDefinition(pendingId, "src/deleted.ts#Gone", "src/deleted.ts", "Gone", "src/deleted.ts#Gone");
    expect((await repository.deleteFileGeneration(lease(), "src/deleted.ts")).status).toBe("deleted");
    expect((await db!.query(`SELECT count(*)::int count FROM symbol_files WHERE generation_id=$1 AND relative_path='src/deleted.ts'`, [pendingId])).rows[0].count).toBe(0);
    expect(await repository.getFile(projectId, "src/active.ts")).not.toBeNull();
  });

  test("marks pending failures stale while retaining valid last-known-good identity", async () => {
    expect((await repository.markFileStaleGeneration(lease(), "src/active.ts", { lastKnownGoodGenerationId: activeId, diagnostics: [{ code: "parse_failed" }], parserErrorCount: 1 })).status).toBe("stale");
    const stale = (await db!.query(`SELECT parser_status,is_stale,last_known_good_generation_id,parser_error_count FROM symbol_files WHERE generation_id=$1 AND relative_path='src/active.ts'`, [pendingId])).rows[0];
    expect(stale).toEqual({ parser_status: "failed", is_stale: true, last_known_good_generation_id: activeId, parser_error_count: 1 });
    expect((await repository.getFile(projectId, "src/active.ts"))?.content_hash).toBe("active-hash");
  });

  test("stale fallback removes inbound references to discarded pending-only definitions", async () => {
    const pendingOnly = "src/active.ts#PendingOnly";
    await seedDefinition(pendingId, pendingOnly, "src/active.ts", "PendingOnly", pendingOnly);
    await seedFile(pendingId, "src/caller.ts", "caller");
    await db!.query(
      `INSERT INTO symbol_references (project_id,generation_id,from_file,from_line,symbol_name,target_fqn,ref_kind)
       VALUES ($1,$2,'src/caller.ts',1,'PendingOnly',$3,'call')`,
      [projectId, pendingId, pendingOnly],
    );
    expect((await repository.markFileStaleGeneration(lease(), "src/active.ts", {
      lastKnownGoodGenerationId: activeId,
      diagnostics: [{ code: "parse_failed" }],
      parserErrorCount: 1,
    })).status).toBe("stale");
    expect((await db!.query(
      `SELECT count(*)::int count FROM symbol_references
       WHERE project_id=$1 AND generation_id=$2 AND target_fqn=$3`,
      [projectId, pendingId, pendingOnly],
    )).rows[0].count).toBe(0);
  });

  test("active per-file replacement removes inbound references to removed definitions", async () => {
    const removed = `src/active.ts#Active~function~${hashA}`;
    await seedFile(activeId, "src/caller.ts", "caller");
    await db!.query(
      `INSERT INTO symbol_references (project_id,generation_id,from_file,from_line,symbol_name,target_fqn,ref_kind)
       VALUES ($1,$2,'src/caller.ts',1,'Active',$3,'call')`,
      [projectId, activeId, removed],
    );
    await repository.writeFileSymbols(projectId, "src/active.ts", [{
      id: "src/active.ts#Replacement", project_id: projectId, file_path: "src/active.ts",
      name: "Replacement", kind: "function", line_start: 1, line_end: 2,
      exported: true, indexed_at: Date.now(), qualified_name: "Replacement",
      legacy_fqn: "src/active.ts#Replacement",
    }], [], []);
    expect((await db!.query(
      `SELECT count(*)::int count FROM symbol_references
       WHERE project_id=$1 AND generation_id=$2 AND target_fqn=$3`,
      [projectId, activeId, removed],
    )).rows[0].count).toBe(0);
  });

  test("rejects modern definitions whose persisted identity disagrees with their FQN", async () => {
    const modern = `src/identity.ts#Identity~function~${hashA}`;
    const attempt = repository.writeFileGeneration({
      lease: lease(),
      file: {
        project_id: projectId, relative_path: "src/identity.ts", content_hash: "identity",
        mtime: 1, size: 1, indexed_at: Date.now(), symbol_count: 1, chunk_count: 0,
        language: "typescript", grammar_version: "g1", query_pack_version: "q1",
        resolver_version: "r1", parser_status: "ok", parser_error_count: 0, diagnostics: [],
      },
      definitions: [{
        id: modern, project_id: projectId, file_path: "src/identity.ts", name: "Identity",
        kind: "function", line_start: 1, line_end: 2, exported: true, indexed_at: Date.now(),
        qualified_name: "Wrong.Identity", signature_hash: hashB,
        canonical_signature: "not-the-signature-for-the-id", legacy_fqn: "wrong.ts#Identity",
      }],
      references: [], imports: [],
    });
    await expect(attempt).rejects.toThrow();
    expect((await db!.query(
      `SELECT count(*)::int count FROM symbol_definitions WHERE project_id=$1 AND generation_id=$2 AND id=$3`,
      [projectId, pendingId, modern],
    )).rows[0].count).toBe(0);

    const simpleBase = {
      id: "src/identity.ts#Identity", project_id: projectId, file_path: "src/identity.ts",
      name: "Identity", kind: "function", line_start: 1, line_end: 2, exported: true,
      indexed_at: Date.now(), qualified_name: "Identity",
    };
    const file = {
      project_id: projectId, relative_path: "src/identity.ts", content_hash: "identity",
      mtime: 1, size: 1, indexed_at: Date.now(), symbol_count: 1, chunk_count: 0,
    };
    await expect(repository.writeFileGeneration({
      lease: lease(), file, definitions: [{ ...simpleBase, legacy_fqn: "wrong.ts#Identity" }],
      references: [], imports: [],
    })).rejects.toThrow("definition_legacy_fqn_mismatch");
    await expect(repository.writeFileGeneration({
      lease: lease(), file, definitions: [{
        ...simpleBase, legacy_fqn: "src/identity.ts#Identity",
        canonical_signature: "simple-signature", signature_hash: hashA,
      }], references: [], imports: [],
    })).rejects.toThrow("definition_fqn_signature_mismatch");
  });

  test("captures one active generation for an entire centrality batch during activation", async () => {
    const advisoryKey = 1_207_012;
    await db!.query(`SELECT pg_advisory_lock($1)`, [advisoryKey]);
    await db!.query(`
      CREATE OR REPLACE FUNCTION block_first_centrality_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.file_path = 'src/barrier-one.ts' THEN PERFORM pg_advisory_lock(${advisoryKey}); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER task12_centrality_barrier BEFORE INSERT ON symbol_centrality
      FOR EACH ROW EXECUTE FUNCTION block_first_centrality_insert()
    `);
    const write = repository.updateCentrality(projectId, new Map([
      ["src/barrier-one.ts", 0.1], ["src/barrier-two.ts", 0.2],
    ]));
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await db!.query(
        `SELECT count(*)::int count FROM pg_stat_activity
         WHERE datname=current_database() AND wait_event='advisory'`,
      );
      if (waiting.rows[0].count > 0) break;
      await Bun.sleep(5);
      if (attempt === 99) throw new Error("centrality barrier was not reached");
    }

    const flipper = new Client({ connectionString: `postgresql://test@127.0.0.1:5433/${databaseName}` });
    await flipper.connect();
    let flipBlocked = false;
    try {
      await flipper.query(`SET statement_timeout='200ms'`);
      await flipper.query(`BEGIN`);
      await flipper.query(`UPDATE graph_generations SET status='superseded' WHERE id=$1`, [activeId]);
      await flipper.query(`UPDATE graph_generations SET status='active' WHERE id=$1`, [pendingId]);
      await flipper.query(`UPDATE workspaces SET active_graph_generation_id=$1 WHERE project_id=$2`, [pendingId, projectId]);
      await flipper.query(`COMMIT`);
    } catch {
      flipBlocked = true;
      await flipper.query(`ROLLBACK`);
    }
    await db!.query(`SELECT pg_advisory_unlock($1)`, [advisoryKey]);
    await write;
    if (flipBlocked) {
      await flipper.query(`SET statement_timeout=0`);
      await flipper.query(`BEGIN`);
      await flipper.query(`UPDATE graph_generations SET status='superseded' WHERE id=$1`, [activeId]);
      await flipper.query(`UPDATE graph_generations SET status='active' WHERE id=$1`, [pendingId]);
      await flipper.query(`UPDATE workspaces SET active_graph_generation_id=$1 WHERE project_id=$2`, [pendingId, projectId]);
      await flipper.query(`COMMIT`);
    }
    await flipper.end();
    const rows = (await db!.query(
      `SELECT generation_id,count(*)::int count FROM symbol_centrality
       WHERE file_path LIKE 'src/barrier-%' GROUP BY generation_id`,
    )).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });
});

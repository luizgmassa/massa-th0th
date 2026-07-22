import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const migrationPath = join(
  import.meta.dir,
  "../../prisma/migrations/20260714170000_add_graph_generations/migration.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");
const repositorySql = readFileSync(
  join(import.meta.dir, "../data/symbol/symbol-repo-generation.ts"),
  "utf8",
) + readFileSync(
  join(import.meta.dir, "../data/symbol/symbol-repo-queries.ts"),
  "utf8",
);

describe("graph generation migration sensors", () => {
  test("keeps the migration atomic and installs the required ownership guards", () => {
    expect(migrationSql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migrationSql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migrationSql).toContain(
      'LOCK TABLE "workspaces", "symbol_files", "symbol_definitions", "symbol_references", "symbol_imports", "symbol_centrality" IN ACCESS EXCLUSIVE MODE',
    );
    expect(migrationSql).toContain("_graph_generation_pre_counts");
    expect(migrationSql).toContain("graph_generation_backfill_row_count_changed");
    expect(migrationSql).toContain("graph_generation_backfill_orphan");
    expect(migrationSql).toContain("graph_generations_one_active_per_project");
    expect(migrationSql).toContain("graph_generations_one_pending_per_project");
    expect(migrationSql).toContain("ON DELETE SET NULL");
    expect(migrationSql).not.toContain("parser_diagnostics");
    expect(migrationSql).not.toContain("start_byte\" INTEGER NOT NULL DEFAULT 0");
  });

  test("keeps transitional repository writes on the active composite key", () => {
    expect(repositorySql).toContain("active_graph_generation_id");
    expect(repositorySql).toContain("ON CONFLICT (project_id, generation_id, relative_path)");
    expect(repositorySql).toContain("ON CONFLICT (project_id, generation_id, id)");
    expect(repositorySql).toContain("ON CONFLICT (project_id, generation_id, file_path)");
    expect(repositorySql).not.toContain("ON CONFLICT (project_id, relative_path)");
    expect(repositorySql).not.toContain("ON CONFLICT (project_id, file_path)");
  });
});

const runIntegration = process.env.RUN_GRAPH_GENERATION_MIGRATION === "1" &&
  process.env.MASSA_TH0TH_DEDICATED === "1";
const adminUrl = process.env.GRAPH_GENERATION_TEST_ADMIN_URL;
const databaseName = `massa_graph_migration_${process.pid}_${Date.now()}`;
let admin: Client | undefined;
let ownsDatabase = false;

afterAll(async () => {
  if (!admin) return;
  if (ownsDatabase) {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await admin.query(`DROP DATABASE "${databaseName}"`);
  }
  await admin.end();
});

describe.skipIf(!runIntegration)("owned PostgreSQL graph migration", () => {
  test("backfills populated and empty workspaces without changing legacy rows", async () => {
    expect(adminUrl).toBeTruthy();
    expect(process.env.MASSA_TH0TH_DEDICATED).toBe("1");
    const parsed = new URL(adminUrl!);
    expect(parsed.protocol).toBe("postgresql:");
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(parsed.port).toBe("5433");
    expect(parsed.pathname).toBe("/postgres");
    expect(parsed.username).toBe("test");
    expect(parsed.password).toBe("");

    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    ownsDatabase = true;

    parsed.pathname = `/${databaseName}`;
    const db = new Client({ connectionString: parsed.toString() });
    await db.connect();
    try {
      await db.query(`
        CREATE TABLE workspaces (
          project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL, display_name TEXT,
          status TEXT NOT NULL DEFAULT 'pending', last_indexed_at TIMESTAMP(3), last_error TEXT,
          files_count INTEGER NOT NULL DEFAULT 0, chunks_count INTEGER NOT NULL DEFAULT 0,
          symbols_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP(3) NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP(3) NOT NULL DEFAULT NOW()
        );
        CREATE TABLE symbol_files (
          project_id TEXT NOT NULL REFERENCES workspaces(project_id) ON DELETE CASCADE,
          relative_path TEXT NOT NULL, content_hash TEXT NOT NULL, mtime BIGINT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0, indexed_at TIMESTAMP(3) NOT NULL,
          symbol_count INTEGER NOT NULL DEFAULT 0, chunk_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (project_id, relative_path)
        );
        CREATE TABLE symbol_definitions (
          id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES workspaces(project_id) ON DELETE CASCADE,
          file_path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, line_start INTEGER NOT NULL,
          line_end INTEGER NOT NULL, exported BOOLEAN NOT NULL DEFAULT false, doc_comment TEXT,
          indexed_at TIMESTAMP(3) NOT NULL, PRIMARY KEY (project_id, id)
        );
        CREATE TABLE symbol_references (
          id SERIAL PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspaces(project_id) ON DELETE CASCADE,
          from_file TEXT NOT NULL, from_line INTEGER NOT NULL, symbol_name TEXT NOT NULL,
          target_fqn TEXT, ref_kind TEXT NOT NULL, meta JSONB
        );
        CREATE TABLE symbol_imports (
          id SERIAL PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspaces(project_id) ON DELETE CASCADE,
          from_file TEXT NOT NULL, to_file TEXT, specifier TEXT NOT NULL,
          imported_names TEXT[] NOT NULL DEFAULT '{}', is_external BOOLEAN NOT NULL DEFAULT false,
          is_type_only BOOLEAN NOT NULL DEFAULT false
        );
        CREATE TABLE symbol_centrality (
          project_id TEXT NOT NULL REFERENCES workspaces(project_id) ON DELETE CASCADE,
          file_path TEXT NOT NULL, score DOUBLE PRECISION NOT NULL DEFAULT 0,
          updated_at TIMESTAMP(3) NOT NULL, PRIMARY KEY (project_id, file_path)
        );
        INSERT INTO workspaces (project_id, project_path, status, files_count, symbols_count)
          VALUES ('populated', '/tmp/populated', 'indexed', 1, 1), ('empty', '/tmp/empty', 'indexed', 0, 0);
        INSERT INTO symbol_files VALUES ('populated', 'src/a.ts', 'hash-a', 1, 12, NOW(), 1, 0);
        INSERT INTO symbol_definitions VALUES
          ('src/a.ts#A', 'populated', 'src/a.ts', 'A', 'class', 2, 4, true, NULL, NOW()),
          ('src/a.ts#Outer.run~method~aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'populated', 'src/a.ts', 'run', 'method', 6, 7, false, NULL, NOW()),
          ('src/a.ts#Outer.run~method~bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'populated', 'src/a.ts', 'run', 'method', 9, 10, false, NULL, NOW());
        INSERT INTO symbol_references (id, project_id, from_file, from_line, symbol_name, target_fqn, ref_kind, meta)
          VALUES
            (41, 'populated', 'src/a.ts', 3, 'A', 'src/a.ts#A', 'call', '{"sourceSpan":{"startByte":1,"endByte":2,"start":{"row":0,"column":1},"end":{"row":0,"column":2}}}'),
            (42, 'populated', 'src/a.ts', 4, 'bad', NULL, 'call', '{"sourceSpan":{"startByte":"bad"}}'),
            (43, 'populated', 'src/a.ts', 5, 'huge', NULL, 'call', '{"sourceSpan":{"startByte":999999999999999999999,"endByte":999999999999999999999,"start":{"row":0,"column":0},"end":{"row":0,"column":0}}}'),
            (44, 'populated', 'src/a.ts', 6, 'fractional', NULL, 'call', '{"sourceSpan":{"startByte":1.5,"endByte":2,"start":{"row":0,"column":0},"end":{"row":0,"column":0}}}');
        INSERT INTO symbol_imports (id, project_id, from_file, to_file, specifier, imported_names)
          VALUES (51, 'populated', 'src/a.ts', 'src/b.ts', './b', ARRAY['B']);
        INSERT INTO symbol_centrality VALUES ('populated', 'src/a.ts', 0.75, NOW());
      `);

      await db.query(migrationSql);

      const generations = await db.query(`
        SELECT project_id, id, status, input_snapshot_hash, files_count, definitions_count,
               references_count, imports_count, centrality_count
        FROM graph_generations ORDER BY project_id
      `);
      expect(generations.rows).toHaveLength(2);
      expect(generations.rows.every((row) => row.status === "active")).toBe(true);
      expect(generations.rows.every((row) => row.input_snapshot_hash.startsWith("md5:"))).toBe(true);
      expect(generations.rows.find((row) => row.project_id === "empty").files_count).toBe(0);

      const populated = await db.query(`
        SELECT w.active_graph_generation_id, w.active_files_count, w.active_definitions_count,
               w.active_references_count, w.active_imports_count, w.active_centrality_count,
               f.relative_path, f.last_successful_at
        FROM workspaces w
        JOIN symbol_files f ON f.project_id = w.project_id AND f.generation_id = w.active_graph_generation_id
        WHERE w.project_id = 'populated'
      `);
      expect(populated.rows[0]).toMatchObject({
        active_files_count: 1,
        active_definitions_count: 3,
        active_references_count: 4,
        active_imports_count: 1,
        active_centrality_count: 1,
        relative_path: "src/a.ts",
      });
      expect(populated.rows[0].last_successful_at).toBeInstanceOf(Date);

      const definitions = await db.query(`
        SELECT id, qualified_name, canonical_signature, signature_hash, legacy_fqn, source_span
        FROM symbol_definitions WHERE project_id = 'populated' ORDER BY id
      `);
      expect(definitions.rows).toEqual([
        {
          id: "src/a.ts#A",
          qualified_name: "A",
          canonical_signature: null,
          signature_hash: null,
          legacy_fqn: "src/a.ts#A",
          source_span: null,
        },
        {
          id: "src/a.ts#Outer.run~method~aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          qualified_name: "Outer.run",
          canonical_signature: null,
          signature_hash: "a".repeat(64),
          legacy_fqn: "src/a.ts#run",
          source_span: null,
        },
        {
          id: "src/a.ts#Outer.run~method~bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          qualified_name: "Outer.run",
          canonical_signature: null,
          signature_hash: "b".repeat(64),
          legacy_fqn: "src/a.ts#run",
          source_span: null,
        },
      ]);
      const references = await db.query(`SELECT id, source_span FROM symbol_references ORDER BY id`);
      expect(references.rows).toEqual([
        {
          id: 41,
          source_span: { startByte: 1, endByte: 2, start: { row: 0, column: 1 }, end: { row: 0, column: 2 } },
        },
        { id: 42, source_span: null },
        { id: 43, source_span: null },
        { id: 44, source_span: null },
      ]);
      expect((await db.query(`SELECT id FROM symbol_imports`)).rows).toEqual([{ id: 51 }]);

      const orphanCount = await db.query(`
        SELECT count(*)::int AS count FROM (
          SELECT project_id, generation_id FROM symbol_files UNION ALL
          SELECT project_id, generation_id FROM symbol_definitions UNION ALL
          SELECT project_id, generation_id FROM symbol_references UNION ALL
          SELECT project_id, generation_id FROM symbol_imports UNION ALL
          SELECT project_id, generation_id FROM symbol_centrality
        ) owned LEFT JOIN graph_generations generation
          ON generation.project_id = owned.project_id AND generation.id = owned.generation_id
        WHERE generation.id IS NULL
      `);
      expect(orphanCount.rows[0].count).toBe(0);

      const populatedGeneration = populated.rows[0].active_graph_generation_id as string;
      const emptyGeneration = (await db.query(`SELECT active_graph_generation_id FROM workspaces WHERE project_id = 'empty'`)).rows[0].active_graph_generation_id as string;
      await expect(
        db.query(`UPDATE workspaces SET active_graph_generation_id = $1 WHERE project_id = 'populated'`, [emptyGeneration]),
      ).rejects.toThrow();
      await expect(
        db.query(`UPDATE workspaces SET pending_graph_generation_id = $1 WHERE project_id = 'populated'`, [emptyGeneration]),
      ).rejects.toThrow();
      await db.query(`UPDATE workspaces SET active_graph_generation_id = NULL WHERE project_id = 'empty'`);
      expect((await db.query(`SELECT active_graph_generation_id FROM workspaces WHERE project_id = 'empty'`)).rows[0].active_graph_generation_id).toBeNull();
      await db.query(`UPDATE workspaces SET active_graph_generation_id = $1 WHERE project_id = 'empty'`, [emptyGeneration]);
      await db.query(`UPDATE workspaces SET pending_graph_generation_id = NULL WHERE project_id = 'populated'`);
      await expect(
        db.query(`INSERT INTO graph_generations (id, project_id, status, fingerprint, input_snapshot_hash) VALUES ('active-duplicate', 'populated', 'active', 'x', 'md5:x')`),
      ).rejects.toThrow();
      await db.query(`INSERT INTO graph_generations (id, project_id, status, fingerprint, input_snapshot_hash) VALUES ('pending-isolation', 'populated', 'pending', 'next', 'md5:next')`);
      await expect(
        db.query(`INSERT INTO graph_generations (id, project_id, status, fingerprint, input_snapshot_hash) VALUES ('pending-duplicate', 'populated', 'pending', 'next', 'md5:next')`),
      ).rejects.toThrow();
      await db.query(`UPDATE workspaces SET pending_graph_generation_id = 'pending-isolation' WHERE project_id = 'populated'`);
      await expect(
        db.query(`UPDATE workspaces SET graph_lease_heartbeat_at = NOW() WHERE project_id = 'populated'`),
      ).rejects.toThrow();

      await db.query(`
        INSERT INTO symbol_files (project_id, generation_id, relative_path, content_hash, mtime, indexed_at)
          VALUES ('populated', 'pending-isolation', 'pending.ts', 'pending', 1, NOW());
        INSERT INTO symbol_definitions (id, project_id, generation_id, file_path, name, kind, line_start, line_end, indexed_at, qualified_name, legacy_fqn)
          VALUES ('pending.ts#Poison', 'populated', 'pending-isolation', 'pending.ts', 'Poison', 'class', 1, 1, NOW(), 'Poison', 'pending.ts#Poison');
        INSERT INTO symbol_references (project_id, generation_id, from_file, from_line, symbol_name, target_fqn, ref_kind)
          VALUES ('populated', 'pending-isolation', 'pending.ts', 1, 'Poison', 'pending.ts#Poison', 'call');
        INSERT INTO symbol_imports (project_id, generation_id, from_file, to_file, specifier)
          VALUES ('populated', 'pending-isolation', 'pending.ts', 'poison-target.ts', './poison');
        INSERT INTO symbol_centrality (project_id, generation_id, file_path, score, updated_at)
          VALUES ('populated', 'pending-isolation', 'pending.ts', 99, NOW());
      `);

      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = parsed.toString();
      const { SymbolRepositoryPg } = await import("../data/symbol/symbol-repository-pg.js");
      const { disconnectPrisma, _resetPrismaForTesting } = await import("../services/query/prisma-client.js");
      _resetPrismaForTesting();
      const repository = SymbolRepositoryPg.getInstance();
      try {
        expect(await repository.allFiles("populated")).toEqual(["src/a.ts"]);
        expect(await repository.getFile("populated", "pending.ts")).toBeNull();
        expect((await repository.listAllDefinitions("populated")).map((row) => row.id)).not.toContain("pending.ts#Poison");
        expect(await repository.searchDefinitions("populated", "Poison")).toEqual([]);
        expect(await repository.getDefinition("populated", "pending.ts#Poison")).toBeNull();
        expect((await repository.allImportEdges("populated")).map((row) => row.id)).toEqual([51]);
        expect(await repository.getImportsFrom("populated", "pending.ts")).toEqual([]);
        expect(await repository.findImporters("populated", "poison-target.ts")).toEqual([]);
        expect((await repository.getTopCentralFiles("populated")).map((row) => row.file_path)).toEqual(["src/a.ts"]);
        expect(await repository.findReferencesByName("populated", "Poison")).toEqual([]);
        expect(await repository.findReferencesByFqn("populated", "pending.ts#Poison")).toEqual([]);
        expect((await repository.findEdges("populated")).map((row) => row.symbol_name)).not.toContain("Poison");
        expect(await repository.countEdgesByKind("populated")).toEqual({ call: 4 });
        expect((await repository.findReferencesByFqn("populated", "src/a.ts#A"))[0]?.source_span).toEqual({
          startByte: 1,
          endByte: 2,
          start: { row: 0, column: 1 },
          end: { row: 0, column: 2 },
        });
        expect([...((await repository.getCentrality("populated")).keys())]).toEqual(["src/a.ts"]);
        expect((await repository.getProjectMapAggregates("populated")).symbolsByKind).toEqual({ method: 2, class: 1 });

        await repository.upsertWorkspace({
          project_id: "bridge",
          project_path: "/tmp/bridge",
          status: "indexing",
          files_count: 0,
          chunks_count: 0,
          symbols_count: 0,
        });
        await repository.upsertFile({
          project_id: "bridge",
          relative_path: "src/new.ts",
          content_hash: "bridge-hash",
          mtime: 1,
          size: 10,
          indexed_at: Date.now(),
          symbol_count: 2,
          chunk_count: 0,
        });
        const modernId = `src/new.ts#Outer.run~method~${"c".repeat(64)}`;
        await repository.writeFileSymbols(
          "bridge",
          "src/new.ts",
          [
            { id: "src/new.ts#Simple", project_id: "bridge", file_path: "src/new.ts", name: "Simple", kind: "class", line_start: 1, line_end: 2, exported: true, indexed_at: Date.now() },
            { id: modernId, project_id: "bridge", file_path: "src/new.ts", name: "run", kind: "method", line_start: 4, line_end: 5, exported: false, indexed_at: Date.now() },
          ],
          [{
            project_id: "bridge", from_file: "src/new.ts", from_line: 5, symbol_name: "run", target_fqn: modernId, ref_kind: "call",
            meta: { sourceSpan: { startByte: 4, endByte: 7, start: { row: 0, column: 4 }, end: { row: 0, column: 7 } } },
          }],
          [{ project_id: "bridge", from_file: "src/new.ts", specifier: "./dep", imported_names: ["dep"], is_external: false, is_type_only: false }],
        );
        await repository.upsertCentrality({ project_id: "bridge", file_path: "src/new.ts", score: 1, updated_at: Date.now() });
        await repository.updateWorkspaceStatus("bridge", "indexed", { filesCount: 1, symbolsCount: 2 });

        const bridged = await db.query(`
          SELECT w.active_files_count, w.active_definitions_count, w.active_references_count,
                 w.active_imports_count, w.active_centrality_count,
                 g.files_count AS generation_files_count, g.definitions_count AS generation_definitions_count,
                 d.qualified_name, d.signature_hash, d.legacy_fqn, r.source_span AS reference_source_span
          FROM workspaces w
          JOIN graph_generations g ON g.project_id = w.project_id AND g.id = w.active_graph_generation_id
          JOIN symbol_definitions d ON d.project_id = w.project_id AND d.generation_id = w.active_graph_generation_id
          JOIN symbol_references r ON r.project_id = w.project_id AND r.generation_id = w.active_graph_generation_id
          WHERE w.project_id = 'bridge' AND d.id = $1
        `, [modernId]);
        expect(bridged.rows[0]).toMatchObject({
          active_files_count: 1,
          active_definitions_count: 2,
          active_references_count: 1,
          active_imports_count: 1,
          active_centrality_count: 1,
          generation_files_count: 1,
          generation_definitions_count: 2,
          qualified_name: "Outer.run",
          signature_hash: "c".repeat(64),
          legacy_fqn: "src/new.ts#run",
          reference_source_span: { startByte: 4, endByte: 7, start: { row: 0, column: 4 }, end: { row: 0, column: 7 } },
        });
      } finally {
        await disconnectPrisma();
        if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousDatabaseUrl;
      }

      await expect(
        db.query(`UPDATE symbol_files SET diagnostics = $1::jsonb`, [JSON.stringify(Array(11).fill({ code: "x" }))]),
      ).rejects.toThrow();
      await db.query("ROLLBACK");

      await db.query(`DELETE FROM graph_generations WHERE id = 'pending-isolation'`);
      expect((await db.query(`SELECT pending_graph_generation_id FROM workspaces WHERE project_id = 'populated'`)).rows[0].pending_graph_generation_id).toBeNull();

      await db.query(`DELETE FROM workspaces WHERE project_id = 'populated'`);
      expect((await db.query(`SELECT count(*)::int AS count FROM graph_generations WHERE project_id = 'populated'`)).rows[0].count).toBe(0);
      expect(populatedGeneration.startsWith("legacy-")).toBe(true);
    } finally {
      await db.end();
    }
  }, 30_000);
});

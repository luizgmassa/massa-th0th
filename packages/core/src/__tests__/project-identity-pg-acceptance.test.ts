/**
 * T6 — PostgreSQL acceptance for transactional project identity (spec AC):
 *
 *  - two PostgreSQL backends prove writers cannot strand the source ID during apply
 *  - lost-response retry returns the one stored result and exactly one audit entry
 *  - different-root / collision / stale-plan / unknown-storage / operation-reuse
 *    conflicts fail without mutation
 *  - injected pre-commit failure preserves a byte-equivalent snapshot
 *  - post-commit invalidator/event failures never flip the committed response
 *  - zero mutable source references remain after apply (immutable audit + alias
 *    records are the only allowed source-ID references)
 *  - both source and target caches are invalidated after commit
 *
 * Gate: runs only with IDENTITY_ACCEPTANCE_DATABASE_URL pointing at an OWNED
 * database with all migrations deployed (the T6 gate provisions
 * `massa_ai_identity_t6` via prisma migrate deploy). Skipped otherwise —
 * recorded in validation.md, never weakened.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { Pool, type PoolClient } from "pg";

import {
  ProjectIdentityError,
  ProjectIdentityInvalidatorRegistry,
  createProjectIdentityService,
  installProjectIdentityGuards,
  type ProjectIdentityApplyResult,
  type ProjectIdentityChangedPayload,
  type ProjectIdentityService,
  type ProjectIdentityTransactionClient,
} from "../services/project-identity/index.js";

const URL = process.env.IDENTITY_ACCEPTANCE_DATABASE_URL;

type Row = Record<string, unknown>;

let pool: Pool;
let serviceCounter = 0;

function wrap(client: PoolClient): ProjectIdentityTransactionClient {
  return Object.assign(client, {
    async beginTransaction() { await client.query("BEGIN"); },
    async commitTransaction() { await client.query("COMMIT"); },
    async rollbackTransaction() { await client.query("ROLLBACK"); },
  }) as unknown as ProjectIdentityTransactionClient;
}

/** Stashed original `client.query` for instrumentation restore-on-release. */
const ORIGINAL_QUERY = Symbol("t6-original-query");

/**
 * Service over the owned pool; optional instrumentation + post-commit wiring.
 *
 * The onQuery wrapper MUST forward every argument (pg-pool's `pool.query`
 * calls `client.query(text, values, callback)` — dropping the callback hangs
 * the pooled promise forever) and MUST be removed before the client returns
 * to the pool (the wrapper mutates the pooled client object; a stale closure
 * would otherwise poison later borrowers — T6 findings: hook timeouts + the
 * 08P01 "bind message" protocol errors).
 */
function serviceFor(options: {
  invalidators?: ProjectIdentityInvalidatorRegistry;
  publisher?: { publish(payload: ProjectIdentityChangedPayload): void };
  onQuery?: (text: string, settled: Promise<unknown>) => void;
  onAcquire?: (backendPid: number) => void;
} = {}): ProjectIdentityService {
  const onQuery = options.onQuery;
  const onAcquire = options.onAcquire;
  return createProjectIdentityService({
    invalidators: options.invalidators ?? new ProjectIdentityInvalidatorRegistry(),
    publisher: options.publisher ?? { publish: () => { /* noop */ } },
    acquireClient: async () => {
      const raw = await pool.connect();
      const wrapped = wrap(raw);
      if (onAcquire) {
        const { rows } = await raw.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`);
        onAcquire(rows[0]!.pid);
      }
      if (onQuery) {
        const baseQuery = wrapped.query.bind(wrapped);
        (wrapped as unknown as Record<symbol, unknown>)[ORIGINAL_QUERY] = baseQuery;
        wrapped.query = ((...args: unknown[]) => {
          const result = (baseQuery as (...inner: unknown[]) => unknown)(...args);
          const settled = result && typeof (result as Promise<unknown>).then === "function"
            ? (result as Promise<unknown>)
            : Promise.resolve(result);
          onQuery(args[0] as string, settled);
          return result;
        }) as unknown as typeof wrapped.query;
      }
      return wrapped;
    },
    releaseClient: async (client) => {
      const raw = client as unknown as PoolClient & Record<symbol, unknown>;
      const original = raw[ORIGINAL_QUERY] as ((...args: unknown[]) => unknown) | undefined;
      if (original) {
        raw.query = original as PoolClient["query"];
        delete raw[ORIGINAL_QUERY];
      }
      raw.release();
    },
  });
}

function uniqueOp(): string {
  return `op-t6-${++serviceCounter}-${randomUUID().slice(0, 8)}`;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SOURCE = "t6-source";
const TARGET = "t6-target";
const ROOT = "/repos/t6-app";

/** Source-side rows only (rename requires an UNUSED target — see seedTarget). */
async function seedSource(): Promise<void> {
  await pool.query(
    `INSERT INTO projects (id, project_id, path, document_count, total_size, updated_at)
     VALUES ('t6-p-s', $1, $2, 0, 0, now())
     ON CONFLICT (id) DO NOTHING`,
    [SOURCE, ROOT],
  );
  await pool.query(
    `INSERT INTO workspaces (project_id, project_path, status) VALUES ($1, $2, 'active')
     ON CONFLICT (project_id) DO NOTHING`,
    [SOURCE, ROOT],
  );
  await pool.query(
    `INSERT INTO memories (id, content, type, level, project_id, tags, metadata, updated_at)
     VALUES
       ('t6-m1', 'alpha', 'conversation', 1, $1, $2, $3, now()),
       ('t6-m2', 'beta', 'conversation', 1, $1, $2, $3, now())
     ON CONFLICT (id) DO NOTHING`,
    // NOTE: tags are seeded as a PG array LITERAL (`{a,b}`) — the production
    // wire format for the TEXT tags column (Prisma has no OID-1009 mapping).
    [SOURCE, `{"project:${SOURCE}","handoff:${SOURCE}"}`, JSON.stringify({ projectId: SOURCE, note: "keep" })],
  );
  await pool.query(
    `INSERT INTO documents (id, project_id, file_path, size, indexed_at)
     VALUES ('t6-d1', $1, 'src/a.ts', 100, now()) ON CONFLICT (id) DO NOTHING`,
    [SOURCE],
  );
  await pool.query(
    `INSERT INTO scheduled_jobs (id, name, job_kind, schedule_type, next_run_at, enabled, payload)
     VALUES ('t6-j1', 't6-job', 'decay-sweep', 'interval', 0, 0, $1)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify({ projectId: SOURCE })],
  );
  await pool.query(
    `INSERT INTO operation_log (id, occurred_at, actor_type, actor_id, project_id, op, scope, result, meta)
     VALUES (910001, now(), 'test', 't6', $1, 'index', '{}', 'success', '{}') ON CONFLICT (id) DO NOTHING`,
    // result CHECK allows success/failure/partial only — 'ok' was silently
    // rejected and the immutable-audit assertion then saw no row (T6 finding).
    [SOURCE],
  ).catch(() => { /* operation_log shape drift is not identity-owned */ });
}

/** Live target with the SAME canonical root (merge fixtures / collision gates). */
async function seedTarget(): Promise<void> {
  await pool.query(
    `INSERT INTO projects (id, project_id, path, document_count, total_size, updated_at)
     VALUES ('t6-p-t', $1, $2, 0, 0, now())
     ON CONFLICT (id) DO NOTHING`,
    [TARGET, ROOT],
  );
  await pool.query(
    `INSERT INTO workspaces (project_id, project_path, status) VALUES ($1, $2, 'active')
     ON CONFLICT (project_id) DO NOTHING`,
    [TARGET, ROOT],
  );
}

/** Source graph history: G1 active (newer), G0 superseded. */
async function seedGraphSource(): Promise<void> {
  await pool.query(
    `INSERT INTO graph_generations (id, project_id, status, fingerprint, input_snapshot_hash, activated_at)
     VALUES
       ('t6-g0', $1, 'superseded', 'fp0', 'snap0', now() - interval '3 days'),
       ('t6-g1', $1, 'active', 'fp1', 'snap1', now() - interval '1 day')
     ON CONFLICT (id) DO NOTHING`,
    [SOURCE],
  );
  await pool.query(
    `UPDATE workspaces SET active_graph_generation_id = 't6-g1' WHERE project_id = $1`,
    [SOURCE],
  );
}

/** Target graph history: G3 active (OLDER than source G1). */
async function seedGraphTarget(): Promise<void> {
  await pool.query(
    `INSERT INTO graph_generations (id, project_id, status, fingerprint, input_snapshot_hash, activated_at)
     VALUES ('t6-g3', $1, 'active', 'fp3', 'snap3', now() - interval '2 days')
     ON CONFLICT (id) DO NOTHING`,
    [TARGET],
  );
  await pool.query(
    `UPDATE workspaces SET active_graph_generation_id = 't6-g3' WHERE project_id = $1`,
    [TARGET],
  );
}

async function clearAll(): Promise<void> {
  const tables = [
    "search_cache", "scheduled_jobs", "documents", "projects", "memories", "operation_log",
    "graph_generations", "project_identity_aliases", "project_identity_operations",
  ];
  for (const table of tables) {
    await pool.query(`DELETE FROM ${table} WHERE true`).catch(() => { /* absent table */ });
  }
  await pool.query(
    `DELETE FROM workspaces WHERE project_id IN ($1, $2, 't6-other-root', 't6-boom', 't6-fresh', 't6-fresh-2', 't6-race-t', 't6-chain-b', 't6-source-2')`,
    [SOURCE, TARGET],
  );
  await pool.query(`DROP TABLE IF EXISTS t6_unknown_store`).catch(() => { /* noop */ });
  await pool.query(`DROP TRIGGER IF EXISTS t6_fail_trigger ON memories`).catch(() => { /* noop */ });
  await pool.query(`DROP FUNCTION IF EXISTS t6_fail_after_mutation`).catch(() => { /* noop */ });
}

// ── Canonical snapshot ───────────────────────────────────────────────────────

function canon(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "bigint") return `big:${value.toString()}`;
  if (Buffer.isBuffer(value)) return `buf:${value.toString("base64")}`;
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Row).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canon(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const SNAPSHOT_TABLES = [
  "workspaces", "projects", "memories", "documents", "scheduled_jobs", "operation_log",
  "graph_generations", "project_identity_aliases", "project_identity_operations",
] as const;

async function snapshot(): Promise<string> {
  const parts: string[] = [];
  for (const table of SNAPSHOT_TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY 1`).catch(() => ({ rows: [] as Row[] }));
    parts.push(`${table}:${canon(rows)}`);
  }
  return parts.join("|");
}

async function applyRename(
  service: ProjectIdentityService,
  operationId: string,
  target: string = TARGET,
): Promise<ProjectIdentityApplyResult> {
  const preview = await service.preview({
    mode: "rename", sourceProjectId: SOURCE, targetProjectId: target, dryRun: true,
  });
  return service.apply({
    mode: "rename", sourceProjectId: SOURCE, targetProjectId: target,
    dryRun: false, operationId, expectedPlanHash: preview.planHash,
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe.skipIf(!URL)("T6 PostgreSQL acceptance — transactional project identity", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: URL, max: 6 });
    // Bring up the runtime-created stores through their REAL init paths so the
    // T4 per-create-site guard installs execute against the owned DB (evidence
    // for the lazy-table wiring, not just the startup pass). The stores init
    // lazily inside getPool(), so force one acquisition each.
    process.env.DATABASE_URL = URL;
    const { getSearchCache } = await import("../services/search/cache-factory.js");
    await (await getSearchCache() as unknown as { getPool(): Promise<unknown> }).getPool();
    const { getKeywordSearch } = await import("../data/keyword/keyword-search-factory.js");
    await (getKeywordSearch() as unknown as { getPool(): Promise<unknown> }).getPool();
    const { getSearchAnalytics } = await import("../services/search/analytics-factory.js");
    await (getSearchAnalytics() as unknown as { getPool(): Promise<unknown> }).getPool();

    // Guard-install gate on the real owned DB (T4 installer evidence): static
    // catalog + runtime tables all guarded without a failure.
    const report = await installProjectIdentityGuards(pool);
    expect(report.failures).toEqual([]);
    expect(report.installed).toContain("keyword_documents");
    expect(report.installed).toContain("search_cache");
  }, 60_000);

  beforeEach(async () => {
    await clearAll();
    await seedSource();
  });

  afterAll(async () => {
    await clearAll().catch(() => { /* best-effort */ });
    await pool?.end();
  });

  test("rename moves every store, preserves immutable audit, leaves zero mutable source references", async () => {
    await seedGraphSource();
    const FRESH = "t6-fresh";
    const result = await applyRename(serviceFor(), uniqueOp(), FRESH);

    expect(result.mode).toBe("rename");
    expect(result.committedAt).toBeTruthy();

    // Direct stores moved.
    const memories = await pool.query(`SELECT project_id, tags, metadata FROM memories WHERE id IN ('t6-m1','t6-m2')`);
    expect(memories.rows.every((row: Row) => row.project_id === FRESH)).toBe(true);
    // Payloads rewritten (spec: adapted identities).
    for (const row of memories.rows as Row[]) {
      expect(String(row.tags)).toContain(`project:${FRESH}`);
      expect(String(row.tags)).not.toContain(SOURCE);
      expect(String(row.metadata)).toContain(FRESH);
    }
    const doc = await pool.query(`SELECT project_id FROM documents WHERE id = 't6-d1'`);
    expect(doc.rows[0]?.project_id).toBe(FRESH);
    const job = await pool.query(`SELECT payload FROM scheduled_jobs WHERE id = 't6-j1'`);
    expect(String(job.rows[0]?.payload)).toContain(FRESH);

    // Immutable audit history PRESERVED with the retired id (allowed reference).
    const audit = await pool.query(`SELECT project_id FROM operation_log WHERE id = 910001`);
    expect(audit.rows[0]?.project_id).toBe(SOURCE);

    // Alias + exactly one operation row.
    const aliases = await pool.query(
      `SELECT retired_project_id, target_project_id FROM project_identity_aliases WHERE retired_project_id = $1`,
      [SOURCE],
    );
    expect(aliases.rows).toEqual([{ retired_project_id: SOURCE, target_project_id: FRESH }]);

    // Zero mutable source references across direct + payload stores (projects
    // included — the identity-root row moved by the roots-first rewrite).
    const directStores = ["workspaces", "projects", "memories", "documents", "graph_generations"];
    for (const table of directStores) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE project_id = $1`, [SOURCE]);
      expect(rows[0].n).toBe(0);
    }
    const payloadLeaks = await pool.query(
      `SELECT count(*)::int AS n FROM scheduled_jobs WHERE payload LIKE '%' || $1 || '%'`,
      [SOURCE],
    );
    expect(payloadLeaks.rows[0].n).toBe(0);

    // Graph history retained; target workspace points at the winner generation.
    const generations = await pool.query(
      `SELECT id, project_id, status FROM graph_generations ORDER BY id`,
    );
    expect(generations.rows.length).toBeGreaterThan(0);
    const targetWorkspace = await pool.query(
      `SELECT active_graph_generation_id FROM workspaces WHERE project_id = $1`,
      [FRESH],
    );
    expect(targetWorkspace.rows[0]?.active_graph_generation_id).toBe("t6-g1");

    // The retired source is no longer a live preview source.
    await expect(serviceFor().preview({
      mode: "rename", sourceProjectId: SOURCE, targetProjectId: "t6-other-root", dryRun: true,
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_SOURCE_RETIRED" });
  }, 30_000);

  test("two PostgreSQL backends: a guarded writer blocked during apply lands on the target, never stranded", async () => {
    let applyBackendPid = 0;
    let lockSeen!: () => void;
    const lockAcquired = new Promise<void>((resolve) => { lockSeen = resolve; });
    const applyService = serviceFor({
      onAcquire: (pid) => { applyBackendPid = pid; },
      // Signal only AFTER the lock query settles: firing on issue would race the
      // writer INSERT in ahead of the exclusive lock and flip the in-tx plan
      // (PROJECT_IDENTITY_PLAN_CHANGED — T6 finding).
      onQuery: (text, settled) => {
        if (text.includes("project_identity_lock_exclusive")) {
          settled.then(() => lockSeen(), () => lockSeen());
        }
      },
    });
    const writerClient = await pool.connect();
    const writerBackend = await writerClient.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`);
    const writerBackendPid = writerBackend.rows[0]!.pid;

    const RACE_T = "t6-race-t";
    const applyPromise = applyRename(applyService, uniqueOp(), RACE_T);

    // Wait until apply holds the exclusive identity locks, then race an INSERT
    // with the RETIRED id from a SECOND backend process.
    await lockAcquired;
    const insertPromise = writerClient.query(
      `INSERT INTO memories (id, content, type, level, project_id, tags, metadata, updated_at)
       VALUES ('t6-race', 'raced', 'conversation', 1, $1, '[]', '{}', now())`,
      [SOURCE],
    );

    let result: ProjectIdentityApplyResult;
    try {
      result = await applyPromise;
      await insertPromise;
    } finally {
      // Never release a client with an in-flight query: if apply throws, the
      // blocked INSERT is still on the wire and the pool would hand the busy
      // connection to the next test (08P01 protocol desync + hook timeouts —
      // T6 finding). Settle the INSERT first; only then release.
      await insertPromise.catch(() => { /* raced insert may reject after a failed apply */ });
      writerClient.release();
    }

    // The blocked writer's row was resolved to the target by the guard — it
    // did NOT persist under the retired source id.
    const raced = await pool.query(`SELECT project_id FROM memories WHERE id = 't6-race'`);
    expect(raced.rows).toEqual([{ project_id: RACE_T }]);
    expect(result.operationId).toBeTruthy();
    // Two distinct PG backends were actually involved.
    expect(applyBackendPid).toBeGreaterThan(0);
    expect(writerBackendPid).not.toBe(applyBackendPid);
  }, 30_000);

  test("lost-response retry returns the one stored result with exactly one operation row", async () => {
    const operationId = uniqueOp();
    const FRESH = "t6-fresh";
    const first = await applyRename(serviceFor(), operationId, FRESH);

    // The honest retry replays the ORIGINAL request material (same
    // operationId + the plan hash the caller already had).
    const retried = await serviceFor().apply({
      mode: "rename", sourceProjectId: SOURCE, targetProjectId: FRESH,
      dryRun: false, operationId, expectedPlanHash: first.planHash,
    });

    expect(retried.operationId).toBe(operationId);
    expect(retried.committedAt).toBe(first.committedAt);
    expect(retried.planHash).toBe(first.planHash);
    // Verbatim replay: no post-commit decoration.
    expect("invalidation" in retried).toBe(false);

    const operations = await pool.query(
      `SELECT count(*)::int AS n FROM project_identity_operations WHERE operation_id = $1`,
      [operationId],
    );
    expect(operations.rows[0].n).toBe(1);
    const aliases = await pool.query(
      `SELECT count(*)::int AS n FROM project_identity_aliases WHERE retired_project_id = $1`,
      [SOURCE],
    );
    expect(aliases.rows[0].n).toBe(1);
  }, 30_000);

  test("different-root, collision, stale-plan, and operation-reuse conflicts fail without mutation", async () => {
    await seedTarget();
    // Different-root merge.
    await pool.query(
      `INSERT INTO workspaces (project_id, project_path, status) VALUES ('t6-other-root', '/elsewhere', 'active')
       ON CONFLICT (project_id) DO NOTHING`,
    );
    await expect(serviceFor().preview({
      mode: "merge", sourceProjectId: SOURCE, targetProjectId: "t6-other-root", dryRun: true,
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_ROOT_MISMATCH" });

    // Collision: rename onto a live target.
    await expect(serviceFor().preview({
      mode: "rename", sourceProjectId: SOURCE, targetProjectId: TARGET, dryRun: true,
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_TARGET_EXISTS" });

    // Stale plan hash.
    await expect(serviceFor().apply({
      mode: "rename", sourceProjectId: SOURCE, targetProjectId: "t6-fresh",
      dryRun: false, operationId: uniqueOp(), expectedPlanHash: "0".repeat(64),
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_PLAN_CHANGED" });

    // Operation reuse with different material.
    const operationId = uniqueOp();
    await applyRename(serviceFor(), operationId, "t6-fresh");
    await expect(serviceFor().apply({
      mode: "rename", sourceProjectId: TARGET, targetProjectId: "t6-fresh-2",
      dryRun: false, operationId, expectedPlanHash: "1".repeat(64),
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_OPERATION_REUSED" });

    // Nothing mutated by the failing gates: the different-root workspace and
    // the collision target survive untouched; SOURCE moved only via the one
    // SUCCESSFUL operation-reuse rename (to t6-fresh), never by a failing gate.
    const workspaces = await pool.query(
      `SELECT project_id FROM workspaces WHERE project_id IN ($1, $2, $3) ORDER BY 1`,
      [SOURCE, TARGET, "t6-other-root"],
    );
    expect(workspaces.rows.map((row: Row) => row.project_id)).toEqual(["t6-other-root", TARGET]);
  }, 30_000);

  test("unknown storage blocks apply without mutation", async () => {
    await pool.query(`CREATE TABLE t6_unknown_store (id text PRIMARY KEY, project_id text)`);
    await pool.query(`INSERT INTO t6_unknown_store VALUES ('u1', $1)`, [SOURCE]);

    // Preview RESOLVES and reports the unclassified store (operator evidence);
    // only APPLY rejects (spec req 4: unknown scoped storage blocks mutation).
    const preview = await serviceFor().preview({
      mode: "rename", sourceProjectId: SOURCE, targetProjectId: "t6-fresh", dryRun: true,
    });
    expect(preview.unknownStores).toContain("t6_unknown_store.project_id");

    const before = await snapshot();
    await expect(serviceFor().apply({
      mode: "rename", sourceProjectId: SOURCE, targetProjectId: "t6-fresh",
      dryRun: false, operationId: uniqueOp(), expectedPlanHash: preview.planHash,
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_UNKNOWN_STORAGE" });
    expect(await snapshot()).toBe(before);
  }, 30_000);

  test("injected pre-commit failure preserves a byte-equivalent snapshot", async () => {
    await seedGraphSource();
    // Fail trigger: aborts the transaction the moment the first identity
    // rewrite to 't6-boom' lands (mid-apply, after mutations began).
    await pool.query(`
      CREATE FUNCTION t6_fail_after_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.project_id = 't6-boom' THEN
          RAISE EXCEPTION 't6 injected pre-commit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER t6_fail_trigger BEFORE UPDATE OF project_id ON memories
      FOR EACH ROW EXECUTE FUNCTION t6_fail_after_mutation();
    `);

    const before = await snapshot();
    const preview = await serviceFor().preview({
      mode: "rename", sourceProjectId: SOURCE, targetProjectId: "t6-boom", dryRun: true,
    });
    await expect(serviceFor().apply({
      mode: "rename", sourceProjectId: SOURCE, targetProjectId: "t6-boom",
      dryRun: false, operationId: uniqueOp(), expectedPlanHash: preview.planHash,
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_BACKEND_UNAVAILABLE" });

    const after = await snapshot();
    expect(after).toBe(before);
  }, 30_000);

  test("post-commit invalidation covers both ids and a throwing invalidator never flips the committed result", async () => {
    const invalidated: string[] = [];
    const published: ProjectIdentityChangedPayload[] = [];
    const registry = new ProjectIdentityInvalidatorRegistry();
    registry.register({ id: "rec", invalidateProject: (p) => { invalidated.push(p); } });
    registry.register({ id: "broken", invalidateProject: () => { throw new Error("boom"); } });
    const operationId = uniqueOp();
    const FRESH = "t6-fresh";

    const result = await applyRename(
      serviceFor({ invalidators: registry, publisher: { publish: (p) => published.push(p) } }),
      operationId,
      FRESH,
    );

    expect(result.operationId).toBe(operationId);
    expect(invalidated.sort()).toEqual([SOURCE, FRESH].sort());
    expect(published).toEqual([{
      mode: "rename",
      sourceProjectId: SOURCE,
      targetProjectId: FRESH,
      operationId,
      committedAt: result.committedAt,
    }]);
    // Sanitized failure reported; committed result unaffected.
    expect(result.invalidation?.failures).toHaveLength(2);
    expect(result.invalidation?.failures[0]?.code).toBe("UNKNOWN");
    // The data move really committed.
    const moved = await pool.query(`SELECT count(*)::int AS n FROM memories WHERE project_id = $1`, [FRESH]);
    expect(moved.rows[0].n).toBe(2);

    // A THROWING publisher cannot flip a committed result either (spec req 8,
    // apply.ts publisher catch). Fresh source required — SOURCE retired above.
    await pool.query(
      `INSERT INTO projects (id, project_id, path, document_count, total_size, updated_at)
       VALUES ('t6-p-s2', 't6-source-2', $1, 0, 0, now()) ON CONFLICT (id) DO NOTHING`,
      [ROOT],
    );
    await pool.query(
      `INSERT INTO workspaces (project_id, project_path, status) VALUES ('t6-source-2', $1, 'active')
       ON CONFLICT (project_id) DO NOTHING`,
      [ROOT],
    );
    const throwing = serviceFor({ publisher: { publish: () => { throw new Error("boom"); } } });
    const secondPreview = await throwing.preview({
      mode: "rename", sourceProjectId: "t6-source-2", targetProjectId: "t6-fresh-2", dryRun: true,
    });
    const second = await throwing.apply({
      mode: "rename", sourceProjectId: "t6-source-2", targetProjectId: "t6-fresh-2",
      dryRun: false, operationId: uniqueOp(), expectedPlanHash: secondPreview.planHash,
    });
    expect(second.mode).toBe("rename");
    const secondWorkspace = await pool.query(
      `SELECT count(*)::int AS n FROM workspaces WHERE project_id = 't6-fresh-2'`,
    );
    expect(secondWorkspace.rows[0].n).toBe(1);
  }, 30_000);

  test("alias chains flatten: rename A→B then merge B→C re-points A→C (spec req 2)", async () => {
    await seedTarget(); // C = TARGET, same canonical root
    const CHAIN_B = "t6-chain-b";

    const renamed = await applyRename(serviceFor(), uniqueOp(), CHAIN_B);
    expect(renamed.mode).toBe("rename");

    // Merge the once-renamed id into C. Before the flatten fix this aborted
    // with 23503 (project_identity_aliases_target_fkey ON DELETE RESTRICT).
    const mergePreview = await serviceFor().preview({
      mode: "merge", sourceProjectId: CHAIN_B, targetProjectId: TARGET, dryRun: true,
    });
    const merged = await serviceFor().apply({
      mode: "merge", sourceProjectId: CHAIN_B, targetProjectId: TARGET,
      dryRun: false, operationId: uniqueOp(), expectedPlanHash: mergePreview.planHash,
    });
    expect(merged.mode).toBe("merge");

    // Chain flattened: both retired ids resolve directly to the merge target.
    const aliases = await pool.query(
      `SELECT retired_project_id, target_project_id FROM project_identity_aliases ORDER BY retired_project_id`,
    );
    expect(aliases.rows).toEqual([
      { retired_project_id: CHAIN_B, target_project_id: TARGET },
      { retired_project_id: SOURCE, target_project_id: TARGET },
    ]);
    // The intermediate id is fully retired too.
    const chainWorkspace = await pool.query(
      `SELECT count(*)::int AS n FROM workspaces WHERE project_id = $1`,
      [CHAIN_B],
    );
    expect(chainWorkspace.rows[0].n).toBe(0);
  }, 30_000);

  test("merge moves rows, selects the newest activated generation, and retires the source workspace", async () => {
    await seedTarget();
    await seedGraphSource();
    await seedGraphTarget();

    const preview = await serviceFor().preview({
      mode: "merge", sourceProjectId: SOURCE, targetProjectId: TARGET, dryRun: true,
    });
    const result = await serviceFor().apply({
      mode: "merge", sourceProjectId: SOURCE, targetProjectId: TARGET,
      dryRun: false, operationId: uniqueOp(), expectedPlanHash: preview.planHash,
    });
    expect(result.mode).toBe("merge");

    // Source rows live on the target; source workspace is gone.
    const memories = await pool.query(`SELECT count(*)::int AS n FROM memories WHERE project_id = $1`, [TARGET]);
    expect(memories.rows[0].n).toBe(2);
    const sourceWorkspace = await pool.query(`SELECT count(*)::int AS n FROM workspaces WHERE project_id = $1`, [SOURCE]);
    expect(sourceWorkspace.rows[0].n).toBe(0);

    // Newest activated generation (t6-g1, 1 day) wins over t6-g3 (2 days).
    const workspace = await pool.query(
      `SELECT active_graph_generation_id FROM workspaces WHERE project_id = $1`,
      [TARGET],
    );
    expect(workspace.rows[0]?.active_graph_generation_id).toBe("t6-g1");
    const statuses = await pool.query(
      `SELECT id, status FROM graph_generations ORDER BY id`,
    );
    const g1 = statuses.rows.find((row: Row) => row.id === "t6-g1");
    const g3 = statuses.rows.find((row: Row) => row.id === "t6-g3");
    expect(g1?.status).toBe("active");
    expect(g3?.status).toBe("superseded");

    // Alias + one operation row.
    const alias = await pool.query(
      `SELECT target_project_id FROM project_identity_aliases WHERE retired_project_id = $1`,
      [SOURCE],
    );
    expect(alias.rows).toEqual([{ target_project_id: TARGET }]);
  }, 30_000);
});

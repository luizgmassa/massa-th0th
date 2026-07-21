/**
 * T4 — PostgreSQL acceptance for hook attribution persistence (M45/HAR-05/06/07).
 *
 * Scope (T4): durable persistence of agent_id + attribution_source; canonical
 * mirror keying after an alias rename (HAR-07); honest-absence agentId → NULL.
 * Repair-migration coverage (HAR-08) is added in T7.
 *
 * Gate: runs only with HOOK_ATTRIBUTION_ACCEPTANCE_DATABASE_URL pointing at an
 * OWNED database (`massa_th0th_hook_attribution`) with all migrations applied.
 * Skipped otherwise — recorded in validation.md, never weakened. The suite
 * points the shared pg/prisma singletons at the owned URL via process.env so
 * the real PgObservationStore + AttributionResolver exercise true integration.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { Pool } from "pg";

const URL = process.env.HOOK_ATTRIBUTION_ACCEPTANCE_DATABASE_URL;

// Env override MUST run before any pg/prisma singleton initializes. Bun loads
// .env first; we overwrite DATABASE_URL to the owned URL at module eval so the
// lazy singletons (getPrismaClient / getPgPool) connect to the owned DB.
if (URL) {
  process.env.DATABASE_URL = URL;
}

import { getHookService, resetHookService } from "../services/hooks/hook-service.js";
import { resetAttributionResolver, setAttributionResolverForTests, type AttributionResolverLike } from "../services/hooks/attribution-resolver.js";
import { getObservationStore } from "../data/memory/observation-repository.js";
import { resetProjectIdentityAliasResolver, setProjectIdentityAliasResolverForTests } from "../services/project-identity/alias-resolver.js";
import { _resetPrismaForTesting } from "../services/query/prisma-client.js";
import { closeConnections } from "../data/db-connection.js";

type Row = Record<string, unknown>;

let pool: Pool;

/** Wait long enough for the fire-and-forget persist IIFE to commit. */
async function settle(): Promise<void> {
  await getObservationStore().__drain();
  await new Promise((r) => setTimeout(r, 120));
}

const VERBATIM: AttributionResolverLike = {
  resolve: async (input) =>
    ({ projectId: input.callerProjectId, source: "verbatim" as const }),
  pinSession: () => {},
};

const run = URL ? describe : describe.skip;

run("Hook attribution PG acceptance (T4)", () => {
  let counter = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    // Reset singletons so they re-initialize against the owned DB.
    await closeConnections();
    _resetPrismaForTesting();
  });

  afterAll(async () => {
    await pool.end();
    await closeConnections();
    _resetPrismaForTesting();
  });

  beforeEach(async () => {
    counter++;
    // Isolate state: clear the rows we own (obs ids are random; clean by the
    // acc- prefixes we control on project_id / session_id) + reset caches.
    await pool.query("DELETE FROM observations WHERE project_id LIKE 'acc-%' OR session_id LIKE 'acc-%'");
    await pool.query("DELETE FROM memories WHERE project_id LIKE 'acc-%' OR session_id LIKE 'acc-%' OR agent_id LIKE 'acc-%'");
    await pool.query("DELETE FROM workspaces WHERE project_id LIKE 'acc-%'");
    await pool.query("DELETE FROM project_identity_aliases WHERE retired_project_id LIKE 'acc-%' OR target_project_id LIKE 'acc-%'");
    resetHookService();
    resetAttributionResolver();
    resetProjectIdentityAliasResolver();
    _resetPrismaForTesting();
  });

  test("HAR-05/06: durable row carries resolved id + attribution_source + agent_id", async () => {
    const cwd = `/acc/repo/${counter}`;
    await pool.query(
      "INSERT INTO workspaces (project_id, project_path, display_name, status) VALUES ($1, $2, $3, 'active') ON CONFLICT DO NOTHING",
      ["acc-repo", cwd, "acc-repo"],
    );
    // Use the REAL resolver + REAL PgObservationStore against the owned DB.
    setAttributionResolverForTests(null); // force production resolver
    const svc = getHookService();
    const obs = await svc.ingestOne({
      event: "user-prompt",
      projectId: "acc-junk-caller",
      sessionId: "acc-session-1",
      payload: { prompt: "hi", cwd },
      agentId: "acc-agent",
      ts: Date.now(),
    });
    expect(obs).toBeTruthy();
    await settle();
    const { rows } = await pool.query<Row>(
      "SELECT project_id, attribution_source, agent_id FROM observations WHERE id = $1",
      [obs],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.project_id).toBe("acc-repo");
    expect(rows[0]!.attribution_source).toBe("containment");
    expect(rows[0]!.agent_id).toBe("acc-agent");
  });

  test("HAR-06: absent agentId persists as NULL (honest absence)", async () => {
    const cwd = `/acc/repo2/${counter}`;
    await pool.query(
      "INSERT INTO workspaces (project_id, project_path, display_name, status) VALUES ($1, $2, $3, 'active') ON CONFLICT DO NOTHING",
      ["acc-repo2", cwd, "acc-repo2"],
    );
    setAttributionResolverForTests(null);
    const svc = getHookService();
    const obs = await svc.ingestOne({
      event: "user-prompt",
      projectId: "acc-junk-2",
      sessionId: "acc-session-2",
      payload: { prompt: "hi", cwd },
      ts: Date.now(),
    });
    await settle();
    const { rows } = await pool.query<Row>(
      "SELECT agent_id FROM observations WHERE id = $1",
      [obs],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.agent_id).toBeNull();
  });

  test("HAR-07: mirror keyed by canonical id after alias rename (no read/write split)", async () => {
    const cwd = `/acc/repo3/${counter}`;
    await pool.query(
      "INSERT INTO workspaces (project_id, project_path, display_name, status) VALUES ($1, $2, $3, 'active') ON CONFLICT DO NOTHING",
      ["acc-live", cwd, "acc-live"],
    );
    // Inject a fake alias resolver so acc-retired canonicalizes to acc-live at
    // the repo persist seam — avoids the full project_identity_operations FK
    // machinery while exercising the real PgObservationStore mirror fix.
    setProjectIdentityAliasResolverForTests({
      resolve: async (id: string) => (id === "acc-retired" ? "acc-live" : id),
    } as never);
    // Verbatim hook resolver returns the caller id; the store's alias resolver
    // canonicalizes retired → live at persist.
    setAttributionResolverForTests(VERBATIM);
    const svc = getHookService();
    const obs = await svc.ingestOne({
      event: "user-prompt",
      projectId: "acc-retired",
      sessionId: "acc-session-3",
      payload: { prompt: "hi" },
      ts: Date.now(),
    });
    await settle();
    // Durable row is canonicalized.
    const { rows } = await pool.query<Row>(
      "SELECT project_id FROM observations WHERE id = $1",
      [obs],
    );
    expect(rows[0]!.project_id).toBe("acc-live");
    // Mirror converged to canonical — sync read with the live id finds it,
    // and the retired id finds nothing (no split).
    const store = getObservationStore();
    await store.__hydrate();
    expect(store.countByProject("acc-live")).toBeGreaterThanOrEqual(1);
    expect(store.countByProject("acc-retired")).toBe(0);
  });

  test("HAR-01: verbatim fail-open persists caller id when no workspace matches", async () => {
    setAttributionResolverForTests(null);
    const svc = getHookService();
    const obs = await svc.ingestOne({
      event: "user-prompt",
      projectId: "acc-unregistered",
      sessionId: "acc-session-4",
      payload: { prompt: "hi", cwd: `/totally/elsewhere/${counter}` },
      ts: Date.now(),
    });
    await settle();
    const { rows } = await pool.query<Row>(
      "SELECT project_id, attribution_source FROM observations WHERE id = $1",
      [obs],
    );
    expect(rows[0]!.project_id).toBe("acc-unregistered");
    expect(rows[0]!.attribution_source).toBe("verbatim");
  });
});

// ---------------------------------------------------------------------------
// T7 — Idempotent hook-attribution repair migration (M47 / HAR-08 / AC-8).
//
// The migration file is re-executed against seeded rows: it is idempotent, so a
// second run is a true no-op. This proves the candidate predicate, path-
// deduped containment, NULL-safe NOT EXISTS, _pre_repair_project_id
// preservation, unambiguous-only memory linkage, and the self-verifying DO $$.
// ---------------------------------------------------------------------------

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../prisma/migrations/20260720210000_repair_hook_attribution/migration.sql",
);
const MIGRATION_SQL = fs.readFileSync(MIGRATION_PATH, "utf8");

run("Hook attribution repair migration (T7 / HAR-08 / AC-8)", () => {
  let counter = 1000;

  beforeAll(async () => {
    // T4's afterAll ended the shared pool; create a fresh one for this block.
    pool = new Pool({ connectionString: URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    counter++;
    await pool.query("DELETE FROM observations WHERE project_id LIKE 'acc-%' OR session_id LIKE 'acc-%'");
    await pool.query("DELETE FROM memories WHERE project_id LIKE 'acc-%' OR session_id LIKE 'acc-%' OR agent_id LIKE 'acc-%'");
    await pool.query("DELETE FROM workspaces WHERE project_id LIKE 'acc-%'");
    await pool.query("DELETE FROM project_identity_aliases WHERE retired_project_id LIKE 'acc-%' OR target_project_id LIKE 'acc-%'");
  });
  function wsId(n: number) { return `acc-ws-${n}`; }
  function obsId(n: number) { return `acc-obs-${n}-${Math.random().toString(36).slice(2, 8)}`; }
  function memId(n: number) { return `acc-mem-${n}-${Math.random().toString(36).slice(2, 8)}`; }

  async function seedWorkspace(id: string, projectPath: string) {
    await pool.query(
      "INSERT INTO workspaces (project_id, project_path, display_name, status) VALUES ($1, $2, $3, 'active') ON CONFLICT DO NOTHING",
      [id, projectPath, id],
    );
  }

  async function seedObservation(opts: {
    id: string;
    projectId: string;
    sessionId?: string;
    cwd?: string;
    attributionSource?: string | null;
  }) {
    const payload: Record<string, unknown> = { prompt: "hi" };
    if (opts.cwd) payload.cwd = opts.cwd;
    await pool.query(
      "INSERT INTO observations (id, project_id, session_id, source, payload_json, importance, attribution_source, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [opts.id, opts.projectId, opts.sessionId ?? null, "user-prompt", JSON.stringify(payload), 0.5, opts.attributionSource ?? null, Date.now()],
    );
  }

  async function seedMemory(opts: {
    id: string;
    projectId: string | null;
    sessionId: string;
  }) {
    await pool.query(
      "INSERT INTO memories (id, content, type, level, project_id, session_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6, NOW(), NOW())",
      [opts.id, "m", "conversation", 1, opts.projectId, opts.sessionId],
    );
  }

  async function runMigration() {
    await pool.query(MIGRATION_SQL);
  }

  async function repairedObservation(id: string) {
    const { rows } = await pool.query<Row>(
      "SELECT project_id, attribution_source, payload_json FROM observations WHERE id = $1",
      [id],
    );
    return rows[0] ?? null;
  }

  test("unambiguous cwd is repaired, stamped, and preserves the pre-repair id", async () => {
    const n = counter;
    await seedWorkspace(wsId(n), `/acc/seed/${n}`);
    const id = obsId(n);
    await seedObservation({
      id,
      projectId: "default",
      sessionId: `acc-s-${n}`,
      cwd: `/acc/seed/${n}/sub/dir`,
    });

    await runMigration();

    const row = await repairedObservation(id);
    expect(row).toBeTruthy();
    expect(row!.project_id).toBe(wsId(n));
    expect(row!.attribution_source).toBe("repaired");
    expect(JSON.parse(row!.payload_json)._pre_repair_project_id).toBe("default");
  });

  test("orphan (non-live) project id is repaired and the old id is preserved", async () => {
    const n = counter;
    await seedWorkspace(wsId(n), `/acc/seed/${n}`);
    const id = obsId(n);
    await seedObservation({
      id,
      projectId: "acc-orphan-caller",
      sessionId: `acc-s-${n}`,
      cwd: `/acc/seed/${n}`,
    });

    await runMigration();

    const row = await repairedObservation(id);
    expect(row!.project_id).toBe(wsId(n));
    expect(JSON.parse(row!.payload_json)._pre_repair_project_id).toBe("acc-orphan-caller");
  });

  test("shared-path workspace is ambiguous and left untouched (path-dedupe)", async () => {
    const n = counter;
    const shared = `/acc/shared/${n}`;
    await seedWorkspace(`acc-x-${n}`, shared);
    await seedWorkspace(`acc-y-${n}`, shared);
    const id = obsId(n);
    await seedObservation({
      id,
      projectId: "default",
      sessionId: `acc-s-${n}`,
      cwd: `${shared}/deep`,
    });

    await runMigration();

    const row = await repairedObservation(id);
    expect(row!.project_id).toBe("default");
    expect(row!.attribution_source).toBeNull();
  });

  test("no-cwd rows are never candidates", async () => {
    const n = counter;
    const id = obsId(n);
    await seedObservation({ id, projectId: "default", sessionId: `acc-s-${n}` });

    await runMigration();

    const row = await repairedObservation(id);
    expect(row!.project_id).toBe("default");
    expect(row!.attribution_source).toBeNull();
  });

  test("nested unique root repairs to the longest unambiguous match", async () => {
    const n = counter;
    await seedWorkspace(`acc-parent-${n}`, `/acc/parent/${n}`);
    await seedWorkspace(`acc-child-${n}`, `/acc/parent/${n}/child`);
    const id = obsId(n);
    await seedObservation({
      id,
      projectId: "default",
      sessionId: `acc-s-${n}`,
      cwd: `/acc/parent/${n}/child/file`,
    });

    await runMigration();

    const row = await repairedObservation(id);
    expect(row!.project_id).toBe(`acc-child-${n}`);
    expect(JSON.parse(row!.payload_json)._pre_repair_project_id).toBe("default");
  });

  test("memory repaired via UNAMBIGUOUS session linkage; ambiguous session untouched", async () => {
    const n = counter;
    await seedWorkspace(`acc-memws1-${n}`, `/acc/mem1/${n}`);
    await seedWorkspace(`acc-memws2-${n}`, `/acc/mem2/${n}`);

    // Session with a single live project → memory is repairable.
    const s1 = `acc-mem-s1-${n}`;
    await seedObservation({ id: obsId(n), projectId: `acc-memws1-${n}`, sessionId: s1, cwd: `/acc/mem1/${n}` });
    const mem1 = memId(n);
    await seedMemory({ id: mem1, projectId: null, sessionId: s1 });

    // Session with two distinct live projects → memory is ambiguous, untouched.
    const s2 = `acc-mem-s2-${n}`;
    await seedObservation({ id: obsId(n + 1000), projectId: `acc-memws1-${n}`, sessionId: s2, cwd: `/acc/mem1/${n}` });
    await seedObservation({ id: obsId(n + 1001), projectId: `acc-memws2-${n}`, sessionId: s2, cwd: `/acc/mem2/${n}` });
    const mem2 = memId(n + 1000);
    await seedMemory({ id: mem2, projectId: "default", sessionId: s2 });

    await runMigration();

    const r1 = await pool.query<Row>("SELECT project_id, metadata FROM memories WHERE id = $1", [mem1]);
    expect(r1.rows[0]!.project_id).toBe(`acc-memws1-${n}`);
    expect(JSON.parse(r1.rows[0]!.metadata)._pre_repair_project_id).toBeNull();

    const r2 = await pool.query<Row>("SELECT project_id, metadata FROM memories WHERE id = $1", [mem2]);
    expect(r2.rows[0]!.project_id).toBe("default");
    expect(r2.rows[0]!.metadata).toBeNull();
  });

  test("idempotent: a second run changes zero additional rows", async () => {
    const n = counter;
    await seedWorkspace(wsId(n), `/acc/seed/${n}`);
    const id = obsId(n);
    await seedObservation({ id, projectId: "default", sessionId: `acc-s-${n}`, cwd: `/acc/seed/${n}` });

    // Seed a memory in the same unambiguous session so memory idempotency is
    // exercised alongside the observation one.
    const mem = memId(n);
    await seedMemory({ id: mem, projectId: null, sessionId: `acc-s-${n}` });

    await runMigration();

    const afterFirstObs = await repairedObservation(id);
    expect(afterFirstObs!.attribution_source).toBe("repaired");
    const afterFirstMem = await pool.query<Row>("SELECT project_id, metadata FROM memories WHERE id = $1", [mem]);
    expect(afterFirstMem.rows[0]!.project_id).toBe(wsId(n));

    const repairedObsBefore = (await pool.query<Row>(
      "SELECT count(*)::int AS c FROM observations WHERE attribution_source = 'repaired'",
    )).rows[0]!.c;
    const repairedMemBefore = (await pool.query<Row>(
      "SELECT count(*)::int AS c FROM memories WHERE metadata IS NOT NULL AND metadata::jsonb ? '_pre_repair_project_id'",
    )).rows[0]!.c;

    // Re-run: must not throw, must not flip any additional row, must leave the
    // preserved pre-repair ids byte-identical.
    await runMigration();

    const repairedObsAfter = (await pool.query<Row>(
      "SELECT count(*)::int AS c FROM observations WHERE attribution_source = 'repaired'",
    )).rows[0]!.c;
    const repairedMemAfter = (await pool.query<Row>(
      "SELECT count(*)::int AS c FROM memories WHERE metadata IS NOT NULL AND metadata::jsonb ? '_pre_repair_project_id'",
    )).rows[0]!.c;
    expect(repairedObsAfter).toBe(repairedObsBefore);
    expect(repairedMemAfter).toBe(repairedMemBefore);

    const afterSecondObs = await repairedObservation(id);
    expect(JSON.parse(afterSecondObs!.payload_json)._pre_repair_project_id).toBe("default");
    const afterSecondMem = await pool.query<Row>("SELECT project_id, metadata FROM memories WHERE id = $1", [mem]);
    expect(afterSecondMem.rows[0]!.project_id).toBe(wsId(n));
    expect(JSON.parse(afterSecondMem.rows[0]!.metadata)._pre_repair_project_id).toBeNull();
  });

  test("DO $$ raises when a repaired observation id is not live (invariant guard)", async () => {
    const n = counter;
    const id = obsId(n);
    // Manually plant a row claiming 'repaired' but pointing at a non-live id.
    await pool.query(
      "INSERT INTO observations (id, project_id, session_id, source, payload_json, importance, attribution_source, created_at) VALUES ($1,$2,$3,$4,$5,$6,'repaired',$7)",
      [id, `acc-not-live-${n}`, `acc-s-${n}`, "user-prompt", JSON.stringify({ cwd: `/acc/nowhere/${n}` }), 0.5, Date.now()],
    );

    await expect(runMigration()).rejects.toThrow(/hook_attribution_repair_observation/);

    // The planted row was inserted in autocommit; the migration txn rolls back
    // but leaves this row. Remove it so it can't poison other tests/runs.
    await pool.query("DELETE FROM observations WHERE id = $1", [id]);
  });
});

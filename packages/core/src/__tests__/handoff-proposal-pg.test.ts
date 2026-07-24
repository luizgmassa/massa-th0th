/** PostgreSQL parity for the PostgreSQL-canonical handoff/proposal repositories. */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { PgHandoffStore } from "../data/handoff/handoff-repository-pg.js";
import {
  getHandoffStore,
  resetHandoffStore,
  type HandoffRecord,
} from "../data/handoff/handoff-repository.js";
import { PgProposalStore } from "../data/proposal/proposal-repository-pg.js";
import {
  getProposalStore,
  resetProposalStore,
  type ProposalRecord,
} from "../data/proposal/proposal-repository.js";

const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const DEDICATED_DB =
  url?.hostname === "127.0.0.1" &&
  url.port === "5433" &&
  url.pathname === "/massa_ai_test";
const PREFIX = "pg-runtime-parity-";
let prisma: any;

function projectId(): string {
  return `${PREFIX}${randomUUID()}`;
}

function handoff(overrides: Partial<HandoffRecord> = {}): HandoffRecord {
  return {
    id: `handoff-${randomUUID()}`,
    projectId: projectId(),
    sourceSessionId: "session-1",
    targetAgent: "implementer",
    summary: "summary",
    openQuestions: ["q"],
    nextSteps: ["n"],
    files: ["src/a.ts"],
    status: "open",
    createdAt: Date.now(),
    acceptedAt: null,
    ...overrides,
  };
}

function proposal(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: `proposal-${randomUUID()}`,
    projectId: projectId(),
    kind: "memory.create",
    targetMemoryId: null,
    payload: { content: "hello", tags: ["t"] },
    rationale: "because",
    status: "pending",
    createdAt: Date.now(),
    decidedAt: null,
    ...overrides,
  };
}

async function cleanup(): Promise<void> {
  if (!prisma) return;
  await prisma.$executeRaw`DELETE FROM handoffs WHERE project_id LIKE ${PREFIX + "%"}`;
  await prisma.$executeRaw`DELETE FROM proposals WHERE project_id LIKE ${PREFIX + "%"}`;
}

describe.skipIf(!DEDICATED_DB)("handoff/proposal PostgreSQL parity", () => {
  beforeAll(async () => {
    const { getPrismaClient } = await import("../services/query/prisma-client.js");
    prisma = getPrismaClient();
    const identity = await prisma.$queryRaw<
      Array<{ database_name: string; server_port: number }>
    >`SELECT current_database() AS database_name, inet_server_port() AS server_port`;
    expect(identity[0]).toEqual({
      database_name: "massa_ai_test",
      server_port: 5433,
    });
    await cleanup();
  });
  afterEach(cleanup);
  afterAll(cleanup);

  describe("PgHandoffStore", () => {
    test("insert/get round-trips JSON and nullable fields into PostgreSQL", async () => {
      const store = new PgHandoffStore();
      await store.__hydrate();
      const record = handoff({
        sourceSessionId: null,
        targetAgent: null,
        openQuestions: ["q1", "q2"],
        nextSteps: ["n1"],
        files: ["a.ts", "b.ts"],
      });
      await store.insert(record);
      expect(await store.getById(record.id)).toEqual(record);
      await store.__drain();

      const rows = await prisma.$queryRaw<any[]>`
        SELECT * FROM handoffs WHERE id = ${record.id}`;
      expect(rows).toHaveLength(1);
      expect(rows[0].source_session_id).toBeNull();
      expect(rows[0].target_agent).toBeNull();
      expect(JSON.parse(rows[0].open_questions_json)).toEqual(["q1", "q2"]);
      expect(await store.getById("missing")).toBeNull();
      expect(await store.journalMode()).toBe("postgres");
    });

    test("listPending mirrors project/target/null filters and oldest-first ordering", async () => {
      const store = new PgHandoffStore();
      await store.__hydrate();
      const pid = projectId();
      const now = Date.now();
      await store.insert(handoff({ id: "pg-h-1", projectId: pid, targetAgent: "a1", createdAt: now }));
      await store.insert(handoff({ id: "pg-h-2", projectId: pid, targetAgent: "a2", createdAt: now + 10 }));
      await store.insert(handoff({ id: "pg-h-3", projectId: pid, targetAgent: null, createdAt: now + 5 }));
      await store.insert(handoff({ id: "pg-h-4", projectId: projectId(), targetAgent: "a1" }));
      expect((await store.listPending(pid)).map((row) => row.id)).toEqual([
        "pg-h-1",
        "pg-h-3",
        "pg-h-2",
      ]);
      expect((await store.listPending(pid, "a1")).map((row) => row.id)).toEqual([
        "pg-h-1",
        "pg-h-3",
      ]);
      expect((await store.listPending(pid, "none")).map((row) => row.id)).toEqual(["pg-h-3"]);
      await store.setStatus("pg-h-1", "accepted", 1234);
      expect((await store.listPending(pid)).map((row) => row.id)).toEqual(["pg-h-3", "pg-h-2"]);
      await store.__drain();
    });

    test("terminal transitions preserve timestamps, guards, and missing behavior", async () => {
      const store = new PgHandoffStore();
      await store.__hydrate();
      const accepted = handoff({ id: "pg-h-accepted" });
      const expired = handoff({ id: "pg-h-expired" });
      await store.insert(accepted);
      await store.insert(expired);
      expect(await store.setStatus(accepted.id, "accepted", 1234)).toMatchObject({
        status: "accepted",
        acceptedAt: 1234,
      });
      expect((await store.setStatus(accepted.id, "expired"))!.status).toBe("accepted");
      expect(await store.setStatus(expired.id, "expired")).toMatchObject({
        status: "expired",
        acceptedAt: null,
      });
      expect(await store.setStatus("missing", "accepted")).toBeNull();
      await store.__drain();
      expect(await store.getById(accepted.id)).toMatchObject({ status: "accepted", acceptedAt: 1234 });
    });

    test("fresh store hydrates persisted rows after restart", async () => {
      const record = handoff();
      const first = new PgHandoffStore();
      await first.__hydrate();
      await first.insert(record);
      await first.__drain();
      const restarted = new PgHandoffStore();
      await restarted.__hydrate();
      expect(await restarted.getById(record.id)).toEqual(record);
    });

    test("concurrent terminal transitions have one durable winner", async () => {
      const seed = new PgHandoffStore();
      await seed.__hydrate();
      const record = handoff();
      await seed.insert(record);
      await seed.__drain();
      const acceptor = new PgHandoffStore();
      const expirer = new PgHandoffStore();
      await Promise.all([acceptor.__hydrate(), expirer.__hydrate()]);
      await Promise.all([
        acceptor.setStatus(record.id, "accepted", 1000),
        expirer.setStatus(record.id, "expired"),
      ]);
      const rows = await prisma.$queryRaw<any[]>`
        SELECT status, accepted_at FROM handoffs WHERE id = ${record.id}`;
      expect(["accepted", "expired"]).toContain(rows[0].status);
      if (rows[0].status === "expired") expect(rows[0].accepted_at).toBeNull();
      await prisma.$executeRaw`
        UPDATE handoffs SET status = 'open' WHERE id = ${record.id} AND status = 'open'`;
      const durable = await prisma.$queryRaw<any[]>`
        SELECT status FROM handoffs WHERE id = ${record.id}`;
      expect(durable[0].status).toBe(rows[0].status);
    });

    test("real PostgreSQL corruption surfaces and failed writes preserve the mirror", async () => {
      const store = new PgHandoffStore();
      await store.__hydrate();
      const record = handoff();
      await store.insert(record);

      await expect(
        store.insert({ ...record, summary: "must not replace durable state" }),
      ).rejects.toMatchObject({
        code: "SEARCH_BACKEND_UNAVAILABLE",
        component: "handoff_store",
      });
      expect(await store.getById(record.id)).toEqual(record);

      await prisma.$executeRaw`
        UPDATE handoffs SET open_questions_json = '[1]' WHERE id = ${record.id}`;
      const restarted = new PgHandoffStore();
      await expect(restarted.getById(record.id)).rejects.toMatchObject({
        code: "STORE_CORRUPTION",
        component: "handoff.open_questions_json",
      });
    });
  });

  describe("PgProposalStore", () => {
    test("insert/get round-trips payload JSON and nullable fields into PostgreSQL", async () => {
      const store = new PgProposalStore();
      await store.__hydrate();
      const record = proposal({
        kind: "memory.update",
        targetMemoryId: null,
        payload: { content: "edited", importance: 0.9, tags: ["x", "y"] },
      });
      await store.insert(record);
      expect(await store.getById(record.id)).toEqual(record);
      await store.__drain();
      const rows = await prisma.$queryRaw<any[]>`
        SELECT * FROM proposals WHERE id = ${record.id}`;
      expect(rows).toHaveLength(1);
      expect(rows[0].target_memory_id).toBeNull();
      expect(JSON.parse(rows[0].payload_json)).toEqual(record.payload);
      expect(await store.getById("missing")).toBeNull();
      expect(await store.journalMode()).toBe("postgres");
    });

    test("listPending mirrors project/status filtering and newest-first ordering", async () => {
      const store = new PgProposalStore();
      await store.__hydrate();
      const pid = projectId();
      const older = proposal({ projectId: pid, createdAt: 1000 });
      const newer = proposal({ projectId: pid, createdAt: 2000 });
      const approved = proposal({ projectId: pid, status: "approved", decidedAt: 1500 });
      await store.insert(older);
      await store.insert(newer);
      await store.insert(approved);
      await store.insert(proposal({ projectId: projectId() }));
      expect((await store.listPending(pid)).map((row) => row.id)).toEqual([newer.id, older.id]);
      await store.__drain();
    });

    test("terminal transitions preserve timestamps, guards, and missing behavior", async () => {
      const store = new PgProposalStore();
      await store.__hydrate();
      const record = proposal();
      await store.insert(record);
      expect(await store.setStatus(record.id, "approved", 12345)).toMatchObject({
        status: "approved",
        decidedAt: 12345,
      });
      expect(await store.setStatus(record.id, "rejected", 2000)).toMatchObject({
        status: "approved",
        decidedAt: 12345,
      });
      expect(await store.setStatus("missing", "approved")).toBeNull();
      await store.__drain();
    });

    test("fresh store hydrates persisted rows after restart", async () => {
      const record = proposal();
      const first = new PgProposalStore();
      await first.__hydrate();
      await first.insert(record);
      await first.__drain();
      const restarted = new PgProposalStore();
      await restarted.__hydrate();
      expect(await restarted.getById(record.id)).toEqual(record);
    });

    test("concurrent terminal transitions have one durable winner", async () => {
      const seed = new PgProposalStore();
      await seed.__hydrate();
      const record = proposal();
      await seed.insert(record);
      await seed.__drain();
      const approver = new PgProposalStore();
      const rejecter = new PgProposalStore();
      await Promise.all([approver.__hydrate(), rejecter.__hydrate()]);
      await Promise.all([
        approver.setStatus(record.id, "approved", 1000),
        rejecter.setStatus(record.id, "rejected", 2000),
      ]);
      const rows = await prisma.$queryRaw<any[]>`
        SELECT status, decided_at FROM proposals WHERE id = ${record.id}`;
      expect(["approved", "rejected"]).toContain(rows[0].status);
      expect(rows[0].decided_at).not.toBeNull();
    });

    test("real PostgreSQL corruption surfaces and failed writes preserve the mirror", async () => {
      const store = new PgProposalStore();
      await store.__hydrate();
      const record = proposal();
      await store.insert(record);

      await expect(
        store.insert({ ...record, payload: { content: "must not replace durable state" } }),
      ).rejects.toMatchObject({
        code: "SEARCH_BACKEND_UNAVAILABLE",
        component: "proposal_store",
      });
      expect(await store.getById(record.id)).toEqual(record);

      await prisma.$executeRaw`
        UPDATE proposals SET payload_json = '[]' WHERE id = ${record.id}`;
      const restarted = new PgProposalStore();
      await expect(restarted.getById(record.id)).rejects.toMatchObject({
        code: "STORE_CORRUPTION",
        component: "proposal.payload_json",
      });
    });
  });

  test("factories route PostgreSQL and runtime rows do not use local PostgreSQL", async () => {
    resetHandoffStore();
    resetProposalStore();
    const handoffStore = getHandoffStore();
    const proposalStore = getProposalStore();
    expect(handoffStore).toBeInstanceOf(PgHandoffStore);
    expect(proposalStore).toBeInstanceOf(PgProposalStore);
    await Promise.all([
      (handoffStore as PgHandoffStore).__hydrate(),
      (proposalStore as PgProposalStore).__hydrate(),
    ]);
    const h = handoff();
    const p = proposal();
    await handoffStore.insert(h);
    await proposalStore.insert(p);
    await Promise.all([
      (handoffStore as PgHandoffStore).__drain(),
      (proposalStore as PgProposalStore).__drain(),
    ]);
    const [hRows, pRows] = await Promise.all([
      prisma.$queryRaw<any[]>`SELECT id FROM handoffs WHERE id = ${h.id}`,
      prisma.$queryRaw<any[]>`SELECT id FROM proposals WHERE id = ${p.id}`,
    ]);
    expect(hRows).toHaveLength(1);
    expect(pRows).toHaveLength(1);
    resetHandoffStore();
    resetProposalStore();
  });
});

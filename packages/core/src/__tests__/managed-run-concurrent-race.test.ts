/**
 * ManagedRunRepository concurrent-begin race test (Wave 5 T12 / AC-22).
 *
 * Two parallel begin() calls on the same (projectId, runKind):
 *  - exactly one returns `acquired`
 *  - the other returns `busy` with the winner's runId
 *  - no 500 / `could not serialize access`
 *
 * Validates AD-W5-013 reaper + AD-W5-014 partial unique pin: the partial
 * UNIQUE on (project_id, run_kind) WHERE status='active' is the race-decider;
 * the loser catches the unique violation and surfaces `busy` from the
 * contract (no thrown error escapes).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { BeginManagedRunOutcome, ManagedRunRepository } from "../data/managed-runs/managed-run-contract.js";
import { ManagedRunRepositoryPg } from "../data/managed-runs/managed-run-repository-pg.js";

const DB_AVAILABLE = /^(postgres|postgresql):/.test(process.env.DATABASE_URL ?? "");
const projectId = () => `managed-run-race-${randomUUID()}`;

let repository: ManagedRunRepository;

beforeAll(async () => {
  if (!DB_AVAILABLE) return;
  repository = ManagedRunRepositoryPg.getInstance();
});

afterAll(async () => {
  // NOTE: Do NOT call disconnectPrisma() or ManagedRunRepositoryPg._resetForTesting()
  // here. See managed-run-repository.test.ts for the full rationale (pool-after-end
  // isolation across B2 PG suites). The pool is torn down on process exit.
  if (!DB_AVAILABLE) return;
});

describe.skipIf(!DB_AVAILABLE)("ManagedRunRepository concurrent begin() (AC-22)", () => {
  test("exactly one of two concurrent begin() calls acquires; the other sees busy", async () => {
    const currentProjectId = projectId();
    try {
      const eventIdA = `evt-race-a-${randomUUID()}`;
      const eventIdB = `evt-race-b-${randomUUID()}`;
      const [first, second]: [BeginManagedRunOutcome, BeginManagedRunOutcome] = await Promise.all([
        repository.begin({ projectId: currentProjectId, runKind: "indexing", eventId: eventIdA }),
        repository.begin({ projectId: currentProjectId, runKind: "indexing", eventId: eventIdB }),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual(["acquired", "busy"]);
      if (first.status === "acquired" && second.status === "busy") {
        expect(second.activeRunId).toBe(first.lease.runId);
      } else if (second.status === "acquired" && first.status === "busy") {
        expect(first.activeRunId).toBe(second.lease.runId);
      } else {
        throw new Error(`unexpected race outcome: ${JSON.stringify(statuses)}`);
      }
      // No 500 / serialization-failure escapes — both outcomes are contract
      // values, not thrown errors. The winner's row is the only active row.
      const active = await repository.getActive(currentProjectId, "indexing");
      expect(active).not.toBeNull();
      const winner = first.status === "acquired" ? first.lease.runId : second.status === "acquired" ? second.lease.runId : null;
      expect(winner).not.toBeNull();
      expect(active!.runId).toBe(winner);
    } finally {
      const { getPrismaClient } = await import("../services/query/prisma-client.js");
      await getPrismaClient().$executeRaw`DELETE FROM managed_runs WHERE project_id = ${currentProjectId}`;
    }
  });

  test("three concurrent begin() calls produce exactly one acquired and two busy", async () => {
    const currentProjectId = projectId();
    try {
      const outcomes = await Promise.all([
        repository.begin({ projectId: currentProjectId, runKind: "indexing", eventId: `evt-3a-${randomUUID()}` }),
        repository.begin({ projectId: currentProjectId, runKind: "indexing", eventId: `evt-3b-${randomUUID()}` }),
        repository.begin({ projectId: currentProjectId, runKind: "indexing", eventId: `evt-3c-${randomUUID()}` }),
      ]);
      const acquired = outcomes.filter((o) => o.status === "acquired");
      const busy = outcomes.filter((o) => o.status === "busy");
      expect(acquired.length).toBe(1);
      expect(busy.length).toBe(2);
      const winnerId = acquired[0]!.lease.runId;
      for (const b of busy) {
        if (b.status === "busy") expect(b.activeRunId).toBe(winnerId);
      }
    } finally {
      const { getPrismaClient } = await import("../services/query/prisma-client.js");
      await getPrismaClient().$executeRaw`DELETE FROM managed_runs WHERE project_id = ${currentProjectId}`;
    }
  });

  test("after the winner completes, a new begin() acquires (reaper not needed)", async () => {
    const currentProjectId = projectId();
    try {
      const first = await repository.begin({
        projectId: currentProjectId,
        runKind: "indexing",
        eventId: `evt-relay-${randomUUID()}`,
      });
      if (first.status !== "acquired") throw new Error("expected acquired");
      await repository.complete(first.lease);
      const second = await repository.begin({
        projectId: currentProjectId,
        runKind: "indexing",
        eventId: `evt-relay-2-${randomUUID()}`,
      });
      expect(second.status).toBe("acquired");
      if (second.status === "acquired") {
        expect(second.lease.runId).not.toBe(first.lease.runId);
      }
    } finally {
      const { getPrismaClient } = await import("../services/query/prisma-client.js");
      await getPrismaClient().$executeRaw`DELETE FROM managed_runs WHERE project_id = ${currentProjectId}`;
    }
  });
});
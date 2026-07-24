/**
 * Assertion-level PostgreSQL parity for the PostgreSQL-canonical GraphStore.
 *
 * The suite is hard-gated to the disposable maintenance database. Fixtures
 * use a unique prefix and cleanup relies on the memory_edges foreign-key
 * cascade, so unrelated rows are never touched.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { MemoryRelationType } from "@massa-ai/shared";
import { GraphStorePg } from "../services/graph/graph-store-pg.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const DEDICATED_DB =
  process.env.MASSA_AI_DEDICATED === "1"
  && /127\.0\.0\.1:5433\/massa_ai_test(?:\?|$)/.test(databaseUrl);
const TEST_PREFIX = "pg-graph-parity-";

let prisma: any;
let store: GraphStorePg;
let ids: Record<string, string>;

async function cleanup(): Promise<void> {
  if (!prisma) return;
  await prisma.$executeRaw`DELETE FROM memories WHERE id LIKE ${TEST_PREFIX + "%"}`;
}

async function createMemory(label: string): Promise<string> {
  const id = `${TEST_PREFIX}${label}-${randomUUID()}`;
  await prisma.$executeRaw`
    INSERT INTO memories (id, content, type, level, project_id, importance, tags, updated_at)
    VALUES (${id}, ${`graph fixture ${label}`}, 'decision', 2, ${TEST_PREFIX}, 0.5, ARRAY[]::text[], NOW())
  `;
  return id;
}

describe.skipIf(!DEDICATED_DB)("GraphStorePg — PostgreSQL graph parity", () => {
  beforeAll(async () => {
    const { getPrismaClient } = await import("../services/query/prisma-client.js");
    prisma = getPrismaClient();
    store = new GraphStorePg();
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
    ids = {
      a: await createMemory("a"),
      b: await createMemory("b"),
      c: await createMemory("c"),
      d: await createMemory("d"),
      e: await createMemory("e"),
    };
  });

  afterEach(cleanup);
  afterAll(cleanup);

  test("preserves zero weight, evidence, and explicit metadata flags", async () => {
    const manual = await store.createEdge({
      sourceId: ids.a,
      targetId: ids.b,
      relationType: MemoryRelationType.SUPPORTS,
      weight: 0,
      evidence: "manual evidence",
      autoExtracted: false,
    });
    const automatic = await store.createEdge({
      sourceId: ids.a,
      targetId: ids.c,
      relationType: MemoryRelationType.DERIVED_FROM,
      weight: 0.4,
      evidence: "automatic evidence",
      autoExtracted: true,
    });

    expect(manual?.weight).toBe(0);
    expect(manual?.evidence).toBe("manual evidence");
    expect(manual?.autoExtracted).toBe(false);
    expect(automatic?.evidence).toBe("automatic evidence");
    expect(automatic?.autoExtracted).toBe(true);

    expect((await store.getEdge(
      ids.a,
      ids.b,
      MemoryRelationType.SUPPORTS,
    ))?.autoExtracted).toBe(false);
    expect((await store.getEdge(
      ids.a,
      ids.c,
      MemoryRelationType.DERIVED_FROM,
    ))?.autoExtracted).toBe(true);
  });

  test("getAllEdges applies relation, minimum-weight, metadata, and limit filters", async () => {
    await store.createEdge({ sourceId: ids.a, targetId: ids.b, relationType: MemoryRelationType.SUPPORTS, weight: 0.8 });
    await store.createEdge({ sourceId: ids.a, targetId: ids.c, relationType: MemoryRelationType.DERIVED_FROM, weight: 0.6, autoExtracted: true });
    await store.createEdge({ sourceId: ids.d, targetId: ids.a, relationType: MemoryRelationType.CONTRADICTS, weight: 0.9, autoExtracted: true });

    const supports = await store.getAllEdges(ids.a, {
      relationTypes: [MemoryRelationType.SUPPORTS],
    });
    expect(supports.map((edge) => edge.relationType)).toEqual([MemoryRelationType.SUPPORTS]);

    const heavy = await store.getAllEdges(ids.a, { minWeight: 0.85 });
    expect(heavy.map((edge) => edge.sourceId)).toEqual([ids.d]);

    const automatic = await store.getAllEdges(ids.a, { autoExtractedOnly: true });
    expect(automatic).toHaveLength(2);
    expect(automatic.every((edge) => edge.autoExtracted)).toBe(true);

    const limited = await store.getAllEdges(ids.a, { limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.weight).toBe(0.9);
  });

  test("updateWeight clamps both ends of the canonical zero-to-one range", async () => {
    const edge = await store.createEdge({
      sourceId: ids.a,
      targetId: ids.b,
      relationType: MemoryRelationType.RELATES_TO,
      weight: 0.5,
    });
    expect(edge).not.toBeNull();

    expect(await store.updateWeight(edge!.id, 4)).toBe(true);
    expect((await store.getEdge(ids.a, ids.b, MemoryRelationType.RELATES_TO))?.weight).toBe(1);
    expect(await store.updateWeight(edge!.id, -4)).toBe(true);
    expect((await store.getEdge(ids.a, ids.b, MemoryRelationType.RELATES_TO))?.weight).toBe(0);
    expect(await store.updateWeight("not-an-id", 0.5)).toBe(false);
  });

  test("concurrent increments are atomic and capped", async () => {
    await store.createEdge({
      sourceId: ids.a,
      targetId: ids.b,
      relationType: MemoryRelationType.RELATES_TO,
      weight: 0,
    });

    const results = await Promise.all(Array.from({ length: 25 }, () =>
      store.incrementEdgeWeight(
        ids.a,
        ids.b,
        MemoryRelationType.RELATES_TO,
        0.02,
        0.3,
      )));

    expect(results.every(Boolean)).toBe(true);
    const edge = await store.getEdge(ids.a, ids.b, MemoryRelationType.RELATES_TO);
    expect(edge?.weight).toBeCloseTo(0.3, 10);
  });

  test("duplicate upsert keeps the greater weight and original extraction flag", async () => {
    await store.createEdge({
      sourceId: ids.a,
      targetId: ids.b,
      relationType: MemoryRelationType.SUPPORTS,
      weight: 0.8,
      autoExtracted: true,
    });
    const duplicate = await store.createEdge({
      sourceId: ids.a,
      targetId: ids.b,
      relationType: MemoryRelationType.SUPPORTS,
      weight: 0.2,
      evidence: "new evidence",
      autoExtracted: false,
    });

    expect(duplicate?.weight).toBe(0.8);
    expect(duplicate?.autoExtracted).toBe(true);
    expect(duplicate?.evidence).toBe("new evidence");
  });

  test("batch count excludes self-reference and database-rejected failures", async () => {
    const count = await store.batchCreateEdges([
      { sourceId: ids.a, targetId: ids.b, relationType: MemoryRelationType.SUPPORTS },
      { sourceId: ids.a, targetId: ids.a, relationType: MemoryRelationType.SUPPORTS },
      { sourceId: ids.a, targetId: `${TEST_PREFIX}missing`, relationType: MemoryRelationType.RELATES_TO },
      { sourceId: ids.c, targetId: ids.d, relationType: MemoryRelationType.CONTRADICTS, autoExtracted: true },
    ]);

    expect(count).toBe(2);
    const stats = await store.getStats();
    expect(stats.totalEdges).toBe(2);
    expect(stats.autoExtracted).toBe(1);
  });
});

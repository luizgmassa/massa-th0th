/**
 * Assertion-level PostgreSQL parity for the PostgreSQL-canonical memory CRUD/FTS
 * contract in memory-crud.test.ts.
 *
 * This suite is deliberately restricted to the dedicated maintenance DB. It
 * never truncates shared tables; every fixture is scoped by a unique project
 * id and removed after the test.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { MemoryLevel, MemoryType } from "@massa-ai/shared";
import { MemoryController } from "../controllers/memory-controller.js";
import { MemoryRepositoryPg } from "../data/memory/memory-repository-pg.js";
import type { InsertMemoryInput } from "../data/memory/memory-repository.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const DEDICATED_DB =
  process.env.MASSA_AI_DEDICATED === "1"
  && /127\.0\.0\.1:5433\/massa_ai_test(?:\?|$)/.test(databaseUrl);
const TEST_PREFIX = "pg-memory-parity-";

let prisma: any;
let repo: MemoryRepositoryPg;
let projectId = "";

function memoryId(label: string): string {
  return `${TEST_PREFIX}${label}-${randomUUID()}`;
}

async function insert(
  label: string,
  content: string,
  tags: string[] = [],
  overrides: Partial<InsertMemoryInput> = {},
): Promise<string> {
  const id = memoryId(label);
  await repo.insert({
    id,
    content,
    type: MemoryType.DECISION,
    level: MemoryLevel.PERSISTENT,
    projectId,
    importance: 0.5,
    tags,
    embedding: [0.01, 0.02, 0.03, 0.04],
    ...overrides,
  });
  return id;
}

async function cleanup(): Promise<void> {
  if (!prisma) return;
  await prisma.$executeRaw`DELETE FROM memories WHERE project_id LIKE ${TEST_PREFIX + "%"}`;
}

describe.skipIf(!DEDICATED_DB)("MemoryRepositoryPg — PostgreSQL CRUD/FTS parity", () => {
  beforeAll(async () => {
    const { getPrismaClient } = await import("../services/query/prisma-client.js");
    prisma = getPrismaClient();
    (MemoryRepositoryPg as any).instance = null;
    repo = MemoryRepositoryPg.getInstance();
    await cleanup();
  });

  beforeEach(async () => {
    projectId = `${TEST_PREFIX}${randomUUID()}`;
    await cleanup();
  });

  afterEach(cleanup);
  afterAll(cleanup);

  test("blank and punctuation-only queries are safe filtered recalls", async () => {
    const first = await insert("blank-a", "alpha searchable content", [], { importance: 0.8 });
    const second = await insert("blank-b", "beta searchable content", [], { importance: 0.4 });
    await insert("other-project", "must remain outside scope", [], {
      projectId: `${TEST_PREFIX}other-${randomUUID()}`,
    });

    const blank = await repo.fullTextSearch("   ", 10, { projectId, minImportance: 0 });
    const punctuation = await repo.fullTextSearch("-!@#$%^&*()", 10, {
      projectId,
      minImportance: 0,
    });

    expect(blank.map((row) => row.id)).toEqual([first, second]);
    expect(punctuation.map((row) => row.id)).toEqual([first, second]);
  });

  test("punctuation separates OR terms like PostgreSQL FTS", async () => {
    const agent = await insert("hyphen-agent", "Agente orchestration notes");
    const unrelated = await insert("hyphen-other", "unrelated material");

    const hits = await repo.fullTextSearch("Agente-GT", 10, { projectId, minImportance: 0 });
    expect(hits.map((row) => row.id)).toContain(agent);
    expect(hits.map((row) => row.id)).not.toContain(unrelated);
  });

  test("partial update refreshes recall and empty patch reports existence", async () => {
    const id = await insert("update", "alpha content here", ["old"]);

    expect(await repo.update(id, {
      content: "beta gamma content",
      importance: 0.9,
      tags: ["new", "shiny"],
      embedding: [0.04, 0.03, 0.02, 0.01],
    })).toBe(true);
    expect((await repo.fullTextSearch("alpha", 10, { projectId, minImportance: 0 })).map((r) => r.id)).not.toContain(id);
    expect((await repo.fullTextSearch("gamma", 10, { projectId, minImportance: 0 })).map((r) => r.id)).toContain(id);

    const row = await repo.getById(id);
    expect(row?.content).toBe("beta gamma content");
    expect(row?.importance).toBe(0.9);
    expect(JSON.parse(row?.tags ?? "[]")).toEqual(["new", "shiny"]);
    expect(await repo.update(id, {})).toBe(true);
    expect(await repo.update(memoryId("missing"), {})).toBe(false);
  });

  test("controller merges, deduplicates, replaces, and clears tags", async () => {
    const id = await insert("tags", "controller tag target", ["alpha"]);
    const controller = Object.create(MemoryController.prototype) as MemoryController;
    (controller as any).repo = repo;

    const merged = await controller.update({
      id,
      tags: ["alpha", "beta"],
      mergeTags: true,
    });
    expect(JSON.parse(merged.memory?.tags ?? "[]")).toEqual(["alpha", "beta"]);

    const cleared = await controller.update({ id, tags: [], mergeTags: false });
    expect(cleared.updated).toBe(true);
    expect(JSON.parse(cleared.memory?.tags ?? "[]")).toEqual([]);
  });

  test("hard delete removes the row and is idempotent", async () => {
    const id = await insert("hard-delete", "deletable gamma");
    expect(await repo.deleteById(id)).toBe(true);
    expect(await repo.getById(id)).toBeNull();
    expect(await repo.deleteById(id)).toBe(false);
    expect((await repo.fullTextSearch("gamma", 10, { projectId, minImportance: 0 })).map((r) => r.id)).not.toContain(id);
  });

  test("soft delete tombstones, hides from recall/list, and is idempotent", async () => {
    const id = await insert("soft-delete", "soft tombstone target");
    expect(await repo.softDeleteById(id)).toBe(true);
    expect((await repo.getById(id))?.deleted_at).not.toBeNull();
    expect((await repo.fullTextSearch("soft", 10, { projectId, minImportance: 0 })).map((r) => r.id)).not.toContain(id);
    expect((await repo.list(100, 0)).map((r) => r.id)).not.toContain(id);
    expect(await repo.softDeleteById(id)).toBe(false);
    expect(await repo.softDeleteById(memoryId("missing"))).toBe(false);
  });

  test("SUPERSEDES targets remain stored but are hidden from FTS recall", async () => {
    const oldId = await insert("superseded", "shared supersedes phrase", [], { importance: 0.9 });
    const newId = await insert("replacement", "shared supersedes phrase replacement", [], { importance: 0.8 });
    await prisma.$executeRaw`
      INSERT INTO memory_edges (from_id, to_id, edge_type, weight, updated_at)
      VALUES (${newId}, ${oldId}, 'SUPERSEDES', 1.0, NOW())
    `;

    const hits = await repo.fullTextSearch("supersedes", 10, { projectId, minImportance: 0 });
    expect(hits.map((row) => row.id)).toContain(newId);
    expect(hits.map((row) => row.id)).not.toContain(oldId);
    expect(await repo.getById(oldId)).not.toBeNull();
  });
});

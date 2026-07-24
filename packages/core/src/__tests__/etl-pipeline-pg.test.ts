import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { DiscoverStage } from "../services/etl/stages/discover.js";
import { getSymbolRepository } from "../data/symbol/symbol-repository-factory.js";

const DB_AVAILABLE = /^(postgres|postgresql):/.test(process.env.DATABASE_URL ?? "");

describe.skipIf(!DB_AVAILABLE)("ETL fingerprint parity on PostgreSQL", () => {
  const projectId = `pg-etl-parity-${randomUUID()}`;
  let projectPath = "";
  let prisma: any;

  beforeAll(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "massa-ai-etl-pg-"));
    const { getPrismaClient } = await import("../services/query/prisma-client.js");
    prisma = getPrismaClient();
    const repo = getSymbolRepository();
    await repo.upsertWorkspace({
      project_id: projectId,
      project_path: projectPath,
      display_name: "PG ETL parity",
      status: "pending",
      files_count: 0,
      chunks_count: 0,
      symbols_count: 0,
    });
  });

  afterAll(async () => {
    if (prisma) await prisma.$executeRaw`DELETE FROM workspaces WHERE project_id = ${projectId}`;
    if (projectPath) await fs.rm(projectPath, { recursive: true, force: true });
  });

  test("an unchanged stored fingerprint is marked skipped", async () => {
    const content = "export const pgFingerprint = true;\n";
    await fs.writeFile(path.join(projectPath, "fingerprint.ts"), content, "utf8");
    const hash = createHash("sha256").update(content).digest("hex");
    const repo = getSymbolRepository();
    await repo.upsertFile({
      project_id: projectId,
      relative_path: "fingerprint.ts",
      content_hash: hash,
      mtime: Date.now(),
      size: content.length,
      indexed_at: Date.now(),
      symbol_count: 1,
      chunk_count: 1,
    });

    const discovered = await new DiscoverStage().run({
      projectId,
      projectPath,
      jobId: `pg-etl-${randomUUID()}`,
      emit: () => {},
    });

    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({
      relativePath: "fingerprint.ts",
      contentHash: hash,
      needsReparse: false,
    });
  });
});

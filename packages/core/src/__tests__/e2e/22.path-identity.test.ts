import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import {
  E2E_ENABLED,
  PROJECT_PATH,
  SHARED_PID,
  SHARED_PROFILE_IDENTITY,
  ensureSharedIndex,
  httpGet,
  httpPost,
  indexAndAwait,
  isOwnedDedicatedE2eEnvironment,
  isSharedIndexWarm,
  probeAvailability,
} from "./_helpers.js";
import {
  buildQwenFixture,
  loadQwenFixtureManifest,
  type QwenFixtureManifest,
} from "./qwen-fixture.js";

const DEDICATED_FIXTURE = isOwnedDedicatedE2eEnvironment();
const READY = await (async () => {
  if (!E2E_ENABLED || !DEDICATED_FIXTURE || !process.env.DATABASE_URL) return false;
  const availability = await probeAvailability();
  return availability.API_UP && availability.OLLAMA_UP && availability.BACKEND === "postgres";
})();

function allManifestPaths(manifest: QwenFixtureManifest): Set<string> {
  return new Set([
    ...manifest.needleTargets,
    ...manifest.distractors,
    ...manifest.supportFiles,
  ].map((entry) => entry.path));
}

function assertManifestPath(filePath: string, manifestPaths: Set<string>): void {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  expect(path.posix.isAbsolute(normalized)).toBe(false);
  expect(/^[A-Za-z]:\//.test(normalized)).toBe(false);
  expect(segments).not.toContain("..");
  expect(segments).not.toContain("adsads");
  expect(manifestPaths.has(normalized)).toBe(true);
}

describe.skipIf(!READY)("T15 dedicated shared-index identity and path hygiene", () => {
  let temporaryRoot = "";
  let wrongFixturePath = "";
  let manifest: QwenFixtureManifest;

  beforeAll(async () => {
    manifest = await loadQwenFixtureManifest();
    temporaryRoot = await mkdtemp(path.join(tmpdir(), "massa-ai-wrong-root-"));
    const wrongRoot = await buildQwenFixture({
      sourceRoot: PROJECT_PATH,
      destination: path.join(temporaryRoot, "fixture"),
      manifest,
    });
    wrongFixturePath = wrongRoot.destination;
    const seeded = await indexAndAwait(wrongRoot.destination, SHARED_PID, {
      forceReindex: true,
      warmCache: false,
      timeoutMs: 420_000,
    });
    if (seeded.status !== "completed" && seeded.status !== "indexed") {
      throw new Error(`wrong-root seed failed: ${JSON.stringify(seeded.raw)}`);
    }
    expect(await isSharedIndexWarm(SHARED_PID)).toBe(true);
  }, 700_000);

  afterAll(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  });

  test("warm wrong-root data is reset and rebuilt at the canonical profile root", async () => {
    expect(SHARED_PROFILE_IDENTITY).toMatch(/^[a-f0-9]{16}$/);
    expect(SHARED_PID).toBe(`e2e-ai-shared-${SHARED_PROFILE_IDENTITY}`);

    expect(await ensureSharedIndex()).toBe(SHARED_PID);
    const response = await httpGet<any>("/api/v1/workspace/list");
    const workspace = (response?.data?.workspaces ?? []).find(
      (entry: any) => entry?.projectId === SHARED_PID,
    );
    expect(workspace).toBeDefined();
    expect(await realpath(workspace.projectPath)).toBe(await realpath(PROJECT_PATH));
  }, 700_000);

  test("PostgreSQL vector metadata and symbol paths are manifest-contained", async () => {
    const dimensions = Number(process.env.OLLAMA_EMBEDDING_DIMENSIONS ?? "4096");
    expect(dimensions).toBe(4096);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const [vectors, symbols] = await Promise.all([
        pool.query<{ file_path: string }>(
          `SELECT DISTINCT metadata->>'filePath' AS file_path
             FROM vector_documents_${dimensions}d
            WHERE project_id = $1
              AND metadata->>'filePath' IS NOT NULL`,
          [SHARED_PID],
        ),
        pool.query<{ file_path: string }>(
          `SELECT DISTINCT relative_path AS file_path
             FROM symbol_files
            WHERE project_id = $1`,
          [SHARED_PID],
        ),
      ]);
      expect(vectors.rows.length).toBeGreaterThan(0);
      expect(symbols.rows.length).toBeGreaterThan(0);
      const manifestPaths = allManifestPaths(manifest);
      for (const row of [...vectors.rows, ...symbols.rows]) {
        assertManifestPath(row.file_path, manifestPaths);
      }
    } finally {
      await pool.end();
    }
  });

  test("non-force API reuse rejects a different canonical root without mutation", async () => {
    const refused = await httpPost<any>("/api/v1/project/index", {
      projectPath: wrongFixturePath,
      projectId: SHARED_PID,
      forceReindex: false,
    });
    expect(refused?.success).toBe(false);
    expect(String(refused?.error)).toContain("already indexes canonical root");

    const response = await httpGet<any>("/api/v1/workspace/list");
    const workspace = (response?.data?.workspaces ?? []).find(
      (entry: any) => entry?.projectId === SHARED_PID,
    );
    expect(await realpath(workspace.projectPath)).toBe(await realpath(PROJECT_PATH));
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  E2E_ENABLED,
  PROJECT_PATH,
  PREFIX,
  RUN_STAMP,
  ensureSharedIndex,
  httpPost,
  indexAndAwait,
  isOwnedDedicatedE2eEnvironment,
  probeAvailability,
  resetProject,
} from "./_helpers.js";
import {
  buildQwenFixture,
  loadQwenFixtureManifest,
} from "./qwen-fixture.js";

const DEDICATED_FIXTURE = isOwnedDedicatedE2eEnvironment();
const READY = await (async () => {
  if (!E2E_ENABLED || !DEDICATED_FIXTURE) return false;
  const availability = await probeAvailability();
  return availability.API_UP && availability.OLLAMA_UP && availability.BACKEND === "postgres";
})();

interface Needle {
  id: string;
  query: string;
  expected: { filePath: string };
}

describe.skipIf(!READY)("T14 commit-locked qwen fixture discrimination", () => {
  const negativeProjectId = `${PREFIX}qwen-negative-${RUN_STAMP}`;
  let positiveProjectId = "";
  let temporaryRoot = "";
  let needle: Needle;

  beforeAll(async () => {
    positiveProjectId = await ensureSharedIndex();
    const manifest = await loadQwenFixtureManifest();
    const omittedPath = manifest.needleTargets.find((entry) =>
      entry.path.endsWith("centrality.ts"),
    )?.path;
    if (!omittedPath) throw new Error("qwen fixture is missing the centrality needle target");

    const dataset = JSON.parse(await readFile(
      path.join(PROJECT_PATH, "benchmarks/needles/fixtures/massa-ai.json"),
      "utf8",
    )) as { needles: Needle[] };
    needle = dataset.needles.find((entry) =>
      entry.id === "N01-pagerank-damping",
    )!;
    if (!needle || needle.expected.filePath !== omittedPath) {
      throw new Error("negative qwen sensor no longer maps to the omitted target");
    }

    temporaryRoot = await mkdtemp(path.join(tmpdir(), "massa-ai-qwen-negative-"));
    const negative = await buildQwenFixture({
      sourceRoot: PROJECT_PATH,
      destination: path.join(temporaryRoot, "fixture"),
      manifest,
      omitPaths: [omittedPath],
    });
    const indexed = await indexAndAwait(negative.destination, negativeProjectId, {
      forceReindex: true,
      warmCache: false,
      timeoutMs: 420_000,
    });
    if (indexed.status !== "completed" && indexed.status !== "indexed") {
      throw new Error(`negative qwen fixture did not complete: ${JSON.stringify(indexed.raw)}`);
    }
  }, 700_000);

  afterAll(async () => {
    try {
      await resetProject(negativeProjectId);
    } finally {
      if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 120_000);

  test("omitting a needle target makes that exact quality sensor fail", async () => {
    const search = async (projectId: string) => {
      const response = await httpPost<any>("/api/v1/search/project", {
        query: needle.query,
        projectId,
        maxResults: 10,
        minScore: 0.05,
        format: "json",
      });
      expect(response?.success).toBe(true);
      return response?.data?.results ?? [];
    };

    const positive = await search(positiveProjectId);
    const negative = await search(negativeProjectId);
    const sensorPasses = (results: any[]) => results.some(
      (entry) => String(entry.filePath) === needle.expected.filePath,
    );

    expect(sensorPasses(positive)).toBe(true);
    expect(negative.length).toBeGreaterThan(0);
    expect(sensorPasses(negative)).toBe(false);
  }, 180_000);
});

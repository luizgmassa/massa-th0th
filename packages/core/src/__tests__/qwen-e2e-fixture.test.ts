import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildQwenFixture,
  loadQwenFixtureManifest,
  validateQwenFixtureManifest,
  type QwenFixtureManifest,
} from "./e2e/qwen-fixture.js";
import {
  decideSharedWorkspaceIdentity,
  deriveSharedProfileIdentity,
  ensureSharedIndex,
  isOwnedDedicatedE2eEnvironment,
  resolveE2EProjectPath,
} from "./e2e/_helpers.js";

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "../../../..");
const temporaryRoots: string[] = [];

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe("commit-locked qwen E2E fixture", () => {
  test("manifest contains five unique needle targets and twenty tracked distractors", async () => {
    const manifest = await loadQwenFixtureManifest();
    const files = await validateQwenFixtureManifest(REPOSITORY_ROOT, manifest);
    const dataset = JSON.parse(await readFile(
      path.join(REPOSITORY_ROOT, "benchmarks/needles/fixtures/massa-th0th.json"),
      "utf8",
    )) as { needles: Array<{ expected: { filePath: string } }> };
    const datasetTargets = [...new Set(
      dataset.needles.map((needle) => needle.expected.filePath),
    )].sort();

    expect(manifest.needleTargets.map((entry) => entry.path).sort()).toEqual(datasetTargets);
    expect(manifest.distractors).toHaveLength(20);
    expect(files).toHaveLength(
      manifest.needleTargets.length +
      manifest.distractors.length +
      manifest.supportFiles.length,
    );
  });

  test("local sparse clone matches tested HEAD and supports an omitted-target negative profile", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "massa-th0th-qwen-fixture-"));
    temporaryRoots.push(parent);
    const manifest = await loadQwenFixtureManifest();
    const positive = await buildQwenFixture({
      sourceRoot: REPOSITORY_ROOT,
      destination: path.join(parent, "positive"),
      manifest,
    });

    expect(positive.files).toHaveLength(
      manifest.needleTargets.length +
      manifest.distractors.length +
      manifest.supportFiles.length,
    );
    expect(await exists(path.join(positive.destination, ".git"))).toBe(true);

    const omittedPath = manifest.needleTargets[0].path;
    const negative = await buildQwenFixture({
      sourceRoot: REPOSITORY_ROOT,
      destination: path.join(parent, "negative"),
      manifest,
      omitPaths: [omittedPath],
    });
    expect(negative.head).toBe(positive.head);
    expect(negative.files).toHaveLength(positive.files.length - 1);
    expect(await exists(path.join(negative.destination, omittedPath))).toBe(false);
  });

  test("rejects changed hashes and forbidden paths before cloning", async () => {
    const manifest = await loadQwenFixtureManifest();
    const changed = structuredClone(manifest) as QwenFixtureManifest;
    changed.supportFiles[0].sha256 = "0".repeat(64);
    await expect(
      validateQwenFixtureManifest(REPOSITORY_ROOT, changed),
    ).rejects.toThrow("hash mismatch");

    const forbidden = structuredClone(manifest) as QwenFixtureManifest;
    forbidden.supportFiles[0].path = ".env.production";
    await expect(
      validateQwenFixtureManifest(REPOSITORY_ROOT, forbidden),
    ).rejects.toThrow("forbidden path");
  });

  test("explicit fixture path is selected only for a fully owned dedicated run", () => {
    const fallback = "/repository/default";
    expect(resolveE2EProjectPath(fallback, {
      MASSA_TH0TH_DEDICATED: "1",
      MASSA_TH0TH_E2E_PROJECT_PATH: "/tmp/explicit-fixture",
    })).toBe(fallback);
    expect(resolveE2EProjectPath(fallback, {
      MASSA_TH0TH_DEDICATED: "0",
      MASSA_TH0TH_E2E_PROJECT_PATH: "/tmp/ignored-fixture",
    })).toBe(fallback);
    expect(resolveE2EProjectPath(fallback, {
      MASSA_TH0TH_DEDICATED: "1",
    })).toBe(fallback);
    expect(resolveE2EProjectPath(fallback, {
      MASSA_TH0TH_DEDICATED: "1",
      MASSA_TH0TH_E2E_PROJECT_PATH: "/tmp/explicit-fixture",
      MASSA_TH0TH_API_URL: "http://127.0.0.1:3334",
      VECTOR_STORE_TYPE: "postgres",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5433/massa_th0th_test",
      POSTGRES_VECTOR_URL: "postgresql://test:test@127.0.0.1:5433/massa_th0th_test",
    })).toBe("/tmp/explicit-fixture");
  });

  test("destructive fixture behavior requires explicit owned API and PostgreSQL targets", () => {
    const complete = {
      MASSA_TH0TH_DEDICATED: "1",
      MASSA_TH0TH_E2E_PROJECT_PATH: "/tmp/explicit-fixture",
      MASSA_TH0TH_API_URL: "http://127.0.0.1:3334",
      VECTOR_STORE_TYPE: "postgres",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5433/massa_th0th_test",
      POSTGRES_VECTOR_URL: "postgresql://test:test@127.0.0.1:5433/massa_th0th_test",
    };
    expect(isOwnedDedicatedE2eEnvironment(complete)).toBe(true);
    for (const key of [
      "MASSA_TH0TH_API_URL",
      "DATABASE_URL",
      "POSTGRES_VECTOR_URL",
      "VECTOR_STORE_TYPE",
    ] as const) {
      expect(isOwnedDedicatedE2eEnvironment({ ...complete, [key]: undefined })).toBe(false);
    }
    expect(isOwnedDedicatedE2eEnvironment({
      ...complete,
      MASSA_TH0TH_API_URL: "http://127.0.0.1:3333",
    })).toBe(false);
    expect(isOwnedDedicatedE2eEnvironment({
      ...complete,
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/massa_th0th_test",
    })).toBe(false);
  });

  test("incomplete dedicated shared-index request rejects before any HTTP call", () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      throw new Error("fetch must not be reached");
    }) as typeof fetch;
    try {
      expect(() => ensureSharedIndex({
        MASSA_TH0TH_DEDICATED: "1",
        MASSA_TH0TH_E2E_PROJECT_PATH: "/tmp/explicit-fixture",
      })).toThrow("Refusing incomplete dedicated E2E environment");
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("shared identity binds commit, manifest, provider, model, and dimensions", () => {
    const base = {
      commit: "a".repeat(40),
      manifestHash: "b".repeat(64),
      provider: "ollama",
      model: "qwen3-embedding:8b",
      dimensions: 4096,
    };
    const identity = deriveSharedProfileIdentity(base);
    expect(identity).toHaveLength(16);
    for (const [key, value] of [
      ["commit", "c".repeat(40)],
      ["manifestHash", "d".repeat(64)],
      ["provider", "other"],
      ["model", "other-model"],
      ["dimensions", 1024],
    ] as const) {
      expect(deriveSharedProfileIdentity({ ...base, [key]: value })).not.toBe(identity);
    }
    expect(() => deriveSharedProfileIdentity({
      ...base,
      dimensions: Number.NaN,
    })).toThrow("complete positive-dimension inputs");
  });

  test("wrong-root warm identity rebuilds only for a dedicated guarded project", () => {
    const common = {
      projectId: "e2e-th0th-shared-profile",
      expectedCanonicalPath: "/fixture/expected",
      storedCanonicalPath: "/fixture/wrong",
    };
    expect(decideSharedWorkspaceIdentity({
      ...common,
      dedicatedFixture: true,
    })).toBe("rebuild");
    expect(() => decideSharedWorkspaceIdentity({
      ...common,
      dedicatedFixture: false,
    })).toThrow("Refusing shared-index reuse");
    expect(decideSharedWorkspaceIdentity({
      ...common,
      storedCanonicalPath: common.expectedCanonicalPath,
      dedicatedFixture: false,
    })).toBe("reuse");
  });
});

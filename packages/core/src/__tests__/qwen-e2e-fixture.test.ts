import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
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

describe("commit-locked qwen E2E fixture", () => {
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
      MASSA_AI_DEDICATED: "1",
      MASSA_AI_E2E_PROJECT_PATH: "/tmp/explicit-fixture",
    })).toBe(fallback);
    expect(resolveE2EProjectPath(fallback, {
      MASSA_AI_DEDICATED: "0",
      MASSA_AI_E2E_PROJECT_PATH: "/tmp/ignored-fixture",
    })).toBe(fallback);
    expect(resolveE2EProjectPath(fallback, {
      MASSA_AI_DEDICATED: "1",
    })).toBe(fallback);
    expect(resolveE2EProjectPath(fallback, {
      MASSA_AI_DEDICATED: "1",
      MASSA_AI_E2E_PROJECT_PATH: "/tmp/explicit-fixture",
      MASSA_AI_API_URL: "http://127.0.0.1:3334",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5433/massa_ai_test",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5433/massa_ai_test",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5433/massa_ai_test",
    })).toBe("/tmp/explicit-fixture");
  });

  test("destructive fixture behavior requires explicit owned API and PostgreSQL targets", () => {
    const complete = {
      MASSA_AI_DEDICATED: "1",
      MASSA_AI_E2E_PROJECT_PATH: "/tmp/explicit-fixture",
      MASSA_AI_API_URL: "http://127.0.0.1:3334",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5433/massa_ai_test",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5433/massa_ai_test",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5433/massa_ai_test",
    };
    expect(isOwnedDedicatedE2eEnvironment(complete)).toBe(true);
    for (const key of [
      "MASSA_AI_API_URL",
      "DATABASE_URL",
      "DATABASE_URL",
      "DATABASE_URL",
    ] as const) {
      expect(isOwnedDedicatedE2eEnvironment({ ...complete, [key]: undefined })).toBe(false);
    }
    expect(isOwnedDedicatedE2eEnvironment({
      ...complete,
      MASSA_AI_API_URL: "http://127.0.0.1:3333",
    })).toBe(false);
    expect(isOwnedDedicatedE2eEnvironment({
      ...complete,
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/massa_ai_test",
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
        MASSA_AI_DEDICATED: "1",
        MASSA_AI_E2E_PROJECT_PATH: "/tmp/explicit-fixture",
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
      projectId: "e2e-ai-shared-profile",
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

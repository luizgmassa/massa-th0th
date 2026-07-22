import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

mock.module("@massa-th0th/shared", () => ({
  config: {
    get: (key: string) => {
      if (key === "embedding") return { model: "qwen3-embedding:8b" };
      if (key === "dataDir") return "/tmp/massa-th0th-test";
      return undefined;
    },
  },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

import { LocalHealthChecker } from "../services/health/local-health-checker.js";

describe("health-checker embedding model config", () => {
  const originalEnv = process.env.OLLAMA_EMBEDDING_MODEL;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env.OLLAMA_EMBEDDING_MODEL;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OLLAMA_EMBEDDING_MODEL = originalEnv;
    } else {
      delete process.env.OLLAMA_EMBEDDING_MODEL;
    }
    globalThis.fetch = originalFetch;
  });

  it("checkOllama uses config embedding model when env not set", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ models: [{ name: "qwen3-embedding:8b" }] }), {
          status: 200,
        }),
      )) as typeof fetch;

    const checker = new LocalHealthChecker();
    const result = await checker.checkOllama();
    expect(result.available).toBe(true);
    expect(result.details?.embeddingModel).toBe("qwen3-embedding:8b");
    expect(result.details?.hasEmbeddingModel).toBe(true);
  });

  it("checkOllama prefers env OLLAMA_EMBEDDING_MODEL over config", async () => {
    process.env.OLLAMA_EMBEDDING_MODEL = "custom-model:latest";
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ models: [{ name: "custom-model:latest" }] }), {
          status: 200,
        }),
      )) as typeof fetch;

    const checker = new LocalHealthChecker();
    const result = await checker.checkOllama();
    expect(result.details?.embeddingModel).toBe("custom-model:latest");
  });

  it("checkOllama falls back to nomic-embed-text:latest when config model is undefined", async () => {
    mock.module("@massa-th0th/shared", () => ({
      config: {
        get: (key: string) => {
          if (key === "embedding") return { model: undefined };
          if (key === "dataDir") return "/tmp/massa-th0th-test";
          return undefined;
        },
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    }));

    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ models: [{ name: "nomic-embed-text:latest" }] }), {
          status: 200,
        }),
      )) as typeof fetch;

    const checker = new LocalHealthChecker();
    const result = await checker.checkOllama();
    expect(result.details?.embeddingModel).toBe("nomic-embed-text:latest");
  });
});
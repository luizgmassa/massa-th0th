/**
 * Tests for the polyglot executor + run-pool + intent progressive disclosure.
 *
 * Coverage goals (from the task spec):
 *   - runtime detection (with a mocked `commandExists` seam)
 *   - timeout kills the child process group
 *   - execute_file blocks an out-of-cwd path AND a deny-glob path
 *   - batch order-preservation + concurrency cap
 *   - intent trims large output
 *   - run-pool order preservation + cpu-cap
 *
 * All execution tests use tiny inline scripts (no indexing, no DB) per the
 * project memory gotchas. Defaults to the `node`/`sh` runtime that's always
 * present on the dev host; skips gracefully when a runtime is absent.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  PolyglotExecutor,
  runPool,
  fulfilledValues,
  detectRuntimes,
  getAvailableLanguages,
  intentSearch,
  renderIntentResult,
  INTENT_SEARCH_THRESHOLD,
  type DetectDeps,
  type Language,
} from "../services/executor/index.js";
import { ExecutorController } from "../controllers/executor-controller.js";

// Detect what's actually available once for the execution tests.
const RUNTIMES = detectRuntimes();
const HAS_NODE = RUNTIMES.javascript === "node" || RUNTIMES.javascript === "bun";
const HAS_PYTHON = !!RUNTIMES.python;
const HAS_SHELL = !!RUNTIMES.shell;

// ── Runtime detection (mocked seam) ──────────────────────────────────────

describe("runtime detection", () => {
  test("detectRuntimes uses the injected commandExists seam", () => {
    // Pretend only bun + bash exist.
    const deps: DetectDeps = {
      commandExists: (cmd: string) =>
        cmd === "bun" || cmd === "bash",
      getVersion: () => "1.0.0",
    };
    const r = detectRuntimes(deps);
    expect(r.javascript).toBe("bun");
    expect(r.typescript).toBe("bun");
    expect(r.shell).toBe("bash");
    // python probes go through runnableExists → commandExists + getVersion;
    // with commandExists false for python3/python, both stay null.
    expect(r.python).toBeNull();
    expect(r.ruby).toBeNull();
  });

  test("getAvailableLanguages only lists runnable languages", () => {
    const langs = getAvailableLanguages(RUNTIMES);
    // shell is always available (falls back to sh/cmd).
    expect(langs).toContain("shell");
    if (HAS_NODE) expect(langs).toContain("javascript");
  });

  test("runnableExists rejects a binary that fails --version", () => {
    const deps: DetectDeps = {
      commandExists: () => true,
      getVersion: () => {
        throw new Error("not found");
      },
    };
    // Import runnableExists indirectly via detectRuntimes + a python probe.
    const r = detectRuntimes(deps);
    // python3 "exists" per the seam but getVersion throws → runnable false.
    expect(r.python).toBeNull();
  });
});

// ── PolyglotExecutor ─────────────────────────────────────────────────────

describe("PolyglotExecutor", () => {
  // Use process.cwd() as the project root so execute_file boundary checks
  // are predictable (the repo root is the default anyway).
  const root = process.cwd();
  let exec: PolyglotExecutor;

  beforeEach(() => {
    exec = new PolyglotExecutor({ projectRoot: root });
  });

  afterEach(() => {
    exec.cleanupBackgrounded();
  });

  (HAS_NODE ? test : test.skip)("javascript executes and returns stdout", async () => {
    const result = await exec.execute({
      language: "javascript",
      code: `console.log("hello-sandbox")`,
      timeout: 10_000,
    });
    expect(result.stdout.trim()).toBe("hello-sandbox");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  (HAS_PYTHON ? test : test.skip)("python executes", async () => {
    const result = await exec.execute({
      language: "python",
      code: `print("py-ok")`,
      timeout: 10_000,
    });
    expect(result.stdout.trim()).toBe("py-ok");
  });

  (HAS_SHELL ? test : test.skip)("shell executes", async () => {
    const result = await exec.execute({
      language: "shell",
      code: `echo "sh-ok"`,
      timeout: 10_000,
    });
    expect(result.stdout.trim()).toBe("sh-ok");
  });

  (HAS_NODE ? test : test.skip)("timeout kills the child process", async () => {
    // An infinite loop that writes repeatedly. With a 500ms timeout the
    // process group must be killed and the run resolves with timedOut=true.
    const start = Date.now();
    const result = await exec.execute({
      language: "javascript",
      code: `setInterval(() => {}, 1); console.log("started");`,
      timeout: 500,
    });
    const elapsed = Date.now() - start;
    expect(result.timedOut).toBe(true);
    // Should resolve well within a few seconds of the timeout (kill is sync).
    expect(elapsed).toBeLessThan(5_000);
  });

  (HAS_NODE ? test : test.skip)("byte cap kills runaway output", async () => {
    const result = await exec.execute({
      language: "javascript",
      code: `process.stdout.write("x".repeat(50 * 1024 * 1024));`, // 50MB
      timeout: 15_000,
    });
    // Default cap is 10MB; stderr should carry the cap notice.
    expect(result.stderr).toMatch(/capped at 10MB/);
  });

  (HAS_NODE ? test : test.skip)("execute_file blocks an out-of-cwd path", async () => {
    const result = await exec.executeFile({
      path: "../../../etc/passwd",
      language: "javascript",
      code: `console.log(FILE_CONTENT.length);`,
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/outside the project root/);
  });

  (HAS_NODE ? test : test.skip)("execute_file blocks a deny-glob path (secrets)", async () => {
    // .env is on the deny list; even if the file doesn't exist, the guard
    // fires before the read attempt.
    const result = await exec.executeFile({
      path: ".env",
      language: "javascript",
      code: `console.log(FILE_CONTENT.length);`,
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/deny-listed pattern/);
  });

  (HAS_NODE ? test : test.skip)("execute_file allows an in-cwd non-sensitive path", async () => {
    // package.json is at the repo root (process.cwd()) and not deny-listed.
    // Read the expected name from the same file the executor will read so the
    // assertion is robust regardless of which package's cwd the test runs from.
    const expectedName = JSON.parse(
      require("node:fs").readFileSync(require("node:path").join(root, "package.json"), "utf-8"),
    ).name;
    const result = await exec.executeFile({
      path: "package.json",
      language: "javascript",
      code: `console.log(JSON.parse(FILE_CONTENT).name);`,
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(expectedName);
  });
});

// ── Intent progressive disclosure ─────────────────────────────────────────

describe("intent progressive disclosure", () => {
  test("below threshold: not searched, output verbatim", () => {
    const small = "line\n".repeat(10); // ~50 bytes
    const r = intentSearch(small, "line");
    expect(r.searched).toBe(false);
    expect(r.matchedSections).toEqual([]);
  });

  test("above threshold without intent: not searched", () => {
    const big = "section about auth\n".repeat(500); // > 5KB
    const r = intentSearch(big, undefined);
    expect(r.searched).toBe(false);
  });

  test("above threshold with intent: returns matching sections + vocab hints", () => {
    // Build a >threshold doc with two distinct topics.
    const authBlock = Array.from({ length: 100 }, (_, i) => `auth token ${i} validated`).join("\n");
    const dbBlock = Array.from({ length: 100 }, (_, i) => `database query ${i} executed`).join("\n");
    const output = `=== auth ===\n${authBlock}\n\n=== database ===\n${dbBlock}\n`;
    expect(Buffer.byteLength(output)).toBeGreaterThan(INTENT_SEARCH_THRESHOLD);

    const r = intentSearch(output, "auth token");
    expect(r.searched).toBe(true);
    expect(r.totalLines).toBeGreaterThan(200);
    expect(r.matchedSections.length).toBeGreaterThan(0);
    // Vocab hints should surface the distinctive terms.
    expect(r.vocabularyHints.length).toBeGreaterThan(0);
    // The auth-focused query should rank auth-heavy sections; at least one
    // matched section's preview/label should reference auth.
    const joined = r.matchedSections.map((m) => `${m.label} ${m.preview}`).join(" ").toLowerCase();
    expect(joined).toContain("auth");
  });

  test("renderIntentResult produces a human-readable summary", () => {
    const big = Array.from({ length: 500 }, (_, i) => `error ${i} in module`).join("\n");
    const r = intentSearch(big, "error");
    const rendered = renderIntentResult(r, "error");
    expect(rendered).toMatch(/Output trimmed via intent/);
    expect(rendered).toMatch(/Searchable terms/);
  });
});

// ── runPool ───────────────────────────────────────────────────────────────

describe("runPool", () => {
  test("preserves input order regardless of completion order", async () => {
    // Jobs that resolve after inverted delays so completion order != input order.
    const delays = [50, 5, 30, 1, 20];
    const jobs = delays.map(
      (d) => ({
        run: () => new Promise<number>((res) => setTimeout(() => res(d), d)),
      }),
    );
    const result = await runPool(jobs, { concurrency: 5 });
    const values = fulfilledValues(result);
    // Order must match input, NOT completion (which would be [1,5,20,30,50]).
    expect(values).toEqual(delays);
  });

  test("a rejecting job does not strand siblings", async () => {
    const jobs = [
      { run: async () => "ok-1" },
      { run: async () => {
        throw new Error("boom");
      } },
      { run: async () => "ok-3" },
    ];
    const result = await runPool(jobs, { concurrency: 3 });
    expect(result.settled[0]).toMatchObject({ status: "fulfilled", value: "ok-1" });
    expect(result.settled[1].status).toBe("rejected");
    expect(result.settled[2]).toMatchObject({ status: "fulfilled", value: "ok-3" });
  });

  test("cpu cap clamps effective concurrency", async () => {
    // Request concurrency 64, but capByCpuCount should clamp it to cpu count.
    const jobs = Array.from({ length: 4 }, () => ({ run: async () => 1 }));
    const result = await runPool(jobs, { concurrency: 64, capByCpuCount: true });
    expect(result.capped).toBe(true);
    expect(result.effectiveConcurrency).toBeLessThanOrEqual(Math.max(1, cpuCount()));
    expect(result.effectiveConcurrency).toBeLessThanOrEqual(4); // also clamped to job count
  });

  test("clamps to job count when fewer jobs than concurrency", async () => {
    const jobs = [{ run: async () => 1 }, { run: async () => 2 }];
    const result = await runPool(jobs, { concurrency: 10 });
    expect(result.effectiveConcurrency).toBe(2);
    expect(result.capped).toBe(true);
  });

  test("empty input returns empty", async () => {
    const result = await runPool([], { concurrency: 4 });
    expect(result.settled).toEqual([]);
    expect(result.effectiveConcurrency).toBe(0);
  });

  test("onSettled fires once per job in input order", async () => {
    const seen: number[] = [];
    const jobs = [
      { run: async () => "a" },
      { run: async () => "b" },
      { run: async () => "c" },
    ];
    await runPool(jobs, { concurrency: 1, onSettled: (idx) => seen.push(idx) });
    // With concurrency 1, workers process strictly in order.
    expect(seen).toEqual([0, 1, 2]);
  });
});

function cpuCount(): number {
  // node:os.cpus() — guarded for environments where it may be empty.
  try {
    return require("node:os").cpus().length;
  } catch {
    return 1;
  }
}

// ── ExecutorController (integration: batch order + concurrency) ───────────

describe("ExecutorController.batchExecute", () => {
  beforeEach(() => {
    ExecutorController.resetInstance();
  });
  afterEach(() => {
    ExecutorController.resetInstance();
  });

  (HAS_SHELL ? test : test.skip)("preserves order and caps concurrency", async () => {
    const ctrl = ExecutorController.getInstance();
    const res = await ctrl.batchExecute({
      commands: ["echo c0", "echo c1", "echo c2", "echo c3"],
      concurrency: 2,
    });
    expect(res.success).toBe(true);
    const data = res.data as { results: { command: string; stdout: string }[]; concurrency: number };
    expect(data.results.map((r) => r.stdout.trim())).toEqual(["c0", "c1", "c2", "c3"]);
    expect(data.concurrency).toBe(2);
  });

  (HAS_SHELL ? test : test.skip)("reports failure without aborting siblings", async () => {
    const ctrl = ExecutorController.getInstance();
    const res = await ctrl.batchExecute({
      // middle command exits non-zero; siblings still run.
      commands: ["echo first", "false", "echo third"],
      concurrency: 3,
    });
    expect(res.success).toBe(false); // at least one failed
    const data = res.data as { results: { stdout: string; exitCode: number | null }[] };
    expect(data.results[0].stdout.trim()).toBe("first");
    expect(data.results[1].exitCode).not.toBe(0);
    expect(data.results[2].stdout.trim()).toBe("third");
  });
});

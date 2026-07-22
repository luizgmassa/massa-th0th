/**
 * N18 — Deterministic acceptance script.
 *
 * Runs the test suite in deterministic-only mode: `_DETERMINISTIC_ONLY=1`
 * skips all suites that require a live database, network, or grammar (native
 * tree-sitter) dependencies. Only pure-unit tests run.
 *
 * Completes without external dependencies (no PostgreSQL, no Ollama, no
 * tree-sitter native binding). Reports which suites were skipped and why.
 *
 * Reuses the `run-tests-isolated.ts` classifier logic to identify which tests
 * need isolation and which are pure.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..", "packages", "core");
const testsRoot = path.join(packageRoot, "src", "__tests__");

type IsolationReason =
  | "module mock"
  | "database/integration"
  | "process-global state"
  | "network"
  | "grammar";

type SuiteEntry = {
  file: string;
  relativePath: string;
  reason: IsolationReason | undefined;
  skipped: boolean;
  skipReason: string | null;
};

/**
 * Classifier — mirrors run-tests-isolated.ts but extends it with network and
 * grammar detection for the deterministic gate.
 */
function classify(file: string, source: string): IsolationReason | undefined {
  if (/^\s*mock\s*\.\s*module\s*\(/m.test(source)) return "module mock";

  const relativePath = path.relative(testsRoot, file);
  if (
    relativePath.startsWith(`integration${path.sep}`) ||
    /(?:^|[.-])(?:e2e|integration)\.test\.ts$/.test(path.basename(file)) ||
    /\b(?:DATABASE_URL|DATABASE_URL)\b/.test(source) ||
    /\b(?:getPrismaClient|disconnectPrisma|PrismaClient)\s*\(/.test(source) ||
    /\b(?:PostgresVectorStore|PostgresGraphRepository|PostgresSymbolRepository)\b/.test(source) ||
    /\b(?:EtlPipeline|ContextualSearchRLM|WorkspaceManager)\b/.test(source) ||
    /\b(?:getGraphStore|getMemoryRepository|getVectorStore|getKeywordSearch|getJobStore|getSessionStore)\s*\(/.test(
      source,
    )
  ) {
    return "database/integration";
  }

  // Network: tests that make real HTTP/fetch calls to external services
  if (
    /\b(?:fetch|http\.request|https\.request)\s*\(/.test(source) &&
    !/mock/i.test(source)
  ) {
    // Only flag as network if it looks like a real call (not mocked)
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0|MASSA_TH0TH_API/.test(source)) {
      return "network";
    }
  }

  // Grammar: tests that require tree-sitter native bindings
  if (
    /\b(?:tree-sitter|treeSitter|Parser|LANGUAGE|Grammar)\b/.test(source) &&
    /require\(|import\s+.*from\s+["']tree-sitter/.test(source)
  ) {
    return "grammar";
  }

  if (
    /\b(?:eventBus|useFakeTimers|setSystemTime)\b/.test(source) ||
    /\b_set[A-Za-z0-9]*ForTesting\s*\(/.test(source) ||
    /(?:delete\s+process\.env\b|process\.env(?:\.[A-Z0-9_]+|\[[^\]]+\])\s*=)/.test(source)
  ) {
    return "process-global state";
  }

  return undefined;
}

async function findTestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findTestFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".test.ts") ? [entryPath] : [];
    }),
  );
  return files.flat();
}

const discoveredFiles = (await findTestFiles(testsRoot)).sort((a, b) =>
  a.localeCompare(b),
);

const entries: SuiteEntry[] = await Promise.all(
  discoveredFiles.map(async (file) => {
    const source = await readFile(file, "utf8");
    const reason = classify(file, source);
    const relativePath = path.relative(testsRoot, file);
    const isDeterministic =
      reason === undefined || reason === "process-global state";
    return {
      file,
      relativePath,
      reason,
      skipped: !isDeterministic,
      skipReason: isDeterministic
        ? null
        : reason === "database/integration"
          ? "requires live PostgreSQL database"
          : reason === "network"
            ? "requires network access to external services"
            : reason === "grammar"
              ? "requires tree-sitter native grammar bindings"
              : reason === "module mock"
                ? "uses mock.module (process-global side effects)"
                : `skipped: ${reason}`,
    };
  }),
);

const deterministicFiles = entries
  .filter((e) => !e.skipped)
  .map((e) => e.file);

const skippedEntries = entries.filter((e) => e.skipped);

// ── Report ──────────────────────────────────────────────────────────────────

console.log(`[deterministic] _DETERMINISTIC_ONLY=1`);
console.log(
  `[deterministic] ${entries.length} test files discovered: ${deterministicFiles.length} deterministic, ${skippedEntries.length} skipped`,
);

if (skippedEntries.length > 0) {
  console.log(`\n[deterministic] Skipped suites:`);
  for (const e of skippedEntries) {
    console.log(`  SKIP ${e.relativePath} — ${e.skipReason}`);
  }
}

if (deterministicFiles.length === 0) {
  console.log(`\n[deterministic] No deterministic tests to run. Exiting.`);
  process.exit(0);
}

// ── Run deterministic tests ──────────────────────────────────────────────────

const DETERMINISTIC_ENV = {
  ...process.env,
  _DETERMINISTIC_ONLY: "1",
  DATABASE_URL: "",
};

let activeChild: ChildProcess | undefined;
let forwardedSignal: NodeJS.Signals | undefined;
const handledSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
const signalHandlers = new Map<NodeJS.Signals, () => void>();

for (const signal of handledSignals) {
  const handler = () => {
    forwardedSignal ??= signal;
    activeChild?.kill(signal);
  };
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

function removeSignalHandlers(): void {
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);
}

function runTests(files: string[]): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    activeChild = spawn(process.execPath, ["test", ...files], {
      cwd: packageRoot,
      env: DETERMINISTIC_ENV,
      stdio: "inherit",
    });
    activeChild.once("error", reject);
    activeChild.once("close", (code, signal) => {
      activeChild = undefined;
      resolve({ code, signal });
    });
  });
}

console.log(`\n[deterministic] Running ${deterministicFiles.length} deterministic test files...`);

try {
  const result = await runTests(deterministicFiles);
  removeSignalHandlers();

  if (forwardedSignal) {
    process.kill(process.pid, forwardedSignal);
  } else if (result.signal) {
    console.error(`[deterministic] SIGNAL ${result.signal}`);
    process.kill(process.pid, result.signal);
  } else if (result.code !== 0) {
    console.error(`[deterministic] FAIL (exit ${result.code})`);
    process.exit(result.code ?? 1);
  } else {
    console.log(`\n[deterministic] PASS: ${deterministicFiles.length} files, ${skippedEntries.length} skipped`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[deterministic] ERROR: ${message}`);
  removeSignalHandlers();
  process.exit(1);
}
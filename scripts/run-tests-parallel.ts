/**
 * Parallel Test Runner — Wave 6 N20 (T23-T24)
 *
 * Single `SUITE_TABLE` macro array drives both listing and execution.
 * `--list-suites` prints the table; runner spawns child processes per
 * non-deadline-sensitive suite in parallel + serial tail for deadline-
 * sensitive suites. UNION GUARD ensures result-set = list (no silent drops).
 *
 * Suite classification derived from `packages/core/scripts/run-tests-isolated.ts`
 * classifier (L88-127): module mock, database/integration, process-global state,
 * or pure (shared process).
 *
 * Usage:
 *   bun scripts/run-tests-parallel.ts [--list-suites] [--filter <regex>] [--serial-tail <suites>]
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export type IsolationReason = "module mock" | "database/integration" | "process-global state" | "pure";

export interface SuiteDef {
  id: string;
  description: string;
  testFiles: string[];
  isolationReason: IsolationReason;
  /** Suites that share deadline-sensitive state (e.g. temporal mocks) run serially. */
  deadlineSensitive: boolean;
}

// ── Test discovery (mirrors run-tests-isolated.ts) ──────────────────────────

const packageRoot = path.resolve(import.meta.dir, "..", "packages", "core");
const testsRoot = path.join(packageRoot, "src", "__tests__");

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

// ── Classifier (ported from run-tests-isolated.ts L100-127) ──────────────────

function classifyIsolation(file: string, source: string): IsolationReason {
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

  if (
    /\b(?:eventBus|useFakeTimers|setSystemTime)\b/.test(source) ||
    /\b_set[A-Za-z0-9]*ForTesting\s*\(/.test(source) ||
    /(?:delete\s+process\.env\b|process\.env(?:\.[A-Z0-9_]+|\[[^\]]+\])\s*=)/.test(source)
  ) {
    return "process-global state";
  }

  return "pure";
}

/** Deadline-sensitive suites: those using fake timers or temporal inhibition. */
function isDeadlineSensitive(source: string): boolean {
  return /\b(?:useFakeTimers|setSystemTime|temporalInhibition|eventBus)\b/.test(source);
}

// ── SUITE_TABLE macro array ─────────────────────────────────────────────────

async function buildSuiteTable(): Promise<SuiteDef[]> {
  const discoveredFiles = (await findTestFiles(testsRoot))
    .filter((file) => {
      const relativePath = path.relative(testsRoot, file);
      // Exclude integration/ directory (has its own test:integration gate)
      return !relativePath.startsWith(`integration${path.sep}`);
    })
    .sort((a, b) => a.localeCompare(b));

  const classified = await Promise.all(
    discoveredFiles.map(async (file) => {
      const source = await readFile(file, "utf8");
      const reason = classifyIsolation(file, source);
      const deadline = isDeadlineSensitive(source);
      return { file, reason, deadline };
    }),
  );

  // Group: pure tests share a process; isolated tests get individual entries
  const pureFiles = classified.filter((c) => c.reason === "pure").map((c) => c.file);
  const isolated = classified.filter((c) => c.reason !== "pure");

  const suites: SuiteDef[] = [];

  if (pureFiles.length > 0) {
    suites.push({
      id: "pure-shared",
      description: `Pure/shared tests (${pureFiles.length} files)`,
      testFiles: pureFiles,
      isolationReason: "pure",
      deadlineSensitive: false,
    });
  }

  for (const entry of isolated) {
    const relativePath = path.relative(packageRoot, entry.file);
    suites.push({
      id: `${entry.reason}:${relativePath}`,
      description: `Isolated (${entry.reason}): ${relativePath}`,
      testFiles: [entry.file],
      isolationReason: entry.reason,
      deadlineSensitive: entry.deadline,
    });
  }

  return suites;
}

// ── --list-suites flag ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const listSuites = args.includes("--list-suites");
const filterArg = args.find((a) => a.startsWith("--filter="));
const filterRegex = filterArg ? new RegExp(filterArg.slice("--filter=".length)) : undefined;
const unknownArgs = args.filter(
  (a) => a !== "--list-suites" && !a.startsWith("--filter=") && !a.startsWith("--serial-tail="),
);

if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
  process.exit(2);
}

const SUITE_TABLE = await buildSuiteTable();

if (listSuites) {
  console.log(`\nSUITE_TABLE (${SUITE_TABLE.length} suites):\n`);
  for (const suite of SUITE_TABLE) {
    const deadlineTag = suite.deadlineSensitive ? " [DEADLINE-SENSITIVE]" : "";
    console.log(`  ${suite.id}${deadlineTag}`);
    console.log(`    description: ${suite.description}`);
    console.log(`    isolationReason: ${suite.isolationReason}`);
    console.log(`    testFiles: ${suite.testFiles.length}`);
    console.log("");
  }
  process.exit(0);
}

// ── Execution + UNION GUARD (T24) ────────────────────────────────────────────

// Filter suites if --filter is provided
const filteredSuites = filterRegex
  ? SUITE_TABLE.filter((s) => filterRegex.test(s.id) || s.testFiles.some((f) => filterRegex.test(f)))
  : SUITE_TABLE;

// Split into parallel (non-deadline-sensitive) and serial tail (deadline-sensitive)
const parallelSuites = filteredSuites.filter((s) => !s.deadlineSensitive);
const serialSuites = filteredSuites.filter((s) => s.deadlineSensitive);

console.log(
  `[parallel-runner] ${filteredSuites.length} suites: ${parallelSuites.length} parallel, ${serialSuites.length} serial tail`,
);

interface SuiteResult {
  suiteId: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  crashed: boolean;
  passed: boolean;
}

function runSuite(suite: SuiteDef): Promise<SuiteResult> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(process.execPath, ["test", ...suite.testFiles], {
      cwd: packageRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", () => {
      resolve({
        suiteId: suite.id,
        exitCode: null,
        signal: null,
        crashed: true,
        passed: false,
      });
    });

    child.once("close", (code, signal) => {
      resolve({
        suiteId: suite.id,
        exitCode: code,
        signal: signal,
        crashed: signal !== null,
        passed: code === 0 && signal === null,
      });
    });
  });
}

// Run parallel suites concurrently
const parallelResults: SuiteResult[] = await Promise.all(
  parallelSuites.map((suite) => {
    console.log(`[parallel-runner] START ${suite.id}`);
    return runSuite(suite);
  }),
);

// Run serial tail suites sequentially
const serialResults: SuiteResult[] = [];
for (const suite of serialSuites) {
  console.log(`[parallel-runner] START (serial) ${suite.id}`);
  const result = await runSuite(suite);
  serialResults.push(result);
}

const allResults = [...parallelResults, ...serialResults];

// ── UNION GUARD: result-set must equal list ──────────────────────────────────

const expectedIds = new Set(filteredSuites.map((s) => s.id));
const resultIds = new Set(allResults.map((r) => r.suiteId));

// Missing suites = listed but not in results = silently dropped
const missing = [...expectedIds].filter((id) => !resultIds.has(id));
if (missing.length > 0) {
  console.error(`\n[parallel-runner] UNION GUARD FAIL: ${missing.length} suite(s) missing from results:`);
  for (const id of missing) console.error(`  - ${id}`);
  process.exit(1);
}

// Extra suites = in results but not in list = phantom execution
const extra = [...resultIds].filter((id) => !expectedIds.has(id));
if (extra.length > 0) {
  console.error(`\n[parallel-runner] UNION GUARD FAIL: ${extra.length} phantom suite(s) in results:`);
  for (const id of extra) console.error(`  - ${id}`);
  process.exit(1);
}

// ── Summary ─────────────────────────────────────────────────────────────────

const passed = allResults.filter((r) => r.passed).length;
const failed = allResults.filter((r) => !r.passed).length;
const crashed = allResults.filter((r) => r.crashed).length;

console.log(`\n[parallel-runner] SUMMARY: ${passed} passed, ${failed} failed, ${crashed} crashed`);

for (const result of allResults) {
  const status = result.passed ? "PASS" : result.crashed ? "CRASH" : "FAIL";
  console.log(`  ${status}: ${result.suiteId}`);
}

// Crashed suite = failed (not dropped) — UNION GUARD ensures it's counted
if (crashed > 0) {
  console.error(`\n[parallel-runner] ${crashed} suite(s) crashed — counted as failed (ZERO-LOSS guard)`);
}

process.exit(failed > 0 || crashed > 0 ? 1 : 0);
import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..");
const testsRoot = path.join(packageRoot, "src", "__tests__");
const argumentsList = process.argv.slice(2);
const unitOnly = argumentsList.includes("--unit");
const e2eOnly = argumentsList.includes("--e2e");
const filterArgument = argumentsList.find((argument) => argument.startsWith("--filter="));
const filterRegex = filterArgument ? new RegExp(filterArgument.slice("--filter=".length)) : undefined;
const unknownArguments = argumentsList.filter(
  (argument) =>
    argument !== "--unit" &&
    argument !== "--e2e" &&
    !argument.startsWith("--filter="),
);

if (unknownArguments.length > 0) {
  console.error(`Unknown argument(s): ${unknownArguments.join(", ")}`);
  process.exit(2);
}

if (unitOnly && e2eOnly) {
  console.error("Incompatible arguments: --unit and --e2e");
  process.exit(2);
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

async function findTopLevelTestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => path.join(directory, entry.name));
}

const discoveryRoot = e2eOnly ? path.join(testsRoot, "e2e") : testsRoot;
const discoveredFiles = (e2eOnly
  ? await findTopLevelTestFiles(discoveryRoot)
  : (await findTestFiles(discoveryRoot)).filter(
      (file) => {
        const relativePath = path.relative(testsRoot, file);

        // Live API tests have their own explicit `test:integration` gate. Never
        // let the default package/root aggregate contact a running developer API.
        if (relativePath.startsWith(`integration${path.sep}`)) return false;

        return !unitOnly || path.dirname(file) === testsRoot;
      },
    )
).sort((left, right) => left.localeCompare(right));

// `--filter=<regex>` narrows the selected files by path (relative to the tests
// root). Used by the macOS arm64 CI gate to run only the native-structural
// suites (which need darwin/arm64) without pulling in database/integration tests.
if (filterRegex) {
  const before = discoveredFiles.length;
  for (let index = discoveredFiles.length - 1; index >= 0; index -= 1) {
    if (!filterRegex.test(path.relative(testsRoot, discoveredFiles[index]!))) {
      discoveredFiles.splice(index, 1);
    }
  }
  console.log(`[test-isolation] --filter retained ${discoveredFiles.length}/${before} files`);
}

if (e2eOnly) {
  const cleanupFinalizer = discoveredFiles.find(
    (file) => path.basename(file) === "17.cleanup-verify.test.ts",
  );
  if (cleanupFinalizer) {
    discoveredFiles.splice(discoveredFiles.indexOf(cleanupFinalizer), 1);
    discoveredFiles.push(cleanupFinalizer);
  }
}

type IsolationReason = "module mock" | "database/integration" | "process-global state";

/**
 * Bun runs test files in one process and schedules suites from different files
 * concurrently. Keep genuinely pure tests in one fast group, but give tests
 * that share module, database, or process-global state their own child process.
 *
 * These rules intentionally inspect the test contract instead of maintaining
 * a filename allow-list: a newly added PG integration or global testing seam is
 * isolated automatically. The expressions only match stateful API usage in
 * test source; ordinary mentions in fixture strings do not opt a file in.
 */
function isolationReason(file: string, source: string): IsolationReason | undefined {
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

  return undefined;
}

const classifiedFiles = await Promise.all(
  discoveredFiles.map(async (file) => {
    const source = await readFile(file, "utf8");
    return { file, isolationReason: isolationReason(file, source) };
  }),
);

const sharedProcessFiles = classifiedFiles
  .filter(({ isolationReason }) => isolationReason === undefined)
  .map(({ file }) => file);
const isolatedFiles = classifiedFiles
  .filter(
    (entry): entry is typeof entry & { isolationReason: IsolationReason } =>
      entry.isolationReason !== undefined,
  );
const groups = e2eOnly
  ? discoveredFiles.map((file) => ({
      label: `e2e: ${path.relative(packageRoot, file)}`,
      files: [file],
    }))
  : [
      ...(sharedProcessFiles.length > 0
        ? [{ label: `mock-free (${sharedProcessFiles.length} files)`, files: sharedProcessFiles }]
        : []),
      ...isolatedFiles.map(({ file, isolationReason }) => ({
        label: `isolated (${isolationReason}): ${path.relative(packageRoot, file)}`,
        files: [file],
      })),
    ];

if (e2eOnly) {
  console.log(`[test-isolation] ${discoveredFiles.length} e2e files: sequential, cleanup finalizer last`);
} else {
  console.log(
    `[test-isolation] ${discoveredFiles.length} files: ${sharedProcessFiles.length} pure/shared, ${isolatedFiles.length} stateful/isolated`,
  );
}

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

function runGroup(files: string[]): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    activeChild = spawn(process.execPath, ["test", ...files], {
      cwd: packageRoot,
      env: process.env,
      stdio: "inherit",
    });
    activeChild.once("error", reject);
    activeChild.once("close", (code, signal) => {
      activeChild = undefined;
      resolve({ code, signal });
    });
  });
}

const failures: string[] = [];

for (const group of groups) {
  console.log(`\n[test-isolation] RUN ${group.label}`);
  try {
    const result = await runGroup(group.files);
    if (forwardedSignal) break;
    if (result.signal) {
      console.error(`[test-isolation] SIGNAL ${result.signal}: ${group.label}`);
      removeSignalHandlers();
      process.kill(process.pid, result.signal);
      break;
    }
    if (result.code !== 0) {
      console.error(`[test-isolation] FAIL (${result.code}): ${group.label}`);
      failures.push(group.label);
    } else {
      console.log(`[test-isolation] PASS: ${group.label}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[test-isolation] ERROR: ${group.label}: ${message}`);
    failures.push(group.label);
  }
}

removeSignalHandlers();

if (forwardedSignal) {
  process.kill(process.pid, forwardedSignal);
} else if (failures.length > 0) {
  console.error(`\n[test-isolation] ${failures.length} failed group(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\n[test-isolation] PASS: all ${groups.length} group(s)`);
}

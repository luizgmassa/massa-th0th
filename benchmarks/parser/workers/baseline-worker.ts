/**
 * Baseline measurement worker (runs in a FRESH child process).
 *
 * Loads the frozen corpus and, for EACH file, performs the FULL baseline
 * ParseStage (5d43a96) per-file structural work, then prints ONE
 * throughput/RSS sample. The parent spawns N of these for stable medians.
 *
 * FAIR MEASUREMENT — the baseline ParseStage.parseFile() did, per file:
 *   1. smartChunk(content, relativePath)            ← semantic chunker
 *   2. extractSymbols(content, ext)                 ← regex symbol extractor
 *   3. extractImports(content, ext)                 ← regex import extractor
 *   4. extractTypedEdges(content, symbols)          ← typed-edge extractor
 *      (TS/JS only, using the symbols from step 2 for caller resolution)
 *
 * The previous version of this worker measured ONLY step 4 with an empty
 * symbol array — an unfair single-regex-pass baseline against which the
 * candidate's full tree-sitter indexer was compared. This version runs all
 * four passes per file, matching the real baseline work scope.
 *
 * The corpus is 100% TS/JS-family (.ts/.tsx/.js/.jsx), so every file takes
 * the JS path through each extractor and all four passes run for every file.
 *
 * smartChunk and extractTypedEdges are exported by the baseline package and
 * are imported from the worktree's built dist (falling back to source).
 * extractJsSymbols and extractJsImports are PRIVATE methods on the baseline
 * ParseStage class; they are pure regex functions with no instance state, so
 * they are faithfully replicated here from the 5d43a96 source verbatim. This
 * is noted because the worktree APIs do not export them.
 *
 * resolveChunkerMaxChars(): in the benchmark environment no EMBEDDING_*
 * env vars are set, so it returns undefined and smartChunk uses its default
 * ChunkerConfig — exactly the path the baseline ParseStage took per file.
 *
 * The baseline modules are loaded from a `git worktree add` at the baseline
 * commit, whose path the parent passes via BENCH_BASELINE_WORKTREE. The
 * parent builds the worktree (`bun install --frozen-lockfile` + `bun run
 * build`) before invoking this worker, so we import from the worktree's
 * built dist.
 *
 * Protocol: prints `BENCH_SAMPLE_RESULT=<json>\n` on stdout.
 *
 * Invocation:
 *   BENCH_BASELINE_WORKTREE=<path> bun benchmarks/parser/workers/baseline-worker.ts <sampleIndex>
 */

import { pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import { loadCorpus } from "../harness.ts";

const RESULT_PREFIX = "BENCH_SAMPLE_RESULT=";

// ─── Baseline type mirrors (5d43a96 stage-context.ts) ───────────────────────

interface RawSymbol {
  kind: "function" | "class" | "variable" | "type" | "interface" | "export";
  name: string;
  fqn?: string;
  lineStart: number;
  lineEnd: number;
  exported: boolean;
  docComment?: string;
}

interface RawImport {
  specifier: string;
  names: string[];
  isTypeOnly: boolean;
}

interface RawEdge {
  kind: string;
  line: number;
  symbolName: string;
  callerSymbol?: string;
  meta?: Record<string, unknown>;
}

type SmartChunk = (content: string, filePath: string, config?: object) => unknown[];
type ExtractTypedEdges = (content: string, symbols: RawSymbol[]) => RawEdge[];

interface BaselineModules {
  smartChunk: SmartChunk;
  extractTypedEdges: ExtractTypedEdges;
}

interface BaselineSample {
  readonly kind: "baseline";
  readonly sampleIndex: number;
  readonly elapsedSeconds: number;
  readonly totalBytes: number;
  readonly throughputBps: number;
  readonly peakRssBytes: number;
  readonly fileCount: number;
}

function emit(sample: BaselineSample): void {
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(sample)}\n`);
}

/**
 * Resolve a baseline module path: prefer the worktree's built dist (matches
 * how the old package shipped); fall back to source if dist was not produced.
 */
async function resolveModulePath(worktreePath: string, distRel: string, srcRel: string): Promise<string> {
  const distPath = resolve(worktreePath, distRel);
  const srcPath = resolve(worktreePath, srcRel);
  try {
    await import("node:fs").then((fs) => fs.statSync(distPath));
    return distPath;
  } catch {
    return srcPath;
  }
}

async function loadBaseline(worktreePath: string): Promise<BaselineModules> {
  // smartChunk is exported from the search/smart-chunker module.
  const chunkerPath = await resolveModulePath(
    worktreePath,
    "packages/core/dist/services/search/smart-chunker.js",
    "packages/core/src/services/search/smart-chunker.ts",
  );
  const chunkerMod = await import(pathToFileURL(chunkerPath).href);
  const smartChunk = (chunkerMod.smartChunk ?? chunkerMod.default?.smartChunk) as SmartChunk | undefined;
  if (typeof smartChunk !== "function") {
    throw new Error(`baseline worktree did not export smartChunk from ${chunkerPath}`);
  }

  // extractTypedEdges is exported from etl/typed-edges.
  const edgesPath = await resolveModulePath(
    worktreePath,
    "packages/core/dist/services/etl/typed-edges.js",
    "packages/core/src/services/etl/typed-edges.ts",
  );
  const edgesMod = await import(pathToFileURL(edgesPath).href);
  const extractTypedEdges = (edgesMod.extractTypedEdges ?? edgesMod.default?.extractTypedEdges) as
    | ExtractTypedEdges
    | undefined;
  if (typeof extractTypedEdges !== "function") {
    throw new Error(`baseline worktree did not export extractTypedEdges from ${edgesPath}`);
  }

  return { smartChunk, extractTypedEdges };
}

// ─── Faithful replicas of baseline ParseStage PRIVATE extractors ────────────
//
// These are copied verbatim from 5d43a96:packages/core/src/services/etl/stages/parse.ts.
// They are private methods on ParseStage but are pure regex functions with no
// instance state, so replicating them exercises the exact same per-file work
// the baseline did. The worktree does not export them, so we reproduce them.

/** Tracks brace depth to find the closing line of a JS/TS block. */
function findBlockEnd(lines: string[], startLine: number): number {
  let depth = 0;
  let found = false;
  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; found = true; }
      if (ch === "}") { depth--; }
    }
    if (found && depth <= 0) return i + 1;
  }
  return startLine + 1;
}

/** Extract JSDoc/TSDoc comment lines immediately before the given line. */
function extractDocComment(lines: string[], lineIndex: number): string | undefined {
  const commentLines: string[] = [];
  let i = lineIndex - 1;
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("/**") || trimmed.startsWith("*/")) {
      commentLines.unshift(trimmed);
      i--;
    } else if (trimmed.startsWith("//")) {
      commentLines.unshift(trimmed.slice(2).trim());
      i--;
    } else {
      break;
    }
  }
  if (commentLines.length === 0) return undefined;
  return commentLines.join(" ").replace(/\/\*\*?|\*\//g, "").replace(/\s*\*\s*/g, " ").trim();
}

/** Baseline extractJsSymbols — regex symbol extractor for TS/JS family. */
function extractJsSymbols(content: string): RawSymbol[] {
  const lines = content.split("\n");
  const symbols: RawSymbol[] = [];

  const patterns: Array<[RegExp, RawSymbol["kind"]]> = [
    [/^(export\s+)?(?:async\s+)?function\s+(\w+)/, "function"],
    [/^(export\s+)?class\s+(\w+)/, "class"],
    [/^(export\s+)?(?:const|let|var)\s+(\w+)(?:\s*[=:])/, "variable"],
    [/^(export\s+)?type\s+(\w+)\s*(?:[=<{])/, "type"],
    [/^(export\s+)?interface\s+(\w+)/, "interface"],
    [/^export\s+default\s+(?:async\s+)?(?:function|class)\s*(\w+)?/, "export"],
    [/^export\s+\{([^}]+)\}/, "export"],
    [/^(export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/, "function"],
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimStart();

    for (const [pattern, kind] of patterns) {
      const match = pattern.exec(line);
      if (!match) continue;

      const exported = line.startsWith("export");

      let name = "";
      if (kind === "export" && line.includes("{")) {
        const inner = match[0].replace(/export\s*\{/, "").replace("}", "");
        const names = inner
          .split(",")
          .map((n) => n.split(" as ").pop()!.trim())
          .filter(Boolean);
        for (const n of names) {
          symbols.push({ kind, name: n, lineStart: i + 1, lineEnd: i + 1, exported: true });
        }
        break;
      } else {
        for (let g = 1; g < match.length; g++) {
          const cap = match[g];
          if (cap && /^\w+$/.test(cap) && cap !== "export" && cap !== "async") {
            name = cap;
            break;
          }
        }
      }

      if (!name) break;

      const lineEnd = findBlockEnd(lines, i);
      const docComment = extractDocComment(lines, i);
      symbols.push({ kind, name, lineStart: i + 1, lineEnd, exported, docComment });
      break;
    }
  }

  return symbols;
}

/** Baseline extractJsImports — regex import extractor for TS/JS family. */
function extractJsImports(content: string): RawImport[] {
  const imports: RawImport[] = [];

  const namedRe = /import\s+(type\s+)?\{\s*([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = namedRe.exec(content)) !== null) {
    const isTypeOnly = Boolean(m[1]);
    const names = m[2].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean);
    imports.push({ specifier: m[3], names, isTypeOnly });
  }

  const defaultRe = /import\s+(\w+)\s+ from\s+['"]([^'"]+)['"]/g;
  while ((m = defaultRe.exec(content)) !== null) {
    imports.push({ specifier: m[2], names: ["default"], isTypeOnly: false });
  }

  const starRe = /import\s+\*\s+as\s+(\w+)\s+ from\s+['"]([^'"]+)['"]/g;
  while ((m = starRe.exec(content)) !== null) {
    imports.push({ specifier: m[2], names: ["*"], isTypeOnly: false });
  }

  const requireRe = /require\(['"]([^'"]+)['"]\)/g;
  while ((m = requireRe.exec(content)) !== null) {
    imports.push({ specifier: m[1], names: ["*"], isTypeOnly: false });
  }

  return imports;
}

/** TS/JS-family extensions — mirrors baseline TYPED_EDGE_EXTENSIONS. */
const TYPED_EDGE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/**
 * Full baseline per-file work — the four passes ParseStage.parseFile() ran.
 * The corpus is all TS/JS so every file takes the JS path and runs all four.
 */
function baselineParseFile(
  content: string,
  relativePath: string,
  modules: BaselineModules,
): void {
  // 1. smartChunk — semantic chunking (uses default config; no EMBEDDING_* env).
  modules.smartChunk(content, relativePath);

  // 2. extractSymbols (JS family — the only family in the corpus).
  const symbols = extractJsSymbols(content);

  // 3. extractImports (JS family).
  extractJsImports(content);

  // 4. extractTypedEdges (TS/JS only, using real symbols for caller resolution).
  const ext = extname(relativePath).toLowerCase();
  if (TYPED_EDGE_EXTENSIONS.has(ext)) {
    modules.extractTypedEdges(content, symbols);
  }
}

async function measure(
  sampleIndex: number,
  modules: BaselineModules,
): Promise<BaselineSample> {
  const { entries } = loadCorpus();
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  let peakRss = process.memoryUsage().rss;
  const start = performance.now();
  for (const entry of entries) {
    const content = entry.source.toString("utf8");
    baselineParseFile(content, entry.name, modules);
    const rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;
  }
  const elapsedSeconds = (performance.now() - start) / 1000;
  const throughputBps = elapsedSeconds > 0 ? totalBytes / elapsedSeconds : 0;
  return {
    kind: "baseline",
    sampleIndex,
    elapsedSeconds,
    totalBytes,
    throughputBps,
    peakRssBytes: peakRss,
    fileCount: entries.length,
  };
}

async function main(): Promise<void> {
  const worktreePath = process.env.BENCH_BASELINE_WORKTREE;
  if (!worktreePath) {
    throw new Error("BENCH_BASELINE_WORKTREE env var is required");
  }
  const sampleIndex = Number(process.argv[2] ?? "0");
  const modules = await loadBaseline(worktreePath);
  emit(await measure(sampleIndex, modules));
}

main().catch((error) => {
  process.stderr.write(`baseline-worker fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

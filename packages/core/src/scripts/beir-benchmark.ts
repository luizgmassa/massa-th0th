#!/usr/bin/env bun

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";

interface BeirCorpusEntry {
  _id: string;
  title?: string;
  text: string;
}

interface BeirQueryEntry {
  _id: string;
  text: string;
}

interface BenchmarkMetrics {
  recallAtK: number;
  ndcgAtK: number;
  mrrAtK: number;
}

interface CliOptions {
  datasetDir: string;
  datasetName: string;
  projectId: string;
  k: number;
  maxQueries?: number;
  minScore: number;
  forceReindex: boolean;
  keepTemp: boolean;
}

function resolveEnvPath(startDir: string): string | null {
  let current = path.resolve(startDir);
  let firstEnvFound: string | null = null;

  while (true) {
    const candidate = path.join(current, ".env");
    if (fsSync.existsSync(candidate)) {
      if (!firstEnvFound) {
        firstEnvFound = candidate;
      }

      const packageJsonPath = path.join(current, "package.json");
      if (fsSync.existsSync(packageJsonPath)) {
        try {
          const packageJson = fsSync.readFileSync(packageJsonPath, "utf-8");
          if (packageJson.includes('"workspaces"')) {
            return candidate;
          }
        } catch {
          // ignore parse/read errors and continue searching
        }
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return firstEnvFound;
    }
    current = parent;
  }
}

function loadEnvironment(): void {
  const explicit = process.env.DOTENV_CONFIG_PATH;
  const envPath = explicit || resolveEnvPath(process.cwd());

  if (!envPath) {
    console.warn("[beir] .env not found; using existing process environment only");
    return;
  }

  const result = dotenv.config({ path: envPath, override: false });
  if (result.error) {
    console.warn(`[beir] failed to load .env at ${envPath}: ${result.error.message}`);
    return;
  }

  const loadedCount = Object.keys(result.parsed || {}).length;
  console.log(`[beir] loaded .env from ${envPath} (${loadedCount} vars)`);
}

function parseArgs(argv: string[]): CliOptions {
  const args = new Map<string, string>();
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key.slice(2), "true");
      continue;
    }

    args.set(key.slice(2), next);
    i += 1;
  }

  const datasetDir = args.get("datasetDir");
  if (!datasetDir) {
    throw new Error("Missing required --datasetDir");
  }

  const datasetName = args.get("datasetName") || path.basename(datasetDir);
  const projectId = args.get("projectId") || `beir-${datasetName}`;
  const k = Number(args.get("k") || "10");
  const maxQueriesRaw = args.get("maxQueries");
  const maxQueries = maxQueriesRaw ? Number(maxQueriesRaw) : undefined;
  const minScore = Number(args.get("minScore") || "0.0");

  return {
    datasetDir,
    datasetName,
    projectId,
    k,
    maxQueries,
    minScore,
    forceReindex: args.get("forceReindex") !== "false",
    keepTemp: args.get("keepTemp") === "true",
  };
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const raw = await fs.readFile(filePath, "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

async function readQrels(filePath: string): Promise<Map<string, Map<string, number>>> {
  const raw = await fs.readFile(filePath, "utf-8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const qrels = new Map<string, Map<string, number>>();

  const dataLines = lines[0].toLowerCase().includes("query-id") ? lines.slice(1) : lines;
  for (const line of dataLines) {
    const [queryId, corpusId, scoreRaw] = line.split("\t");
    if (!queryId || !corpusId || !scoreRaw) {
      continue;
    }

    const score = Number(scoreRaw);
    if (Number.isNaN(score) || score <= 0) {
      continue;
    }

    const byQuery = qrels.get(queryId) || new Map<string, number>();
    byQuery.set(corpusId, score);
    qrels.set(queryId, byQuery);
  }

  return qrels;
}

async function materializeCorpus(corpus: BeirCorpusEntry[], tempRoot: string): Promise<void> {
  const docsDir = path.join(tempRoot, "docs");
  await fs.mkdir(docsDir, { recursive: true });

  for (const entry of corpus) {
    const safeName = `${encodeURIComponent(entry._id)}.md`;
    const filePath = path.join(docsDir, safeName);
    const title = entry.title?.trim() ? `${entry.title.trim()}\n\n` : "";
    const content = `${title}${entry.text || ""}`;
    await fs.writeFile(filePath, content, "utf-8");
  }
}

function docIdFromFilePath(filePath?: string): string | null {
  if (!filePath) {
    return null;
  }

  const base = path.basename(filePath, path.extname(filePath));
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}

function uniqueDocIds(results: Array<{ metadata?: { filePath?: string } }>): string[] {
  const seen = new Set<string>();
  const docIds: string[] = [];

  for (const result of results) {
    const docId = docIdFromFilePath(result.metadata?.filePath);
    if (!docId || seen.has(docId)) {
      continue;
    }

    seen.add(docId);
    docIds.push(docId);
  }

  return docIds;
}

function calcDcg(retrievedDocIds: string[], relevant: Map<string, number>, k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, retrievedDocIds.length); i += 1) {
    const rel = relevant.get(retrievedDocIds[i]) || 0;
    if (rel <= 0) {
      continue;
    }
    dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  }
  return dcg;
}

function calcIdcg(relevant: Map<string, number>, k: number): number {
  const sorted = [...relevant.values()].sort((a, b) => b - a);
  let idcg = 0;
  for (let i = 0; i < Math.min(k, sorted.length); i += 1) {
    idcg += (Math.pow(2, sorted[i]) - 1) / Math.log2(i + 2);
  }
  return idcg;
}

function evaluateQuery(retrievedDocIds: string[], relevant: Map<string, number>, k: number): BenchmarkMetrics {
  const topK = retrievedDocIds.slice(0, k);
  const hits = topK.filter((docId) => (relevant.get(docId) || 0) > 0).length;
  const recallAtK = relevant.size === 0 ? 0 : hits / relevant.size;

  const dcg = calcDcg(topK, relevant, k);
  const idcg = calcIdcg(relevant, k);
  const ndcgAtK = idcg === 0 ? 0 : dcg / idcg;

  let mrrAtK = 0;
  for (let i = 0; i < topK.length; i += 1) {
    if ((relevant.get(topK[i]) || 0) > 0) {
      mrrAtK = 1 / (i + 1);
      break;
    }
  }

  return { recallAtK, ndcgAtK, mrrAtK };
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

async function main(): Promise<void> {
  loadEnvironment();

  const { ContextualSearchRLM } = await import(
    "../services/search/contextual-search-rlm.js"
  );

  const opts = parseArgs(process.argv);
  const datasetDir = path.resolve(opts.datasetDir);
  const corpusPath = path.join(datasetDir, "corpus.jsonl");
  const queriesPath = path.join(datasetDir, "queries.jsonl");
  const qrelsPath = path.join(datasetDir, "qrels", "test.tsv");

  const [corpus, queries, qrels] = await Promise.all([
    readJsonl<BeirCorpusEntry>(corpusPath),
    readJsonl<BeirQueryEntry>(queriesPath),
    readQrels(qrelsPath),
  ]);

  const queryById = new Map<string, string>(queries.map((q) => [q._id, q.text]));
  const queryIds = [...qrels.keys()].filter((id) => queryById.has(id));
  const selectedQueryIds = opts.maxQueries ? queryIds.slice(0, opts.maxQueries) : queryIds;

  if (selectedQueryIds.length === 0) {
    throw new Error("No evaluable queries found in qrels/test.tsv");
  }

  const tempProjectPath = path.join(os.tmpdir(), `massa-ai-beir-${opts.datasetName}`);
  await fs.rm(tempProjectPath, { recursive: true, force: true });
  await materializeCorpus(corpus, tempProjectPath);

  console.log("BEIR benchmark starting...");
  console.log(`Dataset: ${opts.datasetName}`);
  console.log(`Corpus docs: ${corpus.length}`);
  console.log(`Queries to evaluate: ${selectedQueryIds.length}`);
  console.log(`Top-K: ${opts.k}`);
  console.log(`Project ID: ${opts.projectId}`);
  console.log(`Temp corpus path: ${tempProjectPath}`);

  const search = new ContextualSearchRLM();

  if (opts.forceReindex) {
    await search.clearProjectIndex(opts.projectId);
  }

  const indexStart = Date.now();
  const indexStats = await search.indexProject(tempProjectPath, opts.projectId);
  const indexMs = Date.now() - indexStart;

  console.log(`Indexed ${indexStats.filesIndexed} files / ${indexStats.chunksIndexed} chunks in ${indexMs}ms`);

  const recallScores: number[] = [];
  const ndcgScores: number[] = [];
  const mrrScores: number[] = [];
  const latencies: number[] = [];

  for (const queryId of selectedQueryIds) {
    const queryText = queryById.get(queryId) || "";
    const relevant = qrels.get(queryId) || new Map<string, number>();

    const start = Date.now();
    const rawResults = await search.search(queryText, opts.projectId, {
      maxResults: Math.max(opts.k * 2, 20),
      minScore: opts.minScore,
    });
    latencies.push(Date.now() - start);

    const retrievedDocIds = uniqueDocIds(rawResults);
    const metrics = evaluateQuery(retrievedDocIds, relevant, opts.k);
    recallScores.push(metrics.recallAtK);
    ndcgScores.push(metrics.ndcgAtK);
    mrrScores.push(metrics.mrrAtK);
  }

  const result = {
    dataset: opts.datasetName,
    projectId: opts.projectId,
    evaluatedQueries: selectedQueryIds.length,
    k: opts.k,
    metrics: {
      [`Recall@${opts.k}`]: avg(recallScores),
      [`nDCG@${opts.k}`]: avg(ndcgScores),
      [`MRR@${opts.k}`]: avg(mrrScores),
    },
    performance: {
      indexingMs: indexMs,
      avgQueryLatencyMs: avg(latencies),
      p95QueryLatencyMs: [...latencies].sort((a, b) => a - b)[
        Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))
      ],
    },
  };

  console.log("\n=== BEIR RESULT ===");
  console.log(JSON.stringify(result, null, 2));

  if (!opts.keepTemp) {
    await fs.rm(tempProjectPath, { recursive: true, force: true });
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("BEIR benchmark failed:", error);
  process.exit(1);
});

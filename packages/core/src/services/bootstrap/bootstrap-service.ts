/**
 * BootstrapService — Phase 4 repo bootstrap (G6).
 *
 * Scans a project root for high-signal context (recent git history, README,
 * docs, package manifests, top-central files from the existing PageRank ETL)
 * and turns them into seed memories (types pattern/code/decision) via the
 * Phase-1 llm-client. Stored through the existing MemoryRepository so they
 * are searchable by the existing recall/FTS path.
 *
 * Contract (spec.md R1–R6, NF1–NF2):
 *  - Idempotent: a seed memory tagged `bootstrap:<projectId>` is the marker;
 *    a second run without `force` is a no-op.
 *  - Silent degradation: when the LLM is off / `{ok:false}` / throws, falls
 *    back to rule-based minimal seeds derived from README + git log. When
 *    even those signals are empty, skips seeding with a logged reason.
 *    NEVER throws.
 *  - Migration-free: seed memories are rows in the existing memories table.
 *
 * Test-isolation (mirrors Phase-3 ObservationConsolidationJob): the ctor
 * accepts injectable `memoryRepo`, `llm` (LlmSurface), `isBootstrapped`,
 * `symbolGraph`, and `gitRunner` seams. Defaults resolve lazily at run time
 * so the closed-MemoryRepository-singleton landmine (memory-crud.test.ts)
 * does not poison bootstrap tests.
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { z } from "zod";
import { config, logger, MemoryLevel, MemoryType } from "@th0th-ai/shared";
import { getMemoryRepository } from "../../data/memory/memory-repository-factory.js";
import type { InsertMemoryInput } from "../../data/memory/memory-repository.js";
import { eventBus } from "../events/event-bus.js";
import { llm as defaultLlmSurface } from "../memory/llm-client.js";
import type { LlmSurface } from "../memory/consolidator.js";
import { symbolGraphService } from "../symbol/symbol-graph.service.js";

// ── Public types ─────────────────────────────────────────────────────────────

export type SeedType = "pattern" | "code" | "decision";

export interface BootstrapSeed {
  summary: string;
  type: SeedType;
  level: 0 | 1 | 2; // PERSISTENT | PROJECT | USER
  importance: number; // [0,1]
  rationale?: string;
}

export interface BootstrapSignals {
  gitLog: string[];
  readme?: string;
  docs: Array<{ path: string; snippet: string }>;
  manifests: Array<{
    kind: string;
    name?: string;
    description?: string;
    deps?: string[];
  }>;
  centralFiles: Array<{ filePath: string; score: number }>;
}

export type BootstrapSource = "llm" | "rule-based" | "none";

export interface BootstrapResult {
  bootstrapped: boolean;
  reason?: string;
  skipped?: boolean;
  source: BootstrapSource;
  bootstrapId?: string;
  seedMemoryIds: string[];
  signalCount: number;
  memoryCount: number;
}

export interface BootstrapOptions {
  projectPath?: string;
  force?: boolean;
}

/**
 * Injectable memory-repository seam. The default implementation resolves
 * getMemoryRepository() lazily inside each method (test-isolation).
 */
export interface MemoryRepoSeam {
  insert(input: InsertMemoryInput): void | Promise<void>;
  /** Whether any non-deleted memory tagged `bootstrap:<projectId>` exists. */
  hasBootstrapMarker(projectId: string): boolean;
}

/** Centrality source — narrowed SymbolGraphService surface. */
export interface CentralitySource {
  getTopCentralFiles(
    projectId: string,
    limit?: number,
  ): Promise<Array<{ filePath: string; score: number; updatedAt: number }>>;
}

/** Git runner — narrowed surface so tests inject a fake (no subprocess). */
export interface GitRunner {
  (
    cwd: string,
    args: string[],
  ): Promise<{ ok: boolean; stdout: string; stderr?: string }>;
}

export interface BootstrapDeps {
  llm?: LlmSurface;
  memoryRepo?: MemoryRepoSeam;
  isBootstrapped?: (projectId: string) => boolean;
  symbolGraph?: CentralitySource;
  gitRunner?: GitRunner;
}

// ── Config reader (defensive — mirrors Phase-2/3 fallback pattern) ───────────

const FALLBACK_BOOTSTRAP = {
  enabled: true,
  maxSeedMemories: 8,
  centralityLimit: 10,
  gitLogLimit: 20,
  refreshEnabled: true,
};

function readBootstrapConfig() {
  try {
    const c = (config.get("memory") as any)?.bootstrap;
    if (c && typeof c === "object") {
      return {
        enabled: c.enabled ?? FALLBACK_BOOTSTRAP.enabled,
        maxSeedMemories: c.maxSeedMemories ?? FALLBACK_BOOTSTRAP.maxSeedMemories,
        centralityLimit: c.centralityLimit ?? FALLBACK_BOOTSTRAP.centralityLimit,
        gitLogLimit: c.gitLogLimit ?? FALLBACK_BOOTSTRAP.gitLogLimit,
        refreshEnabled: c.refreshEnabled ?? FALLBACK_BOOTSTRAP.refreshEnabled,
      };
    }
  } catch {
    /* fall through */
  }
  return FALLBACK_BOOTSTRAP;
}

// ── Constants ────────────────────────────────────────────────────────────────

const README_CANDIDATES = ["README.md", "README.markdown", "README", "readme.md", "readme"];
const MANIFEST_FILES = ["package.json", "Cargo.toml", "pyproject.toml", "go.mod"];
const MAX_README_BYTES = 4 * 1024;
const MAX_DOC_BYTES = 2 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024;
const MAX_DOCS = 5;
const MAX_SUMMARY_CHARS = 512;

// ── LLM schema ───────────────────────────────────────────────────────────────

const SeedMemorySchema = z.object({
  summary: z.string().min(1).max(MAX_SUMMARY_CHARS),
  type: z.enum(["pattern", "code", "decision"]),
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  importance: z.number().min(0).max(1),
  rationale: z.string().optional(),
});

/**
 * zod schema for the LLM object call. A bounded list of seed memories.
 * Exported for tests + consumers that want the same contract.
 */
export const SeedMemoriesSchema = z.object({
  memories: z.array(SeedMemorySchema).max(FALLBACK_BOOTSTRAP.maxSeedMemories),
});
export type SeedMemories = z.infer<typeof SeedMemoriesSchema>;

// ── Service ──────────────────────────────────────────────────────────────────

export class BootstrapService {
  private readonly llm: LlmSurface;
  private readonly memoryRepo: MemoryRepoSeam;
  private readonly isBootstrappedFn: (projectId: string) => boolean;
  private readonly symbolGraph: CentralitySource;
  private readonly gitRunner: GitRunner;

  constructor(deps: BootstrapDeps = {}) {
    this.llm = deps.llm ?? defaultLlmSurface;
    // Lazy resolver so the repo is touched at run time (not ctor time)
    // unless a test injects one. Mirrors observation-consolidation-job.ts:96-97.
    const injectedRepo = deps.memoryRepo;
    this.memoryRepo =
      injectedRepo ??
      ({
        insert: (i: InsertMemoryInput) => getMemoryRepository().insert(i),
        hasBootstrapMarker: (pid: string) => {
          const repo = getMemoryRepository();
          // getDb() exists on the SQLite repo; PG repo lacks it. Fall back to
          // "not bootstrapped" when the seam is unavailable (PG path: a future
          // dedicated bootstrap_state table would replace this).
          const db = (repo as any).getDb;
          if (typeof db !== "function") return false;
          try {
            const row = db
              .call(repo)
              .prepare(
                "SELECT 1 FROM memories WHERE project_id = ? AND tags LIKE ? AND deleted_at IS NULL LIMIT 1",
              )
              .get(pid, `%bootstrap:${pid}%`);
            return !!row;
          } catch {
            return false;
          }
        },
      } as MemoryRepoSeam);
    this.isBootstrappedFn = deps.isBootstrapped ?? ((pid) => this.memoryRepo.hasBootstrapMarker(pid));
    this.symbolGraph = deps.symbolGraph ?? symbolGraphService;
    this.gitRunner = deps.gitRunner ?? defaultGitRunner;
  }

  /**
   * Run a bootstrap pass for `projectId`. Idempotent unless `force`. Never
   * throws (R5 silent degradation).
   */
  async bootstrap(
    projectId: string,
    opts: BootstrapOptions = {},
  ): Promise<BootstrapResult> {
    const cfg = readBootstrapConfig();
    if (!cfg.enabled) {
      return noopResult("bootstrap-disabled");
    }

    // R3 idempotency
    if (!opts.force) {
      try {
        if (this.isBootstrappedFn(projectId)) {
          return { ...noopResult("already-bootstrapped"), skipped: true };
        }
      } catch (e) {
        logger.warn("bootstrap: marker check threw (continuing)", {
          projectId,
          error: (e as Error).message,
        });
      }
    } else if (!cfg.refreshEnabled) {
      return noopResult("refresh-disabled");
    }

    const root = opts.projectPath ?? defaultProjectRoot(projectId);
    const signals = await scanSignals(
      projectId,
      root,
      { gitLogLimit: cfg.gitLogLimit, centralityLimit: cfg.centralityLimit },
      this.symbolGraph,
      this.gitRunner,
    );
    const signalCount = countSignals(signals);

    // R5: empty signal bundle → skip seeding entirely (no LLM call, no store).
    if (signalCount === 0) {
      return { ...noopResult("no-signals"), signalCount };
    }

    // R2 summarize with silent fallback to rule-based (R5)
    let seeds: BootstrapSeed[];
    let source: "llm" | "rule-based";
    let llmOn = false;
    try {
      llmOn = this.llm.isEnabled();
    } catch {
      llmOn = false;
    }
    if (llmOn) {
      const res = await summarizeWithLlm(signals, this.llm, cfg.maxSeedMemories);
      if (res.ok) {
        seeds = res.seeds;
        source = "llm";
      } else {
        seeds = ruleBasedSeed(signals);
        source = "rule-based";
        logger.info("bootstrap: LLM unavailable, used rule-based seeds", {
          projectId,
          reason: res.reason,
        });
      }
    } else {
      seeds = ruleBasedSeed(signals);
      source = "rule-based";
    }

    if (seeds.length === 0) {
      return { ...noopResult("no-signals"), signalCount };
    }

    const capped = seeds.slice(0, cfg.maxSeedMemories);
    const bootstrapId = `boot-${Date.now()}-${randomUUID().slice(0, 8)}`;

    let ids: string[];
    try {
      ids = await storeSeeds(this.memoryRepo, projectId, bootstrapId, capped, signals);
    } catch (e) {
      logger.warn("bootstrap: storeSeeds failed (silent)", {
        projectId,
        error: (e as Error).message,
      });
      return { ...noopResult("insert-failed"), signalCount, source };
    }

    // R4 emit (only on ≥1 stored seed)
    if (ids.length > 0) {
      eventBus.publish("bootstrap:completed", {
        projectId,
        bootstrapId,
        seedMemoryIds: ids,
        source: source === "llm" ? "llm" : "rule-based",
        signalCount,
        memoryCount: ids.length,
      });
    }

    return {
      bootstrapped: ids.length > 0,
      source: ids.length > 0 ? source : "none",
      bootstrapId,
      seedMemoryIds: ids,
      signalCount,
      memoryCount: ids.length,
    };
  }
}

function noopResult(reason: string): BootstrapResult {
  return {
    bootstrapped: false,
    reason,
    source: "none",
    seedMemoryIds: [],
    signalCount: 0,
    memoryCount: 0,
  };
}

// ── Signal gathering (R1) ────────────────────────────────────────────────────

/**
 * Gather repo signals. Every step is best-effort; a failing step yields its
 * empty default. Never throws.
 */
export async function scanSignals(
  _projectId: string,
  projectRoot: string,
  caps: { gitLogLimit: number; centralityLimit: number },
  symbolGraph: CentralitySource,
  gitRunner: GitRunner,
): Promise<BootstrapSignals> {
  const signals: BootstrapSignals = {
    gitLog: [],
    readme: undefined,
    docs: [],
    manifests: [],
    centralFiles: [],
  };

  // git log
  try {
    const res = await gitRunner(projectRoot, ["log", "--oneline", `-n ${caps.gitLogLimit}`]);
    if (res.ok && res.stdout) {
      signals.gitLog = res.stdout
        .split("\n")
        .map((line) => line.replace(/^[0-9a-f]+\s+/, "").trim())
        .filter((s) => s.length > 0)
        .slice(0, caps.gitLogLimit);
    }
  } catch (e) {
    logger.debug("bootstrap scan: git log failed", { error: (e as Error).message });
  }

  // README
  try {
    for (const name of README_CANDIDATES) {
      const p = path.join(projectRoot, name);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const buf = fs.readFileSync(p);
        signals.readme = buf.slice(0, MAX_README_BYTES).toString("utf8");
        break;
      }
    }
  } catch (e) {
    logger.debug("bootstrap scan: README read failed", { error: (e as Error).message });
  }

  // docs (shallow glob, .md only)
  try {
    const docsDir = path.join(projectRoot, "docs");
    if (fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory()) {
      const entries = walkMarkdown(docsDir).slice(0, MAX_DOCS);
      for (const rel of entries) {
        try {
          const buf = fs.readFileSync(rel);
          signals.docs.push({
            path: path.relative(projectRoot, rel),
            snippet: buf.slice(0, MAX_DOC_BYTES).toString("utf8"),
          });
        } catch {
          /* skip unreadable doc */
        }
      }
    }
  } catch (e) {
    logger.debug("bootstrap scan: docs read failed", { error: (e as Error).message });
  }

  // manifests
  try {
    for (const name of MANIFEST_FILES) {
      const p = path.join(projectRoot, name);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
      const raw = fs.readFileSync(p).slice(0, MAX_MANIFEST_BYTES).toString("utf8");
      const kind = name;
      if (name === "package.json") {
        try {
          const pkg = JSON.parse(raw);
          const deps = [
            ...Object.keys(pkg.dependencies || {}),
            ...Object.keys(pkg.devDependencies || {}),
          ].slice(0, 20);
          signals.manifests.push({
            kind,
            name: pkg.name,
            description: pkg.description,
            deps,
          });
          continue;
        } catch {
          /* fall through to raw */
        }
      }
      signals.manifests.push({ kind, description: raw.slice(0, 256) });
    }
  } catch (e) {
    logger.debug("bootstrap scan: manifests read failed", { error: (e as Error).message });
  }

  // centrality (top central files) — no throw if not indexed
  try {
    const files = await symbolGraph.getTopCentralFiles(_projectId, caps.centralityLimit);
    signals.centralFiles = (files || [])
      .map((f) => ({ filePath: f.filePath, score: f.score }))
      .slice(0, caps.centralityLimit);
  } catch (e) {
    logger.debug("bootstrap scan: centrality read failed", { error: (e as Error).message });
  }

  return signals;
}

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  let guard = 0;
  while (stack.length && guard < 1000) {
    guard++;
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

// ── LLM summarization (R2) ───────────────────────────────────────────────────

export async function summarizeWithLlm(
  signals: BootstrapSignals,
  surface: LlmSurface,
  maxSeedMemories: number,
): Promise<{ ok: true; seeds: BootstrapSeed[] } | { ok: false; reason: string }> {
  let llmOn = false;
  try {
    llmOn = surface.isEnabled();
  } catch {
    llmOn = false;
  }
  if (!llmOn) return { ok: false, reason: "llm disabled" };

  const prompt = buildSummarizePrompt(signals, maxSeedMemories);
  try {
    const res = await surface.object(prompt, SeedMemoriesSchema);
    if (!res.ok || !res.value) {
      return { ok: false, reason: res.error || "llm returned no value" };
    }
    const seeds: BootstrapSeed[] = (res.value.memories || []).map((m) => ({
      summary: truncate(m.summary, MAX_SUMMARY_CHARS),
      type: m.type,
      level: m.level,
      importance: m.importance,
      rationale: m.rationale,
    }));
    return { ok: true, seeds: seeds.slice(0, maxSeedMemories) };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

function buildSummarizePrompt(signals: BootstrapSignals, maxSeedMemories: number): string {
  const parts: string[] = [
    "You are bootstrapping an agent's memory for a software project. From the gathered",
    "signals below, produce up to " + maxSeedMemories + " seed memories that capture the",
    "project's architecture, key entrypoints, conventions, and recent direction. Each memory",
    "MUST have type one of {pattern, code, decision}, level one of {0,1,2} (0=file-level,",
    "1=project-level, 2=user-critical — prefer 1), importance in [0,1], and a short summary",
    "(max 512 chars). Return JSON: { memories: [{ summary, type, level, importance, rationale? }] }.",
    "",
    "Signals:",
  ];
  if (signals.gitLog.length > 0) {
    parts.push("Recent git history:\n" + signals.gitLog.map((s) => "- " + s).join("\n"));
  }
  if (signals.readme) {
    parts.push("README (truncated):\n" + truncate(signals.readme, 2048));
  }
  if (signals.docs.length > 0) {
    parts.push(
      "Docs:\n" +
        signals.docs
          .map((d) => "- " + d.path + ": " + truncate(d.snippet, 512))
          .join("\n"),
    );
  }
  if (signals.manifests.length > 0) {
    parts.push(
      "Manifests:\n" +
        signals.manifests
          .map((m) => "- " + m.kind + (m.name ? " (" + m.name + ")" : "") + (m.description ? ": " + truncate(m.description, 256) : ""))
          .join("\n"),
    );
  }
  if (signals.centralFiles.length > 0) {
    parts.push(
      "Top central files (PageRank):\n" +
        signals.centralFiles.map((f) => "- " + f.filePath + " (score=" + f.score.toFixed(3) + ")").join("\n"),
    );
  }
  return parts.join("\n");
}

// ── Rule-based fallback (R5) ─────────────────────────────────────────────────

/**
 * Derive minimal seeds from the cheapest signals without an LLM call.
 * Capped at 3 seeds. Empty when no usable signal exists.
 */
export function ruleBasedSeed(signals: BootstrapSignals): BootstrapSeed[] {
  const seeds: BootstrapSeed[] = [];

  if (signals.readme && signals.readme.trim().length > 0) {
    const para = signals.readme
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    if (para) {
      seeds.push({
        summary: "Project overview: " + truncate(para.replace(/\s+/g, " "), 400),
        type: "pattern",
        level: 1,
        importance: 0.6,
        rationale: "rule-based: README",
      });
    }
  }

  if (signals.gitLog.length > 0) {
    const recent = signals.gitLog.slice(0, 3).join("; ");
    seeds.push({
      summary: "Recent direction: " + truncate(recent, 400),
      type: "decision",
      level: 1,
      importance: 0.6,
      rationale: "rule-based: git log",
    });
  }

  const pkg = signals.manifests.find((m) => m.kind === "package.json" && m.description);
  if (pkg?.description) {
    seeds.push({
      summary: "Package: " + truncate(pkg.description, 400),
      type: "pattern",
      level: 1,
      importance: 0.6,
      rationale: "rule-based: package.json",
    });
  }

  return seeds.slice(0, 3);
}

// ── Store (R2 store + R3 marker) ─────────────────────────────────────────────

export async function storeSeeds(
  memoryRepo: MemoryRepoSeam,
  projectId: string,
  bootstrapId: string,
  seeds: BootstrapSeed[],
  signals: BootstrapSignals,
): Promise<string[]> {
  const ids: string[] = [];
  const signalCount = countSignals(signals);
  for (const seed of seeds) {
    const id = `seed-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const input: InsertMemoryInput = {
      id,
      content: truncate(seed.summary, MAX_SUMMARY_CHARS),
      type: seedTypeToMemoryType(seed.type),
      level: seedLevelToMemoryLevel(seed.level),
      projectId,
      importance: clamp(seed.importance, 0, 1),
      tags: ["bootstrap", `bootstrap:${projectId}`],
      embedding: [],
      metadata: {
        source: "bootstrap",
        bootstrapId,
        rationale: seed.rationale,
        seedType: seed.type,
        signalCount,
      },
      pinned: false,
    };
    await Promise.resolve(memoryRepo.insert(input));
    ids.push(id);
  }
  return ids;
}

function seedTypeToMemoryType(t: SeedType): MemoryType {
  switch (t) {
    case "pattern":
      return MemoryType.PATTERN;
    case "code":
      return MemoryType.CODE;
    case "decision":
      return MemoryType.DECISION;
  }
}

function seedLevelToMemoryLevel(l: 0 | 1 | 2): MemoryLevel {
  switch (l) {
    case 0:
      return MemoryLevel.PERSISTENT;
    case 1:
      return MemoryLevel.PROJECT;
    case 2:
      return MemoryLevel.USER;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function countSignals(s: BootstrapSignals): number {
  let n = 0;
  if (s.gitLog.length > 0) n++;
  if (s.readme) n++;
  if (s.docs.length > 0) n++;
  if (s.manifests.length > 0) n++;
  if (s.centralFiles.length > 0) n++;
  return n;
}

function truncate(s: string, max: number): string {
  if (!s) return s;
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function defaultProjectRoot(projectId: string): string {
  // Best-effort: cwd. A future enhancement resolves the indexed workspace path.
  try {
    return process.cwd();
  } catch {
    return projectId;
  }
}

/**
 * Default git runner — spawns `git` in `cwd`. Never throws; returns
 * `{ ok:false }` on error (e.g. not a git repo, git missing).
 */
const defaultGitRunner: GitRunner = (cwd, args) =>
  new Promise((resolve) => {
    try {
      const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => resolve({ ok: false, stdout: "", stderr: e.message }));
      child.on("close", (code) =>
        resolve({ ok: code === 0, stdout, stderr }),
      );
    } catch (e) {
      resolve({ ok: false, stdout: "", stderr: (e as Error).message });
    }
  });

// ── Singleton ────────────────────────────────────────────────────────────────

let cachedService: BootstrapService | null = null;

export function getBootstrapService(): BootstrapService {
  if (!cachedService) cachedService = new BootstrapService();
  return cachedService;
}

export function resetBootstrapService(): void {
  cachedService = null;
}

export const bootstrapService: BootstrapService = new BootstrapService();

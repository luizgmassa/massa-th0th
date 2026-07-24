/**
 * Impact Analysis Service (Phase 4 D3)
 *
 * Given a git diff scope (unstaged / staged / committed-vs-base), compute the
 * set of symbols whose callers or dependents are affected by the change, and
 * rank them by a risk score derived from PageRank centrality (blast radius)
 * and graph distance (closer = riskier).
 *
 * Approach (ported-and-rewritten from codebase-memory-mcp's `detect_changes`
 * concept; that reference only mapped files→symbols — the reverse-traversal
 * and risk scoring here are fresh):
 *
 *   1. Run a SCOPED `git diff --name-only` to get changed files (never the
 *      whole repo; the diff runner is injectable for tests).
 *   2. Map each changed file → symbols defined there (listDefinitions).
 *   3. REVERSE-traverse the dependency graph to find impacted consumers:
 *        - File level: who imports the changed file? (symbol_imports reverse)
 *        - Symbol level: who references the changed symbols? (get_references)
 *      These two are the reliable CROSS-FILE signals. Typed CALL edges (D1)
 *      are same-file only, so they are a secondary refinement, not the spine.
 *   4. Propagate impact by `depth` over the reverse file-import graph.
 *   5. Score each impacted symbol: risk = centralityWeight + proximityWeight
 *      (centrality of the impacted file; closer hops weigh more).
 *   6. Sort descending, cap the result count.
 *
 * Cost is bounded by MAX_DEPTH, MAX_IMPACTED, and a visited set so a patho-
 * logical fan-out cannot exhaust memory/time.
 */

import { execFileSync } from "node:child_process";
import { logger, config } from "@massa-ai/shared";
import { getSymbolRepository } from "../../data/symbol/symbol-repository-factory.js";
import type { SymbolDefinition } from "../../data/symbol/symbol-repository-pg.js";
import { validateGitRef } from "./git-ref-validation.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ImpactScope = "unstaged" | "staged" | "committed" | "all";

/**
 * Result shape of the diff runner (N7). `paths` is the deduped set of changed
 * files (tracked + untracked, minus secret-like untracked files). `untrackedFiltered`
 * counts how many untracked paths were excluded by the secrets denylist so
 * the response can surface it (`untracked_filtered`).
 */
export interface DiffRunnerResult {
  paths: string[];
  untrackedFiltered: number;
}

export interface ImpactAnalysisOptions {
  projectId: string;
  /** Absolute path to the project working tree (where `git` runs). */
  projectPath: string;
  /** What diff to analyze. */
  scope: ImpactScope;
  /** For committed scope: diff against this branch (default "main"). */
  baseBranch?: string;
  /** For committed scope: commits since this date/ref (e.g. "2026-07-01" or a SHA). */
  since?: string;
  /** How far to propagate impact through the reverse import graph. Default 2. */
  depth?: number;
  /** Optional filter — only consider these changed paths (relative). */
  paths?: string[];
  /** Injectable diff runner (tests pass a stub; production runs real git). */
  diffRunner?: (
    projectPath: string,
    scope: ImpactScope,
    baseBranch?: string,
    since?: string,
  ) => DiffRunnerResult;
  /**
   * Injectable symbol repository (tests pass an instrumented stub; production
   * resolves the singleton via {@link getSymbolRepository}). Using this seam
   * instead of `mock.module` on the factory avoids a process-wide mock that
   * leaks into concurrently-run sibling suites (which then crash the ETL
   * pipeline with "clearProject is not a function" on the real repo).
   */
  repoOverride?: ReturnType<typeof getSymbolRepository>;
  /**
   * Wall-clock budget (ms) for the reverse-BFS. If exceeded, the traversal
   * aborts with `truncated=true` and the impacted set collected so far.
   * Additive to MAX_DEPTH / MAX_IMPACTED / MAX_DEF_QUERIES. Default 5s.
   * Injectable clock is for deterministic tests.
   */
  deadlineMs?: number;
  /** Injectable clock (defaults to Date.now) for deterministic deadline tests. */
  now?: () => number;
}

export interface ChangedFile {
  /** Relative path inside the project (matches symbol_definitions.file_path). */
  path: string;
  /** Symbols defined in this file. */
  symbols: { fqn: string; name: string; kind: string; line: number }[];
}

export interface ImpactedSymbol {
  /** The impacted consumer symbol (a caller/dependent of the changed code). */
  fqn: string;
  name: string;
  file: string;
  line: number;
  /** Hop distance from the nearest changed file (0 = directly imports it). */
  depth: number;
  /** PageRank centrality of the impacted symbol's file (0–1). */
  centrality: number;
  /** Computed risk score (higher = riskier). Sorted descending. */
  risk: number;
  /** Human-readable reason this symbol is impacted. */
  reason: string;
  /** Which changed file/symbol reaches it. */
  via: { changedFile: string; changedSymbol?: string; edge: "import" | "reference" };
}

export interface ImpactAnalysisResult {
  projectId: string;
  scope: ImpactScope;
  baseBranch?: string;
  since?: string;
  depth: number;
  changedFiles: ChangedFile[];
  impacted: ImpactedSymbol[];
  truncated: boolean;
  /** Number of untracked new files excluded from the diff because they
   * matched the secrets denylist (e.g. `.env*`, `*.key`, `*.pem`). Surfaced
   * so agents can see that a secret was deliberately filtered (N7 AC 9a). */
  untrackedFiltered: number;
  /**
   * N4: pre-clamp total of unique impacted FQNs (the count we would have
   * returned if MAX_IMPACTED did not apply). `impacted_shown = impacted.length`
   * and `impacted_omitted = impacted_total - impacted_shown` are derivable
   * on the same code path as the displayed list.
   */
  impacted_total: number;
  impacted_shown: number;
  impacted_omitted: number;
  /**
   * Wave 5 FR-03 / N41: quotient rollup of impacted files by 2-segment path
   * prefix. Cap DEFAULT_MODULE_CAP prefixes; overflow folds into `(other)`.
   * Same emitter as impacted_total/shown/omitted so the counts are consistent.
   * Undefined when there are no impacted files (backward-compat).
   */
  impacted_modules?: { prefix: string; count: number }[];
  /** Diagnostic when git produced no output (e.g. clean tree). */
  note?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 4;
/** Cap on impacted-symbol results returned. */
const MAX_IMPACTED = 100;
/**
 * Wave 5 FR-03 / N41: cap on the number of 2-segment path prefixes surfaced in
 * `impacted_modules`. Prefixes past this cap fold into an `(other)` overflow
 * entry so the rollup stays bounded and readable. Default 20.
 */
const DEFAULT_MODULE_CAP = 20;
/**
 * Cap on the number of listDefinitionsByFile queries a single analyze() call
 * may issue (across the whole reverse-import BFS). Without it, a dense hub
 * topology can fan out into thousands of per-file definition queries even with
 * a small depth. The cache dedupes repeats; this caps the unique-file work.
 */
const MAX_DEF_QUERIES = 500;
/**
 * Default wall-clock budget for a single analyze() reverse-BFS. Additive to
 * the caps above: a runaway traversal aborts with partial impacted results
 * instead of hanging. 5s is generous vs typical sub-second walks, so unset
 * behaviour is unchanged for normal queries.
 */
const DEFAULT_TRAVERSAL_DEADLINE_MS = 5_000;
/** Centrality weight in the risk formula (centrality ∈ [0,1]). */
const W_CENTRALITY = 0.6;
/** Proximity weight — closer hops weigh higher (proximity = 1/(depth+1)). */
const W_PROXIMITY = 0.4;

const TEST_FILE_RE = /(^|\/)(test|tests|spec|specs|__tests__)(\/|$)|(\.|_|-)(test|spec)\.(t|j)sx?$/i;

// ─── Wave 5 FR-05 / N3: BFS CTE behind-flag helper ─────────────────────────────
// When MASSA_AI_IMPACT_BFS_CTE=true (config.impact.bfsCteEnabled), impact
// analysis skips the TS reverse-import BFS (buildReverseImportGraph + the
// queue loop in step 5a) and uses the single recursive CTE `runBfsCteImpact`
// instead. Parity gated by impact-bfs-parity.test.ts: same FQN set; depths may
// differ by ≤1 hop on cyclic graphs (AD-W5-018). Default false — additive.
function readBfsCteFlag(): boolean {
  try {
    return Boolean(config.get("impact")?.bfsCteEnabled);
  } catch {
    return false;
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ImpactAnalysisService {
  private static instance: ImpactAnalysisService | null = null;

  private constructor() {}

  static getInstance(): ImpactAnalysisService {
    if (!ImpactAnalysisService.instance) {
      ImpactAnalysisService.instance = new ImpactAnalysisService();
    }
    return ImpactAnalysisService.instance;
  }

  /**
   * Run the impact analysis. See {@link ImpactAnalysisOptions}.
   */
  async analyze(opts: ImpactAnalysisOptions): Promise<ImpactAnalysisResult> {
    const projectId = opts.projectId;
    const scope = opts.scope;
    const depth = Math.max(0, Math.min(MAX_DEPTH, opts.depth ?? DEFAULT_DEPTH));
    const repo = opts.repoOverride ?? getSymbolRepository();
    // Wall-clock deadline: an additive guard so a runaway reverse-BFS aborts
    // with partial impacted results instead of hanging. The default is
    // generous; normal queries never reach it. Clock is injectable for tests.
    const now = opts.now ?? Date.now;
    const deadlineAt = now() + (opts.deadlineMs ?? DEFAULT_TRAVERSAL_DEADLINE_MS);

    // ── 1. Changed files (scoped git diff) ──────────────────────────────────
    const runDiff = opts.diffRunner ?? defaultDiffRunner;
    const diffResult = runDiff(opts.projectPath, scope, opts.baseBranch, opts.since);
    let changedPaths = diffResult.paths;
    const untrackedFiltered = diffResult.untrackedFiltered;

    // Optional path filter (relative).
    if (opts.paths && opts.paths.length > 0) {
      const want = new Set(opts.paths);
      changedPaths = changedPaths.filter((p) => want.has(p));
    }
    // Only keep files we actually indexed (source files). Drop deletions/dirs.
    const indexedFiles = new Set(await this.allIndexedFiles(repo, projectId));
    changedPaths = changedPaths.filter((p) => indexedFiles.has(p));

    if (changedPaths.length === 0) {
      return {
        projectId,
        scope,
        baseBranch: opts.baseBranch,
        since: opts.since,
        depth,
        changedFiles: [],
        impacted: [],
        truncated: false,
        untrackedFiltered,
        impacted_total: 0,
        impacted_shown: 0,
        impacted_omitted: 0,
        note: "No indexed source files in the diff (clean tree, or only non-source changes).",
      };
    }

    // ── 2. Map changed files → symbols defined there ────────────────────────
    const changedFiles: ChangedFile[] = [];
    const changedFileSet = new Set(changedPaths);
    // changedSymbolByFile: file → [{fqn,name}] for reference-backbone traversal.
    const changedSymbols = new Map<string, { fqn: string; name: string }[]>();
    // Per-analyze definitions cache: file → definitions. The reverse-import BFS
    // calls listDefinitionsByFile per importer per hop; without a cache the same
    // hub file gets re-queried on every changed-file frontier. The cache also
    // bounds total unique-file queries at MAX_DEF_QUERIES so a pathological fan-
    // out can't issue thousands of queries even at small depth.
    const defCache = new Map<string, SymbolDefinition[]>();
    const cachedDefs = async (file: string): Promise<SymbolDefinition[]> => {
      if (defCache.has(file)) return defCache.get(file)!;
      if (defCache.size >= MAX_DEF_QUERIES) return [];
      const d = await this.listDefinitionsByFile(repo, projectId, file);
      defCache.set(file, d);
      return d;
    };
    for (const file of changedPaths) {
      const defs = await cachedDefs(file);
      const syms = defs.map((d) => ({
        fqn: d.id,
        name: d.name,
        kind: d.kind,
        line: d.line_start,
      }));
      changedFiles.push({ path: file, symbols: syms });
      changedSymbols.set(file, syms.map((s) => ({ fqn: s.fqn, name: s.name })));
    }

    // ── 3. Build the reverse import graph (file-level dependents) ───────────
    // importerOf: file → set of files that import it (the reverse of symbol_imports).
    // Wave 5 FR-05: when MASSA_AI_IMPACT_BFS_CTE=true, skip building the
    // TS reverse graph and use runBfsCteImpact (single recursive CTE) instead.
    // The CTE returns { file, hop }[] directly, so step 5a uses that list
    // instead of walking importerOf. Parity gated by impact-bfs-parity.test.ts.
    const bfsCteEnabled = readBfsCteFlag();
    const importerOf = bfsCteEnabled
      ? new Map<string, string[]>()
      : await this.buildReverseImportGraph(repo, projectId);
    // CTE path: one call for all changed files (multi-source BFS). NULL guard
    // is inside runBfsCteImpact (WHERE file_id IS NOT NULL per AD-W5-018).
    const cteImpact = bfsCteEnabled
      ? await repo.runBfsCteImpact(projectId, changedPaths, {
          depth,
          maxImpacted: MAX_IMPACTED,
        })
      : [];

    // ── 4. Centrality lookup ────────────────────────────────────────────────
    const centrality = await this.getCentralityMap(repo, projectId);
    const maxCentrality = Math.max(0.0001, ...centrality.values());

    // ── 5. Reverse-traverse: find impacted consumers ────────────────────────
    const impacted = new Map<string, ImpactedSymbol>();
    let truncated = false;
    // N4: pre-clamp total of unique impacted FQNs. Increment on every NEW
    // FQN encountered (regardless of whether MAX_IMPACTED let us store it)
    // so impacted_omitted = impacted_total - impacted_shown is derivable.
    let impactedTotal = 0;

    const addImpact = (sym: ImpactedSymbol) => {
      // Keep the strongest (lowest depth / highest risk) entry per impacted FQN.
      const existing = impacted.get(sym.fqn);
      if (existing) {
        if (sym.risk > existing.risk || sym.depth < existing.depth) {
          impacted.set(sym.fqn, { ...existing, ...sym, reason: sym.reason });
        }
        return;
      }
      // New FQN — count it toward the pre-clamp total even if we don't store it.
      impactedTotal++;
      if (impacted.size >= MAX_IMPACTED) {
        truncated = true;
        return;
      }
      impacted.set(sym.fqn, sym);
    };

    // (a) File-level: BFS over reverse import graph from each changed file.
    if (bfsCteEnabled) {
      // CTE path (Wave 5 FR-05): runBfsCteImpact already returned { file, hop }[]
      // for all changed files in one recursive CTE. Emit impacted symbols for
      // each file at its minimum hop, attributing the changed file that seeded
      // the walk. Min-hop attribution: the CTE groups by file_id with MIN(hop);
      // we attribute to the first changed file in changedPaths for stable output
      // (the parity test asserts FQN-set equivalence with the TS path, not
      // per-file attribution, per AD-W5-018).
      for (const { file, hop } of cteImpact) {
        if (now() >= deadlineAt) {
          truncated = true;
          break;
        }
        // Skip the seed files themselves at hop 0 (they are the changed files,
        // not impacted consumers). The CTE includes them with hop=0; mirror
        // the TS path which seeds visited={} with changedFile and never
        // re-emits it as impacted.
        if (hop === 0) continue;
        const consumerDefs = await cachedDefs(file);
        for (const d of consumerDefs) {
          if (TEST_FILE_RE.test(file) && d.exported === false) continue;
          const c = (centrality.get(file) ?? 0) / maxCentrality;
          const proximity = 1 / (hop + 1);
          const risk = W_CENTRALITY * c + W_PROXIMITY * proximity;
          addImpact({
            fqn: d.id,
            name: d.name,
            file,
            line: d.line_start,
            depth: hop,
            centrality: Number(c.toFixed(4)),
            risk: Number(risk.toFixed(4)),
            reason: `impacted via CTE BFS at hop ${hop}`,
            via: { changedFile: changedPaths[0] ?? file, edge: "import" },
          });
        }
      }
    } else {
      // TS reverse-import BFS path (default).
      for (const changedFile of changedPaths) {
        const visited = new Set<string>([changedFile]);
        const queue: Array<{ file: string; hop: number }> = [
          { file: changedFile, hop: 0 },
        ];
        while (queue.length > 0) {
          const { file, hop } = queue.shift()!;
          if (hop >= depth) continue;
          // Wall-clock deadline: abort mid-traversal with partial impacted
          // results so a runaway reverse-BFS never hangs. O(1) per iteration.
          if (now() >= deadlineAt) {
            truncated = true;
            break;
          }
          const importers = importerOf.get(file) ?? [];
          for (const imp of importers) {
            if (visited.has(imp)) continue;
            visited.add(imp);
            // Symbols in the importer file are impacted (they may consume the change).
            // Use the per-analyze cache so a hub file imported by many changed
            // files is queried once, not once-per-frontier.
            const consumerDefs = await cachedDefs(imp);
            for (const d of consumerDefs) {
              if (TEST_FILE_RE.test(imp) && d.exported === false) continue;
              const c = (centrality.get(imp) ?? 0) / maxCentrality; // normalize 0–1
              const proximity = 1 / (hop + 1);
              const risk = W_CENTRALITY * c + W_PROXIMITY * proximity;
              addImpact({
                fqn: d.id,
                name: d.name,
                file: imp,
                line: d.line_start,
                depth: hop + 1,
                centrality: Number(c.toFixed(4)),
                risk: Number(risk.toFixed(4)),
                reason: `imports changed file '${changedFile}'`,
                via: { changedFile, edge: "import" },
              });
            }
            queue.push({ file: imp, hop: hop + 1 });
          }
        }
      }
    }

    // (b) Symbol-level: who references the changed symbols? (cross-file refs)
    for (const [file, syms] of changedSymbols) {
      for (const sym of syms) {
        let refs: { from_file: string; from_line: number; symbol_name: string }[] = [];
        try {
          // Exact identity only: name fallback would merge overloads.
          refs = await repo.findReferencesByFqn(projectId, sym.fqn);
        } catch {
          continue; // best-effort
        }
        for (const r of refs) {
          if (r.from_file === file) continue; // self-reference in same file
          if (changedFileSet.has(r.from_file)) continue; // another changed file
          // Find a definition at the reference site to anchor the impact.
          const siteDefs = await cachedDefs(r.from_file);
          if (siteDefs.length === 0) continue;
          // Pick the definition nearest (after) the reference line.
          const anchor = siteDefs
            .filter((d) => d.line_start <= r.from_line)
            .sort((a, b) => b.line_start - a.line_start)[0] ?? siteDefs[0];
          const c = (centrality.get(r.from_file) ?? 0) / maxCentrality;
          const risk = W_CENTRALITY * c + W_PROXIMITY * 1; // depth 1 (direct ref)
          addImpact({
            fqn: anchor.id,
            name: anchor.name,
            file: r.from_file,
            line: anchor.line_start,
            depth: 1,
            centrality: Number(c.toFixed(4)),
            risk: Number(risk.toFixed(4)),
            reason: `references changed symbol '${sym.name}'`,
            via: { changedFile: file, changedSymbol: sym.name, edge: "reference" },
          });
        }
      }
    }

    // ── 6. Sort by risk desc, cap ───────────────────────────────────────────
    const ranked = Array.from(impacted.values()).sort((a, b) => b.risk - a.risk);
    const out = ranked.slice(0, MAX_IMPACTED);
    truncated = truncated || ranked.length > MAX_IMPACTED;
    const impactedShown = out.length;
    const impactedOmitted = Math.max(0, impactedTotal - impactedShown);

    // Wave 5 FR-03 / N41: impacted_modules quotient rollup over the FULL
    // pre-clamp impacted set (not just the shown slice) so the rollup reflects
    // total blast radius, not a truncated view. Group by 2-segment path prefix,
    // cap at DEFAULT_MODULE_CAP, fold overflow into `(other)`.
    const impactedModules = computeImpactedModules(ranked, DEFAULT_MODULE_CAP);

    logger.info("ImpactAnalysisService: analyze complete", {
      projectId,
      scope,
      changedFiles: changedPaths.length,
      impacted: out.length,
      impactedTotal,
      truncated,
    });

    return {
      projectId,
      scope,
      baseBranch: opts.baseBranch,
      since: opts.since,
      depth,
      changedFiles,
      impacted: out,
      truncated,
      untrackedFiltered,
      impacted_total: impactedTotal,
      impacted_shown: impactedShown,
      impacted_omitted: impactedOmitted,
      impacted_modules: impactedModules,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** All file paths indexed for the project (relative). */
  private async allIndexedFiles(
    repo: ReturnType<typeof getSymbolRepository>,
    projectId: string,
  ): Promise<string[]> {
    try {
      return await Promise.resolve(repo.allFiles(projectId));
    } catch {
      return [];
    }
  }

  /** Definitions in a single file (kind kept for filtering). */
  private async listDefinitionsByFile(
    repo: ReturnType<typeof getSymbolRepository>,
    projectId: string,
    file: string,
  ): Promise<SymbolDefinition[]> {
    try {
      return await Promise.resolve(repo.listDefinitions(projectId, { file, limit: 200 }));
    } catch {
      return [];
    }
  }

  /**
   * Reverse import graph: importerOf(file) = list of importer file paths for
   * every file that imports `file` (i.e. symbol_imports where to_file === file).
   * Built once from allImportEdges (client-side reverse; PG repo lacks
   * findImporters). PostgreSQL allImportEdges returns a minimal {from_file,to_file}
   * row (no specifier); PG returns full SymbolImport — we coerce to the minimal
   * shape so both backends unify.
   */
  private async buildReverseImportGraph(
    repo: ReturnType<typeof getSymbolRepository>,
    projectId: string,
  ): Promise<Map<string, string[]>> {
    /** Minimal row shape both backends satisfy. */
    type ImpEdge = { from_file: string; to_file?: string | null; is_external?: boolean | number };
    let edges: ImpEdge[] = [];
    try {
      const raw = await Promise.resolve(repo.allImportEdges(projectId));
      edges = (raw as ImpEdge[]).map((e) => ({
        from_file: e.from_file,
        to_file: e.to_file,
        is_external: e.is_external,
      }));
    } catch {
      return new Map();
    }
    const reverse = new Map<string, string[]>();
    for (const e of edges) {
      if (e.is_external || !e.to_file) continue;
      const arr = reverse.get(e.to_file) ?? [];
      arr.push(e.from_file);
      reverse.set(e.to_file, arr);
    }
    return reverse;
  }

  /** PageRank centrality map (file → score). */
  private async getCentralityMap(
    repo: ReturnType<typeof getSymbolRepository>,
    projectId: string,
  ): Promise<Map<string, number>> {
    try {
      return await Promise.resolve(repo.getCentrality(projectId));
    } catch {
      return new Map();
    }
  }
}

// ─── Wave 5 FR-03 / N41: impacted_modules quotient rollup ────────────────────

/**
 * Group impacted files by their 2-segment path prefix (`path/to/file.ts` →
 * `path/to`). Cap at `moduleCap` prefixes (highest count first); fold the
 * overflow into an `(other)` entry. Files with no `/` use the full path as
 * their prefix. The rollup runs over the FULL pre-clamp impacted set so it
 * reflects the total blast radius, not the truncated view.
 *
 * Pure (no I/O); exported for B2/B3 consumption + unit testing.
 */
export function computeImpactedModules(
  impacted: ImpactedSymbol[],
  moduleCap: number = DEFAULT_MODULE_CAP,
): { prefix: string; count: number }[] {
  if (impacted.length === 0) return [];
  const counts = new Map<string, number>();
  for (const s of impacted) {
    const prefix = twoSegmentPrefix(s.file);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  // Sort by count desc, then prefix asc for determinism.
  const sorted = Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  if (sorted.length <= moduleCap) {
    return sorted.map(([prefix, count]) => ({ prefix, count }));
  }
  const head = sorted.slice(0, moduleCap - 1);
  const tail = sorted.slice(moduleCap - 1);
  const otherCount = tail.reduce((sum, [, c]) => sum + c, 0);
  return [
    ...head.map(([prefix, count]) => ({ prefix, count })),
    { prefix: "(other)", count: otherCount },
  ];
}

/**
 * Extract the 2-segment path prefix for the quotient rollup: drop the filename
 * (last segment), then keep up to 2 leading directory segments.
 *
 *   `path/to/file.ts`   → `path/to`   (2 dirs, file dropped)
 *   `a/b/c/d.ts`        → `a/b`       (capped at 2 dirs, file dropped)
 *   `src/a.ts`          → `src`       (1 dir, file dropped)
 *   `root.ts`           → `root.ts`   (no dir → use full path as its own prefix)
 *
 * This groups sibling files (`src/a.ts` + `src/b.ts` → `src`) while bounding
 * deep paths to 2 segments so the rollup stays readable.
 */
function twoSegmentPrefix(filePath: string): string {
  if (!filePath) return filePath;
  const slash = filePath.lastIndexOf("/");
  if (slash < 0) return filePath; // no dir → file is its own prefix
  const dir = filePath.slice(0, slash);
  // Cap at 2 leading segments: `a/b/c` → `a/b`.
  const parts = dir.split("/");
  if (parts.length <= 2) return dir;
  return parts.slice(0, 2).join("/");
}

// ─── Default git diff runner (production) ─────────────────────────────────────

/**
 * Secret-like path patterns excluded from untracked-file inclusion (N7 AC 9a).
 * Pre-mortem finding: untracked secrets not in `.gitignore` must not be
 * disclosed to agent consumers. The denylist is conservative and does NOT
 * rely on `.gitignore` (the user may forget).
 */
const SECRET_PATH_PATTERNS = [
  /\.env/i,        // .env, .env.local, .env.production, foo.env
  /\.key$/i,        // private keys (any extension/name boundary)
  /\.pem$/i,        // PEM certs/keys
  /\.p12$/i,        // PKCS#12 bundles
  /\.pfx$/i,        // PFX bundles
  /^secrets?\./i,   // secrets.json, secret.yaml
  /\.keystore$/i,   // Java keystores
  /^id_rsa/i,      // SSH private keys (id_rsa, id_rsa.pub is .pub — not matched)
  /\.asc$/i,        // armored keys / PGP
];

function isSecretLike(p: string): boolean {
  return SECRET_PATH_PATTERNS.some((re) => re.test(p));
}

/**
 * Run a SCOPED `git diff --name-only` in `projectPath`. Returns relative paths.
 * Scope:
 *   - unstaged:  `git diff --name-only` (+ untracked new files)
 *   - staged:    `git diff --name-only --cached` (+ untracked new files)
 *   - committed: `git diff --name-only <base>...HEAD` (single-source; no untracked)
 *   - all:       committed + unstaged + untracked new files, deduped
 *
 * `scope=unstaged` (default) and `scope=staged` BREAKINGLY now include
 * untracked new files (`git ls-files --others --exclude-standard`), matching
 * the cbm invariant: untracked new files are invisible to `git diff` but are
 * semantically part of the working-tree change. `scope=committed` stays
 * single-source (committed-only) for callers that want the old behavior.
 *
 * Secret-like untracked paths (`.env*`, `*.key`, `*.pem`, `secrets.*`, etc.)
 * are excluded and counted in `untrackedFiltered` (N7 AC 9a). Dedup is via
 * `Set<string>`.
 *
 * `baseBranch`/`since` are validated against git arg-injection (N8) before any
 * `execFileSync` call.
 *
 * Never invoked on the whole repo by the tool — the scope is always bounded.
 * Throws on git failure so the tool can surface a clean error.
 */
export function defaultDiffRunner(
  projectPath: string,
  scope: ImpactScope,
  baseBranch?: string,
  since?: string,
): DiffRunnerResult {
  // N8: validate git refs before any execFileSync. Empty strings are allowed
  // (the caller falls back to "main"); invalid patterns throw ToolError.
  validateGitRef("base_branch", baseBranch ?? "");
  validateGitRef("since", since ?? "");

  const args: string[] = ["-C", projectPath, "diff", "--name-only", "--diff-filter=d"];
  if (scope === "staged") {
    args.push("--cached");
  } else if (scope === "committed" || scope === "all") {
    let ref = baseBranch ?? "main";
    let diffRange: string | undefined;
    if (since) {
      try {
        // A commit-ish (branch, tag, or SHA) can be used directly.
        ref = execFileSync("git", ["-C", projectPath, "rev-parse", "--verify", `${since}^{commit}`], {
          cwd: projectPath,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
      } catch {
        // `since` also accepts a date. Resolve it to the newest commit at or
        // before that date before constructing the diff range; Git does not
        // accept a raw date as the left side of `<ref>...HEAD`.
        ref = execFileSync(
          "git",
          ["-C", projectPath, "rev-list", "-1", `--before=${since}`, "HEAD"],
          {
            cwd: projectPath,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        ).trim();
        if (!ref) {
          // The requested date predates repository history. Diff HEAD against
          // Git's canonical empty tree so every file introduced since that
          // date is included; a three-dot range cannot use a tree as a merge
          // base, so record the explicit two-endpoint range here.
          const emptyTree = execFileSync("git", ["hash-object", "-t", "tree", "--stdin"], {
            cwd: projectPath,
            encoding: "utf-8",
            input: "",
            stdio: ["ignore", "pipe", "pipe"],
          }).trim();
          diffRange = `${emptyTree}..HEAD`;
        }
      }
    }
    args.push(diffRange ?? `${ref}...HEAD`);
  }
  // unstaged: no extra args (working-tree vs index)

  const out = execFileSync("git", args, {
    cwd: projectPath,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
  });
  const tracked = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // N7: merge untracked new files for unstaged/staged/all (NOT committed).
  // committed is single-source; it diffs against a ref and intentionally
  // excludes working-tree-only files.
  const includeUntracked = scope === "unstaged" || scope === "staged" || scope === "all";
  let untrackedFiltered = 0;
  const merged = new Set<string>(tracked);
  if (includeUntracked) {
    const untracked = execFileSync(
      "git",
      ["-C", projectPath, "ls-files", "--others", "--exclude-standard"],
      {
        cwd: projectPath,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 4 * 1024 * 1024,
      },
    )
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const p of untracked) {
      if (isSecretLike(p)) {
        untrackedFiltered++;
        continue;
      }
      merged.add(p);
    }
  }

  return { paths: Array.from(merged), untrackedFiltered };
}

export const impactAnalysisService = ImpactAnalysisService.getInstance();

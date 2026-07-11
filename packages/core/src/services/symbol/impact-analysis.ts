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
import { logger } from "@massa-th0th/shared";
import { getSymbolRepository } from "../../data/sqlite/symbol-repository-factory.js";
import type { SymbolDefinition } from "../../data/sqlite/symbol-repository.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ImpactScope = "unstaged" | "staged" | "committed";

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
  diffRunner?: (projectPath: string, scope: ImpactScope, baseBranch?: string, since?: string) => string[];
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
  /** Diagnostic when git produced no output (e.g. clean tree). */
  note?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 4;
/** Cap on impacted-symbol results returned. */
const MAX_IMPACTED = 100;
/**
 * Cap on the number of listDefinitionsByFile queries a single analyze() call
 * may issue (across the whole reverse-import BFS). Without it, a dense hub
 * topology can fan out into thousands of per-file definition queries even with
 * a small depth. The cache dedupes repeats; this caps the unique-file work.
 */
const MAX_DEF_QUERIES = 500;
/** Centrality weight in the risk formula (centrality ∈ [0,1]). */
const W_CENTRALITY = 0.6;
/** Proximity weight — closer hops weigh higher (proximity = 1/(depth+1)). */
const W_PROXIMITY = 0.4;

const TEST_FILE_RE = /(^|\/)(test|tests|spec|specs|__tests__)(\/|$)|(\.|_|-)(test|spec)\.(t|j)sx?$/i;

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
    const repo = getSymbolRepository();

    // ── 1. Changed files (scoped git diff) ──────────────────────────────────
    const runDiff = opts.diffRunner ?? defaultDiffRunner;
    let changedPaths = runDiff(opts.projectPath, scope, opts.baseBranch, opts.since);

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
    const importerOf = await this.buildReverseImportGraph(repo, projectId);

    // ── 4. Centrality lookup ────────────────────────────────────────────────
    const centrality = await this.getCentralityMap(repo, projectId);
    const maxCentrality = Math.max(0.0001, ...centrality.values());

    // ── 5. Reverse-traverse: find impacted consumers ────────────────────────
    const impacted = new Map<string, ImpactedSymbol>();
    let truncated = false;

    const addImpact = (sym: ImpactedSymbol) => {
      // Keep the strongest (lowest depth / highest risk) entry per impacted FQN.
      const existing = impacted.get(sym.fqn);
      if (existing) {
        if (sym.risk > existing.risk || sym.depth < existing.depth) {
          impacted.set(sym.fqn, { ...existing, ...sym, reason: sym.reason });
        }
        return;
      }
      if (impacted.size >= MAX_IMPACTED) {
        truncated = true;
        return;
      }
      impacted.set(sym.fqn, sym);
    };

    // (a) File-level: BFS over reverse import graph from each changed file.
    for (const changedFile of changedPaths) {
      const visited = new Set<string>([changedFile]);
      const queue: Array<{ file: string; hop: number }> = [
        { file: changedFile, hop: 0 },
      ];
      while (queue.length > 0) {
        const { file, hop } = queue.shift()!;
        if (hop >= depth) continue;
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

    // (b) Symbol-level: who references the changed symbols? (cross-file refs)
    for (const [file, syms] of changedSymbols) {
      for (const sym of syms) {
        let refs: { from_file: string; from_line: number; symbol_name: string }[] = [];
        try {
          // Try FQN first (exact), then name.
          const byFqn = await repo.findReferencesByFqn(projectId, sym.fqn);
          refs = byFqn.length > 0 ? byFqn : await repo.findReferencesByName(projectId, sym.name);
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

    logger.info("ImpactAnalysisService: analyze complete", {
      projectId,
      scope,
      changedFiles: changedPaths.length,
      impacted: out.length,
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
   * findImporters). SQLite allImportEdges returns a minimal {from_file,to_file}
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

// ─── Default git diff runner (production) ─────────────────────────────────────

/**
 * Run a SCOPED `git diff --name-only` in `projectPath`. Returns relative paths.
 * Scope:
 *   - unstaged:  `git diff --name-only`
 *   - staged:    `git diff --name-only --cached`
 *   - committed: `git diff --name-only <base>...HEAD` (since wins if provided:
 *                 `git diff --name-only <since>...HEAD`)
 *
 * Never invoked on the whole repo by the tool — the scope is always bounded.
 * Throws on git failure so the tool can surface a clean error.
 */
export function defaultDiffRunner(
  projectPath: string,
  scope: ImpactScope,
  baseBranch?: string,
  since?: string,
): string[] {
  const args: string[] = ["-C", projectPath, "diff", "--name-only", "--diff-filter=d"];
  if (scope === "staged") {
    args.push("--cached");
  } else if (scope === "committed") {
    const ref = since ?? baseBranch ?? "main";
    args.push(`${ref}...HEAD`);
  }
  // unstaged: no extra args (working-tree vs index)

  const out = execFileSync("git", args, {
    cwd: projectPath,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export const impactAnalysisService = ImpactAnalysisService.getInstance();

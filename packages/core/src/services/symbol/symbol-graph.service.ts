/**
 * Symbol Graph Service
 *
 * High-level API for code navigation operations:
 *   - go_to_definition: resolve where a symbol is declared
 *   - get_references: find all usages of a symbol
 *   - get_dependencies: file import graph (BFS, with depth limit)
 *   - list_definitions: filtered browse of all symbols in a project
 *
 * Also owns centrality recomputation (triggered after ETL completes).
 */

import path from "path";
import fs from "fs/promises";
import {
  logger,
  type ActiveGraphDiagnostics,
} from "@massa-th0th/shared";
import { definitionLookupService, type DefinitionLookupResult } from "./definition-lookup.js";
import { getSymbolRepository } from "../../data/symbol/symbol-repository-factory.js";
import { workspaceManager } from "../workspace/workspace-manager.js";
import type {
  SymbolDefinition,
  SymbolReference,
  SymbolImport,
  CentralityEntry,
  RefKind,
  SymbolKind,
  ProjectMapGraphSnapshot,
} from "../../data/symbol/symbol-repository-pg.js";
import { computePageRank } from "./centrality.js";
import { runLouvain, type WeightedEdge } from "./communities.js";
import {
  computeArchitectureMap,
  type ArchitectureMap,
  type HttpEdgeLite,
  type InternalImport,
  type SymbolDefLite,
} from "./architecture.js";

// ─── Typed-edge types (D1) ────────────────────────────────────────────────────

/** Public edge-type names surfaced by the query layer. */
export type EdgeType = "call" | "data_flow" | "http_call" | "emit" | "listen" | "import" | "type_ref" | "extend" | "implement";

export interface EdgeQueryOptions {
  /** Filter by edge type(s). Omit for all types. */
  types?: EdgeType[];
  /** Source symbol FQN ('rel/path.ts#Name') — restricts to outgoing edges. */
  fromSymbol?: string;
  /** Target symbol FQN — restricts to incoming edges. */
  toSymbol?: string;
  /** Constrain to edges originating from a specific file. */
  fromFile?: string;
  /** Edge direction relative to fromSymbol/toSymbol. Default 'both'. */
  direction?: "outgoing" | "incoming" | "both";
  limit?: number;
}

export interface EdgeResult {
  fromFile: string;
  fromLine: number;
  symbolName: string;
  refKind: string;
  targetFqn?: string;
  /** Typed-edge metadata (route, event, paramIndex, callerFqn). */
  meta?: Record<string, unknown> | null;
}

// ─── Return types ─────────────────────────────────────────────────────────────

export interface DefinitionResult {
  fqn: string;
  name: string;
  kind: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  exported: boolean;
  docComment?: string;
  snippet?: string;
  centralityScore: number;
}

export interface ReferenceResult {
  fromFile: string;
  fromLine: number;
  refKind: string;
  symbolName: string;
  targetFqn?: string;
  context?: string; // 3-line snippet around the reference
}

export interface DependencyNode {
  file: string;
  depth: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  specifier: string;
  importedNames: string[];
  isExternal: boolean;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export interface CentralityResult {
  filePath: string;
  score: number;
  updatedAt: number;
}

export interface ListDefinitionsOptions {
  kind?: string[];
  file?: string;
  exportedOnly?: boolean;
  search?: string;
  limit?: number;
}

export interface ProjectMapResult extends ActiveGraphDiagnostics {
  projectId: string;
  stats: {
    files: number;
    chunks: number;
    symbols: number;
    status: string;
    lastIndexedAt: string | null;
  };
  topCentralFiles: CentralityResult[];
  symbolsByKind: Record<string, number>;
  filesByLanguage: Record<string, number>;
  recentFiles: Array<{ filePath: string; indexedAt: string | null }>;
  /** Counts of typed structural edges grouped by ref_kind (D1). */
  edgesByKind?: Record<string, number>;
  // ─── Architecture intelligence (D4) — additive, optional ────────────────────
  /** Files grouped by top-level package/module boundary. */
  packages?: ArchitectureMap["packages"];
  /** Bootstrap / entry-point candidates. */
  entryPoints?: ArchitectureMap["entryPoints"];
  /** API surface: HTTP routes / handlers. */
  routes?: ArchitectureMap["routes"];
  /** Most-depended-on files (centrality + in-degree + symbol count). */
  hotspots?: ArchitectureMap["hotspots"];
  /** De-facto modules from community detection over the file-import graph. */
  communities?: ArchitectureMap["communities"];
  /** De-facto layers inferred from community structure + fan-in/out. */
  layers?: ArchitectureMap["layers"];
}

export interface GetProjectMapOptions {
  centralityLimit?: number;
  recentLimit?: number;
  /** @internal Deterministic concurrency sensor used by DB-backed tests. */
  afterGenerationCaptured?: (generationId: string | null) => void | Promise<void>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class SymbolGraphService {
  private static instance: SymbolGraphService | null = null;
  private projectRootCache: Map<string, string> = new Map();
  /**
   * Maximum entries retained in projectRootCache. Without a cap, an adversarial
   * caller cycling distinct projectIds grows the map for the process lifetime.
   * Map preserves INSERTION order in JS; we promote a key to most-recently-used
   * on GET via delete+set, and evict the oldest key on SET while over the cap.
   * Mirrors ReadFileTool's FILE_CACHE_MAX_ENTRIES / evictOldest pattern.
   */
  private readonly PROJECT_ROOT_CACHE_MAX_ENTRIES = 512;

  constructor(private readonly identityLookup = definitionLookupService) {}

  static getInstance(): SymbolGraphService {
    if (!SymbolGraphService.instance) {
      SymbolGraphService.instance = new SymbolGraphService();
    }
    return SymbolGraphService.instance;
  }

  /** Returns true if the project has any indexed symbols. */
  async hasData(projectId: string): Promise<boolean> {
    const files = await getSymbolRepository().allFiles(projectId);
    return files.length > 0;
  }

  // ── go_to_definition ────────────────────────────────────────────────────────

  /**
   * Find where a symbol is defined.
   *
   * Disambiguation order when multiple results:
   *   1. Symbols defined in `fromFile` (same-file priority)
   *   2. Symbols defined in direct imports of `fromFile`
   *   3. All other results, sorted by centrality desc
   */
  async goToDefinition(
    projectId: string,
    symbolName: string,
    fromFile?: string,
    resolvedLookup?: DefinitionLookupResult,
  ): Promise<DefinitionResult[]> {
    const repo = getSymbolRepository();
    const lookup = resolvedLookup ?? await this.identityLookup.lookup(projectId, symbolName);
    const defs = lookup.status === "resolved" ? [lookup.definition]
      : lookup.status === "bare" ? [...lookup.definitions] : [];
    const centrality = await repo.getCentrality(projectId);

    if (defs.length === 0) return [];

    // Determine direct imports of fromFile for disambiguation
    const directImportFiles = fromFile
      ? new Set(
          (await repo.findDependencies(projectId, fromFile))
            .filter((imp) => imp.to_file)
            .map((imp) => imp.to_file!),
        )
      : new Set<string>();

    const results = defs.map((def) => this.toDefinitionResult(def, centrality));

    results.sort((a, b) => {
      if (fromFile) {
        const aInFile = a.file === fromFile ? 2 : directImportFiles.has(a.file) ? 1 : 0;
        const bInFile = b.file === fromFile ? 2 : directImportFiles.has(b.file) ? 1 : 0;
        if (aInFile !== bInFile) return bInFile - aInFile;
      }
      return b.centralityScore - a.centralityScore;
    });

    // Enrich top-3 with code snippet
    const top = results.slice(0, 3);
    await Promise.all(
      top.map(async (r) => {
        r.snippet = await this.readSnippet(r.file, r.lineStart, r.lineEnd, projectId);
      }),
    );

    return results;
  }

  /** Stable service-level identity result for callers that need ambiguity details. */
  async lookupDefinition(projectId: string, query: string): Promise<DefinitionLookupResult> {
    return this.identityLookup.lookup(projectId, query);
  }

  // ── get_references ──────────────────────────────────────────────────────────

  /**
   * Find all usage sites of a symbol.
   *
   * Resolves via FQN if provided, otherwise searches by name.
   * Enriches top results with 3-line code context.
   */
  async getReferences(
    projectId: string,
    symbolName: string,
    fqn?: string,
    resolvedLookup?: DefinitionLookupResult,
  ): Promise<ReferenceResult[]> {
    const repo = getSymbolRepository();
    let refs: SymbolReference[];
    if (fqn) {
      const lookup = resolvedLookup ?? await this.identityLookup.lookup(projectId, fqn);
      if (lookup.status === "resolved") {
        const targets = lookup.definition.id === fqn ? [fqn] : [lookup.definition.id, fqn];
        const matches = (await Promise.all(targets.map((target) => repo.findReferencesByFqn(projectId, target)))).flat();
        const seen = new Set<string>();
        refs = matches.filter((reference) => {
          const key = `${reference.from_file}\0${reference.from_line}\0${reference.ref_kind}\0${reference.target_fqn ?? ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } else refs = [];
    } else {
      refs = await repo.findReferencesByName(projectId, symbolName);
    }

    const results: ReferenceResult[] = refs.map((r) => ({
      fromFile: r.from_file,
      fromLine: r.from_line,
      refKind: r.ref_kind,
      symbolName: r.symbol_name,
      targetFqn: r.target_fqn,
    }));

    // Enrich top-20 with code context
    const toEnrich = results.slice(0, 20);
    await Promise.all(
      toEnrich.map(async (r) => {
        r.context = await this.readContext(r.fromFile, r.fromLine, 3, projectId);
      }),
    );

    return results;
  }

  // ── get_edges (typed structural edges — D1) ─────────────────────────────────

  /**
   * Query typed structural edges (CALLS / IMPORTS / DATA_FLOWS / HTTP_CALLS /
   * EMITS / LISTENS) with optional filtering by edge type, source/target
   * symbol, file, and direction.
   *
   * Backed by `symbol_references` rows with typed `ref_kind` values + `meta`.
   * Designed for later trace_path / impact_analysis traversal.
   */
  async getEdges(projectId: string, opts: EdgeQueryOptions = {}): Promise<EdgeResult[]> {
    const repo = getSymbolRepository();
    const refs = await repo.findEdges(projectId, {
      types: opts.types as RefKind[] | undefined,
      fromSymbol: opts.fromSymbol,
      toSymbol: opts.toSymbol,
      fromFile: opts.fromFile,
      direction: opts.direction,
      limit: opts.limit,
    });

    return refs.map((r) => ({
      fromFile: r.from_file,
      fromLine: r.from_line,
      symbolName: r.symbol_name,
      refKind: r.ref_kind,
      targetFqn: r.target_fqn,
      meta: r.meta ?? null,
    }));
  }

  // ── get_dependencies ────────────────────────────────────────────────────────

  /**
   * BFS over the import graph to build a file dependency tree.
   * maxDepth default = 3 to avoid graph explosion.
   */
  async getDependencies(
    projectId: string,
    filePath: string,
    maxDepth = 3,
  ): Promise<DependencyGraph> {
    const visited = new Set<string>();
    const nodes: DependencyNode[] = [];
    const edges: DependencyEdge[] = [];
    const queue: Array<{ file: string; depth: number }> = [{ file: filePath, depth: 0 }];

    while (queue.length > 0) {
      const { file, depth } = queue.shift()!;
      if (visited.has(file)) continue;
      visited.add(file);
      nodes.push({ file, depth });

      if (depth >= maxDepth) continue;

      const deps: SymbolImport[] = await getSymbolRepository().findDependencies(projectId, file);
      for (const dep of deps) {
        edges.push({
          from: file,
          to: dep.to_file ?? dep.specifier,
          specifier: dep.specifier,
          importedNames: dep.imported_names,
          isExternal: dep.is_external,
        });
        if (dep.to_file && !visited.has(dep.to_file)) {
          queue.push({ file: dep.to_file, depth: depth + 1 });
        }
      }
    }

    return { nodes, edges };
  }

  // ── list_definitions ────────────────────────────────────────────────────────

  /**
   * Result of {@link listDefinitions} — the displayed page plus the pre-LIMIT
   * total (N4 correctness bundle, WAVE4-N4). The total is the true count of
   * matching definitions BEFORE the SQL `LIMIT` clamps the page, so callers
   * can emit `definitions_total` / `definitions_shown` / `definitions_omitted`
   * (spec AC 4). The total is computed on the SAME code path (same WHERE
   * clauses) as the displayed list — the cbm invariant from the spec.
   *
   * `total_exact` is `true` when `total` is the exact pre-LIMIT count, and
   * `false` when the match set exceeded the 100k sentinel cap (T10, N4 perf).
   * In the sentinel case `total` is the cap value (100000) — a floor of the
   * true count — so callers can emit `definitions_total_exact: false` per
   * spec AC 4 without scanning the full match set on every query.
   */
  async listDefinitions(
    projectId: string,
    opts: ListDefinitionsOptions = {},
  ): Promise<{
    definitions: DefinitionResult[];
    total: number;
    total_exact: boolean;
  }> {
    const repo = getSymbolRepository();
    const limit = opts.limit ?? 100;
    const [defs, centrality, total] = await Promise.all([
      repo.listDefinitions(projectId, opts),
      repo.getCentrality(projectId),
      repo.countDefinitions(
        projectId,
        opts.search,
        opts.kind as SymbolKind[] | undefined,
        opts.exportedOnly,
        opts.file,
      ),
    ]);
    // T10 (N4 perf): when the match set exceeds the 100k sentinel cap, emit
    // total=cap (a floor) + total_exact:false so callers can surface
    // `definitions_total_exact: false` per spec AC 4. The cap avoids
    // re-fetching the full match set on every query; `COUNT(*)` is itself
    // cheap, but the sentinel signals to clients that the value is a floor,
    // not an exact count. The cap is applied AFTER the count so the exact
    // path stays exact for ≤100k workspaces (the common case).
    const SENTINEL_CAP = 100_000;
    if (total > SENTINEL_CAP) {
      return {
        definitions: defs.map((def) => this.toDefinitionResult(def, centrality)),
        total: SENTINEL_CAP,
        total_exact: false,
      };
    }
    return {
      definitions: defs.map((def) => this.toDefinitionResult(def, centrality)),
      total,
      total_exact: true,
    };
  }

  // ── get_top_central_files ──────────────────────────────────────────────────

  async getTopCentralFiles(projectId: string, limit = 20): Promise<CentralityResult[]> {
    const rows: CentralityEntry[] = await getSymbolRepository().getTopCentralFiles(projectId, limit);
    return rows.map((row) => ({
      filePath: row.file_path,
      score: row.score,
      updatedAt: row.updated_at,
    }));
  }

  // ── project_map ─────────────────────────────────────────────────────────

  /**
   * Aggregate view of a project — stats, central files, symbol breakdown by
   * kind, file count by language extension, and most-recently indexed files.
   * Consumes symbol_files, symbol_definitions, and workspace metadata.
   */
  async getProjectMap(
    projectId: string,
    opts: GetProjectMapOptions = {},
  ): Promise<ProjectMapResult | null> {
    const centralityLimit = opts.centralityLimit ?? 20;
    const recentLimit = opts.recentLimit ?? 10;

    const repo = getSymbolRepository();
    const graphSnapshot = await repo.getProjectMapSnapshot(projectId, {
      centralityLimit,
      recentLimit,
      afterGenerationCaptured: opts.afterGenerationCaptured,
    });
    if (!graphSnapshot) return null;
    const workspace = graphSnapshot.workspace;

    // ── Architecture intelligence (D4) — best-effort, fully isolated. ──────────
    // Every step is wrapped so a failure in any analyzer leaves the existing
    // project_map fields byte-for-byte intact. New fields are additive (only
    // attached when non-empty).
    const arch = await this.computeArchitectureMapSafe(graphSnapshot.architecture).catch(
      (err) => {
        logger.warn("getProjectMap: architecture map failed; skipping", {
          projectId,
          error: (err as Error)?.message?.slice(0, 160),
        });
        return null;
      },
    );

    return {
      projectId,
      stats: {
        files: graphSnapshot?.counts.files ?? workspace.files_count,
        chunks: workspace.chunks_count,
        symbols: graphSnapshot?.counts.definitions ?? workspace.symbols_count,
        status: workspace.status,
        lastIndexedAt: workspace.last_indexed_at
          ? new Date(workspace.last_indexed_at).toISOString()
          : null,
      },
      topCentralFiles: graphSnapshot.topCentralFiles.map((row) => ({
        filePath: row.file_path,
        score: row.score,
        updatedAt: row.updated_at,
      })),
      symbolsByKind: graphSnapshot.symbolsByKind,
      activatedGraphGenerationId: graphSnapshot?.generationId ?? null,
      parserDiagnostics: {
        diagnosticsCount: graphSnapshot?.diagnostics.errors ?? 0,
        recoveredFiles: graphSnapshot?.diagnostics.recovered ?? 0,
        hardFailureFiles: graphSnapshot?.diagnostics.hardFailures ?? 0,
        staleFiles: graphSnapshot?.diagnostics.staleFiles ?? 0,
        languages: graphSnapshot?.languages ?? {},
      },
      filesByLanguage: graphSnapshot.filesByLanguage,
      recentFiles: graphSnapshot.recentFiles.map((r) => ({
        filePath: r.filePath,
        indexedAt: r.indexedAt ? new Date(r.indexedAt).toISOString() : null,
      })),
      edgesByKind: Object.keys(graphSnapshot.edgesByKind).length > 0
        ? graphSnapshot.edgesByKind
        : undefined,
      // D4 additive fields — present only when computed and non-empty.
      packages: arch && arch.packages.length > 0 ? arch.packages : undefined,
      entryPoints: arch && arch.entryPoints.length > 0 ? arch.entryPoints : undefined,
      routes: arch && arch.routes.length > 0 ? arch.routes : undefined,
      hotspots: arch && arch.hotspots.length > 0 ? arch.hotspots : undefined,
      communities: arch && arch.communities.length > 0 ? arch.communities : undefined,
      layers: arch && arch.layers.length > 0 ? arch.layers : undefined,
    };
  }

  /**
   * Compute the architecture map (D4): packages, entry points, routes,
   * hotspots, layers, and communities. Best-effort — returns null when there
   * isn't enough graph data to produce a meaningful map.
   *
   * Isolation: each repo call is awaited separately and any thrown error
   * propagates to the caller, which catches and logs it, leaving the existing
   * project_map response intact.
   */
  private async computeArchitectureMapSafe(
    snapshot: ProjectMapGraphSnapshot["architecture"],
  ): Promise<ArchitectureMap | null> {
    const {
      files: filesRaw,
      importEdges: importEdgesRaw,
      definitions: defsRaw,
      httpEdges: httpEdgesRaw,
      centrality: centralityRaw,
    } = snapshot;

    if (!filesRaw || filesRaw.length === 0) return null;

    const files = filesRaw;
    const fileIndex = new Map(files.map((f, i) => [f, i] as const));

    // Internal import edges (both endpoints known, non-external).
    const internalEdges: InternalImport[] = [];
    const weightMap = new Map<string, number>(); // "lo:hi" → weight (import count)
    for (const e of importEdgesRaw) {
      if (!e.to_file) continue;
      internalEdges.push({ fromFile: e.from_file, toFile: e.to_file });
      const a = fileIndex.get(e.from_file);
      const b = fileIndex.get(e.to_file);
      if (a === undefined || b === undefined) continue;
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = lo + ":" + hi;
      weightMap.set(key, (weightMap.get(key) ?? 0) + 1);
    }

    // Build the weighted edge list for community detection.
    const weightedEdges: WeightedEdge[] = [];
    for (const [key, w] of weightMap) {
      const sep = key.indexOf(":");
      weightedEdges.push({ a: +key.slice(0, sep), b: +key.slice(sep + 1), w });
    }

    // Definitions (lite view) + per-file symbol counts.
    const definitions: SymbolDefLite[] = defsRaw.map((d) => ({
      filePath: d.file_path,
      name: d.name,
      kind: d.kind,
      exported: d.exported,
    }));
    const symbolCounts = new Map<string, number>();
    for (const d of defsRaw) {
      symbolCounts.set(d.file_path, (symbolCounts.get(d.file_path) ?? 0) + 1);
    }

    // HTTP edges (lite view) with route/method metadata.
    const httpEdges: HttpEdgeLite[] = httpEdgesRaw.map((r) => ({
      fromFile: r.from_file,
      symbolName: r.symbol_name,
      targetFqn: r.target_fqn,
      method: (r.meta?.method as string | undefined) ?? undefined,
      route: (r.meta?.route as string | undefined) ?? undefined,
    }));

    // Run community detection over the file-import graph.
    const commResult = runLouvain(files.length, weightedEdges);

    // Hand off to the pure analyzers.
    return computeArchitectureMap({
      files,
      internalEdges,
      definitions,
      httpEdges,
      centrality: centralityRaw,
      symbolCounts,
      communities: commResult.communities,
    });
  }

  // ── centrality recomputation ─────────────────────────────────────────────

  /**
   * Recompute PageRank scores for all files in the project.
   * Should be called after a full index completes.
   */
  async recomputeCentrality(projectId: string): Promise<void> {
    const t0 = performance.now();

    const repo = getSymbolRepository();
    const [nodes, rawEdges] = await Promise.all([
      repo.allFiles(projectId),
      repo.allImportEdges(projectId),
    ]);

    if (nodes.length === 0) return;

    const edges = rawEdges
      .filter((e) => !!e.to_file)
      .map((e) => ({ from_file: e.from_file, to_file: e.to_file! }));

    const scores = computePageRank(nodes, edges);
    await repo.updateCentrality(projectId, scores);

    logger.info("SymbolGraphService: centrality recomputed", {
      projectId,
      nodes: nodes.length,
      edges: edges.length,
      durationMs: Math.round(performance.now() - t0),
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private toDefinitionResult(
    def: SymbolDefinition,
    centrality: Map<string, number>,
  ): DefinitionResult {
    return {
      fqn: def.id,
      name: def.name,
      kind: def.kind,
      file: def.file_path,
      lineStart: def.line_start,
      lineEnd: def.line_end,
      exported: def.exported,
      docComment: def.doc_comment,
      centralityScore: centrality.get(def.file_path) ?? 0,
    };
  }

  /**
   * Read a bounded snippet from a project file. Used to enrich definition
   * results with code previews.
   *
   * N9 EXCLUSION: this internal enrichment path is NOT subject to the
   * MASSA_TH0TH_READ_FILE_MAX_LINES cap. The cap applies to user-facing
   * read_file + symbol_snippet HTTP endpoint; readSnippet is called by
   * `go_to_definition` enrichment that returns small bounded context
   * windows (3-line context, top-3 definitions). Applying the cap here
   * would silently clip internal enrichment with no propagation path to
   * the MCP response. See Wave 4 N9 AC 15.
   */
  private async readSnippet(
    relativePath: string,
    lineStart: number,
    lineEnd: number,
    projectId: string,
  ): Promise<string | undefined> {
    try {
      const absolutePath = await this.resolveToAbsolute(relativePath, projectId);
      const content = await fs.readFile(absolutePath, "utf-8");
      const lines = content.split("\n");
      return lines
        .slice(Math.max(0, lineStart - 1), Math.min(lines.length, lineEnd))
        .join("\n");
    } catch {
      return undefined;
    }
  }

  /**
   * Read N lines of context around a given line number from a relative path.
   *
   * N9 EXCLUSION: same as readSnippet — internal enrichment path, NOT capped
   * by MASSA_TH0TH_READ_FILE_MAX_LINES. See Wave 4 N9 AC 15.
   */
  private async readContext(
    relativePath: string,
    lineNumber: number,
    contextLines: number,
    projectId: string,
  ): Promise<string | undefined> {
    try {
      const absolutePath = await this.resolveToAbsolute(relativePath, projectId);
      const content = await fs.readFile(absolutePath, "utf-8");
      const lines = content.split("\n");
      const start = Math.max(0, lineNumber - contextLines - 1);
      const end = Math.min(lines.length, lineNumber + contextLines);
      return lines.slice(start, end).join("\n");
    } catch {
      return undefined;
    }
  }

  /** Resolve a relative path against the project root (best-effort). */
  private async resolveToAbsolute(relativePath: string, projectId: string): Promise<string> {
    const root = await this.getProjectRoot(projectId);
    return root ? path.resolve(root, relativePath) : relativePath;
  }

  private async getProjectRoot(projectId: string): Promise<string | null> {
    const cached = this.projectRootCache.get(projectId);
    if (cached) {
      // LRU touch: promote this key to most-recently-used.
      this.projectRootCache.delete(projectId);
      this.projectRootCache.set(projectId, cached);
      return cached;
    }
    try {
      const workspace = await workspaceManager.getWorkspace(projectId);
      if (workspace?.project_path) {
        this.evictOldestProjectRoot();
        this.projectRootCache.set(projectId, workspace.project_path);
        return workspace.project_path;
      }
    } catch {
      // best-effort — return null on failure
    }
    return null;
  }

  /**
   * Evict the oldest (first-inserted) entries from projectRootCache until it is
   * under PROJECT_ROOT_CACHE_MAX_ENTRIES. Called BEFORE the new insert so the cap
   * is honored post-insert with a single iteration.
   */
  private evictOldestProjectRoot(): void {
    while (this.projectRootCache.size >= this.PROJECT_ROOT_CACHE_MAX_ENTRIES) {
      const oldest = this.projectRootCache.keys().next().value;
      if (oldest === undefined) break;
      this.projectRootCache.delete(oldest);
    }
  }

  /**
   * Drop the cached project root for this projectId (post-commit invalidator
   * hook for project rename/merge). A renamed project must re-resolve its root
   * on next access; leaving a stale entry would resolve the old path.
   */
  clearProjectRoot(projectId: string): void {
    this.projectRootCache.delete(projectId);
  }
}

export const symbolGraphService = SymbolGraphService.getInstance();

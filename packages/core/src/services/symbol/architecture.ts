/**
 * Architecture Intelligence — P4-T4 (D4)
 *
 * Pure functions that derive architectural signal from the file-import graph
 * and symbol definitions: packages, entry points, routes, hotspots, and layers.
 * Pairs with `communities.ts` (community detection) and is consumed by
 * `getProjectMap` to enrich the project-map response (additive — never mutates
 * existing fields).
 *
 * Heuristics ported (rewritten fresh) from codebase-memory-mcp's
 * `get_architecture` aspects, adapted to massa-ai's symbol_imports / symbol_references
 * model instead of a labeled property graph.
 */

import type { Community } from "./communities.js";
import { detectCycles, DEFAULT_CYCLE_EDGE_BUDGET } from "./cycle-detection.js";
import { ToolError } from "../../tools/enum-validation.js";

// ─── Public result types ─────────────────────────────────────────────────────

export interface PackageInfo {
  /** Common root directory or package marker label. */
  name: string;
  /** File paths belonging to this package. */
  files: string[];
  fileCount: number;
  /** Distinct packages this one imports (fan-out). */
  fanOut: number;
  /** Distinct packages importing this one (fan-in). */
  fanIn: number;
}

export interface EntryPoint {
  file: string;
  /** In-degree (number of distinct internal importers). */
  inDegree: number;
  /** Out-degree (number of distinct internal imports this file makes). */
  outDegree: number;
  /** Why this file was flagged as an entry-point candidate. */
  reason: string;
}

export interface RouteInfo {
  /** Route path string (from http_call edge metadata or definition name). */
  path: string;
  /** HTTP method when known. */
  method?: string;
  /** File where the route/HTTP call originates. */
  file?: string;
  /** Symbol name or target FQN bound to the route. */
  handler?: string;
}

export interface HotspotInfo {
  file: string;
  /** Centrality (PageRank) score when available, else undefined. */
  centrality?: number;
  /** In-degree (number of distinct internal importers). */
  inDegree: number;
  /** Symbol count in the file when available. */
  symbolCount?: number;
}

export interface LayerInfo {
  /** Layer label: entry | api | core | service | leaf | unknown. */
  layer: "entry" | "api" | "core" | "service" | "leaf" | "unknown";
  /** Common-path-prefix or community label identifying the layer. */
  name: string;
  fileCount: number;
  /** One-line rationale. */
  reason: string;
}

export interface CommunityInfo {
  /** Stable community id. */
  id: number;
  /** Representative label (common path prefix or most-central file). */
  label: string;
  /** Number of files in the community. */
  size: number;
  /** Internal / (internal + boundary) edge-weight ratio (0..1). */
  cohesion: number;
  /** Top files by degree within the community (≤5). */
  topFiles: string[];
}

export interface ArchitectureMap {
  packages: PackageInfo[];
  entryPoints: EntryPoint[];
  routes: RouteInfo[];
  hotspots: HotspotInfo[];
  communities: CommunityInfo[];
  layers: LayerInfo[];
  /**
   * Opt-in `cycles` aspect (Wave 5 FR-02 / N2). Present only when the caller
   * passed `aspects: ["cycles"]` to {@link computeArchitectureMap}. Each entry
   * is a file-level strongly connected component of size >1 (or a singleton
   * self-loop) over the CALL-edge graph.
   */
  cycles?: CycleInfo[];
  /** `true` when the CALL-edge input exceeded the budget and was truncated. */
  cycles_truncated?: boolean;
}

/**
 * One cycle (strongly connected component) surfaced by the `cycles` aspect.
 *
 * `id` is a stable synthetic id derived from the sorted node list so snapshot
 * fingerprinting and diffing are reproducible. `edgeCount` is the number of
 * intra-SCC CALL edges (the cost of breaking the cycle).
 */
export interface CycleInfo {
  id: string;
  nodes: string[];
  edgeCount: number;
}

// ─── Internal edge view ──────────────────────────────────────────────────────

/** Internal import edge between two files (both endpoints known, non-external). */
export interface InternalImport {
  fromFile: string;
  toFile: string;
}

/**
 * Directed CALL edge between two files (Wave 5 — FR-02 / N2).
 *
 * `from` = caller's file (relative path); `to` = callee's file (relative path,
 * stripped from the callee's structural FQN `path/to/file.ts#Name`). The Tarjan
 * SCC detector ({@link detectCycles}) runs over CALL edges to surface cyclic
 * call graphs. Endpoint identity is FILE-level (not symbol-level) so the SCC
 * partitions reflect file-grained dependency cycles.
 */
export interface CallEdge {
  from: string;
  to: string;
}

export interface SymbolDefLite {
  filePath: string;
  name: string;
  kind: string;
  exported?: boolean;
}

export interface HttpEdgeLite {
  fromFile?: string;
  symbolName?: string;
  targetFqn?: string;
  method?: string;
  route?: string;
}

interface GraphView {
  /** All files (nodes). */
  files: string[];
  /** Internal import edges (non-external, both endpoints known). */
  edges: InternalImport[];
  /** File index for O(1) lookup. */
  fileIndex: Map<string, number>;
  /** In-degree per file (distinct importers). */
  inDegree: Int32Array;
  /** Out-degree per file (distinct imports). */
  outDegree: Int32Array;
  /** File → set of distinct imported files. */
  outAdj: Map<string, Set<string>>;
  /** File → set of distinct importers. */
  inAdj: Map<string, Set<string>>;
}

function buildGraphView(files: string[], edges: InternalImport[]): GraphView {
  const fileIndex = new Map(files.map((f, i) => [f, i]));
  const inDegree = new Int32Array(files.length);
  const outDegree = new Int32Array(files.length);
  const outAdj = new Map<string, Set<string>>();
  const inAdj = new Map<string, Set<string>>();
  for (const f of files) {
    outAdj.set(f, new Set());
    inAdj.set(f, new Set());
  }
  for (const e of edges) {
    if (e.fromFile === e.toFile) continue;
    if (!fileIndex.has(e.fromFile) || !fileIndex.has(e.toFile)) continue;
    const out = outAdj.get(e.fromFile);
    const inn = inAdj.get(e.toFile);
    if (out && !out.has(e.toFile)) {
      out.add(e.toFile);
      outDegree[fileIndex.get(e.fromFile)!]++;
    }
    if (inn && !inn.has(e.fromFile)) {
      inn.add(e.fromFile);
      inDegree[fileIndex.get(e.toFile)!]++;
    }
  }
  return { files, edges, fileIndex, inDegree, outDegree, outAdj, inAdj };
}

// ─── Packages ────────────────────────────────────────────────────────────────

/**
 * Group files by top-level package boundary.
 *
 * Heuristic (in priority order):
 *   1. `packages/<pkg>/` and `apps/<pkg>/` monorepo segments.
 *   2. The first path segment otherwise (e.g. `src`, `lib`, `cmd`).
 *   3. A `package.json` / `go.mod` marker is honored implicitly via (1)/(2)
 *      since monorepo tooling co-locates them.
 *
 * Files at the repo root (no `/`) are grouped under `<root>`.
 */
const MONOREPO_RE = /^(?:packages|apps|modules|libs|services)\/([^/]+)\//;

export function detectPackages(
  files: string[],
  gv: GraphView,
  opts: { maxPackages?: number; minFiles?: number } = {},
): PackageInfo[] {
  const maxPackages = opts.maxPackages ?? 15;
  const minFiles = opts.minFiles ?? 1;

  const pkgFiles = new Map<string, string[]>();
  for (const f of files) {
    const pkg = packageOf(f);
    let arr = pkgFiles.get(pkg);
    if (!arr) {
      arr = [];
      pkgFiles.set(pkg, arr);
    }
    arr.push(f);
  }

  // Fan-in/out between packages.
  const fanOut = new Map<string, Set<string>>();
  const fanIn = new Map<string, Set<string>>();
  for (const p of pkgFiles.keys()) {
    fanOut.set(p, new Set());
    fanIn.set(p, new Set());
  }
  for (const e of gv.edges) {
    const pf = packageOf(e.fromFile);
    const pt = packageOf(e.toFile);
    if (pf === pt) continue;
    fanOut.get(pf)?.add(pt);
    fanIn.get(pt)?.add(pf);
  }

  const out: PackageInfo[] = [];
  for (const [name, pkgFileList] of pkgFiles) {
    if (pkgFileList.length < minFiles) continue;
    out.push({
      name,
      files: pkgFileList,
      fileCount: pkgFileList.length,
      fanOut: fanOut.get(name)?.size ?? 0,
      fanIn: fanIn.get(name)?.size ?? 0,
    });
  }
  // Rank by file count desc, then fan-in desc.
  out.sort((a, b) => b.fileCount - a.fileCount || b.fanIn - a.fanIn);
  return out.slice(0, maxPackages);
}

function packageOf(filePath: string): string {
  const m = filePath.match(MONOREPO_RE);
  if (m) return m[1];
  const slash = filePath.indexOf("/");
  if (slash < 0) return "<root>";
  return filePath.slice(0, slash);
}

// ─── Entry points ────────────────────────────────────────────────────────────

/**
 * Flag entry-point candidates: files with high in-degree (imported by many)
 * but few/zero local imports of their own — typical of main/index/server
 * bootstrap modules. Also names files that look like bootstrap by path
 * (index.ts, main.ts, server.ts, app.ts, cli.ts) even at lower in-degree.
 */
const BOOTSTRAP_RE = /(^|\/)(index|main|server|app|cli|bootstrap|entry)\.[tj]sx?$/i;

export function detectEntryPoints(
  gv: GraphView,
  opts: { maxResults?: number; minInDegree?: number } = {},
): EntryPoint[] {
  const maxResults = opts.maxResults ?? 20;
  const minInDegree = opts.minInDegree ?? 1;

  const out: EntryPoint[] = [];
  for (let i = 0; i < gv.files.length; i++) {
    const file = gv.files[i];
    const inDeg = gv.inDegree[i];
    const outDeg = gv.outDegree[i];
    const isBootstrap = BOOTSTRAP_RE.test(file);

    // Candidate if: high in-degree with low out-degree, OR a bootstrap-named file.
    const highInLowOut = inDeg >= minInDegree && outDeg <= Math.max(2, inDeg);
    if (!highInLowOut && !isBootstrap) continue;

    let reason: string;
    if (isBootstrap && inDeg >= minInDegree) {
      reason = `bootstrap module (imported by ${inDeg}, imports ${outDeg})`;
    } else if (isBootstrap) {
      reason = "bootstrap-named module";
    } else {
      reason = `high in-degree (${inDeg}) with low out-degree (${outDeg})`;
    }
    out.push({ file, inDegree: inDeg, outDegree: outDeg, reason });
  }

  // Rank by in-degree desc, then bootstrap-first.
  out.sort((a, b) => {
    const ab = BOOTSTRAP_RE.test(a.file) ? 1 : 0;
    const bb = BOOTSTRAP_RE.test(b.file) ? 1 : 0;
    if (ab !== bb) return bb - ab;
    return b.inDegree - a.inDegree;
  });
  return out.slice(0, maxResults);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * Surface the API surface. Sources, in priority order:
 *   1. HTTP_CALL typed edges (meta.route / meta.method) — the richest signal.
 *   2. Symbol definitions of kind `route` (framework-specific extractors) —
 *      surfaced by name when no http_call edges exist.
 *   3. HTTP method + path patterns in symbol names (e.g. `GET /api/users`).
 */
const ROUTE_NAME_RE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S+)/i;

export function detectRoutes(
  httpEdges: HttpEdgeLite[],
  defs: SymbolDefLite[],
  opts: { maxResults?: number } = {},
): RouteInfo[] {
  const maxResults = opts.maxResults ?? 50;
  // Dedup key = "<METHOD> <PATH>" across ALL sources so a `GET /x` http_call
  // edge and a `GET /x` route-kind definition collapse into a single route.
  const seen = new Set<string>();
  const out: RouteInfo[] = [];

  // (1) HTTP_CALL edges — richest signal, so they seed the dedup set first.
  for (const e of httpEdges) {
    const path = e.route;
    if (!path) continue;
    const method = (e.method ?? "ANY").toUpperCase();
    const key = method + " " + path;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      path,
      method: e.method,
      file: e.fromFile,
      handler: e.targetFqn ?? e.symbolName,
    });
  }

  // (2) route-kind definitions. Normalize the def name into a method+path key
  // so it dedupes against http_call edges for the same route. A def name like
  // `GET /x` splits into method=GET, path=/x; a bare `/x` becomes ANY /x.
  for (const d of defs) {
    if (d.kind !== "route") continue;
    const parsed = parseRouteName(d.name);
    const method = parsed?.method ?? "ANY";
    const path = parsed?.path ?? d.name;
    const key = method + " " + path;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, method: parsed?.method, file: d.filePath, handler: d.name });
  }

  // (3) route-name patterns in any definition name (e.g. a handler named
  // `GET /api/users`). Already covered by the cross-source dedup key.
  for (const d of defs) {
    const parsed = parseRouteName(d.name);
    if (!parsed) continue;
    const key = parsed.method + " " + parsed.path;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: parsed.path, method: parsed.method, file: d.filePath, handler: d.name });
  }

  return out.slice(0, maxResults);
}

/** Parse a `METHOD /path` string; return normalized {method, path} or null. */
function parseRouteName(name: string): { method: string; path: string } | null {
  const m = name.match(ROUTE_NAME_RE);
  if (!m) return null;
  return { method: m[1].toUpperCase(), path: m[2] };
}

// ─── Hotspots ────────────────────────────────────────────────────────────────

/**
 * Most-depended-on files. Combines PageRank centrality (when available) with
 * in-degree (number of distinct importers) and per-file symbol counts.
 */
export function detectHotspots(
  gv: GraphView,
  opts: {
    centrality?: Map<string, number>;
    symbolCounts?: Map<string, number>;
    maxResults?: number;
  } = {},
): HotspotInfo[] {
  const maxResults = opts.maxResults ?? 10;
  const centrality = opts.centrality;
  const symbolCounts = opts.symbolCounts;

  const out: HotspotInfo[] = [];
  for (let i = 0; i < gv.files.length; i++) {
    const file = gv.files[i];
    const inDeg = gv.inDegree[i];
    // Keep only files with at least one importer or a known symbol count.
    if (inDeg === 0 && !(symbolCounts && symbolCounts.get(file))) continue;
    out.push({
      file,
      centrality: centrality?.get(file),
      inDegree: inDeg,
      symbolCount: symbolCounts?.get(file),
    });
  }

  // Rank by a composite: centrality (if present) else in-degree, then symbol count.
  out.sort((a, b) => {
    const sa = a.centrality ?? a.inDegree / 10;
    const sb = b.centrality ?? b.inDegree / 10;
    if (sb !== sa) return sb - sa;
    return (b.symbolCount ?? 0) - (a.symbolCount ?? 0);
  });
  return out.slice(0, maxResults);
}

// ─── Communities → labeled clusters ──────────────────────────────────────────

/**
 * Convert raw community memberships (node indices) into labeled clusters over
 * file paths. Each community gets a representative label (common path prefix
 * when one exists, else the most-central/most-connected file), a size, a
 * cohesion metric, and its top files.
 */
export function labelCommunities(
  files: string[],
  gv: GraphView,
  communities: Community[],
  opts: { maxResults?: number; minSize?: number; maxTopFiles?: number } = {},
): CommunityInfo[] {
  const maxResults = opts.maxResults ?? 12;
  const minSize = opts.minSize ?? 2;
  const maxTopFiles = opts.maxTopFiles ?? 5;

  const out: CommunityInfo[] = [];
  for (const c of communities) {
    if (c.members.length < minSize) continue;
    const memberFiles = c.members.map((idx) => files[idx]).filter(Boolean);
    if (memberFiles.length === 0) continue;

    const label = commonPrefixLabel(memberFiles) ?? memberFiles[0];

    // Cohesion: internal edge weight / (internal + boundary).
    let internal = 0;
    let boundary = 0;
    const memberSet = new Set(memberFiles);
    for (const f of memberFiles) {
      const outs = gv.outAdj.get(f);
      if (!outs) continue;
      for (const t of outs) {
        if (memberSet.has(t)) internal++;
        else boundary++;
      }
    }
    const total = internal + boundary;
    const cohesion = total > 0 ? internal / total : 0;

    // Top files by total degree within the community.
    const ranked = memberFiles
      .map((f) => {
        const idx = gv.fileIndex.get(f);
        const deg = idx === undefined ? 0 : gv.inDegree[idx] + gv.outDegree[idx];
        return { f, deg };
      })
      .sort((a, b) => b.deg - a.deg)
      .slice(0, maxTopFiles)
      .map((x) => x.f);

    out.push({
      id: c.id,
      label,
      size: memberFiles.length,
      cohesion: Math.round(cohesion * 1000) / 1000,
      topFiles: ranked,
    });
  }

  // Rank by size desc, then cohesion desc.
  out.sort((a, b) => b.size - a.size || b.cohesion - a.cohesion);
  return out.slice(0, maxResults);
}

/** Longest common path prefix among files, truncated to a directory boundary. */
function commonPrefixLabel(files: string[]): string | null {
  if (files.length === 0) return null;
  if (files.length === 1) return files[0];
  let prefix = files[0];
  for (let i = 1; i < files.length; i++) {
    while (!files[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return null;
    }
  }
  // Truncate to the last directory boundary.
  const slash = prefix.lastIndexOf("/");
  if (slash <= 0) return prefix || null;
  return prefix.slice(0, slash);
}

// ─── Layers ──────────────────────────────────────────────────────────────────

/**
 * Classify communities/files into de-facto layers using fan-in/fan-out signals:
 *   - entry:   imported by others, imports little (bootstrap / public surface)
 *   - api:     contains routes / http_call edges
 *   - core:    high fan-in, moderate fan-out (foundation modules)
 *   - leaf:    high fan-out, low fan-in (terminals: handlers, scripts)
 *   - service: default for mid-coupling groups
 */
export function classifyLayers(
  communities: CommunityInfo[],
  gv: GraphView,
  routes: RouteInfo[],
): LayerInfo[] {
  const routeFiles = new Set(routes.map((r) => r.file).filter(Boolean));
  const out: LayerInfo[] = [];

  for (const c of communities) {
    const memberFiles = c.topFiles.length > 0 ? c.topFiles : [];
    if (memberFiles.length === 0) continue;

    // Aggregate fan-in/out across members.
    let fanIn = 0;
    let fanOut = 0;
    for (const f of memberFiles) {
      const idx = gv.fileIndex.get(f);
      if (idx === undefined) continue;
      fanIn += gv.inDegree[idx];
      fanOut += gv.outDegree[idx];
    }
    const hasRoute = memberFiles.some((f) => routeFiles.has(f));
    const isBootstrap = memberFiles.some((f) => BOOTSTRAP_RE.test(f));

    let layer: LayerInfo["layer"];
    let reason: string;
    if (isBootstrap && fanIn > 0 && fanOut > fanIn) {
      layer = "entry";
      reason = "bootstrap modules that fan out to the rest of the codebase";
    } else if (hasRoute) {
      layer = "api";
      reason = "contains HTTP route / API-surface definitions";
    } else if (fanIn > fanOut && fanIn >= 3) {
      layer = "core";
      reason = `high fan-in (${fanIn}) — depended on broadly`;
    } else if (fanOut > 0 && fanIn === 0) {
      layer = "leaf";
      reason = "imports others but nothing imports these (terminal layer)";
    } else {
      layer = "service";
      reason = `mid-coupling group (in=${fanIn}, out=${fanOut})`;
    }

    out.push({
      layer,
      name: c.label,
      fileCount: c.size,
      reason,
    });
  }

  return out.slice(0, 20);
}

// ─── Top-level orchestrator ──────────────────────────────────────────────────

export interface ArchitectureInput {
  files: string[];
  internalEdges: InternalImport[];
  definitions: SymbolDefLite[];
  httpEdges: HttpEdgeLite[];
  /**
   * Directed CALL edges (Wave 5 FR-02 / N2). Populated from
   * `symbol_references WHERE ref_kind='call'` rows by the snapshot reader;
   * the `cycles` aspect (T03) runs iterative Tarjan SCC over these. Optional
   * for backward-compat: pre-Wave-5 callers omit it and `cycles` stays absent
   * from the resulting {@link ArchitectureMap}.
   */
  callEdges?: CallEdge[];
  centrality?: Map<string, number>;
  symbolCounts?: Map<string, number>;
  communities?: Community[];
}

/**
 * Valid aspect names for {@link ArchitectureOptions.aspects} (Wave 5 FR-02 /
 * FR-04 / AD-W5-020). Used both to validate caller input (teaching error on
 * unknown value, Wave 4 N6 parity) and to document the contract.
 */
export const VALID_ARCHITECTURE_ASPECTS = ["cycles"] as const;
export type ArchitectureAspect = (typeof VALID_ARCHITECTURE_ASPECTS)[number];

export interface ArchitectureOptions {
  /** Whether to compute communities (skip to save cost when undesired). */
  withCommunities?: boolean;
  /**
   * Opt-in aspects (Wave 5 FR-02 / FR-04). When present, only listed aspects
   * beyond the always-on baseline (packages/entryPoints/routes/hotspots/
   * communities/layers) are computed. Today the only opt-in aspect is
   * `"cycles"` (iterative Tarjan SCC over CALL edges).
   *
   * Unknown values throw a teaching error listing {@link VALID_ARCHITECTURE_ASPECTS}
   * (Wave 4 N6 parity). `undefined` / empty → no opt-in aspects (backward-
   * compat with pre-Wave-5 callers).
   */
  aspects?: string[];
}

/**
 * Compute the full architecture map. Pure: no DB, no I/O.
 *
 * @throws {ToolError} when `opts.aspects` contains an unknown value (Wave 4
 *   N6 teaching-error parity; message lists {@link VALID_ARCHITECTURE_ASPECTS}).
 */
export function computeArchitectureMap(
  input: ArchitectureInput,
  opts: ArchitectureOptions = {},
): ArchitectureMap {
  // Validate opt-in aspects first (teaching error before any work).
  const aspects = opts.aspects ?? [];
  for (const a of aspects) {
    if (!VALID_ARCHITECTURE_ASPECTS.includes(a as ArchitectureAspect)) {
      throw new ToolError(
        `Invalid aspects value: ${String(a)}. Valid values: ${VALID_ARCHITECTURE_ASPECTS.join(", ")}.`,
      );
    }
  }

  const gv = buildGraphView(input.files, input.internalEdges);

  const packages = detectPackages(input.files, gv);
  const entryPoints = detectEntryPoints(gv);
  const routes = detectRoutes(input.httpEdges, input.definitions);
  const hotspots = detectHotspots(gv, {
    centrality: input.centrality,
    symbolCounts: input.symbolCounts,
  });

  let communityInfos: CommunityInfo[] = [];
  if (input.communities && input.communities.length > 0) {
    communityInfos = labelCommunities(input.files, gv, input.communities);
  }
  const layers = classifyLayers(communityInfos, gv, routes);

  const map: ArchitectureMap = {
    packages,
    entryPoints,
    routes,
    hotspots,
    communities: communityInfos,
    layers,
  };

  // Wave 5 FR-02 / N2: opt-in `cycles` aspect via iterative Tarjan SCC over
  // CALL edges (AD-W5-001). Only computed when the caller asks for it.
  if (aspects.includes("cycles")) {
    const callEdges = input.callEdges ?? [];
    const { sccs, truncated } = detectCycles(callEdges, DEFAULT_CYCLE_EDGE_BUDGET);
    if (sccs.length > 0 || truncated) {
      map.cycles = sccs.map((scc) => decorateCycle(scc.nodes, callEdges));
      map.cycles_truncated = truncated;
    } else {
      // Empty-but-explicit: surface truncation flag even when no SCCs found.
      map.cycles = [];
      map.cycles_truncated = truncated;
    }
  }

  return map;
}

/**
 * Decorate one SCC with a stable synthetic id and the intra-SCC CALL-edge
 * count. Pure: deterministic so snapshot fingerprints are reproducible.
 */
function decorateCycle(nodes: string[], callEdges: CallEdge[]): CycleInfo {
  const sorted = nodes.slice().sort();
  const id = "cycle:" + sorted.join("|");
  const nodeSet = new Set(sorted);
  let edgeCount = 0;
  for (const e of callEdges) {
    if (nodeSet.has(e.from) && nodeSet.has(e.to)) edgeCount++;
  }
  return { id, nodes: sorted, edgeCount };
}

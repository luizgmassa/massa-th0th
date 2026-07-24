/**
 * attribution-resolver — application-layer hook attribution (M45/HAR-01..03,
 * HAR-09). Resolves the durable project id for one hook event before enqueue,
 * in strict order:
 *
 *  1. explicit    — caller id is a live workspace id, alias-resolves to one,
 *                   or self-matches inside a path-sharing id set.
 *  2. sticky      — session pin hit (first resolved id of the session wins
 *                   for later events with unregistered caller ids).
 *  3. containment — canonicalized payload cwd inside exactly one deduped,
 *                   non-broad workspace root; longest path wins.
 *  4. verbatim    — fail-open: caller id unchanged.
 *
 * Roots are DEDUPLICATED BY PATH (plan-critic C1): identical `project_path`
 * values collapse to one candidate root carrying its live id set; a matched
 * shared path resolves only via caller self-match, else it is ambiguous.
 * Broad roots (filesystem root, user home) never participate in containment
 * (HAR-03).
 *
 * Failure mode: FAIL-OPEN with a sanitized warn. Attribution failure NEVER
 * rejects or delays an event beyond bounded lookups; any internal error
 * degrades to `verbatim` (HAR-09). Never throws.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "@massa-ai/shared";
import { getPgPool } from "../../data/db-connection.js";
import type { AttributionSource } from "../../data/memory/observation-contract.js";
import {
  getProjectIdentityAliasResolver,
  type ProjectIdentityAliasResolver,
} from "../project-identity/alias-resolver.js";
import { SessionPinStore } from "./session-pin-store.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface WorkspaceRoot {
  readonly projectId: string;
  readonly projectPath: string;
}

/** Source of registered workspace roots. Injectable for DB-free tests. */
export interface WorkspaceRootProvider {
  listRoots(): Promise<WorkspaceRoot[]>;
}

export interface AttributionInput {
  readonly callerProjectId: string;
  readonly sessionId?: string | null;
  readonly cwd?: string | null;
}

export interface AttributionResult {
  readonly projectId: string;
  readonly source: AttributionSource;
}

/** Minimal resolver surface for injection (HookService, CompactSnapshotTool, tests). */
export interface AttributionResolverLike {
  resolve(input: AttributionInput): Promise<AttributionResult>;
  /**
   * Record a winning resolution for future sticky hits. Callers MUST call this
   * AFTER admission survives (never before a QueueSaturatedError check) so a
   * rejected event leaves no pin behind.
   */
  pinSession(sessionId: string | null | undefined, projectId: string, source: AttributionSource): void;
}

/** Minimal alias-resolution surface (satisfied by ProjectIdentityAliasResolver). */
export interface AttributionAliasResolver {
  resolve(projectId: string): Promise<string>;
}

export interface AttributionResolverOptions {
  readonly roots?: WorkspaceRootProvider;
  readonly aliasResolver?: AttributionAliasResolver;
  readonly pins?: SessionPinStore;
  /** Injectable canonicalizer for tests. Return undefined when unresolvable. */
  readonly canonicalize?: (cwd: string) => string | undefined;
  /** Injectable home dir for tests (broad-root exclusion). */
  readonly homedir?: () => string;
  /** Injectable fs-root detector for tests (broad-root exclusion). */
  readonly fsRoot?: () => string;
}

// ── PG provider (cached, bounded, fail-open) ────────────────────────────────

const PROVIDER_TTL_MS = 30_000;
const PROVIDER_TIMEOUT_MS = 250;

/**
 * Cached workspaces reader. Mirrors the alias-resolver cache/timeout pattern:
 * a sick-but-hanging DB must not stall hook admission; failures fail open to
 * an EMPTY root list (containment/explicit simply never match) with a
 * sanitized warn.
 */
export class PgWorkspaceRootProvider implements WorkspaceRootProvider {
  private cache: { roots: WorkspaceRoot[]; expiresAt: number } | null = null;
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  async listRoots(): Promise<WorkspaceRoot[]> {
    if (this.cache && this.cache.expiresAt > this.now()) return this.cache.roots;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const lookup = (async (): Promise<WorkspaceRoot[]> => {
        const pool = await getPgPool();
        const { rows } = await pool.query<{ project_id: string; project_path: string }>(
          `SELECT project_id, project_path FROM workspaces`,
        );
        return rows.map((r) => ({ projectId: r.project_id, projectPath: r.project_path }));
      })();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("workspace_roots_timeout")), PROVIDER_TIMEOUT_MS);
      });
      const roots = await Promise.race([lookup, timeout]);
      // Positive cache only: a transient failure must not pin an empty list.
      this.cache = { roots, expiresAt: this.now() + PROVIDER_TTL_MS };
      return roots;
    } catch (error) {
      logger.warn("[hook-attribution] workspace roots lookup failed; containment disabled (sanitized)", {
        name: error instanceof Error ? error.name : "unknown",
      });
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Test/maintenance escape hatch. */
  clearCache(): void {
    this.cache = null;
  }
}

// ── Resolver ────────────────────────────────────────────────────────────────

export class AttributionResolver implements AttributionResolverLike {
  private readonly roots: WorkspaceRootProvider;
  private readonly aliasResolver: AttributionAliasResolver;
  private readonly pins: SessionPinStore;
  private readonly canonicalize: (cwd: string) => string | undefined;
  private readonly homedir: () => string;
  private readonly fsRoot: () => string;

  constructor(options: AttributionResolverOptions = {}) {
    this.roots = options.roots ?? new PgWorkspaceRootProvider();
    this.aliasResolver = options.aliasResolver ?? getProjectIdentityAliasResolver();
    this.pins = options.pins ?? new SessionPinStore();
    this.canonicalize = options.canonicalize ?? defaultCanonicalize;
    this.homedir = options.homedir ?? os.homedir;
    this.fsRoot = options.fsRoot ?? (() => path.parse(path.sep).root);
  }

  /**
   * Resolve one event's durable project id. NEVER throws; any internal
   * failure degrades to `{ projectId: caller, source: "verbatim" }`.
   */
  async resolve(input: AttributionInput): Promise<AttributionResult> {
    const caller = input.callerProjectId;
    try {
      const roots = await this.roots.listRoots();
      const liveIds = new Set(roots.map((r) => r.projectId));

      // 1. explicit — caller id is live, or alias-resolves to a live id.
      const canonicalCaller = await this.aliasResolver.resolve(caller);
      if (liveIds.has(canonicalCaller) || liveIds.has(caller)) {
        const winner = liveIds.has(canonicalCaller) ? canonicalCaller : caller;
        return { projectId: winner, source: "explicit" };
      }

      // 2. sticky — session pin hit. Read-only; pinning is the caller's job
      // after admission survives (see pinSession).
      if (input.sessionId) {
        const pinned = this.pins.get(input.sessionId);
        if (pinned) {
          return { projectId: pinned, source: "sticky" };
        }
      }

      // 3. containment — canonical cwd inside exactly one deduped non-broad root.
      if (input.cwd) {
        const result = this.resolveContainment(input, roots);
        if (result) return result;
      }

      // 4. verbatim — fail-open.
      return { projectId: caller, source: "verbatim" };
    } catch (error) {
      logger.warn("[hook-attribution] resolution failed; using caller id (sanitized)", {
        name: error instanceof Error ? error.name : "unknown",
      });
      return { projectId: caller, source: "verbatim" };
    }
  }

  /**
   * Record a winning resolution for future sticky hits. No-op for verbatim
   * results (a fail-open outcome carries no signal worth pinning) and when no
   * sessionId is present. Sticky hits refresh expiry via SessionPinStore.get.
   */
  pinSession(sessionId: string | null | undefined, projectId: string, source: AttributionSource): void {
    if (!sessionId) return;
    if (source === "verbatim") return;
    this.pins.set(sessionId, projectId);
  }

  private resolveContainment(
    input: AttributionInput,
    roots: WorkspaceRoot[],
  ): AttributionResult | null {
    const canonicalCwd = this.canonicalize(input.cwd as string);
    if (!canonicalCwd) return null;

    // Dedupe roots by path (C1): identical paths collapse to one candidate.
    // Empty paths are junk rows — excluded ("" + sep would match every cwd).
    const byPath = new Map<string, Set<string>>();
    for (const root of roots) {
      const normalized = this.normalizeRootPath(root.projectPath);
      if (!normalized || this.isBroadRoot(normalized)) continue;
      const set = byPath.get(normalized) ?? new Set<string>();
      set.add(root.projectId);
      byPath.set(normalized, set);
    }

    // Longest containing path wins.
    let bestPath: string | null = null;
    for (const candidate of byPath.keys()) {
      if (canonicalCwd === candidate || canonicalCwd.startsWith(candidate.endsWith(path.sep) ? candidate : candidate + path.sep)) {
        if (bestPath === null || candidate.length > bestPath.length) {
          bestPath = candidate;
        }
      }
    }
    if (bestPath === null) return null;

    const idSet = byPath.get(bestPath) as Set<string>;
    if (idSet.size === 1) {
      const [only] = idSet;
      return { projectId: only, source: "containment" };
    }
    // Shared path (multiple live ids): ambiguous at this tier. Caller/alias
    // self-match already won at the explicit tier (raw + canonical live check),
    // so reaching here means the caller is not part of the sharing set.
    return null;
  }

  private isBroadRoot(projectPath: string): boolean {
    return projectPath === this.fsRoot() || projectPath === this.normalizeRootPath(this.homedir());
  }

  /** Strip trailing separators (except the fs root itself); empty stays empty. */
  private normalizeRootPath(projectPath: string): string {
    if (!projectPath) return projectPath;
    const fsRoot = this.fsRoot();
    let normalized = projectPath;
    while (normalized.length > fsRoot.length && normalized.endsWith(path.sep)) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }
}

/** realpath with resolve fallback; undefined when the path cannot be resolved at all. */
function defaultCanonicalize(cwd: string): string | undefined {
  try {
    return fs.realpathSync(cwd);
  } catch {
    try {
      return path.resolve(cwd);
    } catch {
      return undefined;
    }
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let sharedResolver: AttributionResolver | null = null;

export function getAttributionResolver(): AttributionResolver {
  if (!sharedResolver) sharedResolver = new AttributionResolver();
  return sharedResolver;
}

/** @internal — reset the singleton (tests only). */
export function resetAttributionResolver(): void {
  sharedResolver = null;
}

/** @internal — swap the singleton with a stubbed resolver (tests only). */
export function setAttributionResolverForTests(
  resolver: AttributionResolverLike | null,
): void {
  sharedResolver = resolver as AttributionResolver | null;
}

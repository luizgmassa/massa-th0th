/**
 * alias-resolver — application-layer canonical project-ID resolution (spec
 * req 3, design "Concurrency and Caches"). The DB trigger resolves aliases on
 * INSERT/UPDATE of a guarded identity column, but it cannot rewrite:
 *
 *  - statements FILTERED by a retired id (`UPDATE/DELETE ... WHERE project_id
 *    = 'retired'` matches 0 rows post-rename — a silent write loss), or
 *  - payload-embedded ids (scheduled_jobs.payload JSON — no identity column).
 *
 * Writers therefore resolve the canonical ID at their write-entry seam before
 * persistence. Resolution reuses the server-side `project_identity_resolve`
 * function (alias-chain flattening, cycle guard) in one round trip.
 *
 * Caching: positive/negative results cached with a short TTL. The post-commit
 * invalidator registry clears BOTH source and target entries after every
 * committed rename/merge, so staleness is bounded by the invalidation
 * latency, not the TTL; the TTL only covers processes that never see an
 * identity change.
 *
 * Failure mode: FAIL-OPEN with a warn. If the alias lookup fails, the writer
 * proceeds with the original ID — the DB trigger remains the backstop for
 * guarded identity columns, and an alias-DB outage would fail the write
 * anyway. Resolution NEVER throws.
 */

import { logger } from "@massa-ai/shared";
import { getPgPool } from "../../data/db-connection.js";

/** Minimal query surface (pg Pool/PoolClient both satisfy it). */
export interface AliasResolverQuerier {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface ProjectIdentityAliasResolverOptions {
  /** Cache TTL in ms. Default 30_000. */
  readonly ttlMs?: number;
  /** Max time a single lookup may take before FAIL-OPEN kicks in. Default 250. */
  readonly resolveTimeoutMs?: number;
  /** Injectable for tests; defaults to the shared pg pool. */
  readonly querier?: AliasResolverQuerier;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

interface CacheEntry {
  readonly canonical: string;
  readonly expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_RESOLVE_TIMEOUT_MS = 250;

export class ProjectIdentityAliasResolver {
  private readonly ttlMs: number;
  private readonly resolveTimeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private querier: AliasResolverQuerier | undefined;
  private readonly now: () => number;

  constructor(options: ProjectIdentityAliasResolverOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.resolveTimeoutMs = options.resolveTimeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS;
    this.querier = options.querier;
    this.now = options.now ?? Date.now;
  }

  /**
   * Resolve `projectId` to its canonical target. Live IDs resolve to
   * themselves; retired IDs flatten to the current target. NEVER throws —
   * on any lookup failure the input ID is returned (fail-open, see header).
   *
   * The lookup is raced against `resolveTimeoutMs`: a sick-but-hanging DB
   * (connect timeout is 5s on the shared pool) must not stall every write
   * seam for seconds. Successful resolutions are cached, so the steady-state
   * cost is one fast query per id per TTL.
   */
  async resolve(projectId: string): Promise<string> {
    if (!projectId) return projectId;
    const cached = this.cache.get(projectId);
    if (cached && cached.expiresAt > this.now()) {
      return cached.canonical;
    }
    try {
      const canonical = await this.resolveWithTimeout(projectId);
      this.cache.set(projectId, { canonical, expiresAt: this.now() + this.ttlMs });
      return canonical;
    } catch (error) {
      // Fail-open: proceed with the original ID. No negative-cache write, so
      // the next writer retries the lookup instead of riding a transient.
      logger.warn("[project-identity] alias resolution failed; using original id (sanitized)", {
        name: error instanceof Error ? error.name : "unknown",
      });
      return projectId;
    }
  }

  private async resolveWithTimeout(projectId: string): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const lookup = (async (): Promise<string> => {
        const querier = await this.getQuerier();
        const { rows } = await querier.query<{ project_identity_resolve: string | null }>(
          `SELECT project_identity_resolve($1)`,
          [projectId],
        );
        const resolved = rows[0]?.project_identity_resolve;
        return typeof resolved === "string" && resolved.length > 0 ? resolved : projectId;
      })();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("project_identity_resolve_timeout")),
          this.resolveTimeoutMs,
        );
      });
      return await Promise.race([lookup, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Post-commit invalidator hook: drop the cached mapping for this ID. Apply
   * invokes it for BOTH source and target via the invalidator registry.
   */
  invalidateProject(projectId: string): void {
    this.cache.delete(projectId);
  }

  /** Test/maintenance escape hatch. */
  clearCache(): void {
    this.cache.clear();
  }

  /** @internal — exposed for tests. */
  get cacheSize(): number {
    return this.cache.size;
  }

  private async getQuerier(): Promise<AliasResolverQuerier> {
    if (!this.querier) {
      this.querier = await getPgPool();
    }
    return this.querier;
  }
}

/** Process-wide resolver (production singleton). */
let sharedResolver: ProjectIdentityAliasResolver | null = null;

export function getProjectIdentityAliasResolver(): ProjectIdentityAliasResolver {
  if (!sharedResolver) {
    sharedResolver = new ProjectIdentityAliasResolver();
  }
  return sharedResolver;
}

/** @internal — reset the singleton (tests only). */
export function resetProjectIdentityAliasResolver(): void {
  sharedResolver = null;
}

/** @internal — swap the singleton with a stubbed resolver (tests only). */
export function setProjectIdentityAliasResolverForTests(
  resolver: ProjectIdentityAliasResolver | null,
): void {
  sharedResolver = resolver;
}

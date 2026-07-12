/**
 * Shared E2E helpers — massa-th0th live-stack tests.
 *
 * Targets the RUNNING Tools API (default http://localhost:3333) + Ollama +
 * the MCP stdio subprocess. No mocks. All mutating tests scope to an
 * `e2e-th0th-*` projectId that is reset in afterAll.
 *
 * Gating: the whole suite is skipped unless RUN_E2E=1 AND the API /health is
 * reachable (matches the real-api.test.ts self-skip pattern).
 */
import path from "path";

// ── Constants ───────────────────────────────────────────────────────────────

export const API = process.env.MASSA_TH0TH_API_URL ?? "http://localhost:3333";
export const API_KEY = process.env.MASSA_TH0TH_API_KEY ?? "";
export const E2E_ENABLED = process.env.RUN_E2E === "1";

/** One stamp per bun-test process; shared by every file imported in the run. */
export const RUN_STAMP = Date.now().toString(36);
export const PREFIX = "e2e-th0th-";
export const PROJECT_ID = `${PREFIX}self-${RUN_STAMP}`;
export const POLY_PROJECT_ID = `${PREFIX}poly-${RUN_STAMP}`;
export const PROJECT_PATH = path.resolve(import.meta.dir, "../../../../../");
export const POLY_FIXTURE_PATH = path.resolve(import.meta.dir, "./fixtures/polyglot");

export type Backend = "sqlite" | "postgres" | "unknown";

export interface Availability {
  API_UP: boolean;
  OLLAMA_UP: boolean;
  BACKEND: Backend;
  AUTH_REQUIRED: boolean;
  API_KEY: string;
  MCP_BIN: string | null;
  CONFIG_OK: boolean;
  EMBEDDING_MODEL?: string;
}

// ── Prefix guard ────────────────────────────────────────────────────────────

/** Hard guard: refuse to operate on any projectId outside the e2e prefix. */
export function assertE2ePrefix(id: string): void {
  if (!id.startsWith(PREFIX)) {
    throw new Error(
      `Refusing to touch projectId "${id}" — must start with "${PREFIX}" to protect real data.`,
    );
  }
}

// ── Availability probe (cached per process) ─────────────────────────────────

let _avail: Availability | null = null;

export async function probeAvailability(): Promise<Availability> {
  if (_avail) return _avail;

  const fs = await import("fs/promises");
  const MCP_BIN = path.resolve(import.meta.dir, "../../../../../apps/mcp-client/dist/index.js");
  const configPath = path.join(
    process.env.XDG_CONFIG_HOME ?? `${process.env.HOME}/.config`,
    "massa-th0th/config.json",
  );

  let binOk = false;
  try {
    binOk = (await fs.stat(MCP_BIN)).isFile();
  } catch {
    binOk = false;
  }
  let configOk = false;
  try {
    configOk = (await fs.stat(configPath)).isFile();
  } catch {
    configOk = false;
  }

  const API_UP = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok)
    .catch(() => false);

  let OLLAMA_UP = false;
  let BACKEND: Backend = "unknown";
  let AUTH_REQUIRED = false;
  let EMBEDDING_MODEL: string | undefined;

  if (API_UP) {
    try {
      const ollama = await fetch(`${API}/api/v1/system/ollama`, {
        signal: AbortSignal.timeout(4000),
      }).then((r) => r.json() as Promise<any>);
      OLLAMA_UP = !!ollama?.available;
      EMBEDDING_MODEL = ollama?.embeddingModel ?? ollama?.configuredModel;
    } catch {
      OLLAMA_UP = false;
    }
    try {
      const info = await fetch(`${API}/api/v1/system/info`, {
        signal: AbortSignal.timeout(4000),
      }).then((r) => r.json() as Promise<any>);
      const sizes = info?.databases?.sizes;
      if (sizes && typeof sizes === "object") {
        BACKEND = Object.keys(sizes).some((k) => k.endsWith(".db")) ? "sqlite" : "unknown";
      }
    } catch {
      /* leave unknown */
    }
    // Auth probe: a 401 on a protected endpoint without key means auth is on.
    try {
      const noKey = await fetch(`${API}/api/v1/workspace/list`, {
        signal: AbortSignal.timeout(3000),
      });
      AUTH_REQUIRED = noKey.status === 401;
    } catch {
      AUTH_REQUIRED = false;
    }
  }

  _avail = {
    API_UP,
    OLLAMA_UP,
    BACKEND,
    AUTH_REQUIRED,
    API_KEY,
    MCP_BIN: binOk ? MCP_BIN : null,
    CONFIG_OK: configOk,
    EMBEDDING_MODEL,
  };
  return _avail;
}

// ── HTTP client ─────────────────────────────────────────────────────────────

function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", ...extra };
  if (API_KEY) h["x-api-key"] = API_KEY;
  return h;
}

export async function httpGet<T = any>(endpoint: string, query?: Record<string, unknown>): Promise<T> {
  const url = new URL(`${API}${endpoint}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, { method: "GET", headers: apiHeaders(), signal: AbortSignal.timeout(60_000) });
  return (await res.json()) as T;
}

export async function httpPost<T = any>(endpoint: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${endpoint}`, {
    method: "POST",
    headers: apiHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  return (await res.json()) as T;
}

export async function httpRaw(endpoint: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${endpoint}`, { headers: apiHeaders(), signal: AbortSignal.timeout(60_000), ...init });
}

// ── Polling ─────────────────────────────────────────────────────────────────

export async function pollUntil(
  fn: () => Promise<boolean>,
  { timeoutMs = 120_000, intervalMs = 2_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return true;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ── Indexing lifecycle ──────────────────────────────────────────────────────

export interface IndexResult {
  jobId?: string;
  status: string;
  result?: any;
  raw: any;
}

/** POST /project/index (server reads projectPath from local FS) then poll status. */
export async function indexAndAwait(
  projectPath: string,
  projectId: string,
  opts: { forceReindex?: boolean; warmCache?: boolean; timeoutMs?: number } = {},
): Promise<IndexResult> {
  assertE2ePrefix(projectId);
  const start = await httpPost<any>("/api/v1/project/index", {
    projectPath,
    projectId,
    forceReindex: opts.forceReindex ?? true,
    warmCache: opts.warmCache ?? false,
  });
  const jobId: string | undefined = start?.data?.jobId ?? start?.jobId;

  if (!jobId) {
    // Synchronous path — treat as completed.
    return { status: start?.data?.status ?? "completed", raw: start };
  }

  const done = await pollUntil(
    async () => {
      const s = await httpGet<any>(`/api/v1/project/index/status/${jobId}`);
      const st = s?.data?.status;
      return st === "indexed" || st === "completed" || st === "failed";
    },
    { timeoutMs: opts.timeoutMs ?? 300_000, intervalMs: 3_000 },
  );

  const status = await httpGet<any>(`/api/v1/project/index/status/${jobId}`);
  if (!done) throw new Error(`index job ${jobId} did not finish: ${JSON.stringify(status?.data)}`);
  return { jobId, status: status?.data?.status ?? "unknown", result: status?.data?.result, raw: status };
}

export async function getJobStatus(jobId: string): Promise<any> {
  return httpGet<any>(`/api/v1/project/index/status/${jobId}`);
}

// ── Shared index (index ONCE, reuse across every file/run) ───────────────────
// Root-cause fix for the OOM: each embedding-heavy file used to do its own
// full-repo index in beforeAll, and the never-completing indexJobTracker let
// concurrent indexes saturate Ollama until the box OOM'd. This stable PID is
// indexed once (data-plane settle, since the tracker never reaches "completed")
// and reused by every search/symbol/NFR file. NOT reset in afterAll — it
// persists so separate `bun test` invocations skip re-indexing.

export const SHARED_PID = `${PREFIX}shared`;

/** True when the project has searchable vectors for a probe query. */
export async function isSearchable(
  projectId: string,
  query = "ContextualSearchRLM mutex queue serialization",
): Promise<boolean> {
  try {
    const r = await httpPost<any>("/api/v1/search/project", {
      query,
      projectId,
      maxResults: 1,
      minScore: 0.05,
      format: "json",
    });
    return (r?.data?.results?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Distinct probe queries targeting different known symbols/files in the shared
 * repo. Each must return ≥1 hit at minScore 0.05 for the index to be considered
 * GENUINELY warm (not a single borderline file that crept past the old 1-probe
 * gate). Queries are chosen to be strongly findable by the hybrid
 * keyword+vector search: each names a real exported symbol / file in the repo.
 */
export const SHARED_PROBE_QUERIES: readonly string[] = [
  // services/search/contextual-search-rlm.ts — the original N7 query.
  "ContextualSearchRLM mutex queue serialization",
  // services/symbol/centrality.ts — computePageRank export.
  "computePageRank centrality graph",
  // data/vector/postgres-vector-store.ts — addDocuments sub-batch path.
  "postgres vector store addDocuments transaction",
] as const;

/**
 * Strong multi-probe readiness gate for the shared index. Returns true only
 * when EVERY probe query in {@link SHARED_PROBE_QUERIES} returns ≥1 hit. This
 * prevents the old single-probe gate from declaring the store warm on a single
 * borderline file long before the full-repo index has materialized.
 */
export async function isSharedIndexWarm(
  projectId: string = SHARED_PID,
  queries: readonly string[] = SHARED_PROBE_QUERIES,
): Promise<boolean> {
  for (const q of queries) {
    if (!(await isSearchable(projectId, q))) return false;
  }
  return true;
}

let _sharedPromise: Promise<string> | null = null;

/**
 * Ensure the shared repo index exists and is searchable; return its projectId.
 * Idempotent: if a probe query already returns hits, reuse without re-indexing.
 * Cached per-process; the stable SHARED_PID also persists across invocations.
 *
 * Cold-DB caveat (2026-07-12): on a cold/dedicated stack the shared workspace
 * `e2e-th0th-shared` can report `indexed` (251 files) while `vector_documents`
 * is 0 rows — the symbol graph is warm but the vectors haven't been seeded.
 * Vectors re-seed on demand; a full re-index to warm them takes ~95 s. The
 * strong-probe gate below forces this re-index, so callers of
 * `ensureSharedIndex` block until the store is richly searchable.
 */
export function ensureSharedIndex(): Promise<string> {
  if (!_sharedPromise) _sharedPromise = doSharedIndex();
  return _sharedPromise;
}

async function doSharedIndex(): Promise<string> {
  assertE2ePrefix(SHARED_PID);
  // Strong gate: require every probe query to hit. If already richly warm,
  // reuse without re-indexing. (This supersedes the old 1-probe short-circuit
  // which could pass on a single borderline file before the full-repo index
  // had materialized.)
  if (await isSharedIndexWarm(SHARED_PID)) return SHARED_PID;

  const start = await httpPost<any>("/api/v1/project/index", {
    projectPath: PROJECT_PATH,
    projectId: SHARED_PID,
    forceReindex: true,
  });
  const jobId: string | undefined = start?.data?.jobId ?? start?.jobId;

  // Job-status path: poll the index JOB to a terminal state. This is the
  // definitive settle signal when the indexJobTracker cooperates. The known
  // OOM-tracker caveat means this may never reach "completed"/"failed" on a
  // fully cold dedicated stack, so it is best-effort: we race it against the
  // strong data-plane gate below and resolve as soon as BOTH have settled (or
  // the job reaches terminal, whichever framing applies).
  let jobTerminal = false;
  if (jobId) {
    jobTerminal = await pollUntil(
      async () => {
        try {
          const s = await httpGet<any>(`/api/v1/project/index/status/${jobId}`);
          const st = s?.data?.status;
          return st === "indexed" || st === "completed" || st === "failed";
        } catch {
          return false;
        }
      },
      { timeoutMs: 600_000, intervalMs: 5_000 },
    );
  }

  // Strong data-plane gate: never resolve until every probe query returns ≥1
  // hit. This is the load-bearing requirement — the store must be richly warm
  // before N7 (and every other consumer) relies on it. If the job-status path
  // never went terminal (tracker caveat), this gate alone still guards us.
  const warm = await pollUntil(() => isSharedIndexWarm(SHARED_PID), {
    timeoutMs: 600_000,
    intervalMs: 5_000,
  });
  if (!warm) {
    throw new Error(
      `shared index ${SHARED_PID} never became richly searchable ` +
        `(jobId=${jobId ?? "none"}, jobTerminal=${jobTerminal})`,
    );
  }
  console.log(
    `[ensureSharedIndex] ${SHARED_PID} warm (jobId=${jobId ?? "none"}, ` +
      `jobTerminal=${jobTerminal}); ${SHARED_PROBE_QUERIES.length} probe queries all hit.`,
  );
  return SHARED_PID;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export async function resetProject(
  projectId: string,
  scopes: { clearVectors?: boolean; clearSymbols?: boolean; clearMemories?: boolean } = {},
): Promise<any> {
  assertE2ePrefix(projectId);
  return httpPost<any>("/api/v1/project/reset", {
    projectId,
    clearVectors: scopes.clearVectors ?? true,
    clearSymbols: scopes.clearSymbols ?? true,
    clearMemories: scopes.clearMemories ?? true,
  });
}

// ── Matrix equivalence ──────────────────────────────────────────────────────

const VOLATILE_KEYS = new Set([
  "id",
  "memoryId",
  "jobId",
  "checkpointId",
  "handoffId",
  "proposalId",
  "sessionId",
  "createdAt",
  "updatedAt",
  "timestamp",
  "lastIndexedAt",
  "lastAccessedAt",
  "accessCount",
  "accessedAt",
  "expiresAt",
]);

export interface MatrixOpts {
  dropKeys?: string[];
  scoreTolerance?: number;
}

/** Deep-clone with volatile keys dropped and floats tolerated. */
export function normalize(value: any, opts: MatrixOpts = {}): any {
  const tol = opts.scoreTolerance ?? 0.01;
  const extra = new Set(opts.dropKeys ?? []);
  if (Array.isArray(value)) return value.map((v) => normalize(v, opts));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (VOLATILE_KEYS.has(k) || extra.has(k)) continue;
      out[k] = normalize(v, opts);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isInteger(value)) {
    return Math.round(value / tol) * tol; // bucket to tolerance
  }
  return value;
}

/** Assert MCP-parsed payload ≡ HTTP body after normalization. */
export function assertMatrix(
  httpPayload: any,
  mcpPayload: any,
  opts: MatrixOpts = {},
  label = "matrix",
): void {
  const a = normalize(httpPayload, opts);
  const b = normalize(mcpPayload, opts);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new AssertionError(
      `${label} mismatch\n  http: ${JSON.stringify(a).slice(0, 600)}\n  mcp : ${JSON.stringify(b).slice(0, 600)}`,
    );
  }
}

class AssertionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AssertionError";
  }
}

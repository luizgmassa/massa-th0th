# Phase 4 — Bootstrap from Repo: Design

Slug: `phase-4-bootstrap`. Companion to `spec.md`. This design closes
every AC with a concrete, source-anchored mechanism and reuses landed
Phase-1/3 seams verbatim. No new schema, no migration.

## 1. Architecture overview

```
MCP bootstrap ─┐
                     ├─→ POST /api/v1/bootstrap (routes/bootstrap.ts)
API client ──────────┘            │
                                  ▼
                          BootstrapService.bootstrap(projectId, opts)
                                  │
            ┌─────────────────────┼─────────────────────────────┐
            ▼                     ▼                             ▼
   scanSignals(projectRoot)  isBootstrapped?           (if LLM on)
   git/README/docs/          marker tag check           llmObject(prompt,
   manifests/centrality      (injectable seam)          SeedMemoriesSchema)
            │                     │                             │
            │              yes + !force ── no-op ──┐             │
            │                     │ no             │             ▼
            │                     ▼                │      toSeedMemories(batch)
            │              (proceed)               │             │
            ▼                                        │             ▼
   ruleBasedSeed(signals)  ◀────── LLM off / {ok:false} ─── storeSeeds(memories)
            │                                                via MemoryRepository.insert
            └────────────────────► storeSeeds ◄────────────────────┘
                                  │
                                  ▼
                          eventBus.publish("bootstrap:completed")
```

Two pure-ish helper functions (`scanSignals`, `ruleBasedSeed`) + one
LLM-touching path (`summarizeWithLlm`) feed a single `storeSeeds` sink.
The service ctor injects `memoryRepo`, `llm` (LlmSurface),
`isBootstrapped`, `symbolGraph` (centrality), and a `gitRunner` — all
defaulting to real implementations resolved **lazily at run time** (test
isolation, mirroring Phase-3 `ObservationConsolidationJob`).

## 2. Config (R-config, NF1)

Add a `memory.bootstrap` block to `ServerConfig` (additive; mirrors the
Phase-3 `hooks` block precedent at `config/index.ts:93-105, 380-395,
550-555`).

**Interface** (alongside `memory.decay`):
```ts
memory: {
  decay: DecayParams;
  bootstrap: {
    enabled: boolean;          // off-switch (route returns 423 when false)
    maxSeedMemories: number;   // cap on stored seeds per run (default 8)
    centralityLimit: number;   // top-N central files to consume (default 10)
    gitLogLimit: number;       // recent commits to scan (default 20)
    refreshEnabled: boolean;   // allow force=true refresh (default true)
  };
}
```

**defaultConfig** (env-driven via existing `envBool`/`envNum`):
```ts
bootstrap: {
  enabled: envBool("BOOTSTRAP_ENABLED", true),
  maxSeedMemories: envNum("BOOTSTRAP_MAX_SEED_MEMORIES", 8),
  centralityLimit: envNum("BOOTSTRAP_CENTRALITY_LIMIT", 10),
  gitLogLimit: envNum("BOOTSTRAP_GIT_LOG_LIMIT", 20),
  refreshEnabled: envBool("BOOTSTRAP_REFRESH_ENABLED", true),
}
```

**mergeConfig** (shallow-merges nested — same pattern as `hooks`/`decay`):
```ts
memory: {
  ...defaults.memory,
  ...overrides.memory,
  decay: { ...defaults.memory.decay, ...overrides.memory?.decay },
  bootstrap: { ...defaults.memory.bootstrap, ...overrides.memory?.bootstrap },
}
```

LLM summarization inherits the top-level `llm.enabled` gate (default
false, env `RLM_LLM_ENABLED`). No new LLM config keys.

## 3. BootstrapService — public surface

File: `packages/core/src/services/bootstrap/bootstrap-service.ts`.

```ts
export interface BootstrapSeed {
  summary: string;
  type: "pattern" | "code" | "decision";
  level: 0 | 1 | 2;
  importance: number;          // [0,1]
  rationale?: string;
}

export interface BootstrapSignals {
  gitLog: string[];            // recent commit subjects
  readme?: string;             // first N bytes
  docs: Array<{ path: string; snippet: string }>;
  manifests: Array<{ kind: string; name?: string; description?: string; deps?: string[] }>;
  centralFiles: Array<{ filePath: string; score: number }>;
}

export interface BootstrapResult {
  bootstrapped: boolean;
  reason?: string;             // "already-bootstrapped" | "no-signals" | "insert-failed" | "llm-off-rule-based" | ...
  skipped?: boolean;           // true on idempotent no-op
  source: "llm" | "rule-based" | "none";
  bootstrapId?: string;
  seedMemoryIds: string[];
  signalCount: number;
  memoryCount: number;
}

export interface BootstrapOptions {
  projectPath?: string;        // defaults to config.dataDir-derived or cwd
  force?: boolean;             // refresh even if marker exists
}

// Injectable ctor seams (mirror ObservationConsolidationJobOptions)
export interface BootstrapDeps {
  llm?: LlmSurface;                                    // default: real `llm`
  memoryRepo?: MemoryRepoSeam;                         // default: lazy getMemoryRepository()
  isBootstrapped?: (projectId: string) => boolean;     // default: DB marker query
  symbolGraph?: { getTopCentralFiles(id, limit): Promise<CentralityResult[]> };  // default: symbolGraphService
  gitRunner?: (cwd: string, args: string[]) => Promise<{ ok: boolean; stdout: string }>;  // default: spawn git
}

export class BootstrapService {
  constructor(deps: BootstrapDeps = {}) { ... }
  async bootstrap(projectId: string, opts?: BootstrapOptions): Promise<BootstrapResult>;
}

export const bootstrapService: BootstrapService;  // singleton, deps default
export function getBootstrapService(): BootstrapService;
export function resetBootstrapService(): void;     // tests
```

### `MemoryRepoSeam` (test-isolation — dodges the closed-singleton landmine)

```ts
export interface MemoryRepoSeam {
  insert(input: InsertMemoryInput): void | Promise<void>;
  /** Marker query: does any memory tagged `bootstrap:<projectId>` exist? */
  hasBootstrapMarker(projectId: string): boolean;
}
```

The default implementation (used when `deps.memoryRepo` is not provided)
resolves `getMemoryRepository()` lazily inside each method — never at
ctor time. This is the exact Phase-3 trick
(`observation-consolidation-job.ts:96-97`) that keeps the singleton
closed by `memory-crud.test.ts` from poisoning bootstrap tests.

```ts
const injected = deps.memoryRepo;
this.memoryRepo = injected ?? ({
  insert: (i) => getMemoryRepository().insert(i as any),
  hasBootstrapMarker: (pid) => {
    const db = getMemoryRepository().getDb();
    const row = db.prepare(
      "SELECT 1 FROM memories WHERE project_id = ? AND tags LIKE ? AND deleted_at IS NULL LIMIT 1"
    ).get(pid, `%bootstrap:${pid}%`);
    return !!row;
  },
} as MemoryRepoSeam);
```

`hasBootstrapMarker` queries `tags LIKE '%bootstrap:<projectId>%'` — the
marker is the tag itself (no new column, no migration). The
`deleted_at IS NULL` clause means a soft-deleted seed batch is treated
as "not bootstrapped" (a future re-run would re-seed).

## 4. Signal gathering — `scanSignals` (R1)

Pure-ish async helper (file-system + git reads; no DB, no LLM).
Defaults come from the `memory.bootstrap` config block.

```ts
async function scanSignals(
  projectId: string,
  projectRoot: string,
  caps: { gitLogLimit: number; centralityLimit: number },
  symbolGraph: { getTopCentralFiles(id, limit): Promise<CentralityResult[]> },
  gitRunner: (cwd: string, args: string[]) => Promise<{ ok: boolean; stdout: string }>,
): Promise<BootstrapSignals>
```

- **git log**: `gitRunner(root, ["log", "--oneline", "-n", caps.gitLogLimit])`
  → split lines → subjects (drop the leading SHA + space). On `ok:false`
  → `gitLog: []` (not a git repo, or git missing).
- **README**: try `README.md`, `README.markdown`, `README` (case-
  insensitive first match in root). Read first **4 KiB**. Missing →
  `undefined`.
- **docs**: shallow glob `docs/**/*.md` (top 5 by mtime desc), read
  first **2 KiB** each. Uses `fs.readdirSync`/`readFileSync` (no new
  dep; `glob` is available but the shallow case is trivial).
- **manifests**: probe root for `package.json`, `Cargo.toml`,
  `pyproject.toml`, `go.mod`. For `package.json` parse name/
  description/scripts keys + top-level deps keys; for others take first
  **2 KiB** raw. Missing each → skipped.
- **centralFiles**: `await symbolGraph.getTopCentralFiles(projectId,
  caps.centralityLimit)` → map to `{ filePath, score }`. If the project
  is not indexed, this returns `[]` (no throw) — consistent with the
  existing `getProjectMap` behavior (`symbol-graph.service.ts:296-297`
  returns null when workspace missing; here we catch and yield `[]`).

Every step is wrapped in try/catch; a failing step yields its empty
default. `signalCount` = total non-empty signals.

## 5. LLM summarization — `summarizeWithLlm` (R2)

Reuses the Phase-1 `llmObject` + zod. The schema is a **list** of seeds
(unlike Phase-3's single `ConsolidatedBatch`):

```ts
const SeedMemorySchema = z.object({
  summary: z.string().min(1).max(512),
  type: z.enum(["pattern", "code", "decision"]),
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  importance: z.number().min(0).max(1),
  rationale: z.string().optional(),
});

export const SeedMemoriesSchema = z.object({
  memories: z.array(SeedMemorySchema).max(8),
});
export type SeedMemories = z.infer<typeof SeedMemoriesSchema>;
```

The prompt bundles `BootstrapSignals` (truncated, JSON-ish) and
instructs: produce up to `maxSeedMemories` seed memories capturing the
project's architecture / conventions / key decisions / entrypoints;
each must be one of the three types; level defaults to 1 (USER);
importance in [0,1].

```ts
async function summarizeWithLlm(
  signals: BootstrapSignals,
  surface: LlmSurface,
  maxSeedMemories: number,
): Promise<{ ok: true; seeds: BootstrapSeed[] } | { ok: false; reason: string }>
```

- Calls `surface.object(prompt, SeedMemoriesSchema)` (NOT
  `llmObject` directly — the injected `LlmSurface` is the seam; the
  default surface wraps `llmObject`). The default surface's
  `isEnabled()` reads the real config; a test surface's `isEnabled()` is
  authoritative (mirrors `observation-consolidation-job.ts:157-163`).
- `{ok:false}` / throw / schema-invalid → `{ ok:false, reason }`. The
  caller falls back to `ruleBasedSeed`. Never throws.

## 6. Rule-based fallback — `ruleBasedSeed` (R5)

Pure function; no LLM, no DB. Derives 1–3 short seeds from the cheapest
signals when the LLM is off/unavailable:

- **From README**: first non-empty paragraph → 1 `pattern` seed
  ("Project overview: <truncated>"). Skipped if no README.
- **From git log**: the 3 most recent subjects → 1 `decision` seed
  ("Recent direction: <subjects>"). Skipped if no git.
- **From manifests**: if `package.json` has a description, 1 `pattern`
  seed. Skipped if absent.

```ts
function ruleBasedSeed(signals: BootstrapSignals): BootstrapSeed[]
```

Capped at `maxSeedMemories`. Each seed gets `importance: 0.6`,
`level: 1`, `rationale: "rule-based"`.

If `signals` is entirely empty (no README, no git, no manifests) →
returns `[]`. The service then returns
`{ bootstrapped:false, reason:"no-signals", source:"none" }` without
storing or emitting an event.

## 7. `storeSeeds` (R2 store path + idempotency tag)

```ts
async function storeSeeds(
  memoryRepo: MemoryRepoSeam,
  projectId: string,
  bootstrapId: string,
  seeds: BootstrapSeed[],
  signals: BootstrapSignals,
): Promise<string[]>   // new memory ids
```

For each seed (after truncating `summary` to 512 chars and capping at
`maxSeedMemories`):

```ts
const id = `seed-${Date.now()}-${randomUUID().slice(0,8)}`;
memoryRepo.insert({
  id,
  content: seed.summary,
  type: seed.type as MemoryType,
  level: seed.level as MemoryLevel,
  projectId,
  importance: seed.importance,
  tags: ["bootstrap", `bootstrap:${projectId}`],
  embedding: [],                 // seeds have no embedding (FTS-only recall)
  metadata: {
    source: "bootstrap",
    bootstrapId,
    rationale: seed.rationale,
    type: seed.type,
    signalCount: signals.gitLog.length + signals.docs.length + ... ,
  },
  pinned: false,
});
```

Notes:
- `embedding: []` — seed memories are FTS-searchable but not vector-
  searchable. The existing `fullTextSearch` path (`memory-repository.ts:285`)
  works with empty embeddings (it JOINs `memories_fts`, not the
  embedding blob). This is consistent with the Phase-3 consolidation
  bridge (`observation-consolidation-job.ts:225`).
- The `bootstrap:<projectId>` tag is the **idempotency marker** (R3) —
  `hasBootstrapMarker` queries it.
- `MemoryType`/`MemoryLevel` enums are in `@massa-th0th/shared`.

## 8. EventBus event — `bootstrap:completed` (R4)

Added to `EventMap` in `services/events/event-bus.ts`:

```ts
/** Phase 4: emitted after a successful bootstrap stores ≥1 seed memory. */
"bootstrap:completed": {
  projectId: string;
  bootstrapId: string;
  seedMemoryIds: string[];
  source: "llm" | "rule-based";
  signalCount: number;
  memoryCount: number;
};
```

Published once, after `storeSeeds` returns ≥1 id. NOT published on a
no-op (`skipped:true`) or an empty-seed run (`source:"none"`).

## 9. Control flow — `bootstrap(projectId, opts)`

```ts
async bootstrap(projectId, opts = {}): Promise<BootstrapResult> {
  // 1. enabled gate (config.memory.bootstrap.enabled)
  //    (route also checks this → 423; service is defensive)

  // 2. idempotency check (R3)
  if (!opts.force && this.deps.isBootstrapped(projectId)) {
    return { bootstrapped:false, skipped:true, reason:"already-bootstrapped",
             source:"none", seedMemoryIds:[], signalCount:0, memoryCount:0 };
  }

  // 3. gather signals (R1) — never throws
  const root = opts.projectPath ?? defaultProjectRoot(projectId);
  const signals = await scanSignals(projectId, root, caps, this.symbolGraph, this.gitRunner);

  // 4. summarize (R2) with silent fallback to rule-based (R5)
  let seeds: BootstrapSeed[];
  let source: "llm" | "rule-based";
  let llmOn = false;
  try { llmOn = this.llm.isEnabled(); } catch { llmOn = false; }
  if (llmOn) {
    const res = await summarizeWithLlm(signals, this.llm, caps.maxSeedMemories);
    if (res.ok) { seeds = res.seeds; source = "llm"; }
    else { seeds = ruleBasedSeed(signals); source = "rule-based"; }
  } else {
    seeds = ruleBasedSeed(signals);
    source = "rule-based";
  }

  // 5. empty → skip
  if (seeds.length === 0) {
    return { bootstrapped:false, reason:"no-signals", source:"none",
             seedMemoryIds:[], signalCount: countSignals(signals), memoryCount:0 };
  }

  // 6. store (R2 store + R3 marker) — try/catch → insert-failed
  const bootstrapId = `boot-${Date.now()}-${randomUUID().slice(0,8)}`;
  let ids: string[];
  try {
    ids = await storeSeeds(this.memoryRepo, projectId, bootstrapId, seeds.slice(0, caps.maxSeedMemories), signals);
  } catch (e) {
    logger.warn("bootstrap: storeSeeds failed", { projectId, error: (e as Error).message });
    return { bootstrapped:false, reason:"insert-failed", source,
             seedMemoryIds:[], signalCount: countSignals(signals), memoryCount:0 };
  }

  // 7. emit (R4)
  eventBus.publish("bootstrap:completed", {
    projectId, bootstrapId, seedMemoryIds: ids, source,
    signalCount: countSignals(signals), memoryCount: ids.length,
  });

  return { bootstrapped:true, source, bootstrapId, seedMemoryIds: ids,
           signalCount: countSignals(signals), memoryCount: ids.length };
}
```

## 10. MCP tool + API route (R6)

**MCP tool** (`apps/mcp-client/src/tool-definitions.ts`, appended to
`TOOL_DEFINITIONS` before the closing `]`):
```ts
{
  name: "bootstrap",
  description: "Scan a project (git log, README, docs, manifests, top central files) and create LLM-summarized seed memories so an agent begins with usable context. Idempotent — skips if already bootstrapped unless force=true. LLM-off degrades to rule-based seeds.",
  apiEndpoint: "/api/v1/bootstrap",
  apiMethod: "POST",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Project identifier" },
      projectPath: { type: "string", description: "Project root (defaults to cwd)" },
      force: { type: "boolean", default: false, description: "Refresh even if already bootstrapped" },
    },
    required: ["projectId"],
  },
},
```
Dispatch is the generic POST path (`apps/mcp-client/src/index.ts:169`) →
`apiClient.post("/api/v1/bootstrap", args)`. No new MCP-side code.

**API route** (`apps/tools-api/src/routes/bootstrap.ts`, mirroring
`routes/hooks.ts`):
```ts
import { getBootstrapService } from "@massa-th0th/core";
import { config, logger } from "@massa-th0th/shared";
import { Elysia, t } from "elysia";

let cached: ReturnType<typeof getBootstrapService> | null = null;
function service() { if (!cached) cached = getBootstrapService(); return cached; }

function bootstrapDisabled(): boolean {
  try { return config.get("memory").bootstrap.enabled === false; } catch { return false; }
}

export const bootstrapRoutes = new Elysia({ prefix: "/api/v1/bootstrap" })
  .post("/", async ({ body, set }) => {
    if (bootstrapDisabled()) { set.status = 423; return { status: 423, error: "bootstrap disabled" }; }
    const { projectId, projectPath, force } = body as any;
    if (!projectId || !String(projectId).trim()) { set.status = 400; return { status: 400, error: "projectId required" }; }
    try {
      const result = await service().bootstrap(projectId, { projectPath, force });
      set.status = result.bootstrapped ? 200 : (result.skipped ? 200 : 200);
      return { success: true, data: result };
    } catch (e) {
      logger.error("bootstrap failed", e as Error);
      set.status = 500;
      return { success: false, error: `bootstrap failed: ${(e as Error).message}` };
    }
  }, {
    body: t.Object({
      projectId: t.String(),
      projectPath: t.Optional(t.String()),
      force: t.Optional(t.Boolean()),
    }),
    detail: { tags: ["bootstrap"], summary: "Bootstrap seed memories from repo signals",
              description: "Scans git/README/docs/manifests/centrality and stores seed memories. Idempotent." },
  });
```

Registered in `apps/tools-api/src/index.ts`:
- import: `import { bootstrapRoutes } from "./routes/bootstrap.js";`
- chain: `.use(bootstrapRoutes)` after `.use(hookRoutes)`.

## 11. Test-isolation strategy (load-bearing)

Mirrors Phase-3 exactly (`observation-consolidation-job.test.ts`):
- Do NOT `mock.module("@massa-th0th/shared")` (process-wide collision).
- Inject a **fake `MemoryRepoSeam`** that captures inserts + controls
  `hasBootstrapMarker` — avoids the closed-`MemoryRepository` singleton
  landmine.
- Inject a **fake `LlmSurface`** (enabled/disabled/failing) — same
  shape as Phase-3 (`consolidator.LlmSurface`).
- Inject a **fake `symbolGraph`** (returns fixed centrality) — no DB.
- Inject a **fake `gitRunner`** (returns fixed `git log` stdout) — no
  subprocess.
- Use a **temp project root** with fixture README/manifest files for
  `scanSignals` (real fs reads; isolated under `os.tmpdir()`).

This keeps `bootstrap-service.test.ts` fully deterministic and
side-effect-free.

## 12. Reuse summary (no reinvention)

| Need | Reuse (file:symbol) | Reinvented? |
| --- | --- | --- |
| LLM call | `services/memory/llm-client.ts` → `llm`, `LlmResult`; `consolidator.LlmSurface` | NO |
| Memory store | `MemoryRepository.insert` (`InsertMemoryInput`) + `getDb()` for marker query | NO |
| Searchability | `MemoryRepository.fullTextSearch` (FTS5, existing) | NO |
| Centrality | `SymbolGraphService.getTopCentralFiles` (PageRank ETL output) | NO |
| EventBus | `eventBus.publish` + `EventMap` (Phase-1/2/3 precedent) | NO |
| Config | `config.get("memory").bootstrap` (additive block, env helpers `envBool`/`envNum`) | NO |
| Test seam pattern | `ObservationConsolidationJob` ctor + lazy `memoryRepo` (`observation-consolidation-job.ts:90-102`) | NO |
| Tool wiring | `TOOL_DEFINITIONS` array + generic POST dispatch | NO |
| Route pattern | `routes/hooks.ts` (Elysia prefix, lazy cached service, disabled→423) | NO |

## 13. Migration / schema delta

**None.** Seed memories are rows in the existing `memories` table. The
idempotency marker is a tag (`bootstrap:<projectId>`) queryable via
`tags LIKE` + the existing FTS index. No `ALTER TABLE`, no new table.

## 14. Risk / accepted assumptions

1. **Seed memories have no embeddings.** They are FTS-searchable but not
   vector-searchable. Consistent with Phase-3 consolidation output. Low
   risk: bootstrap seeds are keyword-retrieval targets ("architecture",
   "convention", project name); vector search is not the primary path.
2. **Marker = tag, not a dedicated column/table.** `tags LIKE
   '%bootstrap:<projectId>%'` is O(rows) but bootstrap is rare (once per
   project) and the `memories` table is indexed by `project_id`. A
   future dedicated `bootstrap_state` table can replace this without
   contract change.
3. **Refresh does not delete prior seeds.** `force=true` stores a fresh
   batch alongside the old one (the consolidation job may later
   SUPERSEDE them). Documented refresh behavior; avoids data loss.
4. **No OS-level scheduler.** Bootstrap is on-demand (MCP/route). A
   future periodic refresh is additive.
5. **`projectPath` default.** When `opts.projectPath` is absent the
   service derives a root from the project's indexed workspace path if
   available, else `process.cwd()`. The route requires `projectId`; the
   path is best-effort.
6. **Same-author verification** (sole agent). Mitigated by per-AC
   evidence table, discrimination sensor, and the objective gate.

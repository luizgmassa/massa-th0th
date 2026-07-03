# Phase 5 — Auto-improvement loop (G7): Design

Slug: `phase-5-auto-improve`. Companion to `spec.md`. Mirrors the Phase-3/6
architecture (job + store + service + route + barrel) and reuses their
proven seams. SQLite-canonical; LLM local-first default-off + silent degrade.

## 1. Component map

```
observation:ingested ──► AutoImproveJob.maybeRun(projectId)   [debounce trigger]
                              │
                              ▼
                     observationStore.listRecent(projectId, maxWindow)
                              │
                              ▼
                     detectPatterns(observations, thresholds)   [pure, rule-based]
                              │  (candidates: ProposalRecord[pending])
                              ▼
              ┌──── llm.isEnabled()? ──► enrichWithLlm(candidates, observations)
              │                                │  ({ok:false}/throw → candidates verbatim)
              ▼                                ▼
        reviewGate=true                  reviewGate=false (default)
        proposalStore.insert(pending)    proposalStore.insert(pending)
              │                                │
              ▼                                ▼
        (surface via tools)             autoApply: memoryRepo.insert/update
                                              │
                                              ▼
                                    proposalStore.setStatus(approved, decidedAt)
                                              │
                                              ▼
                                    eventBus.publish("memory:auto-improved")
                                              │
                                              ▼
                                    logger.info("auto-approved", audit)
```

Explicit `approve(id)` / `reject(id)` (review-gate path or any caller):
load → pending guard → apply (approve only) → flip status → emit (approve
only). Mirrors `HandoffService.terminate`.

## 2. Pattern-detection heuristics (pure, deterministic, no LLM)

`detectPatterns(observations: Observation[], thresholds): Candidate[]` lives
in a pure helper module so it is trivially unit-testable. It parses each
observation's `payloadJson` defensively (`try`/`catch`, never throws) and
counts:

| Signal | Source filter | Key extraction | Threshold (default) | Proposal kind |
| --- | --- | --- | --- | --- |
| Repeated query | `source === "user-prompt"` | `payload.prompt` (string) lowercased + tokenized to a stable signature (top-3 stems, stopword-stripped) | `minQueryHits` (3) | `memory.create` (a `pattern`/`decision` memory capturing the recurring question) |
| Hot file | `source === "post-tool-use"` | `payload.filePath` (or `payload.tool_input.file_path`) normalized to repo-relative | `minFileHits` (3) | `memory.tag` if a known memory references it, else `memory.create` (a `code`/`pattern` memory noting the hot file) — v1 emits `memory.create` (no FTS lookup in the hot path to keep it cheap) |
| Common fix | `source === "post-tool-use"` | `payload.tool` + edit-kind signature (e.g. `Edit` recurring on similar paths) | `minFixHits` (2) | `memory.create` (`pattern`) |

Each candidate carries: `kind`, `targetMemoryId?` (null for create),
`payload` (the typed edit), `rationale` (e.g. `"file 'src/auth.ts'
referenced in 4 post-tool-use observations"`), and a `signalKey` used for
dedup within the window. The window is bounded by `maxWindow` (default 16).
The function is total: bad/missing payload fields are skipped, never thrown.

## 3. Proposal schema + migrations (both backends)

### SQLite (`packages/core/src/data/proposal/proposal-repository.ts`)

```sql
CREATE TABLE IF NOT EXISTS proposals (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  kind             TEXT NOT NULL,           -- memory.create | memory.update | memory.tag
  target_memory_id TEXT,                    -- nullable; null for memory.create
  payload_json     TEXT NOT NULL,           -- typed edit payload
  rationale        TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at       INTEGER NOT NULL,
  decided_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_proposals_project_status ON proposals(project_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at DESC);
```

DB file `proposals.db` (WAL + `busy_timeout=3000`), separate from
`memories.db` / `observations.db` / `handoffs.db` (mirrors Phase-6).
Lazy-open so constructing the store is side-effect-free. `getProposalStore()`
probes (forces schema create) and falls back to `MemoryProposalStore` on
throw — exactly mirrors `getHandoffStore()`.

### Prisma (`packages/core/prisma/schema.prisma`)

```prisma
model Proposal {
  id              String    @id
  projectId       String    @map("project_id")
  kind            String    // memory.create | memory.update | memory.tag
  targetMemoryId  String?   @map("target_memory_id")
  payloadJson     String    @map("payload_json")
  rationale       String    @default("")
  status          String    @default("pending") // pending | approved | rejected
  createdAt       DateTime  @default(now()) @map("created_at")
  decidedAt       DateTime? @map("decided_at")

  @@index([projectId, status])
  @@map("proposals")
}
```

Additive only; no ALTER to existing tables. No PgProposalStore code yet
(SQLite-canonical runtime state, mirrors observations/handoffs).

## 4. Review-gate vs auto-approve (default auto-approve + logging)

`memory.autoImprove.reviewGate` (default `false`). The job reads it once per
`runOnce`:

- `false` (default): each pending proposal is auto-applied in the same
  `runOnce` turn. The apply step reuses the explicit `approve()` path
  (single code path — auto-approve calls `this.approve(record.id)` so the
  state machine + event emission is identical). An injected logger sink
  records `"auto-approved"` (audit trail = the row's `decidedAt` + the
  `memory:auto-improved` event + the log line).
- `true`: proposals stay `pending`; surfaced via `list_proposals` +
  `approve_proposal`.

Default-off review gate matches the plan ("default auto-approve with
logging"). Auto-approve is observable: the event fires and the row flips.

## 5. Audit trail

Every approved/rejected proposal carries:
- `status` (`approved` | `rejected`) + `decidedAt` (the decision timestamp).
- `rationale` (the rule-based or LLM-enriched justification).
- The `memory:auto-improved` event (approved only) with `proposalId`,
  `kind`, `targetMemoryId?`, `source` (`"rule-based"` | `"llm"`), `appliedAt`.
- A `logger.info("proposal:auto-approved" | "proposal:approved" |
  "proposal:rejected", { id, projectId, kind })` line.

The audit trail is sufficient to reconstruct what was proposed, why, and
when it was decided — without a separate audit table (the proposals row IS
the audit record; status + decidedAt are the decision).

## 6. Apply / reject state machine

```
                ┌──────────┐
   insert ────► │ pending  │
                └────┬─────┘
            approve  │  reject
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌───────────┐             ┌───────────┐
  │ approved  │             │ rejected  │   (both terminal)
  └───────────┘             └───────────┘
```

- `approve(id, projectId?)`: missing → `not-found`; non-pending → `not-pending`;
  project mismatch → `project-mismatch`; apply throw → `apply-failed`
  (status unchanged); else apply + flip + emit.
- `reject(id, projectId?)`: missing → `not-found`; non-pending → `not-pending`;
  project mismatch → `project-mismatch`; else flip to `rejected` + `decidedAt`
  (no apply, no event).
- Defense-in-depth: the SQLite `setStatus` uses `WHERE status='pending'`;
  the service post-checks `updated.status !== target` → `store-failed`
  (mirrors HandoffService).

## 7. LLM use + degradation

The LLM is consulted **only** when `llm.isEnabled()` (Phase-1 gate, env
`RLM_LLM_ENABLED`, default off). `enrichWithLlm(candidates, observations)`
issues a single `llm.object(prompt, ProposalEnrichmentSchema)` call that
returns refined `{ content, rationale }` drafts per candidate. Contract:

- `{ok:false}` (disabled / timeout / invalid) → return candidates verbatim.
- throw → caught, return candidates verbatim.
- `{ok:true}` with a candidate whose `kind` is invalid → schema-validated
  out (zod), that candidate falls back to its rule-based draft.

The rule-based `detectPatterns` runs **first** and unconditionally; the LLM
only refines. Therefore P5-DEGRADE-01/02 hold by construction: pattern
detection NEVER requires the LLM.

## 8. EventBus `memory:auto-improved`

Added to `EventMap`:

```ts
"memory:auto-improved": {
  proposalId: string;
  projectId?: string;
  kind: "memory.create" | "memory.update" | "memory.tag";
  targetMemoryId?: string;
  status: "approved";
  appliedAt: number;
  source: "llm" | "rule-based";
};
```

Published once per successful apply (auto-approve OR explicit approve). NOT
published on reject / no-op / throw / non-pending.

## 9. Config keys

Additive nested block under `ServerConfig.memory` (alongside `decay` +
`bootstrap`):

```ts
memory.autoImprove: {
  enabled: boolean;          // envBool AUTO_IMPROVE_ENABLED, default true (rule-based, no LLM dep)
  reviewGate: boolean;       // envBool AUTO_IMPROVE_REVIEW_GATE, default false (auto-approve)
  minObservations: number;   // envNum AUTO_IMPROVE_MIN_OBS, default 8
  minIntervalMs: number;     // envNum AUTO_IMPROVE_MIN_INTERVAL_MS, default 300_000 (5 min)
  maxWindow: number;         // envNum AUTO_IMPROVE_MAX_WINDOW, default 16
  minQueryHits: number;      // envNum AUTO_IMPROVE_MIN_QUERY_HITS, default 3
  minFileHits: number;       // envNum AUTO_IMPROVE_MIN_FILE_HITS, default 3
  minFixHits: number;        // envNum AUTO_IMPROVE_MIN_FIX_HITS, default 2
}
```

`mergeConfig` shallow-merges `memory.autoImprove` (one-level deep, like
`memory.bootstrap`). The job's ctor reads config defensively (try/catch +
spec-default fallback, mirroring `readBridgeConfig` in Phase-3) so test
files that mock shared config process-wide and omit the block don't break.

## 10. Auto-improve-job exports

`packages/core/src/services/jobs/auto-improve-job.ts`:
- `AutoImproveJob` (class, ctor `AutoImproveJobOptions`).
- `detectPatterns` (pure helper, exported for unit tests).
- `enrichWithLlm` (pure helper, exported for unit tests).
- `PROPOSAL_KINDS`, `ProposalEnrichmentSchema`.
- singleton `autoImproveJob` + `getAutoImproveJob()`/`resetAutoImproveJob()`.
- Types: `AutoImproveJobOptions`, `AutoImproveResult`, `PatternThresholds`,
  `PatternCandidate`, `ProposalEnrichment`, `MemoryApplySeam`.

## 11. Test-isolation strategy (extends Phase-1..6 rule)

`auto-improve-job.test.ts` does NOT mock `@massa-th0th/shared`. It injects:
- `MemoryProposalStore` (in-memory) for proposal persistence.
- `MemoryObservationStore` (in-memory) pre-loaded with deterministic
  observations carrying the recurring file/query/fix signals.
- a fake `MemoryApplySeam` (captures inserts/updates; controls success/throw).
- a fake `LlmSurface` (enabled/disabled/failing) for the degradation tests.
- explicit thresholds + a deterministic `idFactory`.

No `mock.module`. The single P5-SEARCH-01-style integration block (if any)
resets the MemoryRepository singleton to a temp DB (mirrors P4/P6-SEARCH-01).
The proposal-repository test uses an explicit temp `dbPath`.

## 12. Reuse ledger (do not reinvent)

| Need | Reuse |
| --- | --- |
| LLM | `services/memory/llm-client.ts` `llm` handle (`{complete,object,isEnabled}`). |
| Observations | `getObservationStore()` → `listRecent(projectId, n)`. |
| Memory apply | `MemoryRepository.insert` (create/tag) / `update` (update). |
| Job pattern | `ObservationConsolidationJob` ctor seam + `maybeRun`/`runOnce` debounce. |
| Store pattern | `HandoffStore` / `getHandoffStore()` factory + WAL + lazy open. |
| State machine | `HandoffService.terminate` guards + `setStatus WHERE` defense-in-depth. |
| Route pattern | `routes/handoff.ts` 423/400/200 + Elysia prefix + swagger tag. |
| Tool pattern | `tool-definitions.ts` handoff entries (name/desc/apiEndpoint/inputSchema). |
| Config | `envBool`/`envNum` + `mergeConfig` shallow-merge nested block. |
| EventBus | `EventMap` entry + `eventBus.publish`. |

## 13. Risks + mitigations

| Risk | Mitigation |
| --- | --- |
| Pattern detection false-positives flood proposals | Thresholds default 3/3/2; window capped at 16; dedup by signalKey within a run; auto-approved proposals are themselves memories subject to Phase-1 decay (self-correcting). |
| Auto-approve applies a bad edit | Apply reuses the explicit `approve()` path (single code path); memory insert is best-effort + logged; `apply-failed` leaves the proposal pending for retry/review. Reviewers can flip `reviewGate=true`. |
| LLM enrichment changes a `kind` to something invalid | zod schema-validated out; rule-based candidate survives. |
| Closed MemoryRepository singleton in full suite | ctor-seam `MemoryApplySeam` injection (mirrors Phase-3/4/6). |
| Concurrent `runOnce` for same project | Debounce trigger is fire-and-forget; insert is idempotent per signalKey within a window (best-effort). |

## 14. Sequencing (tasks.md maps 1:1)

1. spec/design/tasks (this commit).
2. config + EventMap + Proposal table + Prisma model + ProposalStore factory.
3. auto-improve-job (detectPatterns + enrichWithLlm + runOnce + approve/reject
   + auto-approve path + singleton).
4. MCP tools + API route + core barrel.
5. tests + validation + integration ledger.

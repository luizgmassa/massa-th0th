# Hook Attribution Repair — Design

**Spec**: `.specs/features/hook-attribution-repair/spec.md`
**Status**: Approved (approach user-confirmed 2026-07-20: server + emitters, fail-open + provenance)

---

## Architecture Overview

One application-layer attribution resolver in core, invoked pre-enqueue at every hook ingestion path, backed by a cached workspace-root provider and a bounded in-memory session pin store. Emitters pin per session as a first line. Persistence gains two additive nullable columns. A separate idempotent repair migration fixes history. M16+M17 alias resolution remains the final canonicalization at the repo seam, unchanged.

```mermaid
graph TD
    A[Claude hooks / OpenCode plugin / MCP hook_ingest] --> B[hook routes: single, batch, compact-snapshot]
    B --> C[HookService ingestOne/ingestBatch]
    C --> D[AttributionResolver]
    D --> E[explicit: live workspace or alias]
    D --> F[sticky: session pin map]
    D --> G[containment: canonical cwd in workspace roots, broad-root excluded]
    D --> H[verbatim: fail-open]
    E|F|G|H --> I[WriterQueue single writer]
    I --> J[PgObservationStore.insert: persist agent_id + attribution_source, alias-resolve final id, mirror keyed canonically]
    J --> K[eventBus observation:ingested]
    M[repair migration] -.one-shot, idempotent.-> J
```

## Approach Tradeoffs (Large)

| Approach | Summary | Verdict |
| --- | --- | --- |
| **A. App-layer resolver in HookService + emitter pinning (chosen)** | Resolver module in core, pre-enqueue; provenance persisted; emitters pin session id | Chosen — user-confirmed; choke point covers all 3 routes + MCP; DB-free unit-testable; matches M16+M17 app-layer resolution architecture |
| B. Repo-seam-only resolution (inside `PgObservationStore.insert`) | Resolve next to alias resolve | Rejected — too late: mirror, event payload, and consolidation already keyed by raw id; no clean access to session context; cannot stamp provenance honestly |
| C. DB-function/trigger containment resolution | SQL resolves at insert | Rejected — hides behavior in DB, not DB-free testable, conflicts with the app-layer precedent set by M16+M17 (triggers are backstop-only), sanitized-error contract harder |

## Requirements Traceability

| Req | Component(s) | Verification |
| --- | --- | --- |
| HAR-01 | `attribution-resolver.ts`, `hook-service.ts` wiring | unit (order matrix) + acceptance |
| HAR-02 | resolver containment + canonicalize | unit (nested/ambiguous/zero match) + acceptance |
| HAR-03 | resolver broad-root exclusion | unit + acceptance |
| HAR-04 | `session-pin-store.ts`, HookService, `_post.sh`/`session-start.sh`/`pre-compact.sh`, opencode plugin | unit + script tests + acceptance |
| HAR-05 | migration 1 (columns), observation contract, repo persist | acceptance |
| HAR-06 | migration 1, hook-service pass-through, repo persist | acceptance |
| HAR-07 | `observation-repository-pg.ts` mirror keyed canonically | acceptance (alias insert then read canonical) |
| HAR-08 | migration 2 (repair) | acceptance (seed/repair/re-run) |
| HAR-09 | resolver try/catch → verbatim + sanitized warn | unit + acceptance probe |
| HAR-10 | acceptance suite + turbo `passThroughEnv` + full gates | gate runs |

## Current Codebase Evidence

- Ingest seams: `packages/core/src/services/hooks/hook-service.ts:183` (`ingestOne`), `:230` (`ingestBatch`); validation `:100-105`; agentId normalized `:134-135` then dropped `:192-201,252-261`.
- Compact-snapshot route `apps/tools-api/src/routes/hooks.ts:140-164` — wiring target verified in T3 (must route through the same resolver; if it bypasses HookService, resolver is applied at its handler).
- Observation persistence: `packages/core/src/data/memory/observation-repository-pg.ts:181` alias seam; `:160-161` mirror raw-id bug; `:213-236` readers.
- Alias resolver pattern to reuse: `packages/core/src/services/project-identity/alias-resolver.ts:80-98` (fail-open, 30s TTL cache, 250ms timeout).
- Canonicalization precedent: `packages/core/src/tools/index_project.ts:37-42`; `apps/tools-api/src/routes/workspace.ts:85-91` (`realpathSafe`), containment check `:488-497`.
- Workspace roots source: `workspaces` table (`project_id`, `project_path` canonical by construction via `index_project.ts:128-131`), manager `workspace-manager.ts:39-55`.
- Repair template: `packages/core/prisma/migrations/20260714170000_add_graph_generations/migration.sql:128-205` (backfill + `DO $$` verification).
- Script patterns: `apps/claude-plugin/hooks/_post.sh:44`, `session-start.sh`, `pre-compact.sh:13`; tests `packages/core/src/__tests__/hook-scripts.test.ts:28-84`.
- Plugin patterns: `apps/opencode-plugin/src/index.ts:118`, `observation-emitter.ts:243`; tests `packages/core/src/__tests__/observation-emitter.test.ts:180-291`.
- Identity acceptance gate pattern: `IDENTITY_ACCEPTANCE_DATABASE_URL` + `turbo.json passThroughEnv` (T7 identity feature).

## Active Decision Handling

Conform to AD-004/005/006 (exact Bun 1.3.11 gate runtime, pinned native stack — test gates only; this feature touches no native code). No supersession needed. Bun pg caveat honored: resolver runs sequential single queries on the lazy `getPool()` connection; no pipelining, no wrapper callback drops (T6 lesson).

## Components

### AttributionResolver (`packages/core/src/services/hooks/attribution-resolver.ts`)

- **Purpose**: resolve `{callerProjectId, sessionId?, cwd?}` → `{projectId, source}`.
- **Interfaces**:
  - `resolve(input: AttributionInput): Promise<AttributionResult>` — order: explicit → sticky → containment → verbatim.
  - `WorkspaceRootProvider` (interface): `listRoots(): Promise<Array<{projectId, projectPath}>>` — PG impl cached 30s TTL + 250ms timeout, fail-open to empty (→ containment simply never matches).
- **Logic**:
  - Roots are **deduplicated by `project_path`** before matching: identical paths collapse to one candidate root carrying its live id set; a matched shared path is ambiguous unless the caller self-matches — which is decided at the explicit tier (raw + canonical live check), not inside containment.
  - explicit: caller id is a live workspace id OR alias-resolves to one (reuse `getProjectIdentityAliasResolver`) → `source:'explicit'`. Self-match across a path-sharing id set lands here automatically.
  - sticky: pin map hit for `sessionId` → `source:'sticky'`; the hit re-pins so expiry refreshes for long-lived sessions.
  - containment: `canonicalize(cwd)` (realpathSync, fallback `path.resolve`; fs failure → fall through) matched against non-broad deduped roots (trailing separators normalized, empty paths excluded); longest path match wins; single-id match → `source:'containment'`; shared-path match → ambiguous → verbatim. Zero matches → verbatim.
  - broad-root: root `=== path.parse(root).root` or `=== os.homedir()` excluded from matching.
  - verbatim: `source:'verbatim'`, caller id unchanged.
  - On success with source ∈ {explicit, sticky, containment} and `sessionId` present → (re)pin session.
  - Any internal error → catch → `{projectId: caller, source:'verbatim'}` + sanitized warn (error name only; no SQL, no paths, no caller ids).
- **Reuses**: alias-resolver pattern; `realpathSafe` semantics; `canonicalizeProjectRoot` semantics.

### SessionPinStore (`packages/core/src/services/hooks/session-pin-store.ts`)

- **Purpose**: bounded TTL pin map `sessionId → projectId`.
- **Interfaces**: `get(sessionId): string|undefined`, `set(sessionId, projectId)`, `clear()` (tests).
- **Bounds**: max 1000 entries (oldest-access evict), TTL 24h lazy expiry. Process-local; loss degrades to containment/verbatim (contract-legal).

### HookService wiring (`hook-service.ts`, modify)

- Run resolver in `ingestOne`/`ingestBatch` (and compact-snapshot path if separate) after validation, before enqueue; set `Observation.agentId` (already normalized) and `Observation.attributionSource`; `projectId` = resolved id.

### Observation persistence (`observation-repository-pg.ts`, modify)

- Persist `agent_id`, `attribution_source` (additive columns from migration 1).
- Mirror keyed by the same canonical id computed for the durable row (fix `:160-161`), keeping read API unchanged.
- Existing alias resolve stays as final canonicalization.

### Emitter pinning

- `apps/claude-plugin/hooks/_pin.sh` (new sourced helper): `massa_ai_pin_project_id <session_id> <cwd>` echoes the pinned id — if pin file `${TMPDIR:-/tmp}/massa-ai-hooks/<sanitized-session_id>` exists, cat it; else compute `$MASSA_AI_PROJECT_ID` > `git -C <cwd> rev-parse --show-toplevel` basename > `basename <cwd>`, write pin, echo. **Constraint (plan-critic C3): `_post.sh:21-25` consumes stdin once; pin logic MUST run after stdin capture inside `_post.sh`/`pre-compact.sh`, never in a pre-read wrapper — otherwise the POST body is empty and the script silently exits 0.** Any first event type of a session writes the pin; no special role for `session-start.sh` (keeps its current shape).
- `_post.sh` / `pre-compact.sh`: after existing stdin capture, replace the bare `basename "$PWD"` fallback with the `_pin.sh` call. Silent-degrade (exit 0) preserved; git absence tolerated.
- `apps/opencode-plugin/src/index.ts`: per-session memo of the computed id (`project?.id` > git toplevel basename > directory basename > `"default"`), reused by all emitters for that session; populate `agentId` on emit paths from the host context (HAR-06).

### Compact-snapshot seam (plan-critic C4)

- Wire body gains optional `cwd` (`pre-compact.sh` has `$PWD`; plugin has `projectPath`).
- `CompactSnapshotTool.handle` currently persists directly (`compact_snapshot.ts:80`), bypassing HookService — its persist path routes through the same AttributionResolver before `store.insert`. Route-level test replaces the weaker code-inspection gate.

### Shared-DB grooming runbook (ops, NOT executed by this feature)

Plan-critic C1/C2 verified the dev DB holds duplicate (`e2e-ai-shared` ≡ `massa-ai-self-test` at the same root), nested (`e2e-ai-verify-586`), and `/tmp` (`partial`) workspace rows. Design hardening (path dedupe, self-match, ambiguous-safe) keeps the resolver honest under this shape, but full real-DB effect requires grooming: retire junk/test registrations and register the canonical `massa-ai` workspace id. **Execution requires explicit user approval; `e2e-ai-shared` is intentionally preserved per standing ops decision (original-suite shared index, do not delete).** Runbook lives here as documentation; recommended before running the repair migration against the shared dev DB:

1. `SELECT project_id, project_path FROM workspaces ORDER BY project_path;` — inventory.
2. Retire rows whose path no longer exists or that are suite leftovers except `e2e-ai-shared` (user confirms each).
3. Register canonical id for the main repo if absent (index run with explicit `projectId`).
4. Re-run repair migration dry counts; inspect `DO $$` notices before commit.

### Migrations (`packages/core/prisma/migrations/`)

1. `YYYYMMDDHHMMSS_add_observation_attribution/migration.sql` — `ALTER TABLE observations ADD COLUMN IF NOT EXISTS agent_id TEXT`, `ADD COLUMN IF NOT EXISTS attribution_source TEXT`. Additive, reversible, no backfill.
2. `YYYYMMDDHHMMSS_repair_hook_attribution/migration.sql` — explicit `BEGIN…COMMIT`:
   - Candidate observations: `project_id IS NULL OR project_id='default' OR NOT EXISTS (live-or-alias id match)` — **NULL-safe `NOT EXISTS`, never `NOT IN` over a nullable subquery** (a single NULL silently zeroes the candidate set while self-verify passes on a consistent zero).
   - Match against **path-deduplicated** live roots (`DISTINCT project_path`; paths shared by >1 live id are excluded from single-match), excluding `project_path='/'`: `cwd = project_path OR cwd LIKE project_path || '/%'`, longest match, exactly one → `UPDATE … SET project_id=match, attribution_source='repaired'` **and preserve the old id** via `payload_json = jsonb_set(payload_json::jsonb, '{_pre_repair_project_id}', to_jsonb(old project_id), true)::text`.
   - Candidate memories (same NULL-safe predicate): repair only when their `session_id` yields exactly one distinct live/repaired project across that session's observations; preserve old id via `metadata` `jsonb_set` the same way.
   - `DO $$` block: before/after candidate counts, repaired counts, remaining counts; `RAISE NOTICE`; `RAISE EXCEPTION` if a produced id is not live or repaired > candidates.
   - Idempotent: second run matches zero unambiguous candidates.

## Data Models

```sql
ALTER TABLE observations ADD COLUMN IF NOT EXISTS agent_id TEXT;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS attribution_source TEXT; -- explicit|sticky|containment|verbatim|repaired
```

```typescript
interface Observation {
  // existing fields…
  agentId?: string
  attributionSource?: 'explicit' | 'sticky' | 'containment' | 'verbatim' | 'repaired'
}
```

## Error Handling Strategy

| Scenario | Handling | User impact |
| --- | --- | --- |
| Workspace provider DB error/timeout | fail-open empty roots → verbatim + sanitized warn | event persisted, attribution best-effort |
| cwd realpath failure (deleted dir, perms) | fall through to verbatim | none |
| Pin map eviction/expiry | containment/verbatim fallback | none |
| Repair migration finds ambiguous rows | leaves untouched, counted in NOTICE | operator visibility only |
| Resolver throws unexpectedly | catch → verbatim + sanitized warn; ingestion never fails for attribution | 202 contract preserved |

## Risks & Concerns

| Concern | Location | Impact | Mitigation |
| --- | --- | --- | --- |
| Per-event workspace query cost | resolver provider | hook latency | 30s TTL cache + 250ms timeout (alias-resolver precedent), fail-open |
| Dev DB workspaces hold duplicate/nested/junk roots (plan-critic C1, verified) | shared dev DB | containment ties → verbatim no-op for busiest project | path dedupe + self-match preference (HAR-02); grooming runbook above (user-approved ops, not code scope) |
| Repair mis-fires into junk-but-live workspace; irreversible (plan-critic C2) | migration 2 | history re-bucketed wrongly, propagates to memories | unambiguous-only + path-dedupe + `_pre_repair_project_id` preservation + NOT EXISTS + grooming runbook before shared-DB run |
| `_post.sh` single stdin read (plan-critic C3) | `_post.sh:21-25` | naive session-start pin kills session-start POST silently | `_pin.sh` runs after stdin capture; acceptance asserts session-start body intact |
| Compact-snapshot bypasses HookService, no cwd on wire (plan-critic C4) | `compact_snapshot.ts:80` | resolver structurally cannot cover seam | optional `cwd` wire field + resolver in persist path + route-level test |
| `agent_id` would stay ~100% NULL (plan-critic C5) | emitters | HAR-06 delivers no observable value | OpenCode populates `agentId`; Claude honestly NULL (no agent concept) |
| SQL cannot realpath; symlinked historical cwds unmatchable | repair migration | some rows unrepairable | unambiguous-only contract; residual counted, documented in validation |
| Home-root workspace indistinguishable from legit project in SQL | repair migration | over-repair risk | migration excludes only `/`; runtime resolver excludes home strictly; nested ambiguity naturally skips |
| Mirror keyed canonically changes sync-read ids after rename | repo | readers see canonical id | this IS the fix (HAR-07); acceptance proves post-rename reads |
| Bun pg pipelining desync | resolver queries | wedged clients | sequential single queries only (T6 lesson), lazy getPool, no wrapper drops |

## Verification Design

- Unit (DB-free): resolver order matrix, nested/ambiguous/broad containment, sticky pin hit/miss/expiry, sanitized failure; pin store bounds; script pin read/write; plugin memo.
- Owned PG acceptance (`HOOK_ATTRIBUTION_ACCEPTANCE_DATABASE_URL`, owned DB `massa_ai_hook_attribution`): end-to-end ingest attribution per AC-1..7; migration 2 seed/repair/idempotency/self-verification per AC-8; sanitized-failure probe AC-9; skips cleanly without var (AC-10); turbo `passThroughEnv` forwards var.
- Full regression / type-check 6/6 / build 5/5 under pinned Bun 1.3.11.
- Independent verifier: spec-anchored + discrimination sensor ≥2 mutations.

## Tech Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Resolver layer | app-layer in HookService | M16+M17 precedent; testable; choke point |
| Pin durability | in-memory bounded TTL | pins are optimization, not correctness; repair migration backfills history |
| Two migrations (columns, then repair) | separate files | additive/repair separability; clean rollback; template precedent allows both styles |
| Migration broad-root guard | exclude `/` only | SQL cannot know `$HOME`; runtime resolver is the strict layer; ambiguity skip covers home+project nesting |
| Provenance on memories | none | additive-column minimalism; repair counts via migration notices |

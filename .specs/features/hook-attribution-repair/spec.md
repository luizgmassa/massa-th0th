# M45 + M47 — Hook Attribution Repair

## Goal

Hook-captured observations are attributed to the correct durable project even when the host fires from a subdirectory, worktree, symlinked path, or unregistered directory, and historical misattributed rows are repaired by an idempotent data migration. Attribution never silently loses an event and never lets a broad root swallow foreign events.

## Verified Problem Evidence (2026-07-20 fan-out, branch wave-3)

Bug class confirmed REAL in current source:

- Attribution is client-side cwd basename: `apps/claude-plugin/hooks/_post.sh:44` (`${MASSA_AI_PROJECT_ID:-$(basename "$PWD")}`), `apps/opencode-plugin/src/index.ts:118` (`project?.id || basename || "default"`). Server treats `projectId` as opaque required string (`hook-service.ts:100-105`).
- Subdirectory misattribution: hook from `repo/apps/tools-api` sends `"tools-api"`, indexed project is root basename — strict-equality reads split (`observation-repository-pg.ts:217`).
- Worktree/symlink fragmentation: index side canonicalizes (`index_project.ts:37-42`), hook side never does.
- Unregistered/$HOME events create silent new buckets; no sentinel, no containment, no broad-root exclusion anywhere; basename collisions mix projects silently.
- Side findings (user-approved in scope): (1) `agentId` is wire-normalized then dropped for observations (`hook-service.ts:192-201,252-261`; no `agent_id` column); (2) observation in-memory mirror keeps the raw caller id while the durable row gets the alias-resolved id (`observation-repository-pg.ts:160-161,181`) — reads split from durable rows after rename.

## Public Contract

- Attribution resolution order at every hook ingestion seam (single, batch, compact-snapshot — the compact-snapshot wire gains an optional `cwd` field, and its persist path routes through the resolver; MCP `hook_ingest` included):
  1. **explicit** — caller `projectId` that is a live registered workspace (direct or alias-resolved) wins unchanged; when several live workspace ids share the matching canonical root, a caller id inside that sharing set wins as a self-match.
  2. **sticky** — server-pinned `sessionId → projectId` from the first resolved event of the session.
  3. **containment** — canonicalized `payload.cwd` inside exactly one registered workspace canonical root after path dedupe; longest matching root wins.
  4. **verbatim** — fail-open: caller id persisted unchanged. Never reject for attribution failure.
- Broad-root exclusion: workspaces whose canonical root is a broad root (filesystem root, user home directory) never participate in containment matching.
- Persisted provenance per observation: `attribution_source ∈ {explicit, sticky, containment, verbatim, repaired}`.
- Emitter-side session pinning: Claude hook scripts and the OpenCode plugin resolve the project id once per session and reuse it.
- `observations.agent_id` persisted (additive nullable column).
- Idempotent repair migration (V27 shape) rewrites historical misattributed `observations`/`memories` rows only when the correct target is unambiguous; self-verifying; re-runnable no-op.

## Requirements

1. **HAR-01** — One server-side attribution resolver runs before enqueue at all hook ingestion paths (`HookService.ingestOne`, `ingestBatch`, compact-snapshot). Resolution order is explicit → sticky → containment → verbatim, and the chosen provenance is recorded on the event.
2. **HAR-02** — Containment canonicalizes the payload cwd (`realpath`, symlink-safe) and matches it against registered workspace canonical roots **deduplicated by path** (identical paths collapse to one candidate root). An event whose cwd is inside exactly one candidate root resolves to that root's workspace; when the matched path is shared by multiple live ids, the caller id wins if it belongs to that sharing set (self-match, provenance `explicit`), otherwise the match is ambiguous. Nested roots resolve to the longest (deepest) match; zero or ambiguous matches fall through.
3. **HAR-03** — Broad-root exclusion: a workspace whose canonical root is the filesystem root or the process user's home directory is excluded from containment matching (it can still receive explicit/sticky attribution).
4. **HAR-04** — Session stickiness: the server pins the first non-verbatim resolved `projectId` per `sessionId` and reuses it for later events of that session when no explicit id wins. The pin store is in-memory, bounded, and TTL-expired; loss of pins degrades to containment/verbatim. Claude hooks pin client-side through a sourced `_pin.sh` helper used by `_post.sh` and `pre-compact.sh` AFTER stdin capture (never before — stdin single-read constraint): the first event of any type for a session writes the pin (env override > git toplevel basename > cwd basename), later events read it. The OpenCode plugin pins per session with the same precedence (falling back to `"default"`).
5. **HAR-05** — `observations.attribution_source` (additive nullable TEXT) persists the provenance (`explicit|sticky|containment|verbatim|repaired`). Pre-existing rows remain NULL.
6. **HAR-06** — `observations.agent_id` (additive nullable TEXT) persists the wire-normalized `agentId` that is currently dropped, and the OpenCode plugin populates `agentId` on its emit paths. Claude Code hooks have no agent concept and emit no `agentId` (column stays NULL for them — honest absence, not a defect).
7. **HAR-07** — The observation store's in-memory mirror keys by the same canonical id as the durable row, so `listRecent`/`countByProject`/`listBySession` reads are consistent with persisted rows after renames.
8. **HAR-08** — One idempotent data-repair migration (shape precedent: `20260714170000_add_graph_generations`) repairs historical rows: (a) `observations` whose `project_id` is NULL, `'default'`, or not a live workspace id (NULL-safe `NOT EXISTS` predicate, never `NOT IN` over nullable sets) are re-derived from `payload_json->>'cwd'` containment against path-deduplicated live roots when exactly one non-broad root matches, and stamped `attribution_source='repaired'`; (b) `memories` whose `project_id` is NULL, `'default'`, or orphaned are re-derived only when their `session_id` maps to exactly one unambiguous repaired-or-live project across that session's observations. Every repaired row preserves its pre-repair id (`_pre_repair_project_id` key in `payload_json` / `metadata`) for reversibility. Rows without an unambiguous target are left untouched and counted. The migration wraps in an explicit transaction, self-verifies counts in a `DO $$` block, and is a no-op on re-run.
9. **HAR-09** — Errors remain typed and sanitized; attribution failure paths never expose SQL, workspace paths beyond the resolved projectId, or stored payloads.
10. **HAR-10** — Feature-owned gates: owned PostgreSQL acceptance suite gated by `HOOK_ATTRIBUTION_ACCEPTANCE_DATABASE_URL` (mirroring the `IDENTITY_ACCEPTANCE_DATABASE_URL` pattern, turbo `passThroughEnv` forwarding included), focused unit suites, full workspace regression, `type-check` 6/6, and `build --force` 5/5 under pinned Bun 1.3.11.

## Acceptance Criteria

- AC-1 (HAR-01/02): WHEN a hook event arrives with an unregistered caller id and a `payload.cwd` inside exactly one registered workspace root THEN the observation SHALL persist with that workspace's `project_id` and `attribution_source='containment'`.
- AC-2 (HAR-02): WHEN the cwd sits inside nested registered roots THEN the deepest root SHALL win; WHEN two live ids share the matched path and the caller id is one of them THEN that id SHALL win as self-match (`explicit`); WHEN the shared-path set does not contain the caller id, or the cwd matches zero roots THEN the caller id SHALL persist verbatim with `attribution_source='verbatim'` and HTTP admission remains 202.
- AC-3 (HAR-03): WHEN a workspace is registered at the user's home directory or filesystem root THEN it SHALL NOT capture containment attribution for foreign cwds.
- AC-4 (HAR-01/04): WHEN a session's first event resolves via containment or explicit id THEN later events of the same `sessionId` with unregistered caller ids SHALL reuse the pinned id with `attribution_source='sticky'`; WHEN the caller id is itself a live workspace THEN it SHALL win over any pin (`explicit`).
- AC-5 (HAR-04): WHEN the Claude hooks fire any first event of a session from a project root and a later event from a subdirectory THEN both events SHALL send the same session-pinned project id (git toplevel basename when available), AND the session-start event's POST body SHALL remain intact (pin logic runs after stdin capture, never consumes it early).
- AC-6 (HAR-05/06): WHEN an observation is ingested with `agentId` present (OpenCode emit paths) THEN the durable row SHALL carry `agent_id` and the resolved `attribution_source`; WHEN a Claude-originated observation arrives without `agentId` THEN the row SHALL persist with NULL `agent_id`.
- AC-7 (HAR-07): WHEN an observation is inserted under an alias (retired id) THEN `listRecent`/`countByProject` with the canonical id SHALL return it without restart.
- AC-8 (HAR-08): GIVEN seeded misattributed rows (NULL/`'default'`/orphan ids, cwd-payload observations, session-linked memories) plus a seeded junk nested workspace WHEN the repair migration runs THEN unambiguous rows SHALL move to the correct live project with `_pre_repair_project_id` preserved, ambiguous rows (including multi-id shared paths and zero-match) SHALL remain, counts SHALL self-verify, and a second run SHALL change zero rows.
- AC-9 (HAR-09): WHEN attribution internals fail (workspace lookup error) THEN ingestion SHALL degrade to verbatim persistence with sanitized error handling — no SQL or payload leakage, no ingestion failure.
- AC-10 (HAR-10): WHEN the owned acceptance suite runs under Bun 1.3.11 with `HOOK_ATTRIBUTION_ACCEPTANCE_DATABASE_URL` set THEN all acceptance tests SHALL pass against the owned database; WHEN the var is unset the suite SHALL skip (never run against the shared DB).

## Non-goals

- Index-side broad-root blocking (`index_project` refusing `$HOME`/`/`) — separate hardening; attribution-side exclusion only.
- Shared-DB workspace grooming execution (retiring junk/e2e registrations) — an ops runbook is authored in design.md, but running it against the shared dev DB requires explicit user approval and is not this feature's code scope; `e2e-ai-shared` is intentionally preserved per standing ops decision.
- Rejecting or queue-holding unattributable events (fail-open is contractual).
- Durable (DB-backed) session pin store — in-memory + repair migration is sufficient.
- Provenance column on `memories` (observations only; memories repair counted via migration notices).
- Changing M16+M17 alias resolution semantics; the repo-level alias seam remains the final canonicalization.
- Synapse/working-memory attribution changes.
- Observability/metrics endpoint for attribution stats (migration `DO $$` notices only).

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Resolution seam placement | Server resolver + emitter pinning both | User decision 2026-07-20 | y |
| Unresolvable events | Fail-open + provenance tag | User decision 2026-07-20; 202 fire-and-forget must not silently drop | y |
| Side findings (agentId, mirror) | Both in scope | User decision 2026-07-20 | y |
| Session pin store | In-memory bounded TTL map | KISS; repair migration backfills history; pins are an optimization not a correctness dependency | y (assumption) |
| Memories repair source | `session_id` → unambiguous session project | Memories have no cwd payload; session linkage is the only honest signal | y (assumption) |
| Compact-snapshot route | Covered by same resolver via new optional `cwd` wire field | Verified bypass (`compact_snapshot.ts:80` persists directly; no cwd on wire) — closed by requirement, not assumption | y |
| Shared-DB data shape (duplicate/nested/junk workspace roots on dev DB) | Resolver + migration dedupe by path; self-match preference; ambiguous-safe; grooming runbook authored, execution needs user approval | Plan-critic C1/C2 evidence: dev DB has duplicate root (`e2e-ai-shared` ≡ `massa-ai-self-test`), nested (`e2e-ai-verify-586`), `/tmp` (`partial`) | y (design hardened) |

**Open questions:** none.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| HAR-01 | P1 server resolver | Design | Pending |
| HAR-02 | P1 containment | Design | Pending |
| HAR-03 | P1 broad-root exclusion | Design | Pending |
| HAR-04 | P1 stickiness (server + emitters) | Design | Pending |
| HAR-05 | P1 provenance | Design | Pending |
| HAR-06 | P2 agent_id persistence | Design | Pending |
| HAR-07 | P2 mirror consistency | Design | Pending |
| HAR-08 | P1 repair migration | Design | Pending |
| HAR-09 | P1 sanitized failures | Design | Pending |
| HAR-10 | P1 gates | Design | Pending |

**Coverage:** 10 total, 10 mapped, 0 unmapped.

## Verification Approach

- Focused unit suites: resolver order/ambiguity/broad-root/sticky TTL, emitter script pinning, mirror consistency, provenance wiring (DB-free where possible).
- Owned PG acceptance suite (`HOOK_ATTRIBUTION_ACCEPTANCE_DATABASE_URL`): end-to-end ingest attribution, migration repair + idempotency + self-verification, mirror-after-rename, sanitized-failure probes. Skips cleanly without the var; turbo `passThroughEnv` forwards it.
- Full workspace regression, type-check 6/6, build 5/5 under pinned Bun 1.3.11 (isolated binary per AD-004/005).
- Independent verifier: spec-anchored outcome check + discrimination sensor with ≥2 behavior-level mutations.

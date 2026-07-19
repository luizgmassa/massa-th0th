# M16 + M17 — Design

## Transaction Model

`ProjectIdentityService` owns preview/apply. A PostgreSQL-backed `ProjectIdentityGuard` resolves aliases and serializes project writers with transaction-scoped advisory locks derived from project IDs. Database trigger guards cover classified direct identity columns, including runtime-created tables, so writers outside the primary process cannot bypass the contract. Resolution occurs after acquiring the lock and is tested across two snapshots/processes. Apply locks source and target in lexical order, then computes its authoritative plan inside the same transaction. The external preview hash must match that in-transaction plan.

The schema adds `project_identity_aliases` and `project_identity_operations`. The operation row is the idempotency and strict audit result for identity changes; the existing general `operation_log` remains immutable and is not rewritten.

## Discovery and Adapters

Direct columns are enumerated from `information_schema.columns` for the active application schema and compared against an allowlisted adapter registry. Known direct stores are rewritten with table-specific conflict policies. Adapters inspect and rewrite nested identity in `json`, `jsonb`, or text-encoded JSON, including vector/keyword metadata, Synapse workspace identity, scheduled-job payloads, observation/proposal payloads, and project-bearing memory metadata/tags. Runtime-created vector, keyword, search-cache, analytics, and event tables install guards during initialization and are included by discovery, not only migrations.

Any table with a project/workspace identity column or recognized identity-bearing payload that has no registered policy is reported in preview and blocks apply. DDL identifiers are selected only from validated discovery results; values remain parameterized.

## Conflict and Graph Policy

- Rename rejects any live target state.
- Merge permits duplicate rows only when their non-identity material is equivalent under the registered adapter.
- Graph-generation rows are retained. The newest activated generation becomes active; any other active generation is superseded. Workspace aggregate counts are recomputed from the chosen generation.
- Foreign/composite keys are handled in dependency order inside one transaction. Deferred constraints are used only where the installed schema supports them.

The migration repairs graph-generation and workspace composite foreign keys to support guarded identity updates (`ON UPDATE CASCADE`, deferrable where required). Merge clears active/pending pointers before moving generations, selects the winner, then restores recomputed pointers and counts.

## Concurrency and Caches

All production project writers are protected by the shared database guard before persistence. Application adapters additionally resolve the canonical ID for returned state and drain ETL, hook, job, checkpoint, Synapse, scheduler, observation, Handoff, and Proposal queues/mirrors. Apply uses the same ordered locks, waits for already-admitted guarded writes, commits, then invokes the invalidator registry for both IDs, including search/L1/file-filter/index-manager caches. Invalidation errors are recorded as sanitized diagnostics; event publication is notification only.

## Failure Boundaries

No mutation occurs during preview. Apply validates request, operation idempotency, locks, authoritative plan, conflicts, and storage coverage before the first rewrite. Any database error rolls back. The durable result is committed with the data move. A retry reads it without replay. Failpoints surround the first mutation and pre-commit boundary for rollback tests.

## Plan Challenge Decisions

- Dynamic discovery alone is insufficient because nested metadata is invisible; explicit versioned adapters are mandatory.
- A process-local mutex cannot protect multiple API processes; PostgreSQL advisory locks are the authority.
- Application-only guarding cannot cover direct or runtime-created storage writers; classified database triggers share the same lock-and-resolve function.
- Existing graph foreign keys do not all cascade identity updates; migration repair precedes transactional apply.
- Publishing an event before commit or treating post-commit notification as fatal creates false rollback semantics; direct invalidation follows commit and notification is best effort.
- General audit rows must remain immutable, so operation idempotency uses a dedicated strict result table.

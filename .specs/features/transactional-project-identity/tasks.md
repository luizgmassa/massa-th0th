# M16 + M17 — Tasks

1. **T1 schema and contracts** — aliases, idempotent operation results, typed preview/apply schemas, canonical hashing, graph FK repair, shared database guard function/trigger primitives. Commit: `feat(identity): add transactional identity contracts`.
2. **T2 discovery and planning** — information-schema inventory, explicit direct/payload adapters, counts/conflicts/unknown-store blocking, deterministic plan hash. Commit: `feat(identity): discover project-scoped storage`.
3. **T3 transactional apply** — ordered database locks, conflict-safe rewrite/dedupe, graph selection/counts, aliases, idempotency, rollback failpoints. Commit: `feat(identity): apply rename and merge transactionally`.
4. **T4 writer guard and invalidation** — guard installation for static and runtime tables, alias resolution on scoped writers, queue drain semantics, source/target invalidator registry, best-effort event. Commit: `fix(identity): guard writers and invalidate caches`.
5. **T5 transports** — REST rename/merge and MCP tools with dry-run default and shared envelopes. Commit: `feat(identity): expose rename and merge transports`.
6. **T6 PostgreSQL acceptance** — two-process writer race, retries, failpoints, roots/collisions, snapshot rollback, one audit, zero source references. Commit: `test(identity): prove transactional rename and merge`.
7. **T7 validation** — focused, migration, type, build, full regression, independent verifier. Commit: `docs(specs): validate transactional project identity`.

Each implementation slice uses a bounded sequential writer. No writers overlap. The final verifier is independent and read-only.

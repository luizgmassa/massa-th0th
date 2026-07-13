# PostgreSQL Parity Evidence

PostgreSQL/pgvector is the acceptance backend. This file adds evidence for the new behavior only and references, without modifying, `.specs/features/repository-maintenance-2026-07-12/parity-matrix.md`.

| ID | Behavior | Required PostgreSQL evidence | Status |
| --- | --- | --- | --- |
| NPAR-01 | Session-aware search scoping/ranking | 82 focused tests plus live PostgreSQL/qwen F24: matching session injected same-project result, rejected malicious cross-project result, changed identity/rank, and respected `maxResults`; invalid/mismatch/unscoped unit matrix passed | FOCUSED PASS — final G10 pending |
| NPAR-02 | Filtered bounded retrieval/cache | 25 focused tests cover include/exclude/combined, old-window domination, cap/no-retry, unfiltered `2N`, pathless and recursive-glob behavior; cache-key separation passes in SQLite and dedicated PostgreSQL; live PG/qwen F18 passes | FOCUSED PASS — final G10 pending |
| NPAR-03 | Retrieval outage envelope | Required PostgreSQL/vector dependency outage differs from zero-hit success | PENDING |
| NPAR-04 | Embedding cache dimension identity | Mismatched cached dimension rejected under qwen profile | PENDING |
| NPAR-05 | Workspace/profile/path identity | Direct vector/symbol metadata sentinels and wrong-root guarded rebuild | PENDING |
| NPAR-06 | Destructive restart recovery | Owned PostgreSQL outage/restart and post-recovery identity/data-plane checks | PENDING |

# PostgreSQL Parity Evidence

PostgreSQL/pgvector is the acceptance backend. This file adds evidence for the new behavior only and references, without modifying, `.specs/features/repository-maintenance-2026-07-12/parity-matrix.md`.

| ID | Behavior | Required PostgreSQL evidence | Status |
| --- | --- | --- | --- |
| NPAR-01 | Session-aware search scoping/ranking | 82 focused tests plus live PostgreSQL/qwen F24 and final G10 search: matching sessions modulate only same-project results, invalid/mismatch sessions fall back, and final caps hold | PASS |
| NPAR-02 | Filtered bounded retrieval/cache | 25 focused tests, SQLite/PG cache-key parity, live F18, and final G10 search cover bounded over-fetch, include/exclude semantics, no retry, and stable unfiltered behavior | PASS |
| NPAR-03 | Retrieval outage envelope | Deterministic zero-hit/outage tests plus final owned N1/N3 verify Ollama and PostgreSQL failures surface `success:false` over HTTP/MCP and recover | PASS |
| NPAR-04 | Embedding cache dimension identity | SQLite and PostgreSQL reject/replace wrong-dimension cache entries; final clean qwen G10 at `02b7475` ran model `qwen3-embedding:8b` at 4096 dimensions | PASS |
| NPAR-05 | Workspace/profile/path identity | Dedicated intent fails closed before probes/HTTP/shared-index work unless fixture/API/database/vector pins prove ownership; zero-fetch regression passes. Final completed G10 same-process wrong-root rebuild restored the canonical root; 468 vectors, 34 vector paths, and 34 symbol paths were manifest-contained; direct SQL found zero absolute/traversal/`adsads` paths | PASS — final safety delta focused-verified; repeated full G10 user-waived |
| NPAR-06 | Destructive restart recovery | Final owned gate 4/4, 79 assertions: N1/N3/E25/F88 failed and recovered as specified; every signal was ownership-validated; all dedicated listeners and run roots were removed | PASS |

The exact final PostgreSQL identity, commands, sentinels, and teardown are recorded in
`final-verification-evidence.md`. Remote Git drift is a process exception, not a PostgreSQL
parity defect.

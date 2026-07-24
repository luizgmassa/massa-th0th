# Qwen Embedding 8B — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/let-s-use-qwen-embedding-8b-for-goofy-hennessy.md` planned a full-surface default change from `bge-m3`/1024 dimensions to `qwen3-embedding:8b`/4096 dimensions, and from `qwen2.5-coder:7b` to `qwen3.5:9b`, with larger LLM output and timeout limits.

## Intent and scope

Plan intent: improve retrieval defaults and enable Ollama's default thinking behavior without adding unsupported reasoning SDK options. Scope named runtime configuration, metadata-vector dimensions, environment/container defaults, installers, setup documentation, and an optional fixture update. It also prescribed a one-time reindex and runtime verification after the swap.

## Implemented outcome

Commit evidence shows the requested defaults were implemented in two commits. Runtime, container, WSL setup, diagnosis, and the optional test fixture changed in `d381721`; installer, example-environment, README, and memory-skill documentation surfaces changed in `c730076`.

## Commit evidence

### Primary runtime and deployment defaults

- `d381721ee233d9f063e4374a0041b63151efbe28` — `feat: default to qwen3-embedding:8b + qwen3.5:9b, raise LLM budgets`
  - Changed Ollama fallback model to `qwen3-embedding:8b`, fallback dimensions to `4096`, and metadata zero-vector length to `4096`.
  - Changed canonical, deprecated-alias, and defensive-fallback LLM defaults to `qwen3.5:9b`, `8000` output tokens, and `90000` ms timeout.
  - Changed Docker, Compose, WSL setup, diagnosis defaults, and `memory-crud.test.ts` fixture.
  - Commit message states no SDK thinking wiring was added and `reasoning_effort` was avoided.

### Installer and documentation surface

- `c7300766d44f2c1293004787a9ca2919912b93b7` — `feat(install): native PostgreSQL option + Docker/colima ~5GB RAM warning`
  - Updated `.env.example`, `install.sh`, `scripts/setup-local-first.sh`, `README.md`, and `skills/massa-ai-memory/SKILL.md` to present the Qwen embedding and LLM defaults and the new limits.
  - Updated generated local setup configuration to use `qwen3-embedding:8b` and `4096` dimensions.
  - This commit also introduced native-PostgreSQL installer work outside the source plan's model-swap scope.

## Spec/acceptance facts now worth preserving

- Default Ollama embedding configuration uses `qwen3-embedding:8b` with `4096` dimensions.
- The metadata document placeholder uses a 4096-element zero vector, matching the default embedding dimension.
- Default LLM model is `qwen3.5:9b`; default output budget is `8000`; default timeout is `90000` ms across the three configuration fallback surfaces named by the plan.
- Installer and documentation paths direct users to pull the Qwen defaults and write the matching embedding model and dimensions.
- The source plan's required operational follow-up remains: re-embed projects after moving from 1024-dimensional vectors to 4096-dimensional vectors.

## Deviations or unresolved gaps

- Source plan requested `.env` changes, but no tracked `.env` change can be established from these commits; `.env.example` is evidenced instead.
- The runtime and commit evidence do not prove models were pulled, a project was reindexed, SQLite data was cleared where applicable, diagnostics passed, structured LLM consumers succeeded, recall smoke testing succeeded, or `bun test` ran.
- No commit evidence here validates the plan's latency target or absence of `llmObject failed — degrading` after the swap.
- `c730076` bundled the planned installer/documentation updates with unrelated native-PostgreSQL setup work.

## Cross-references to existing `.specs/features/*`

- `.specs/features/local-first-memory-platform-roadmap/design.md` is the
  corresponding historical platform-roadmap record.
- No additional direct feature-spec dependency was established from the
  inspected plan and commit evidence.

## Verification evidence used

- Source-plan inspection: `/Users/luizmassa/.claude/plans/let-s-use-qwen-embedding-8b-for-goofy-hennessy.md`.
- Commit-range inventory: `git log c1d37b8120025a69e2de0e5fd054ca8177e205de..81d33606fb6826e1759a073006b165419d0e3ba4`.
- Commit inspection: `git show` for `d381721ee233d9f063e4374a0041b63151efbe28` and `c7300766d44f2c1293004787a9ca2919912b93b7`.
- Local artifact checks: non-empty-file and whitespace-diff checks recorded after this write.

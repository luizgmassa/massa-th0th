### 🟢 Onboarding (New Project / First Session)

Use this workflow for a first session, missing project context, or repo setup where the agent must resolve the project identity, establish usable memory/index state, and capture a high-level architecture overview before deeper work.

1. Resolve `projectId` and `workflowSessionId` (`onboarding-[entity]`).
2. `th0th_recall` -> check for existing project identity and knowledge.
3. `th0th_list_projects` -> resolve the exact registered project ID and index
   status before indexing.
4. If indexed, call `th0th_project_map` for the first architecture overview. A usable index means status is `indexed`, `th0th_project_map` succeeds, file count is >0, and symbol/chunk coverage is nonzero for code-bearing repositories.
5. If no usable index exists, call `th0th_index` with `projectPath` and
   `projectId`, then poll with the discipline in `references/th0th-tools.md`.
6. Full reindex is allowed only when index status is `error`, `th0th_project_map` is missing/empty after indexing, or a large tracked-file change touched >50 files or >10% of tracked files since the last index timestamp. Treat `th0th_reindex` as compatibility-sensitive; fall back to `th0th_index(forceReindex=true)` with the known project path when its adapter contract is unverified.
7. Honor root `AGENTS.md` ignored paths during context loading; if a tool cannot
   accept excludes, discard ignored-path results instead of loading them.
8. Load `references/synapse-policy.md` when architecture mapping will require
   repeated searches, then follow the shared retrieval order from
   `references/codebase-investigation.md`.
9. Persist the architectural overview via `th0th_remember` as a scored
   `decision` memory with `memory:semantic`.
10. Complete the Evidence Gate from `references/evidence-gate.md`.

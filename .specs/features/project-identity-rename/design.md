# Rename Entire Project — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/rename-the-entire-project-quiet-torvalds.md` — “Rename project → `massa-th0th`, version → `v1.0.0`”.

## Intent and scope

Plan claimed a breaking identity and runtime-contract rename: published package scope, display and repository references, configuration and storage names, TypeScript identifiers, MCP server/tool contract, and seven manifest versions set to `1.0.0`. External platform renames and existing-user migration remained out of code scope.

## Implemented outcome

Execution evidence predates this record’s commit range. Rename commit `09713f4` records a repository-wide `th0th` → `massa-th0th` migration and seven manifests at `1.0.0`; follow-up `346f718` corrected package/workflow/environment/skill references. The assigned range subsequently maintains the renamed package/configuration surface and adds new unprefixed MCP tools.

Current source confirms `name: "massa-th0th"`, `MassaTh0thConfig`, `MASSA_TH0TH_*` project variables, scoped packages such as `@massa-th0th/core`, and `.massa-th0th-data`. It also confirms the runtime tool convention is unprefixed (`index`, `fetch_and_index`, `execute`), rather than the source plan’s proposed `massa_th0th_*` tool names.

## Commit evidence

### Execution boundary — before assigned range

- `09713f4f56d9477358604d675848e8e4a3462c92` — `refactor: rename project th0th -> massa-th0th, set v1.0.0, strip MCP tool prefix`
- `346f7180f1e3b96c62619cf8cc665385b13dad9d` — `refactor: rename packages, workflows, envs and skills`

### Assigned-range continuity

- `da4c60f2b7370b1f9977a92ae2beec4c5dd915eb` — `fix(config): reconcile MassaTh0thConfig + drop compression.llm`
- `b50720ddbd6471e51b218aaaf1fa4dea3239a013` — `fix(build): purge tsbuildinfo before tsc to guarantee emission`
- `829cfee7bcd1b35c9a92c4297d3015823df5376b` — `fix(executor): correct package name assertion in execute_file test`
- `ba75d4904d4cfb37ab39980c5a8cde5958575678` — `feat(executor): polyglot sandbox executor + run-pool + execute/execute_file/batch_execute tools`
- `c6e69cf9a37bfb5dbf277094d7a6c5185398d8cd` — `feat(web): fetch_and_index + SSRF guard + HTML→md conversion`
- `c05146895c49df0f273568aed496ef653428f70e` — `feat(scheduler): in-process cron scheduler for consolidation/decay/auto-improve jobs`
- `949617ecd86facaecd226c62b085cc7a0270d763` — `docs: refresh README (42 tools) + TODO (Phase 4/gaps/hardening, 284-skip breakdown)`

## Spec/acceptance facts now worth preserving

- Package scope is `@massa-th0th`; configuration type is `MassaTh0thConfig`.
- Project-owned environment variables use `MASSA_TH0TH_*`; `RLM_LLM_*` remains a subsystem configuration namespace.
- Runtime MCP server identity is `massa-th0th`; current MCP tool names are unprefixed.
- Post-rename additions must preserve scoped package resolution: build repair explicitly protects `@massa-th0th/shared` emission, and executor coverage asserts `@massa-th0th/core`.

## Deviations or unresolved gaps

- Source plan proposed `massa_th0th_*` MCP tool names. Verified execution instead stripped the prefix; current source dispatches unprefixed names. This is a material plan deviation.
- Source plan’s default proposed `.massa-th0th` data directory, `.massa-th0th-src` install directory, and `MASSA_TH0TH_LLM_*`. Verified execution uses `.massa-th0th-data`, an install default of `.massa-th0th`, and retains `RLM_LLM_*`.
- The assigned range begins after rename implementation, so it cannot independently prove the plan’s original full type-check/build/test/install verification claims. No external platform rename or existing-user migration evidence was inspected.

## Cross-references to existing `.specs/features/*`

- `.specs/features/phase-0-quick-wins/spec.md`
- `.specs/features/phase-3-hook-capture/spec.md`
- `.specs/features/phase-4-bootstrap/spec.md`
- `.specs/features/phase-5-auto-improve/spec.md`
- `.specs/features/phase-6-handoffs/spec.md`
- `.specs/features/phase-7-retrieval-polish/spec.md`
- `.specs/features/phase-8-web-ui/spec.md`

## Verification evidence used

- Read source plan in full; inspected rename-boundary commit metadata/statistics and relevant commits in `c1d37b8120025a69e2de0e5fd054ca8177e205de..81d33606fb6826e1759a073006b165419d0e3ba4`.
- Inspected current identity/config/tool declarations in manifests, MCP client, shared configuration, installer, and environment template.
- Documentation-artifact checks: non-empty file and `git diff --check`.

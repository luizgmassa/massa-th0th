# massa-ai Spec State

## Current — Repository Rename Part 2

- projectId: `massa-ai`
- workflowSessionId: `spec-repo-rename-massa-ai-part2`
- workflow: spec-driven (Large/Complex)
- feature: `repo-rename-massa-ai-part2` — COMPLETE + validated PASS
- scope: 13 requirements (R1-R13), residual `th0th`/`massa-th0th` concept + identity references across bun.lock, CHANGELOG, .specs, skills, plugin agents, docs, source
- Validation: PASS — 13/13 ACs verified, discrimination sensor killed 1 mutation (observation-extractor `case "search":` → `th0th_search`), type-check 6/6, build 5/5, drift gate no-drift, 398+ tests green across affected suites
- Report: `.specs/features/repo-rename-massa-ai-part2/validation.md`
- Spec: `.specs/features/repo-rename-massa-ai-part2/spec.md`
- Key decisions (user gray-area resolutions):
  - D1: CHANGELOG historical `massa-th0th` refs rewritten to `massa-ai` (breaks append-only, accepted)
  - D2: observation-extractor `th0th_*` legacy case arms REMOVED (breaks DB backward-compat, accepted; no migration)
  - D3: .specs/features/** `th0th`/`Th0th` concept refs → `massa-ai`
  - D4: installation.md upstream corrected to `luizgmassa/massa-ai` (from stale `S1LV4/th0th`)
  - D5: README/FEATURES Credits `[th0th](S1LV4/th0th)` preserved
- Latent bugs found + fixed during lockfile regen:
  - web-ui type-check: added `@types/bun` devDep (was relying on accidental root hoisting)
  - subagent-parity test: added `toml` root devDep (was relying on transitive `effect` dep hoisting)
  - cursor+codex plugin hook symlinks: fixed stale `massa-th0th-hook.ts` target → `massa-ai-hook.ts`
- Next step: none — feature complete.

## Previous — Workflow Tools Adaptation

- projectId: `massa-ai`
- workflowSessionId: `spec-workflow-tools-adaptation`
- workflow: spec-driven (Large/Complex)
- feature: `workflow-tools-adaptation` — COMPLETE + validated PASS
- scope: 29 requirements (WTA-01..29), 9 user stories (4 P1, 4 P2, 1 P3)
- Validation: PASS — 29/29 ACs verified with grep-sensor evidence, 1/1 discrimination mutation killed, type-check 6/6, build 5/5. All 4 pre-mortem mitigations verified.
- Report: `.specs/features/workflow-tools-adaptation/validation.md`
- Commits: 12 commits (`e318fe9`..`5a1894d`)
- Spec: `.specs/features/workflow-tools-adaptation/spec.md`
- Design: `.specs/features/workflow-tools-adaptation/design.md` (Approach A: single-pass rename + selective adoption)
- Tasks: `.specs/features/workflow-tools-adaptation/tasks.md` (12 tasks across 4 phases)
- Plan Challenge: full The Fool pre-mortem mode; 5 failure narratives; 3 critical/high findings (F1 references not renamed, F2 graph tools lack freshness gate, F3 compact_snapshot session-id confusion) incorporated as plan revisions.
- Key decisions:
  - Canonical tool naming = un-prefixed (matching `tool-definitions.ts` CANONICAL_ORDER); all `th0th_*` references removed across 60 files.
  - `references/mcp-tools.md` expanded from ~20 to 52 tools (full MCP Capability Matrix).
  - Selective tool adoption: each workflow adopts only tools that materially benefit its flow.
  - Graph tools (`trace_path`, `impact_analysis`, `get_architecture`) include explicit freshness gates.
  - `compact_snapshot` uses lifecycle `sessionId`, NOT `workflowSessionId` (two-session-id rule).
  - `get_architecture` (architecture-specific) distinguished from `project_map` (general overview).
- Next step: none — feature complete.

## Previous — Subagent Skills Plugin Parity

- projectId: `massa-ai`
- workflowSessionId: `spec-subagent-skills-plugins-parity`
- workflow: spec-driven (Large/Complex)
- feature: `subagent-skills-plugin-parity` — COMPLETE + validated PASS
- scope: 44 requirements (CLA-01..10, CDX-01..10, CRS-01..08, OPC-01..10, DOC-01..07), 5 user stories, 4 host targets
- Validation: PASS — 42/44 ACs verified with file:line evidence, 3/3 discrimination mutations killed, 60 tests pass (818 assertions), type-check 6/6, build 5/5, drift gate exit 0. 2 non-blocking spec-precision gaps flagged (CRS-02/03 transitive, DOC-06 substring parity).
- Report: `.specs/features/subagent-skills-plugin-parity/validation.md`
- Commits: 14 commits on `spec-sub-agent-system` (bc57daa..851f29b)
- Spec: `.specs/features/subagent-skills-plugin-parity/spec.md` (checksum `e563bb80...`, v4 docs-parity amendment)
- Design: `.specs/features/subagent-skills-plugin-parity/design.md` (checksum `a7fa79c8...`, v1; Approach A chosen: one generator + four installer extensions)
- Tasks: `.specs/features/subagent-skills-plugin-parity/tasks.md` (checksum `59c28dab...`, v1; 12 tasks across 3 phases; pre-approval checks pass)
- Tasks plan: Phase 1 (T1-T4 generator foundation) → Phase 2 (T5-T8 installer extensions) → Phase 3 (T9-T12 docs + final gate). Single source of truth = `scripts/generate-subagent-artifacts.ts`; drift gate via `--check` + parity test.
- Design key decisions:
  - `scripts/generate-subagent-artifacts.ts` = single source of truth; reads `skills/*/SKILL.md`, emits per-host agent files into `apps/*/agents/`; outputs checked in; `--check` mode + parity test = drift gate (F1 mitigation).
  - Codex agents → `~/.codex/agents/*.toml` (OUTSIDE plugin dir; `# massa-ai-owned` top comment). OpenCode agents → `~/.config/opencode/agents/*.md` (OUTSIDE npm package; `metadata: { massa-ai-owned: true }`; shipped via `files` array update — R2).
  - Claude/Cursor agents → plugin's `agents/` dir (Claude uninstall excludes `massa-ai-navigator.md` by name — R1).
  - OpenCode: new `massa-ai-config agents install/uninstall` subcommand (extends `config-cli.ts`).
  - 10 risks R1-R10 documented with mitigations; no project-level AD (additive, no DB/binary).
- Docs parity (user follow-up): `README.md` = summary layer (12 names, pinned model+effort per host in compact form, link to FEATURES.md); `FEATURES.md` = depth layer (new "Subagent Skills (12 Specialists)" section: per-host names, file locations/formats, four model-pinning tables verbatim, effort pins, permission mappings, ownership markers, generator+parity contract). DOC-02/03/06/07 assert the split; DOC-06 asserts FEATURES.md ↔ spec table byte-parity (test).
- Model pinning (user follow-up): `model` PINNED per agent per host, NOT advisory. Claude aliases (haiku/sonnet/opus); Codex IDs (gpt-5.4-mini / gpt-5.6-terra / gpt-5.6-sol); Cursor + OpenCode use charter `metadata.model_hint` verbatim (DeepSeek V4 Pro / GLM-5.2 / MiniMax M3). Three model-pinning tables added to spec; AC CLA-10/CDX-10/CRS-08/OPC-10 assert exact pinning.
- Effort pinning (user follow-up): Claude `effort: high`; Codex `model_reasoning_effort = "high"`; Cursor `reasoningEffort: max` (field-name unverified — subagent docs 404; pass-through, harmless if ignored); OpenCode `reasoningEffort: max` (pass-through, provider-dependent honoring for DeepSeek/GLM/MiniMax). ACs CLA-10/CDX-10/CRS-08/OPC-10 updated.
- Plan Challenge: lite-escalation inline (subagent spawning unavailable — `cavecrew-reviewer` model not found). 8 findings F1-F8; F1 (drift), F2 (name collision), F4 (OpenCode bash ambiguity), F5 (out-of-plugin-dir ownership marker), F6 (Claude tools format) incorporated as assumptions + ACs. Escalate-to-full: false.
- Decisions (feature-local, no project-level AD):
  - Ship as host-native subagent definitions (Claude `agents/*.md`, Cursor `agents/*.md`, OpenCode `agents/<name>.md` mode: subagent, Codex `agents/<name>.toml`).
  - Full native frontmatter adaptation (tools/sandbox_mode/permission per host; model hint as advisory body comment, omitted from frontmatter).
  - No new lifecycle hooks (invocation-based specialists; existing 6 lifecycle hooks unchanged; shared binary untouched).
  - Codex/OpenCode agents live OUTSIDE the plugin dir (shared agent dirs) → in-file ownership marker (`# massa-ai-owned` comment / `metadata: { massa-ai-owned: true }`).
  - Single source of truth: `scripts/generate-subagent-artifacts.ts` emits shipped files from `skills/*/SKILL.md`; parity test asserts byte-identity (drift fails CI).
  - Existing `massa-ai-navigator.md` (Claude/Cursor) preserved; 12 specialists additive.
- Next step: Design phase (`references/spec-driven/design.md`) — architecture, components, per-host frontmatter mapping table, generator design, verification design.

## Previous — Codex + Cursor Plugin Parity

- projectId: `massa-ai`
- workflowSessionId: `spec-codex-cursor-plugin-parity`
- workflow: spec-driven (Large/Complex)
- feature: `codex-cursor-plugin-parity` — COMPLETE + validated PASS
- branch: `spec-codex-cursor-plugin-parity` (off `main`)
- scope: 28 requirements (CPX-01..08, CRS-01..08, INS-01..12), 20 tasks across 4 phases
- Phase 1 (T1-T6): COMPLETE — binary `pre-tool-use` + Codex plugin (manifest, skills, hooks.json, .mcp.json, install.sh, README, tests)
- Phase 2 (T7-T11): COMPLETE — Cursor plugin (manifest, skills, hooks.json with 7 events incl. sessionStart + preCompact, mcp.json, agents, install.sh, README, tests)
- Phase 3 (T12-T15): COMPLETE — root install.sh plugin menu (Codex/Cursor), install-agents.ts deconfliction hints, README, stale Cursor note removed
- Phase 4 (T16-T20): COMPLETE — Claude Code hooks auto-write into settings.json, root menu extended to 4 tools (Claude/Codex/Cursor/OpenCode), install-agents.ts Claude/OpenCode hints, README 4-plugin parity
- Validation: PASS — 28/28 ACs verified, 5/5 discrimination mutants killed, 112 tests pass, type-check 6/6, build 5/5
- Report: `.specs/features/codex-cursor-plugin-parity/validation.md`
- Commits: 17 commits on `spec-codex-cursor-plugin-parity` (1a59854..fcda808)

## Previous — Wave 7

- projectId: `massa-ai`
- workflowSessionId: `spec-wave-7-hygiene-ui-process`
- workflow: spec-driven (Large/Complex)
- feature: `wave-7-hygiene-ui-process` (Wave 7) — COMPLETE + validated PASS
- branch: `wave-7` (off `main`)
- scope: 13 requirements (W7-01..W7-13), 15 tasks across 3 phases
- Phase 1 (T1-T7): COMPLETE — hygiene (AGENTS.md, version pins, LLM defaults, CHANGELOG, D5 ADR, doc cleanup, removed-features)
- Phase 2 (T8-T12): COMPLETE — features (web UI markdown+write+SSE, json_schema, sandbox)
- Phase 3 (T13-T15): COMPLETE — cleanup (spec archive, wave-2 reconcile, hook breadcrumb)
- Validation: PASS — 13/13 ACs verified, 3/3 mutations killed, gates green
- Report: `.specs/features/wave-7-hygiene-ui-process/validation.md`

## Decisions

| ID | Status | Decision | Evidence |
| --- | --- | --- | --- |
| AD-007 | active (T12) | Executor sandbox default is `auto` (not `on`); uses platform tool if available, falls back to best-effort. F1 mitigation. | `sandbox.ts` getSandboxMode, `MASSA_AI_EXECUTOR_SANDBOX=auto\|on\|none` |
| AD-008 | active (T11) | json_schema constrained decoding for Ollama structured calls; version-gated (>= 0.5.0), graceful fallback to json_object. F3 mitigation. | `llm-client.ts` _checkJsonSchemaSupport, llmObject |
| AD-009 | active (T5) | D5 Cypher subset deferral formally removed — structural graph traversal covers use cases. | `docs/adr/0001-remove-d5-cypher-subset.md` |

---

## Wave 7 — Active

- projectId: `massa-ai`
- workflowSessionId: `spec-wave-7-hygiene-ui-process`
- workflow: spec-driven (Large/Complex)
- feature: `wave-7-hygiene-ui-process` (Wave 7) — IN PROGRESS
- branch: `wave-7` (off `main`)
- baseline: `56c84d1`
- scope: 13 requirements (W7-01..W7-13), 15 atomic tasks across 3 phases
- Phase 1 COMPLETE: T1-T7 committed (32b5ce4..815488f)
- Phase 2 COMPLETE: T8-T12 committed (f0b92cd..2a2aee9)
- Phase 3 IN PROGRESS: T13 done, T14-T15 remaining
- Pre-mortem: 5 findings (F1 sandbox auto, F2 realpathSync, F3 json_schema log, F4 XSS, F5 bot PR skip)
- Spec: `.specs/features/wave-7-hygiene-ui-process/spec.md`
- Design: `.specs/features/wave-7-hygiene-ui-process/design.md`
- Tasks: `.specs/features/wave-7-hygiene-ui-process/tasks.md`

---

## Wave 5 — Active

- projectId: `massa-ai`
- workflowSessionId: `spec-wave-5`
- workflow: spec-driven (Large/Complex)
- feature: `wave-5-cross-pollination` (Wave 5, P1) — COMPLETE + validated PASS
- branch: `wave-5` (off `main` post-`92b7fb4`)
- baseline: `92b7fb4`
- scope: 26 requirements (FR-01..FR-26), 29 acceptance criteria, 27 atomic tasks across 9 phases
- gray areas: all 8 resolved (see `.specs/features/wave-5-cross-pollination/context.md`)
- plan-critic revisions: FR-20..FR-26 / AD-W5-013..AD-W5-020 incorporated
- B1 (graph features) COMPLETE: T01-T08, 8 commits (9a73b4b..14744ce)
- B2 (grouped format + indexing) COMPLETE: T09-T16, 8 commits (a12f9f6..6740a3e) + 1 test-isolation fixup (a0c67d6)
- B3 (search/scheduler/synapse) COMPLETE: T17-T24, 8 commits (2c21db6..56e5c10)
- B4 (defense + validation) COMPLETE: T25-T27, 3 commits (1509732..38b04bb) + independent verifier PASS (7/7 ACs, 3/3 mutations killed)

---

## Wave 4 — Complete

- projectId: `massa-ai`
- workflowSessionId: `spec-wave-4-correctness-hygiene`
- workflow: spec-driven
- feature: `wave-4-correctness-hygiene` (Wave 4, P1) — COMPLETE + validated PASS
- status: complete (T1–T20 all done; independent verifier PASS: 13/13 ACs, 4/4 discrimination mutations killed, gates green, no gaps)
- branch: `main`
- baseline: `f3d8020`
- residual risk: pre-existing `qwen-e2e-fixture` failure (documented, owned by `sqlite-removal-followup` SQLRFU-002 — not Wave 4 task-owned)

---

## Wave 3 — Active

- projectId: `massa-ai`
- workflowSessionId: `spec-wave3-followup` (native-runtime-rebaseline follow-up); prior `spec-m21` (M21) COMPLETE.
- workflow: spec-driven
- feature: `native-runtime-rebaseline` (Wave 3 follow-up, P1) — T1–T6 COMPLETE + validated PASS. T1 merge `b6aa4a4`; T2 test rewrite `428d462`; spec artifacts `846ff29`; T3 classification `e866ea5` + `17eedfd`; T4 npm reconcile (no code change — Codespace npm 11.12.1 → 11.14.1 install); T5 cross-platform verify (Codespace Bun 1.3.14 install, ABI 137, both platforms `verify:tree-sitter-native` exit 0, 152/152 native-structural); T6 AD amendment + validation.md (this commit). Status: `complete`.
- prior: `linux-native-structural-runtime` (M21, P0) — COMPLETE + validated PASS.
- status: M19, M20+M54, M50, M16+M17, M45+M47, M21 complete. **native-runtime-rebaseline COMPLETE** (T1–T6: `b6aa4a4`/`428d462`/`846ff29`/`e866ea5`/`17eedfd` + T4/T5/T6). Phase A (T1–T2) PASS on macOS arm64; Phase B (T3) six-suite classification — 2 FIX (`e866ea5` auto-improve LLM-surface isolation defect, `17eedfd` qwen fixture re-lock after identity-guard drift) + 4 DOCUMENTED-ACCEPT (etl-cache-invalidation, etl-pipeline-queue, scheduler-store-pg, trace-path — shared-DB fixture gaps: `graph_generation_workspace_missing:*`, `scheduled-*` pollution) — **RESOLVED in Wave 6**: `clearProject` now deletes `graph_generations` rows (prevents orphaned generations), `architecture-map.test.ts` calls `markIndexing` before `EtlPipeline.run` (prevents workspace-missing race), qwen fixture hashes re-locked after N31 decomposition; Phase C (T4–T5) npm reconciled 11.14.1 both platforms, Bun 1.3.14 installed on Codespace (ABI 137), `verify:tree-sitter-native` PASS on macOS arm64 + Ubuntu Codespace (33+33 parses, 27+27 modules, 10 sensors, RSS -188 KB Codespace / +589 KB macOS < 16 MiB, packed package PASS, 152/152 native-structural both platforms). Phase D (T6) AD-004/005/006 amendment + validation.md.
- branch/worktree: `wave-3` / `massa-ai-wt-wave-3`
- sequence: M19 → M20+M54 → M50 → M16+M17 → M45+M47 ✅ → M21 ✅ → native-runtime-rebaseline ✅
- invariant: `sqlite-removal` complete; `sqlite-removal-followup` in_progress (M29); `multi-language-tree-sitter-breadth` reconciled to `complete` from its recorded PASS evidence.
- cleanup: temp branch `wave-3-codespace-sync` on origin (used to sync Codespace for T5) — delete after feature closure.

### Wave 3 Next Step

native-runtime-rebaseline complete. Wave 3 follow-up exhausted. Clean up: delete temp remote branch `wave-3-codespace-sync`. No push of `wave-3` (contract). Independent verifier (author ≠ verifier) to run full gate matrix + discrimination sensors and confirm PASS per spec-driven validate.md.

---

## Current

- projectId: `massa-ai`
- workflowSessionId: `spec-multi-language`
- workflow: spec-driven
- persona: AI Engineer
- feature: `multi-language-tree-sitter-breadth`
- status: EXECUTE + VALIDATE complete (feature verdict PASS). Native runtime re-baselined to Bun `1.3.11` + Node `25.9.0` (npm `11.14.1`); TASK-001 through TASK-026 PASS. MLTS-022 performance contract reframed on 2026-07-17 (spec-owner approved): the 16 MiB explicit-disposal/forced-GC stress is the hard native-safety gate (PASS, 82 KB median delta); candidate throughput/RSS (≈1.20 MB/s, ≈290 MB) recorded as an absolute self-baseline. Output-preserving optimizations committed: `490f302`, `13718af`, `4a26353`. Final independent verifier PASS.
- branch: `main`
- baseline: `5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03`
- push: not attempted

## Objective

Replace regex structural extraction with pinned native Tree-sitter grammars and versioned query/resolver contracts across all 33 canonical extensions while keeping semantic chunking, embeddings, ranking, and search behavior unchanged.

## Active Constraints

- TASK-001 is a no-fallback feasibility gate on exact Bun/macOS arm64. Every required grammar must install, load, and parse before production implementation.
- Native runtime downloads, WASM fallback, raw CST persistence, compiler/LSP resolution, and semantic-search changes are out of scope.
- Structural generations cover files, definitions, references, imports, centrality, diagnostics, and full counts; DB lease/snapshot/CAS activation must finish before terminal job state.
- Required-file hard failure blocks generation activation; incremental hard failure retains last-known-good active structure with stale diagnostics.
- TS/JS native-safety is bounded by the 16 MiB explicit-disposal/forced-GC stress gate (MLTS-022 reframed 2026-07-17, spec-owner approved); candidate throughput/RSS are an absolute self-baseline, not a regex-relative threshold, because the candidate is a full 33-language AST indexer vs the `5d43a96` single-regex baseline.
- One atomic commit per task. Sequential phase workers are authorized; independent verification is mandatory.

## Decisions

| ID | Status | Decision | Evidence |
| --- | --- | --- | --- |
| AD-001 | active after TASK-001/TASK-002 verification | Structural parsing uses pinned native Tree-sitter grammar artifacts plus repository-owned query/resolver packs; no runtime-download or WASM fallback. | TASK-001 matrix; TASK-002 frozen dependency/verifier gates |
| AD-002 | proposed; activate after migration/CAS tests | Graph schema upgrades build generation-scoped structure beside active data and activate through DB lease, immutable snapshot, completeness, and CAS. | `design.md`, full pre-mortem |
| AD-003 | active codec; transport parity pending T12/T20 | One versioned FQN codec owns modern IDs, legacy aliases, collision failure, and ambiguity payloads; later persistence/HTTP/MCP tasks must consume it without reimplementation. | TASK-006 canonical hash, collision, ambiguity, and independent review gates |
| AD-004 | active after TASK-004 PASS; re-baselined 2026-07-16 | Exact Bun `1.3.11` loads upstream native packages through one serialized compatibility loader that snapshots, removes, and restores the full `process.versions.bun` descriptor before parsing. Exact Node `25.9.0` is the build-only `node-gyp` helper (npm `11.14.1`). | TASK-001 native evidence; TASK-004 fault, readiness, startup, and direct-guard gates |
| AD-005 | active after TASK-002 PASS; re-baselined 2026-07-16 | The runtime identity combines upstream `tree-sitter@0.25.0` SRI with patch SHA-256 `e79aec7b96eb8114e85ebcb90f0a8b12076bcd8aa08c09bb88929621e1c1446d`, adding idempotent cursor/tree deletion, stale-object guards, immutable JS owner identity, same-tree cursor reset enforcement, generated-addon packaging, a C++20 `binding.gyp` (Node 25 headers), and an install-guard that no-ops when the prebuilt addon is present. Core bundles the patched dependency for packed consumers. | TASK-002 no-delete control, hardened prototype, independent crash reviews, fresh normal packed consumer, final independent PASS; re-baseline cold install + source/dist native verifier under Bun 1.3.11/Node 25.9.0 |
| AD-006 | active after TASK-005 PASS | Production uses one process-global FIFO parser pool: default capacity 4/hard max 32 and default acquisition timeout 5,000 ms/hard max 60,000 ms. Runtime owns cursor-before-tree cleanup and never returns empty success without a query executor. | TASK-005 overlap, timeout, retarget recovery, hard-outcome, native lifetime, RSS, and independent review gates |
| AD-004 (amendment 2026-07-21, native-runtime-rebaseline) | active; Bun pin moved 1.3.11 → 1.3.14 via merge of main (`e12c4e4`) into `wave-3` | Wave-3 absorbed main's Bun `1.3.14` bump + lock-contract `record.includes` fix via merge commit `b6aa4a4`. Node `25.9.0` unchanged; npm `11.14.1` unchanged (Codespace npm 11.12.1 → 11.14.1 install reconciled). ABI `137` unchanged (confirmed on both platforms). Native load still uses the masked-Bun Node-path (`withMaskedBunVersion` → `node-gyp-build` → `build/Release`). | `verify:tree-sitter-native` PASS on macOS arm64 + Ubuntu Codespace under Bun 1.3.14; `verify-tree-sitter-grammars.test.ts` 9/9; native-structural 152/152 both platforms |
| AD-005 (amendment 2026-07-21, native-runtime-rebaseline) | active; patch SHA `e79aec7b...` unchanged; only the Bun pin moves | Patch SHA `e79aec7b96eb8114e85ebcb90f0a8b12076bcd8aa08c09bb88929621e1c1446d` unchanged under Bun 1.3.14. Immutable owners, same-tree reset, install-guard, C++20 `binding.gyp`, 33-language manifest, versioned FQN codec, lazy grammar pool, embedded Vue/Markdown all unchanged (FROZEN contract). | 33+33 parses, 27+27 modules, 10 sensors, RSS -188 KB (Codespace) / +589 KB (macOS) < 16 MiB on both platforms under 1.3.14 |
| AD-006 (amendment 2026-07-21, native-runtime-rebaseline) | active; parser pool contract unchanged; only the Bun pin moves | Parser pool (capacity 4/max 32, timeout 5s/max 60s), cursor-before-tree cleanup, non-empty-success guarantee all unchanged under Bun 1.3.14. | 10 behavior sensors PASS on both platforms; RSS stress gate PASS (100 cycles, median delta well within 16 MiB) under 1.3.14 |

## Progress

- Required coding bootstrap, memory recall, persona routing, source investigation, and full Plan Challenge completed.
- Supplied plan revised until the Plan Critic reported no remaining critical/high contradiction.
- Canonical `spec.md`, `context.md`, `design.md`, `tasks.md`, `capability-matrix.md`, and initial `gate-manifest.md` created.
- 23 requirements, 12 acceptance criteria, 26 atomic tasks, seven phases, and independent verifier contract are frozen.
- Current source evidence: all 33 allowed extensions route through native structural extraction; the deterministic polyglot fixture proves 29 Flow-tier extensions and four Structure-tier extensions.
- TASK-001 target discovery measured macOS 26.5.2 arm64 with Bun 1.3.11. The user then narrowed platform scope to macOS arm64 only, reopening the grammar artifact loop. No production file changed yet.
- TASK-001 PASS: exact Bun 1.2.0 was rejected; exact Bun 1.3.0 passed a second frozen clean install, all 33 extension parses twice, 27 loaded native modules with Mach-O arm64/system-only linkage, and missing/incompatible negative sensors.
- Frozen selections include modern pinned Dart and Erlang Git commits, Clojure Orchard, and HTML as the Vue SFC host. No WASM or runtime download was used.
- TASK-002 initially pinned exact Bun 1.3.0, exact Node 22.22.2 build-helper contract, all 27 audited native dependencies/trust entries, and the frozen lockfile. Its first implementation passed fresh install, focused tests, type-check, and build, but independent review rejected the verifier as insufficient.
- TASK-002 remediation closed cold real source/dist consumers, queue release after setup/restoration faults, and exact resolved lock identities/integrities. The reference-only lifetime proposal was then falsified: stock binding parses retained about 1 MiB RSS per repeated 32 KiB parse under forced GC.
- A full native patch red-team rejected a root-only patch for packed consumers and required stale-object guards. The hardened source-and-packaging patch now adds idempotent cursor/tree deletion, live guards across Tree/Node/Query/oldTree/Cursor operations, and generated-addon delivery through core's bundled dependency.
- Independent review found a second critical native path: mutable public node/cursor `.tree` properties allowed a deleted owner to be replaced with a live tree and caused SIGSEGV. Patch v2 binds both owners as non-writable/non-configurable and adds cold substitution sensors.
- A follow-up review found cross-tree cursor reset/resetTo could bypass or desynchronize owner identity. Patch v3 marshals only same-tree reset nodes and rejects cross-tree cursor transfer in JS plus native code; the declaration marks both owners readonly.
- Authoritative patch v3 gates pass: empty-cache 770-package install; 9 focused tests/54 assertions; real cold source/dist 33+33 parses and 27+27 modules; ten behavior sensors; patched 100-cycle median below 1 MiB versus a roughly 125 MiB no-delete control; type-check 6/6; build 5/5.
- Fresh npm-packed shared/core installed into a normal consumer. Built core resolved only the nested runtime; immutable owners, same-tree reset, cross-tree reset/resetTo rejection, stale throw, and system-only Mach-O arm64 linkage passed.
- Exact Node 22.22.2/npm 10.9.7 packed shared/core after Bun 1.3.0 packing was proven to omit bundle payloads. A normal non-workspace Bun consumer imported built core, resolved the nested patched runtime, parsed/double-deleted, and loaded a system-only Mach-O arm64 addon.
- Clean build exposed pre-existing direct `zod` imports in core without a direct declaration; TASK-002 added `zod` as the minimal required dependency.
- TASK-003 froze the normalized structural contracts and exact ordered 33-extension manifest. Exact Bun 1.3.0 focused tests passed 6/6 with 451 assertions; uncached type-check/build passed; independent review's sole `parameterIndex` versus `paramIndex` mismatch was remediated and accepted.
- TASK-004 added literal lazy native grammar loading, exact serialized Bun-marker restoration, cached all-33 readiness, live-but-parser-failed health, startup validation ordering, and pre-side-effect guards for the tool, ETL, and legacy direct index paths. Focused/native/regression/type/build/dist gates and independent review passed.
- TASK-005 added the process-global bounded FIFO parser pool, structural runtime, bounded diagnostics with total counts, validated grammar-cache handoff, and native lifetime ownership. Review-driven fixes closed per-runtime cap multiplication, poisoned retarget-slot reuse, and public raw grammar access.
- TASK-006 added immutable UTF-8 byte/point indexing, embedded host-child span remapping, legacy line derivation, canonical full-SHA FQNs, legacy aliases, collision detection, and deterministic ambiguity payloads. Review-driven strict parsing prevents malformed modern-looking suffixes from masquerading as legacy names.
- TASK-007 added runtime-owned bounded native Query execution/cache identity and declarative TS/JS/TSX/JSX packs. Review-driven fixes completed typed signature/import material, exact exports/relations/calls/flow/specialized edges, capability filtering, private-name encoding, native dialect breadth, and AST-safe modifier identity.
- TASK-008 added an exact `(dialect, resolverVersion)` registry, generation-scoped identity session, and deterministic TS/JS resolver for lexical, import, re-export, namespace, default-owner, global, ambiguity, unresolved, and legacy outcomes. Review-driven direct probes closed nested-basename leakage, dynamic import namespaces, barrel forwarding, private export leakage, and default-owner member qualification.
- TASK-009 routed TS/JS/TSX/JSX ETL structural work through the native runtime, retained exact `smartChunk` output, persisted generation-scoped resolver results, froze executable pre-T9 parity evidence and approved additions, and removed the superseded TS/JS regex typed-edge path. Focused 105/105, native source/dist, type/build, diff, and independent review gates passed.
- TASK-010 added the locked transactional graph-generation migration, deterministic legacy backfill, generation-owned graph keys/metadata, active/pending/lease state, full counts, and an active-scoped T9 repository bridge. Owned PostgreSQL 17 passed 3/3 with 62 assertions; clean migration, migrated ETL, type/build, and independent review gates passed.
- TASK-011 added the PostgreSQL lifecycle repository for serialized begin, heartbeat, completion, CAS activation, abort, lease-expiry takeover, and superseded cleanup. The owned macOS arm64 PostgreSQL suite passed 11/11 with 67 assertions after review fixes made expired abort non-mutating and protected last-known-good generation pointers. T13 retains ownership of discovered-file snapshot membership and post-snapshot content-delta reconciliation.
- TASK-012 generation-scoped symbol storage now validates live pending leases, atomically replaces/deletes/stales per-file graph rows, removes stale inbound edges, captures one active generation for batch reads/writes, replaces centrality exactly, and resolves modern/legacy FQNs with deterministic ambiguity. Owned PostgreSQL passed 12/12 with 38 assertions after race and identity review remediation.
- TASK-013 integrates complete pending generations through real Discover/Parse/Resolve/Load stages, immutable input snapshots, deletion reconciliation, stale LKG recovery, cross-process owner refresh, interruption settlement, synchronous CAS activation, and durable terminal generation identity. Exact Bun 1.3.0 focused/owned PostgreSQL passed 38/38 with 147 assertions; type-check 6/6, build 5/5, diff, and independent review passed. The canonical semantic vector/keyword lifecycle remains unchanged by adjudication.
- TASK-014 preserves exact diagnostic totals independently from ten bounded details/spans for recovered and incremental hard/stale files, derives status/language summaries only from the activated generation, and durably round-trips the summary with its activated identity through nullable forward-compatible job columns. Exact Bun 1.3.0 focused/owned PostgreSQL and ETL passed 50/50 with 249 assertions; type 6/6, build 5/5, diff, and independent review passed.
- TASK-015 adds native Python/Ruby/PHP/Lua declarations, documentation, honest per-module/per-clause imports, applicable type relations, calls/data flow/HTTP/events, and dialect-scoped resolution without cross-language leakage. Exact Bun 1.3.0 focused query/resolver/ETL passed 67/67 with 333 assertions; core build/type compilation, diff, and independent review passed after four P1 remediations.
- TASK-016 adds native C/C++/Go/Rust/Zig declarations, documentation, honest AST-derived imports, applicable types/inheritance/traits, calls/data flow/HTTP/events, and dialect-isolated resolution. `.h` defaults to C and selects C++ only from unambiguous native importer or directory-aware compilation-database evidence, including cached importers; angle includes remain unresolved. Exact Bun 1.3.0 focused gates passed 95/95 with 1,010 assertions; core build, diff, and independent review passed after four remediation rounds.
- TASK-017 adds native Java/Kotlin/KTS/Scala/C#/Swift/Dart declarations, documentation, honest imports, overload/constructor/property/field identities, inheritance, calls/data flow/HTTP/events, and dialect-isolated resolution. Real Java provider/consumer tests prove nested and static named/wildcard imports with public/private visibility. Exact Bun 1.3.0 focused gates passed 91/91 with 480 assertions; type-check 6/6, build 5/5, diff, and independent review passed after five remediation rounds.
- TASK-018 adds native Elixir/EXS/Erlang/Clojure/OCaml/Haskell declarations, documentation/spec evidence, honest namespace/named/open/qualified/hiding imports, applicable relations, calls/data flow, module-owned identities, and dialect-isolated resolution. BEAM import arity selects exact overload identities; EX/EXS remain compatible. Exact Bun 1.3.0 focused gates passed 101/101 with 575 assertions; type-check 6/6, core build 2/2, diff, and independent review passed after two remediation rounds.
- TASK-019 adds Vue/Markdown embedded parsing plus Markdown heading and JSON/YAML qualified-key packs. Host resources release before sequential depth-two child parsing, native UTF-16 offsets are centrally adapted to exact UTF-8 bytes, Vue `lang` uses native attributes, stable ordinal scopes remap child spans, and fallback/hard-failure diagnostics retain exact totals. Exact Bun 1.3.0 passed 141/141 with 915 assertions; type-check 6/6, build 5/5, diff, and independent review passed after resolver, native-attribute, and acceptance-matrix remediation.
- TASK-020 routes definition, reference, trace, architecture, and impact consumers through one active-generation identity lookup; exact modern identities resolve, legacy ambiguity remains explicit and stable, overload impact analysis does not fall back to bare names, and search exposes all 18 canonical additive kinds. Exact Bun 1.3.0 focused tests passed 8/8 with 19 assertions; owned PostgreSQL passed 21/21 with 81 assertions; type-check 6/6, build 5/5, diff, and independent review passed. A supplemental broad trace/architecture run retained four pre-existing shared-database fixture failures outside the task-owned gate; no validation asset was weakened.
- TASK-021 exposes one shared parser-summary, active-generation, FQN-resolution, and canonical 18-kind transport contract through HTTP and the production MCP CallTool proxy. Project-map graph inputs are captured in one share-locked PostgreSQL transaction so concurrent activation cannot mix generations; extension counts remain distinct from parser language counts and raw diagnostics are never expanded. Exact Bun 1.3.0 focused transport/readiness/identity tests passed 19/19 with 92 assertions; owned PostgreSQL passed 21/21 with 93 assertions including the activation-lock/pending-poison sensor; type-check 6/6, build 5/5, diff, and independent re-review passed after both initial P1 findings were remediated.
- TASK-022 replaces the baseline-deleted indexing limitation suite with a PostgreSQL-native deterministic all-33 E2E contract. A 29-of-33 ParseStage integration escape—25/29 Flow tiers plus all four Structure tiers—was remediated by deriving routing from `LANGUAGE_MANIFEST`; the exact fixture now proves 29 Flow tiers, four Structure tiers, modern/legacy identity, HTTP/MCP parity, unresolved null targets, atomic activation, stale-failure preservation, deletion, and same/different-project concurrency. Owned sequential E2E passed 41 tests with 664 assertions plus one explained auth-on skip; focused indexing passed 7/7 with 249 assertions; static routing passed 20 tests with 278 assertions and seven expected E2E-off skips; type 6/6, build 5/5, qwen 69-entry hash validation, diff, and independent final review passed.
- TASK-023 implementation is complete but uncommitted. Focused 14/14, source/dist native 33+33 parses and 27+27 modules, ten lifetime sensors, RSS/linkage, type 6/6, build 5/5, tar semver/addon inspection, and an extracted packed-surface 33/27/10 run pass. Independent review requires the current tarballs' mandatory empty-cache install; it remains unexecuted because platform network escalation was rejected at the account approval limit and local caches lack 47 resolution manifests plus Dart/Erlang Git tarballs.

## Native Runtime Re-baseline (2026-07-16)

User directive switched the native runtime to Bun `1.3.11` and Node `25.9.0` (Node 25.2.2 was requested but is not a real release; the closest real, locally-installed Node 25.x — 25.9.0 — was selected and confirmed by the user). The network approval block cleared, so the TASK-023 empty-cache packed-consumer install now runs. Two real defects surfaced and were fixed: (1) Node 25 headers require C++20 while `tree-sitter@0.25.0` declared C++17, so the patch now sets the `binding.gyp` C++ standard to C++20; (2) the bundled tree-sitter `install` script (`node-gyp-build`) fell back to a missing `node-gyp` in consumers, so the patch adds an install-guard that no-ops when the prebuilt addon is present (falling back to the upstream command only for fresh source builds). The package verifier also materializes the hoisted patched runtime into `packages/core/node_modules` before `npm pack` so the core tarball bundles the exact nested patched runtime. Cold install, source/dist native verifier (33+33 parses, 27+27 modules, 10 sensors, RSS within bound), the package gate (33 parses, 27 modules/paths, 10 sensors), focused verifier tests (14/14), type-check (6/6), and build (5/5) pass under the new versions. Patch SHA moved from `b0f73d00…` to `e79aec7b96eb8114e85ebcb90f0a8b12076bcd8aa08c09bb88929621e1c1446d`.

## Next Step

Commit the native runtime re-baseline, then commit TASK-023 (`build(parser): verify macos native artifacts`) after its independent review passes. Continue TASK-024 (frozen macOS arm64 CI), TASK-025 (parser benchmark), and TASK-026 (docs) under Bun `1.3.11`/Node `25.9.0`.

## Previous Feature

`sqlite-removal` remains registry `in_progress` because its documented legacy-fixture follow-up is unresolved; its implementation/validation evidence remains under `.specs/features/sqlite-removal/`. This feature does not alter that status.

### SQLite Removal Final State

- Configuration, installer, core persistence, API/health, CI, docs, and active test/E2E paths were converted to PostgreSQL-only behavior.
- Workspace type-check/build, validator discrimination, bootstrap regression, installer tests, active-reference scan, and diff integrity passed.
- Isolated PostgreSQL 17 + pgvector completed 14 migrations, vector CRUD integration (16/16), CRUD/scheduler restart checks (44), smoke (4/4), CLI (13/13), and destructive E2E (4/4; 79 assertions). Owned `:5433`, `:3334`, and `:11435` resources were removed; shared `:3333` remained healthy.
- Residual follow-up: rerun a legacy migration smoke after its checked Prisma fixture repair, rebuild/re-run the frozen qwen fixture, and capture a concise aggregate root-test result.
- Canonical evidence: `.specs/features/sqlite-removal/validation.md`.

### Historical Plan Spec Capture

- Added 14 feature-named folders for supplied Claude Code plans, each with `spec.md`, `design.md`, `tasks.md`, and `validation.md`.
- Source plans remain machine-local under `/Users/luizmassa/.claude/plans`; each feature design captures commit-backed execution facts and explicit gaps.
- Historical source range: inclusive `c1d37b8120025a69e2de0e5fd054ca8177e205de^..81d33606fb6826e1759a073006b165419d0e3ba4` contains 133 reachable commits. Historical claims are not current-session runtime verification.

## Wave 2 (Improvement Plan v2) — COMPLETE

- Source plan: `~/Downloads/massa-ai-improvement-plan.md`. Wave 1 merged via PR #3 (`9fb32f3`).
- workflowSessionId: `spec-driven-wave2`; branch: `wave-2` (off `main`).
- Status: **COMPLETE** — 10/10 items done (M36, M7, M9, M40, M13, M11, M10, M8, M12, M14). All validated PASS. Local branch `wave-2` now tracks `origin/wave-2`.
- **M36 (TOON compact output) — DONE + validated PASS** (2026-07-18). Shared `serializeToolResponse` + `fields` projection; `format` added to 3 tools (get_optimized_context, trace_path, impact_analysis), `fields` to all 12, two-layer MCP parity. Commits `33fea92`, `23035ac`, `05d518b`, `1d30061` on `wave-2`. Independent verifier PASS, discrimination sensor 4/4. Artifacts: `.specs/features/toon-compact-output/`. Follow-ups (non-blocking): MCP `search` def lacks `format` (pre-existing, M32 scope); pre-existing PG-fixture failures in `trace-path.test.ts` (test-isolation task).
- **Small batch — DONE** (2026-07-18): M7 query deadline (`8cf69d2`, injectable clock), M9 schema-ahead (`1ef6d0a`, SchemaAheadError + canonical-signature/checkpoint guards), M40 pinned invariant (`164ed95`, pin guard + fail-closed proposal validation), M13 body-tokens gate (`969ae4f`, empty-region signature skip). Each DB-free tested + tsc clean. Quick specs under `.specs/quick/001..004`.
- **M11 (grammar load-time integrity) — DONE** (`4731cbd`). Shared `native-lock-identities.ts` + `grammar-integrity.ts` verifier (sha512 over package source, ABI-rebuild-safe), wired into `parser-readiness.ts` default-on/memoized. NOTE: prior partial's 27 `sourceIntegrity` pins were fabricated; re-derived from `bun.lock` + recomputed, round-trip-verified. Quick spec `.specs/quick/005`.
- Remaining: **M10** (search preflight — behavior change, two-tier recommended), **M8** (audit-log — DB migration + actor-identity gap), **M12** (agent installer — writes user HOME), **M14** (god-files refactor — Large/high-risk, own feature). Checkpoint before M8/M12/M14.
- **M10/M8/M12 — DONE** (2026-07-18, user approved safe-defaults proceed): M10 two-tier search preflight (`1f5374f`, hard-fail unindexed / warn stale); M8 audit-log (`6db3855`, additive reversible `operation_log` migration + `recordOperation` + api-key-only `ActorContext` seam, PG-verified); M12 agent installer (`d8bf093`, `scripts/install-agents.ts`, 5 agents wired — claude-code/desktop/codex/cursor/opencode — safe-merge+backup+`--dry-run`+`--uninstall`+home-write guard; Gemini/Grok/Devin deferred). Final regression: 67 pass across 6 core DB-free suites + 46 installer; repo type-check 6/6.
- **M14 (god-files refactor) — DONE** (2026-07-18, branch `m14-god-files` off `wave-2`, full spec-driven pass with plan-challenge gate): decomposed both god-files behind byte-identical facades. query-pack 1254→73 LOC across 5 modules (native-node-helpers/symbol-signature/query-pack-registry/query-pack-captures/query-pack-edges); ContextualSearchRLM 1668→463 LOC across 5 delegate modules (rlm-indexing/rlm-search/rlm-fusion/rlm-synapse/rlm-admin). No module >537 LOC. New characterization test (21 tests) pins RRF fusion + search() + mutex try/finally BEFORE the split. Plan-critic gate caught 3 critical/high issues (mutex try/finally preservation, `_indexProjectInternal`/`ensureInitialized` instance-delegate requirement, characterization seam-reachability) — all incorporated pre-execute. Static `indexingLocks` mutex preserved; barrel `services/index.ts` byte-identical. Independent verifier: PASS (88/88 targeted tests, 3 discrimination mutations killed). 9 commits. Validation at `.specs/features/god-files-refactor/validation.md`. **Wave 2 now 10/10 complete.** Branch NOT pushed.

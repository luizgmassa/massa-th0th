# Subagent Skills Plugin Parity Specification

## Problem Statement

massa-ai defines 12 reusable sub-agent skills in `skills/` (charter `SKILL.md` files) plus a single shipped subagent (`massa-ai-navigator.md`) inside the Claude and Cursor plugins. None of the four supported plugin packages ship the 12 specialists in a host-native, invocation-ready form. Codex ships zero agents; Claude ships one; Cursor ships one; OpenCode ships none. Users installing any plugin therefore lose access to the investigator/planner/builder/reviewer/context-curator/verification-agent/requirements-analyst/architecture-specialist/test-engineer/documentation-agent/audit-specialist/mobile-specialist specialists that the massa-ai workflow router and AGENTS.md registry describe.

## Goals

- [ ] Ship all 12 sub-agent specialists as host-native subagent definitions across Claude Code, Codex, Cursor, and OpenCode
- [ ] Each host gets a full-native frontmatter adaptation (tools, permission boundaries, model hint) so read-only vs write boundaries are enforced per host, not advisory
- [ ] Preserve the existing `massa-ai-navigator.md` subagent in Claude/Cursor (it is a different, index-first agent); the 12 new specialists coexist with it
- [ ] Idempotent install/uninstall for the new agents, matching the ownership-marker + backup + consent-gate conventions from `install-agents.ts`
- [ ] Keep all existing tests green; add manifest + installer tests proving the 12 agents are present and correctly shaped per host
- [ ] No new lifecycle hooks (decision: the 12 skills are invocation-based, not lifecycle events)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| Rewriting massa-ai workflows to invoke the shipped agents instead of inline prompt sections | Tracked separately by the registry's "Future Integration" note. This feature only ships the agent definitions. |
| New lifecycle hook events (SubagentStart/Stop capture) | User decision: the 12 skills are invocation-based; existing 6 lifecycle hooks already cover passive capture. No binary changes. |
| Plugin-shipped agents using `hooks`/`mcpServers`/`permissionMode` frontmatter on Claude Code | Claude Code blocks these frontmatter fields on plugin-shipped agents for security. We omit them (agents inherit MCP from the parent session, which already loads the massa-ai MCP server). |
| Changing the shared `massa-ai-hook.ts` binary or `EVENT_MAP` | No hook work in this feature. |
| Marketplace publication (Codex marketplace JSON, Cursor/VS Code marketplace) | Bundles are installable from the repo. Marketplace submission is a separate operational step. |
| New npm packages or build pipelines | All four hosts support filesystem-discovered agents (Claude/Cursor `.md`, Codex `.toml`, OpenCode `.md`). No new build target. |
| Removing or rewriting the existing `massa-ai-navigator.md` | It is a distinct index-first navigator. Keep it; the 12 specialists are additive. |
| Agent auto-invocation / routing logic | Hosts decide when to delegate based on `description`. We do not add routing code. |
| Duplicating the full per-agent model/effort/permission tables in `README.md` | `README.md` is the summary layer; the full tables live in `FEATURES.md` (depth layer). README links into FEATURES. Splitting prevents README bloat and keeps a single verifiable source (FEATURES ↔ spec parity test). |
| Editing the per-plugin `apps/*/README.md` to add full subagent tables | The per-app READMEs stay focused on their own plugin's install. The cross-cutting 12-specialist depth lives in the root `FEATURES.md` (which already has the `## Plugins (4-Tool Parity)` section). Per-app READMEs get a one-line mention + link only. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Ship as host-native subagent definitions | Yes — Claude `agents/*.md`, Cursor `agents/*.md`, OpenCode `agents/<name>.md` (mode: subagent), Codex `agents/<name>.toml` | User selected "As agents". Each host has a native subagent concept; the charters describe bounded invocation specialists. Matches the registry's orchestration model. | y (user) |
| Full native frontmatter adaptation | Yes — map `metadata.permission` → host tool/permission lists; `model` PINNED per host (see model tables below, NOT advisory); strip massa-ai-internal sections into advisory body prose | User selected "Full native adaptation". Preserves the read-only/write boundary central to the registry; drops fields hosts ignore. Model is pinned (user follow-up directive), not advisory. | y (user) |
| No new hooks | Yes — record "hooks not applicable" as accepted assumption | User selected "No new hooks". Claude blocks plugin-agent hooks (security); OpenCode/Cursor/Codex have no per-subagent hook concept. Existing 6 lifecycle hooks unchanged. | y (user) |
| **Model pinning** (user follow-up) | Each agent's `model` is PINNED in host-native frontmatter, NOT advisory. Per-host tables below. | User directive: "enforce the subagents to use specific models." Reverses the earlier "advisory body comment" decision. Pinning guarantees the cost/quality target per agent. | y (user follow-up) |
| **Reasoning/effort pinning** (user follow-up) | Reasoning effort is PINNED per host: Claude Code `effort: high`; Codex `model_reasoning_effort = "high"`; Cursor `reasoningEffort: max` (pass-through, field unverified — see assumption); OpenCode `reasoningEffort: max` (pass-through, provider-dependent honoring). | User directive: "In Cursor/Open Code, use max. In Claude/Codex, use high." Enforced, not advisory. | y (user follow-up) |
| Codex model_reasoning_effort | `high` on every Codex agent TOML. Codex docs list `ultra`/`max`/`xhigh`/`high`/`medium`/`low`; user selected `high` for Codex (vs `max` for Cursor/OpenCode). | User directive: "In Claude/Codex, use high." | y (user) |
| Cursor reasoningEffort | `reasoningEffort: max` added to every Cursor agent frontmatter as a pass-through field. Cursor's subagent frontmatter docs returned 404 (unverified); the field follows OpenCode's pass-through convention. If Cursor ignores unknown frontmatter (likely, matching the `.cursor-plugin/plugin.json` "optional manifest" behavior), the field is harmless. Verification deferred to Design. | User directive: enforce on all four, Cursor/OpenCode → max. | y (user; field-name unverified — recorded assumption) |
| OpenCode reasoningEffort | `reasoningEffort: max` added to every OpenCode agent frontmatter. OpenCode docs confirm unknown options pass through to the provider ("Any other options you specify... will be passed through directly"). Whether DeepSeek V4 Pro / GLM-5.2 / MiniMax M3 honor `reasoningEffort: max` is provider-dependent — the pin is emitted verbatim; honoring is host/provider behavior. | User directive + OpenCode pass-through docs. | y (user; provider-honoring unverified) |
| Cursor model + effort | Use the charter `metadata.model_hint` value verbatim in the `model` frontmatter field (e.g. `model: DeepSeek V4 Pro`, `model: GLM-5.2`, `model: MiniMax M3`). Plus `reasoningEffort: max` (see effort-pinning row). Cursor resolves the model by alias/name; if unavailable, the host falls back. | User directive: "use the models already defined in the agents skills markdown files in max reasoning/effort." The charters' `model_hint` is the chosen Cursor/OpenCode model. | y (user) |
| OpenCode model + effort | Use the charter `metadata.model_hint` value verbatim in the `model` frontmatter field. Plus `reasoningEffort: max` (see effort-pinning row). OpenCode `model` accepts provider/model-id format; if the pinned model is unavailable, OpenCode falls back to the primary agent's model. | User directive (same as Cursor). OpenCode inherits the invoking primary agent's model if the pinned model is missing — acceptable graceful degrade. | y (user) |
| Codex agent file format | TOML at `agents/<name>.toml` with `name`, `description`, `developer_instructions`, `sandbox_mode` (read-only agents → `read-only`; write agents → omit or `workspace-write`) | Official Codex subagents doc: custom agents are TOML files under `~/.codex/agents/` or `.codex/agents/`. The plugin manifest (`plugin.json`) has NO `agents` field; Codex does not bundle agents in plugins. So the Codex installer writes agent files into `~/.codex/agents/` (user) or `./.codex/agents/` (project), NOT into the plugin dir. | y (web research — Codex Subagents doc, verified live 2026-07-23) |
| Codex agent file location vs plugin dir | Codex custom agents live in `<codex_dir>/agents/*.toml`, separate from `<codex_dir>/plugins/massa-ai/`. The Codex plugin installer SHALL write agent TOML files alongside copying the plugin bundle. Uninstall removes only ownership-marked agent files. | Codex plugin discovery loads `skills/` + `hooks/` + `.mcp.json` from the plugin dir, but custom agents are loaded from the `agents/` directory at the config root, not the plugin dir. This is a divergence from Claude/Cursor (whose plugins bundle `agents/`). | y (web research) |
| Claude Code agent frontmatter | `name`, `description`, `tools` (comma string), `model`. Omit `hooks`/`mcpServers`/`permissionMode` (blocked on plugin-shipped agents). Read-only agents: `tools: Read, Grep, Glob` (+ `Bash(pwd)` where useful); write agents: add `Write, Edit, Bash`. | Official Claude Code sub-agents doc. Plugin-shipped agents load from the plugin's `agents/` directory (lowest priority). | y (web research) |
| Cursor agent format | Same as Claude Code — `agents/*.md` with `name`, `description`, `tools`, `model`. Cursor auto-discovers `agents/` in a registered plugin path. | Prior parity feature confirmed Cursor auto-discovers `agents/`. Cursor skill format differs (`skills/<name>/SKILL.md`) but agent format matches Claude. | y (codebase + prior spec) |
| OpenCode agent format | `.md` at `~/.config/opencode/agents/<name>.md` (user) or `.opencode/agents/<name>.md` (project), frontmatter `description` (required), `mode: subagent`, `model`, `permission` (e.g. `edit: deny` for read-only). The OpenCode Plugin API does NOT register agents — they are filesystem-discovered. | Official OpenCode agents doc + skills doc. OpenCode plugin (`@massa-ai/opencode-plugin`) currently has no agent registration; agents are a separate filesystem concept. So the OpenCode installer SHALL write `.md` agent files to the agents directory, NOT into the npm package. | y (web research) |
| OpenCode agent install path | The `config-cli.ts` (or a new install command) writes agent `.md` files to `~/.config/opencode/agents/` (user) or `.opencode/agents/` (project). The npm plugin itself is unchanged (it owns tools + in-process hooks). Agents are a separate filesystem-discovered layer. | OpenCode discovers agents from `.opencode/agents/`, `~/.config/opencode/agents/`, `.claude/agents/`, `~/.claude/agents/`, `.agents/skills/`, `~/.agents/skills/`. We use the native `.opencode/agents/` + `~/.config/opencode/agents/` pair. | y (web research) |
| Model hint mapping | `DeepSeek V4 Pro` → omit (host default); `GLM-5.2` → omit (host default) or advisory note; `MiniMax M3` → omit. Model IDs are host-specific and the charters mark hints as advisory. We record the hint in the agent body as a comment, not in the frontmatter `model` field, to avoid hard-coding unavailable models. | OpenCode/Claude/Cursor `model` accepts provider-specific IDs; Codex uses `gpt-5.x`. Hard-coding a non-host model would break loading. The charters already say "advisory; fallback to configured default." | y (charter text + web research) |
| Permission mapping | read-only → Claude/Cursor `tools: Read, Grep, Glob, Bash`; OpenCode `permission: { edit: deny, bash: <pattern> }`; Codex `sandbox_mode = "read-only"`. write → Claude/Cursor `tools: Read, Grep, Glob, Write, Edit, Bash`; OpenCode `permission: { edit: allow, bash: allow }` (or omit); Codex `sandbox_mode` omitted or `"workspace-write"`. test-write/doc-write scoped agents get the write tools but with a scoped body instruction. | Matches each host's native permission model. Preserves the registry's read-only/write boundary. | y (charter permissions + host docs) |
| `mobile-specialist` conditional shipping | Ship on all four hosts (no conditional skip). The charter says "conditional: mobile project detected" — but shipping the definition is harmless; the host only delegates when the description matches a mobile task. Non-mobile repos simply never invoke it. | The charter's "conditional" refers to invocation, not shipping. Shipping everywhere keeps plugin parity simple. | y (charter reading) |
| Existing `massa-ai-navigator.md` | Keep as-is in Claude/Cursor. Do NOT ship it to Codex/OpenCode (Codex has no plugin-bundled agents; OpenCode gets the 12 specialists but navigator is a Claude/Cursor-specific index-first agent already covered by the 6 slash commands). | Navigator is index-first and tied to MCP tools already registered. The 12 specialists are the gap this feature closes. | y (codebase) |
| Agent body content | Each agent body = charter Mission + Responsibilities + Restrictions + Inputs + Outputs + Invocation (use/do-not-use) + a condensed "massa-ai Integration" section (Context Firewall, Verification Ladder, Memory Boundary, Synapse where relevant). Strip `license`/`metadata`/`Model Hint` frontmatter (move model hint into body as a comment). | Preserves the operational guidance; drops frontmatter hosts ignore or that would break loading. | y (user: full native adaptation) |
| Codex `developer_instructions` field | The charter body becomes the `developer_instructions` string (triple-quoted TOML string `"""..."""`). Escape any embedded `"""` as `\"\"\"` in the generator. Preserve markdown structure inside. | Codex TOML agent schema requires `developer_instructions` as the core instruction field. | y (web research) |
| Single source of truth (drift prevention) | The shipped agent files are GENERATED from `skills/*/SKILL.md` by a small generator (one script, run at build/dev time, output checked into the apps). A test asserts every shipped agent body is byte-identical to the generator output from the current charters, so drift fails CI. | Plan-critic F1: silent divergence between `skills/` and `apps/*/agents/` is the most likely failure mode. The generator + parity test makes drift a deterministic check. | y (plan-critic) |
| Built-in agent name collisions | None of the 12 registry names (`investigator`, `planner`, `builder`, `reviewer`, `context-curator`, `verification-agent`, `requirements-analyst`, `architecture-specialist`, `test-engineer`, `documentation-agent`, `audit-specialist`, `mobile-specialist`) collide with host built-ins (Codex `default`/`worker`/`explorer`; Claude `Explore`/`Plan`/`general-purpose`; OpenCode `build`/`plan`/`general`/`explore`/`scout`). No intentional overrides. A test asserts no shipped name equals a host built-in name. | Plan-critic F2: avoid silently shadowing a built-in. | y (plan-critic) |
| Ownership marker for out-of-plugin-dir agents (Codex/OpenCode) | Codex TOML agents get a comment line `# massa-ai-owned` at the top of the file; OpenCode `.md` agents get a frontmatter field `metadata: { massa-ai-owned: true }` (hosts ignore unknown frontmatter). Uninstall removes only files carrying the marker. Claude/Cursor agents live inside the plugin dir and are removed with it (no per-file marker needed, but we still prefix names `massa-ai-`). | Plan-critic F5: Codex/OpenCode agent dirs are SHARED with user agents; the `.massa-ai.bak-<ts>` backup convention doesn't mark the agent file itself. Need an in-file marker for safe scoped uninstall. | y (plan-critic) |
| Claude `tools` frontmatter format | JSON array form `["Read", "Grep", "Glob", "Bash"]` (matching the existing `massa-ai-navigator.md` which uses `["mcp__massa-ai__*", "Read", "Grep", "Glob", "Bash(pwd)"]`). NOT the comma-string form. | Plan-critic F6: the existing navigator uses array form; mixing formats risks a parse path breaking. Consistency with the existing precedent. | y (codebase) |
| OpenCode `permission.bash` per-agent | Strict read-only agents (investigator, context-curator, verification-agent, requirements-analyst, architecture-specialist, reviewer, audit-specialist, mobile-specialist): `permission: { edit: deny, bash: deny }`. Inspection-capable read-only agents (planner): `permission: { edit: deny, bash: { "*": "ask" } }`. Write agents (builder, test-engineer, documentation-agent): `permission: { edit: allow, bash: allow }` (or omit to inherit). | Plan-critic F4: spec left `bash` ambiguous per agent. Fixed mapping per charter permission + whether the agent runs inspection commands. | y (plan-critic) |
| Generator script location | `scripts/generate-subagent-artifacts.ts` (Bun/TS) — reads `skills/*/SKILL.md`, emits per-host agent files into `apps/{claude,codex,cursor,opencode}-plugin/agents/`. Run via `bun run scripts/generate-subagent-artifacts.ts`. Outputs checked into git so the plugins ship without a build step. | Plan-critic F1 mitigation: one generator, one source of truth, deterministic output. | y (plan-critic) |

**Open questions:** none — all resolved or logged above (required before the spec is confirmed).

---

## Model Pinning Tables (per host)

The `model` frontmatter field is PINNED per agent per host (user follow-up directive: "enforce specific models"). NOT advisory. The generator emits these exact values; a parity test asserts them.

### Claude Code (model aliases + `effort: high`)

Every Claude Code agent SHALL set `effort: high` in addition to its pinned `model`.

| Agent | Model | Why |
| --- | --- | --- |
| investigator | haiku | Fast repository exploration, symbol lookup, dependency tracing, file discovery. |
| context-curator | haiku | Reading many files, summarizing, filtering, building Context Packets. |
| documentation-agent | haiku | README, KDoc, changelogs, ADR formatting don't need frontier reasoning. |
| requirements-analyst | sonnet | Needs to detect ambiguity and infer missing requirements. |
| planner | opus | One of the highest-leverage places to spend tokens. |
| builder | sonnet | "Everyday coding" workload Sonnet is intended for. |
| reviewer | sonnet | Strong balance of code understanding and cost. |
| verification-agent | sonnet | Systematic reasoning without Opus-level cost. |
| test-engineer | sonnet | Excellent for generating tests and edge cases. |
| audit-specialist | sonnet | Most audits don't justify Opus unless architectural. |
| mobile-specialist | sonnet | Android/iOS implementation is primarily coding work. |
| architecture-specialist | opus | Large-scale design, trade-offs, migrations, RFC guidance. |

### Codex (model IDs + `model_reasoning_effort = "high"`)

Every Codex agent TOML SHALL set `model_reasoning_effort = "high"` in addition to its pinned `model`.

| Agent | Model | Why |
| --- | --- | --- |
| investigator | gpt-5.4-mini | Fast repository exploration, symbol lookup, dependency tracing, file discovery. |
| context-curator | gpt-5.4-mini | Reading many files, summarizing, filtering, building Context Packets. |
| documentation-agent | gpt-5.4-mini | README, KDoc, changelogs, ADR formatting don't need frontier reasoning. |
| requirements-analyst | gpt-5.6-terra | Needs to detect ambiguity and infer missing requirements. |
| planner | gpt-5.6-sol | One of the highest-leverage places to spend tokens. |
| builder | gpt-5.6-terra | "Everyday coding" workload GPT-5.6 Terra is intended for. |
| reviewer | gpt-5.6-terra | Strong balance of code understanding and cost. |
| verification-agent | gpt-5.6-terra | Systematic reasoning without Opus-level cost. |
| test-engineer | gpt-5.6-terra | Excellent for generating tests and edge cases. |
| audit-specialist | gpt-5.6-terra | Most audits don't justify Opus unless architectural. |
| mobile-specialist | gpt-5.6-terra | Android/iOS implementation is primarily coding work. |
| architecture-specialist | gpt-5.6-sol | Large-scale design, trade-offs, migrations, RFC guidance. |

### Cursor (charter `metadata.model_hint` verbatim + `reasoningEffort: max`)

Every Cursor agent SHALL set `reasoningEffort: max` in frontmatter (pass-through; field-name unverified — see assumptions). Cursor resolves the model by name; if unavailable, the host falls back.

| Agent | Model (verbatim from charter) | Charter hint |
| --- | --- | --- |
| investigator | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| context-curator | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| documentation-agent | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| requirements-analyst | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| planner | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| builder | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| reviewer | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| verification-agent | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| test-engineer | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| audit-specialist | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| mobile-specialist | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| architecture-specialist | MiniMax M3 | `metadata.model_hint: MiniMax M3` |

### OpenCode (charter `metadata.model_hint` verbatim + `reasoningEffort: max`)

Every OpenCode agent SHALL set `reasoningEffort: max` in frontmatter (pass-through to the provider; honoring is provider-dependent for DeepSeek/GLM/MiniMax). OpenCode `model` accepts `provider/model-id`; if the pinned model is unavailable, OpenCode gracefully falls back to the invoking primary agent's model.

| Agent | Model (verbatim from charter) | Charter hint |
| --- | --- | --- |
| investigator | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| context-curator | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| documentation-agent | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| requirements-analyst | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| planner | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| builder | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| reviewer | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| verification-agent | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| test-engineer | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| audit-specialist | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| mobile-specialist | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| architecture-specialist | MiniMax M3 | `metadata.model_hint: MiniMax M3` |

> OpenCode pass-through confirmed by docs ("Any other options you specify... will be passed through directly to the provider"). The `reasoningEffort: max` pin is emitted verbatim; whether DeepSeek V4 Pro / GLM-5.2 / MiniMax M3 honor it is provider behavior, not a spec gap.

---

## User Stories

### P1: Claude Code subagent bundle ⭐ MVP

**User Story**: As a Claude Code user with the massa-ai plugin installed, I want the 12 sub-agent specialists available as native subagents (invocable via the Agent tool / @mention) with correct read-only/write tool boundaries, so that the massa-ai workflow router's delegation model works inside Claude Code.

**Why P1**: Claude Code is the canonical host the plugins were built on first; it has the richest subagent support and the existing `massa-ai-navigator.md` precedent.

**Acceptance Criteria**:

1. WHEN a user runs `apps/claude-plugin/install.sh --user` THEN the system SHALL create 12 agent files at `~/.claude/agents/massa-ai-<name>.md` (names: investigator, planner, builder, reviewer, context-curator, verification-agent, requirements-analyst, architecture-specialist, test-engineer, documentation-agent, audit-specialist, mobile-specialist), each with `name`, `description`, `tools`, and `model` frontmatter
2. WHEN the Claude Code plugin is installed THEN each read-only agent (investigator, planner, reviewer, context-curator, verification-agent, requirements-analyst, architecture-specialist, audit-specialist, mobile-specialist) SHALL have `tools` restricted to read-only tools (`Read, Grep, Glob, Bash`) and SHALL NOT include `Write` or `Edit`
3. WHEN the Claude Code plugin is installed THEN each write-permitted agent (builder, test-engineer, documentation-agent) SHALL include `Write, Edit, Bash` in `tools` in addition to read tools
4. WHEN the Claude Code plugin is installed THEN no shipped agent SHALL set `hooks`, `mcpServers`, or `permissionMode` frontmatter (Claude Code blocks these on plugin-shipped agents)
5. WHEN a user runs `apps/claude-plugin/install.sh --uninstall` THEN the system SHALL remove only the 12 ownership-marked `massa-ai-*.md` agent files, preserving `massa-ai-navigator.md` (not ownership-marked by this feature) and any user agents
6. WHEN a user re-runs the installer THEN it SHALL be idempotent (existing owned agent files are overwritten with identical content; no duplicates)
7. WHEN the shipped agent files are compared to the generator output from the current `skills/*/SKILL.md` charters THEN every shipped `massa-ai-*.md` body SHALL be byte-identical to the generator output (drift fails the test) — applies to all four hosts
8. WHEN the 12 shipped agent `name` fields are compared against each host's built-in agent names (Codex `default`/`worker`/`explorer`; Claude `Explore`/`Plan`/`general-purpose`; OpenCode `build`/`plan`/`general`/`explore`/`scout`) THEN none SHALL collide
9. WHEN the Claude Code plugin is installed THEN the 12 shipped agents SHALL be exactly: investigator, planner, builder, reviewer, context-curator, verification-agent, requirements-analyst, architecture-specialist, test-engineer, documentation-agent, audit-specialist, mobile-specialist (no more, no less)
10. WHEN each Claude Code agent's `model` frontmatter is read THEN it SHALL match the Claude model-pinning table exactly: investigator→haiku, context-curator→haiku, documentation-agent→haiku, requirements-analyst→sonnet, planner→opus, builder→sonnet, reviewer→sonnet, verification-agent→sonnet, test-engineer→sonnet, audit-specialist→sonnet, mobile-specialist→sonnet, architecture-specialist→opus; AND every agent SHALL set `effort: high`

**Independent Test**: Install the plugin into a temp HOME, list `~/.claude/agents/`, confirm exactly 12 `massa-ai-*.md` files exist with the exact names, correct array-form `tools` frontmatter per the permission mapping, no `hooks`/`mcpServers`/`permissionMode` fields, and `model` matching the Claude pinning table. Run the generator and assert no diff.

---

### P2: Codex subagent bundle

**User Story**: As a Codex user, I want the 12 specialists available as native Codex custom agents (TOML files under `~/.codex/agents/` or `.codex/agents/`) with `sandbox_mode` enforcing read-only boundaries, so that I can delegate to them via Codex's subagent workflow.

**Why P2**: Codex currently ships zero agents. Codex custom agents are TOML files (not plugin-bundled), so this requires extending the Codex installer to write agent files alongside the plugin copy.

**Acceptance Criteria**:

1. WHEN a user runs `apps/codex-plugin/install.sh --user` THEN the system SHALL create 12 agent TOML files at `~/.codex/agents/massa-ai-<name>.toml`, each with `name`, `description`, `developer_instructions`, and `sandbox_mode` fields
2. WHEN the Codex plugin is installed THEN each read-only agent SHALL set `sandbox_mode = "read-only"` in its TOML
3. WHEN the Codex plugin is installed THEN each write-permitted agent SHALL set `sandbox_mode = "workspace-write"` (or omit it to inherit the parent sandbox) in its TOML
4. WHEN the Codex plugin is installed THEN each agent TOML's `developer_instructions` SHALL contain the charter body (Mission, Responsibilities, Restrictions, Inputs, Outputs, Invocation, massa-ai Integration) as a triple-quoted TOML string
5. WHEN a user runs `apps/codex-plugin/install.sh --uninstall` THEN the system SHALL remove only the 12 ownership-marked `~/.codex/agents/massa-ai-*.toml` files, preserving any user agent TOML files
6. WHEN a user re-runs the installer THEN it SHALL be idempotent (owned TOML files overwritten with identical content)
7. WHEN each Codex agent TOML is parsed THEN the `developer_instructions` string SHALL round-trip without TOML syntax errors (embedded `"""` escaped as `\"\"\"`) AND each TOML file SHALL carry a top comment `# massa-ai-owned` for uninstall scoping
8. WHEN the shipped Codex agent TOML files are compared to the generator output from the current charters THEN every file SHALL be byte-identical (drift fails the test)
9. WHEN the 12 shipped Codex agent `name` fields are compared against Codex built-ins (`default`, `worker`, `explorer`) THEN none SHALL collide
10. WHEN each Codex agent TOML's `model` field is read THEN it SHALL match the Codex model-pinning table exactly (investigator→gpt-5.4-mini, context-curator→gpt-5.4-mini, documentation-agent→gpt-5.4-mini, requirements-analyst→gpt-5.6-terra, planner→gpt-5.6-sol, builder→gpt-5.6-terra, reviewer→gpt-5.6-terra, verification-agent→gpt-5.6-terra, test-engineer→gpt-5.6-terra, audit-specialist→gpt-5.6-terra, mobile-specialist→gpt-5.6-terra, architecture-specialist→gpt-5.6-sol) AND every TOML SHALL set `model_reasoning_effort = "high"`

**Independent Test**: Install into a temp HOME, list `~/.codex/agents/`, confirm exactly 12 `massa-ai-*.toml` files exist with `sandbox_mode` set per the permission mapping, a `# massa-ai-owned` top comment, `model` + `model_reasoning_effort = "max"` per the Codex pinning table, and parse cleanly via a TOML parser. Run the generator and assert no diff.

---

### P3: Cursor subagent bundle

**User Story**: As a Cursor user, I want the 12 specialists available as native Cursor agents (auto-discovered from the plugin's `agents/` directory) with correct tool boundaries, so that delegation works inside Cursor.

**Why P3**: Cursor currently ships only `massa-ai-navigator.md`. Cursor auto-discovers `agents/` in a registered plugin path, so the 12 new agents bundle into the existing plugin dir.

**Acceptance Criteria**:

1. WHEN a user runs `apps/cursor-plugin/install.sh --user` THEN the system SHALL create 12 agent files at `~/.cursor/plugins/massa-ai/agents/massa-ai-<name>.md`, each with `name`, `description`, `tools`, `model` frontmatter (same shape as Claude Code)
2. WHEN the Cursor plugin is installed THEN each read-only agent SHALL have `tools` restricted to read-only tools and SHALL NOT include `Write` or `Edit`
3. WHEN the Cursor plugin is installed THEN each write-permitted agent SHALL include `Write, Edit, Bash` in `tools`
4. WHEN the Cursor plugin is installed THEN the existing `massa-ai-navigator.md` SHALL remain in the plugin's `agents/` directory alongside the 12 new specialists
5. WHEN a user runs `apps/cursor-plugin/install.sh --uninstall` THEN the system SHALL remove the plugin directory (including the 12 agents); the existing per-plugin-dir removal behavior is unchanged
6. WHEN the shipped Cursor agent files are compared to the generator output from the current charters THEN every `massa-ai-*.md` SHALL be byte-identical (drift fails the test)
7. WHEN the 12 shipped Cursor agent `name` fields are compared against built-ins THEN none SHALL collide; the 12 SHALL be exactly the registry names
8. WHEN each Cursor agent's `model` frontmatter is read THEN it SHALL match the charter `metadata.model_hint` verbatim per the Cursor model-pinning table (investigator/context-curator/documentation-agent/requirements-analyst→DeepSeek V4 Pro; planner/builder/reviewer/verification-agent/test-engineer/audit-specialist/mobile-specialist→GLM-5.2; architecture-specialist→MiniMax M3); AND every agent SHALL set `reasoningEffort: max`

**Independent Test**: Install into a temp HOME, list `~/.cursor/plugins/massa-ai/agents/`, confirm 13 `.md` files (12 specialists + navigator) exist with correct array-form `tools` frontmatter and `model` matching the Cursor pinning table. Run the generator and assert no diff on the 12 specialists.

---

### P4: OpenCode subagent bundle

**User Story**: As an OpenCode user, I want the 12 specialists available as native OpenCode subagents (`.md` files under `~/.config/opencode/agents/` or `.opencode/agents/`) with `mode: subagent` and correct `permission` boundaries, so that the `@mention` and Task-tool delegation works.

**Why P4**: OpenCode currently ships zero agents. OpenCode agents are filesystem-discovered (the Plugin API does not register them), so this requires a new install path that writes `.md` agent files outside the npm package.

**Acceptance Criteria**:

1. WHEN a user runs the OpenCode agent install command (new `agents` subcommand on `massa-ai-config` OR a dedicated install script) with user scope THEN the system SHALL create 12 agent files at `~/.config/opencode/agents/massa-ai-<name>.md`, each with `description` (required), `mode: subagent`, `model`, and `permission` frontmatter
2. WHEN the OpenCode agents are installed THEN each read-only agent SHALL set `permission: { edit: deny }` (and `bash: deny` for strictly read-only agents, or `bash: { "*": "ask" }` for agents that may run inspection commands) in its frontmatter
3. WHEN the OpenCode agents are installed THEN each write-permitted agent SHALL set `permission: { edit: allow, bash: allow }` (or omit `permission` to inherit) in its frontmatter
4. WHEN the OpenCode agents are installed THEN each agent's markdown body SHALL contain the charter's Mission/Restrictions/Inputs/Outputs/Invocation/massa-ai Integration content
5. WHEN a user runs the uninstall command THEN the system SHALL remove only the 12 ownership-marked `massa-ai-*.md` files, preserving any user agents
6. WHEN a user re-runs the install THEN it SHALL be idempotent (owned files overwritten with identical content)
7. WHEN each OpenCode agent `.md` file is read THEN it SHALL carry `metadata: { massa-ai-owned: true }` in frontmatter (hosts ignore unknown fields) for uninstall scoping AND the `bash` permission SHALL match the per-agent mapping (strict read-only → `bash: deny`; inspection-capable → `bash: { "*": "ask" }`; write → `bash: allow`)
8. WHEN the shipped OpenCode agent files are compared to the generator output from the current charters THEN every `massa-ai-*.md` SHALL be byte-identical (drift fails the test)
9. WHEN the 12 shipped OpenCode agent `name` fields are compared against built-ins (`build`, `plan`, `general`, `explore`, `scout`) THEN none SHALL collide; the 12 SHALL be exactly the registry names
10. WHEN each OpenCode agent's `model` frontmatter is read THEN it SHALL match the charter `metadata.model_hint` verbatim per the OpenCode model-pinning table (investigator/context-curator/documentation-agent/requirements-analyst→DeepSeek V4 Pro; planner/builder/reviewer/verification-agent/test-engineer/audit-specialist/mobile-specialist→GLM-5.2; architecture-specialist→MiniMax M3); AND every agent SHALL set `reasoningEffort: max`

**Independent Test**: Run the OpenCode agent install into a temp HOME, list `~/.config/opencode/agents/`, confirm exactly 12 `massa-ai-*.md` files exist with `mode: subagent`, `metadata: { massa-ai-owned: true }`, correct `permission` per the per-agent mapping, and `model` matching the OpenCode pinning table. Run the generator and assert no diff.

---

### P5: Installer menu + docs parity

**User Story**: As a user setting up massa-ai, I want the root `install.sh` plugin menu and README to document the 12 subagent specialists shipped per tool, so that I know they exist and how to invoke them. I also want `FEATURES.md` to document the full depth (the 12 names, per-host model + effort pinning, permission boundaries, file locations, ownership markers, and the generator/parity-test contract), with the root `README.md` carrying a concise summary that links into `FEATURES.md` for depth.

**Why P5**: Discoverability. The agents ship silently unless the installers and docs mention them. `README.md` is the entry point (summary level); `FEATURES.md` is the feature reference (depth level). Splitting summary-vs-depth keeps `README.md` scannable while `FEATURES.md` holds the verifiable detail.

**Acceptance Criteria**:

1. WHEN each per-plugin `install.sh` runs THEN it SHALL print a line listing the 12 subagent specialists installed (e.g. "+ 12 subagent specialists: investigator, planner, ...")
2. WHEN the root `README.md` Integration / Plugin Bundles section is read THEN it SHALL include a concise summary that (a) states the 12 sub-agent specialists ship in all four plugins, (b) names them in a compact list or table, (c) states model + effort are pinned per host with the host-specific values (Claude `effort: high` + aliases, Codex `model_reasoning_effort = "high"` + IDs, Cursor/OpenCode `reasoningEffort: max` + charter hints), and (d) links to `FEATURES.md` for the full per-agent detail. The README summary SHALL NOT duplicate the full per-agent model/effort/permission tables — those live in `FEATURES.md`.
3. WHEN `FEATURES.md` is read THEN it SHALL contain a "Subagent Skills (12 Specialists)" section (under or adjacent to "Plugins (4-Tool Parity)") documenting, per host: (a) the exact 12 agent names, (b) the file location + format (`apps/<plugin>/agents/*.md` for Claude/Cursor, `~/.codex/agents/*.toml` for Codex, `~/.config/opencode/agents/*.md` for OpenCode — noting Codex/OpenCode live OUTSIDE the plugin dir), (c) the per-agent pinned `model` (the four model-pinning tables from this spec, verbatim), (d) the per-host effort pin (Claude `effort: high`, Codex `model_reasoning_effort = "high"`, Cursor/OpenCode `reasoningEffort: max`), (e) the read-only vs write permission mapping per host (`tools`/`sandbox_mode`/`permission`), (f) the ownership-marker convention (`# massa-ai-owned` for Codex, `metadata: { massa-ai-owned: true }` for OpenCode, name-prefix `massa-ai-` for Claude/Cursor), and (g) the generator + parity-test contract (`scripts/generate-subagent-artifacts.ts` emits from `skills/*/SKILL.md`; drift fails CI)
4. WHEN the root `install.sh` plugin menu runs THEN the per-tool install output SHALL mention the 12 specialists are included
5. WHEN `install-agents.ts --agent <codex|cursor|claude-code|opencode>` runs THEN it SHALL print a hint pointing to the new subagent install for that tool (separate from the existing MCP deconfliction hint)
6. WHEN the `FEATURES.md` subagent section is read THEN the four model-pinning tables (Claude/Codex/Cursor/OpenCode) SHALL match this spec's tables byte-for-byte (same agent names, same model values, same effort values), so the docs are verifiably derived from the spec — a test SHALL assert this parity
7. WHEN the root `README.md` summary is read THEN it SHALL link to the `FEATURES.md` subagent section via a relative markdown link (e.g. `[FEATURES.md](./FEATURES.md#subagent-skills-12-specialists)`) so users can navigate from summary to depth

**Independent Test**: Run each per-plugin installer and grep its output for "12 subagent specialists"; grep `README.md` for the 12 names + a `FEATURES.md#` link; grep `FEATURES.md` for the four model-pinning tables and assert byte-parity with the spec tables; grep `install-agents.ts` output for the subagent hint.

---

## Edge Cases

- WHEN the agents target directory does not exist THEN the installer SHALL create it (idempotent `mkdir -p`)
- WHEN a user has an existing `massa-ai-<name>.md`/`.toml` without the ownership marker THEN the installer SHALL back it up (`.massa-ai.bak-<ts>`) before overwriting
- WHEN a user re-runs the installer with no content changes THEN the agent files SHALL be overwritten with identical content (no diff) — idempotent
- WHEN a user runs `--uninstall` THEN only ownership-marked `massa-ai-*` agent files SHALL be removed; the unmarked `massa-ai-navigator.md` (Claude/Cursor) and any user agents SHALL survive
- WHEN Codex `agents/` directory has user TOML files THEN the installer SHALL only write/overwrite the 12 `massa-ai-*` files, preserving user agents
- WHEN OpenCode `agents/` directory has user `.md` files THEN the installer SHALL only write/overwrite the 12 `massa-ai-*` files
- WHEN a charter's `model_hint` names a model the host does not support THEN the agent SHALL omit the `model` frontmatter field (or set it to inherit) and record the hint as an advisory comment in the body — the agent loads on the host default model
- WHEN the `mobile-specialist` is installed on a non-mobile repo THEN it SHALL still load (harmless); the host only delegates when the description matches a mobile task
- WHEN a read-only agent is invoked and attempts a write tool THEN the host SHALL deny it via the `tools`/`permission`/`sandbox_mode` restriction — the agent cannot escape its boundary
- WHEN Codex `sandbox_mode` is unset on a write agent THEN it SHALL inherit the parent's sandbox (which may be read-only in plan mode); the body SHALL instruct the agent to request write approval per Codex's approval flow

---

## Requirement Traceability

Each requirement gets a unique ID for tracking across design, tasks, and validation.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CLA-01 | P1: Claude Code subagent bundle | Design | Pending |
| CLA-02 | P1: Claude Code subagent bundle | Design | Pending |
| CLA-03 | P1: Claude Code subagent bundle | Design | Pending |
| CLA-04 | P1: Claude Code subagent bundle | Design | Pending |
| CLA-05 | P1: Claude Code subagent bundle | Design | Pending |
| CLA-06 | P1: Claude Code subagent bundle | Design | Pending |
| CLA-07 | P1: Claude Code subagent bundle (drift parity) | Design | Pending |
| CLA-08 | P1: Claude Code subagent bundle (name collision) | Design | Pending |
| CLA-09 | P1: Claude Code subagent bundle (exact 12 names) | Design | Pending |
| CLA-10 | P1: Claude Code subagent bundle (model pinning) | Design | Pending |
| CDX-01 | P2: Codex subagent bundle | Design | Pending |
| CDX-02 | P2: Codex subagent bundle | Design | Pending |
| CDX-03 | P2: Codex subagent bundle | Design | Pending |
| CDX-04 | P2: Codex subagent bundle | Design | Pending |
| CDX-05 | P2: Codex subagent bundle | Design | Pending |
| CDX-06 | P2: Codex subagent bundle | Design | Pending |
| CDX-07 | P2: Codex subagent bundle (TOML round-trip + owned marker) | Design | Pending |
| CDX-08 | P2: Codex subagent bundle (drift parity) | Design | Pending |
| CDX-09 | P2: Codex subagent bundle (name collision) | Design | Pending |
| CDX-10 | P2: Codex subagent bundle (model pinning + max effort) | Design | Pending |
| CRS-01 | P3: Cursor subagent bundle | Design | Pending |
| CRS-02 | P3: Cursor subagent bundle | Design | Pending |
| CRS-03 | P3: Cursor subagent bundle | Design | Pending |
| CRS-04 | P3: Cursor subagent bundle | Design | Pending |
| CRS-05 | P3: Cursor subagent bundle | Design | Pending |
| CRS-06 | P3: Cursor subagent bundle (drift parity) | Design | Pending |
| CRS-07 | P3: Cursor subagent bundle (name collision + exact 12) | Design | Pending |
| CRS-08 | P3: Cursor subagent bundle (model pinning) | Design | Pending |
| OPC-01 | P4: OpenCode subagent bundle | Design | Pending |
| OPC-02 | P4: OpenCode subagent bundle | Design | Pending |
| OPC-03 | P4: OpenCode subagent bundle | Design | Pending |
| OPC-04 | P4: OpenCode subagent bundle | Design | Pending |
| OPC-05 | P4: OpenCode subagent bundle | Design | Pending |
| OPC-06 | P4: OpenCode subagent bundle | Design | Pending |
| OPC-07 | P4: OpenCode subagent bundle (owned marker + bash permission) | Design | Pending |
| OPC-08 | P4: OpenCode subagent bundle (drift parity) | Design | Pending |
| OPC-09 | P4: OpenCode subagent bundle (name collision + exact 12) | Design | Pending |
| OPC-10 | P4: OpenCode subagent bundle (model pinning) | Design | Pending |
| DOC-01 | P5: Installer menu + docs parity (installer prints 12) | - | Pending |
| DOC-02 | P5: Installer menu + docs parity (README summary + link) | - | Pending |
| DOC-03 | P5: Installer menu + docs parity (FEATURES.md depth section) | - | Pending |
| DOC-04 | P5: Installer menu + docs parity (root menu mention) | - | Pending |
| DOC-05 | P5: Installer menu + docs parity (install-agents.ts hint) | - | Pending |
| DOC-06 | P5: Installer menu + docs parity (FEATURES.md ↔ spec table parity test) | - | Pending |
| DOC-07 | P5: Installer menu + docs parity (README → FEATURES.md link) | - | Pending |

**ID format**: `CLA-NN` (Claude), `CDX-NN` (Codex), `CRS-NN` (Cursor), `OPC-NN` (OpenCode), `DOC-NN` (Docs/Installer)

**Coverage:** 44 total, 44 mapped to stories, 0 unmapped

---

## Success Criteria

How we know the feature is successful:

- [ ] All 12 sub-agent specialists ship as host-native subagent definitions in all four plugins (Claude, Codex, Cursor, OpenCode)
- [ ] Read-only vs write permission boundaries are enforced per host via native frontmatter (`tools`/`sandbox_mode`/`permission`), not advisory prose
- [ ] `model` is PINNED per agent per host (Claude aliases: haiku/sonnet/opus; Codex IDs: gpt-5.4-mini/gpt-5.6-terra/gpt-5.6-sol; Cursor/OpenCode: charter `metadata.model_hint` verbatim) — NOT advisory
- [ ] Reasoning effort is PINNED per host: Claude `effort: high`, Codex `model_reasoning_effort = "high"`, Cursor `reasoningEffort: max`, OpenCode `reasoningEffort: max` (pass-through; provider-honoring for Cursor/OpenCode/DeepSeek/GLM/MiniMax is host behavior, recorded as assumption)
- [ ] Install is idempotent; uninstall removes only ownership-marked agent files, preserving user agents and the existing `massa-ai-navigator.md`
- [ ] Existing `massa-ai-navigator.md` (Claude/Cursor) is preserved; the 12 specialists are additive
- [ ] No new lifecycle hooks; the shared binary and `EVENT_MAP` are unchanged
- [ ] Shipped agent files are byte-identical to generator output from current `skills/*/SKILL.md` (drift fails CI)
- [ ] No shipped agent name collides with a host built-in
- [ ] All new tests pass; existing tests remain green; type-check 6/6 and build 5/5
- [ ] README + installer output document the 12 specialists per tool; `README.md` carries a concise summary + link, `FEATURES.md` carries the full per-host depth (names, models, effort, permissions, locations, ownership markers, generator contract)
- [ ] `FEATURES.md` four model-pinning tables are byte-identical to this spec's tables (parity test)
- [ ] Independent verifier (author ≠ verifier) confirms spec-anchored outcomes + discrimination sensor

---

## Artifact-Store Evidence

- Active artifact key: `.specs/features/subagent-skills-plugin-parity/spec.md`
- Version: 4 (Specify + model-pinning + effort-pinning + docs-parity amendment)
- Checksum (SHA-256, post docs-parity amendment): `e563bb803ecc89ca00d252c4fe3ce8cae6c1170c9ba07c5caf9fe3f4130b82a0`
- Plan Challenge: lite-escalation inline critique (subagent spawning unavailable — `cavecrew-reviewer` model not found); 8 findings (F1-F8), F1/F2/F4/F5/F6 high/medium incorporated as assumptions + ACs (CLA-07..10, CDX-07..10, CRS-06..08, OPC-07..10, DOC-01..07). Escalate-to-full verdict: false (spec-precision gaps, no architectural/security/migration unknowns).
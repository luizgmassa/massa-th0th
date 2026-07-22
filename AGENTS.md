# massa-th0th — Agent Startup Contract

## Project Identity

- **projectId**: `massa-th0th`
- **Resolve from**: workspace root directory basename (fallback: git toplevel basename)
- **Session IDs**: `spec-<workflow>-<entity>` (e.g., `spec-wave-7-hygiene-ui-process`)

## Runtime Routing

This project uses the `massa-th0th` skill workflow router. Load it once per coding session.

### Active Feature

Check `.specs/project/STATE.md` for the current active feature and `.specs/project/FEATURES.json` for the feature registry.

### Available Skills (repo-local)

- `massa-th0th-memory/` — memory system usage patterns
- `synapse-usage/` — Synapse cognitive session lifecycle

### Spec Artifacts

- `.specs/project/STATE.md` — current objective, progress, decisions
- `.specs/project/FEATURES.json` — feature registry and status
- `.specs/HANDOFF.md` — session handoff state
- `.specs/features/<slug>/` — per-feature spec, design, tasks, validation
- `.specs/lessons.json` — machine-owned lesson state
- `.specs/LESSONS.md` — rendered lesson playbook (read-only)

## Indexing / Context Hygiene

Always ignore these paths during indexing and context loading:

```text
node_modules/
vendor/
.venv/
env/
__pycache__/
*.pyc
dist/
build/
.next/
.nuxt/
out/
bin/
obj/
target/
ios/Pods/
ios/build/
android/app/build/
android/.gradle/
android/.idea/
.expo/
.dart_tool/
*.ipa
*.apk
*.app
*.log
logs/
.npm/
.eslintcache
.stylelintcache
.cache/
tmp/
.env*
*.pem
*.key
.ssh/
secrets.json
.idea/
.vscode/
.DS_Store
Thumbs.db
```

## Plan Challenge Policy

```yaml
plan_challenge:
  enabled: auto
  depth: lite
  mode: auto
  full_gate: high_risk_or_explicit
  serious_findings: revise_plan
```

Load full `workflows/the-fool.md` when the workflow is `spec-driven`, `feature`, `adr`, `rfc`, `tdd`, or `refactor`; when the plan touches security, data loss, migrations, irreversible actions, auth/privacy, cross-service contracts; or when the plan touches more than 5 files, classes, or modules.

For low-risk plans, run the inline auto-lite checklist without loading The Fool references.

## Conversation Feedback Policy

```yaml
conversation_feedback:
  enabled: auto
  density: transition_updates
  style: emoji_capitalized_ascii
  max_lines_per_update: 2
  include: [workflow, loads, memory, notebooklm, subagents, divergences, verification]
  suppress: [chain_of_thought, raw_tool_output, repeated_micro_events]
```

## Runtime Contract

After activation, follow `skills/massa-th0th/SKILL.md` (global, not repo-local) for all runtime behavior. The global skill defines workflow routing, project/session handling, retrieval, persistence, graceful degradation, and completion evidence.

## Tech Stack

- **Runtime**: Bun 1.3.14 (pinned via `.tool-versions`, `mise.toml`, Dockerfile)
- **Build helper**: Node 25.9.0 (pinned via `.tool-versions`, `mise.toml`)
- **Language**: TypeScript (ESM, strict)
- **Test runner**: `bun test` (Bun-native)
- **Type-check**: `bun run type-check` (6 tsc projects)
- **Build**: `bun run build` (turbo build, 5 packages)
- **Database**: PostgreSQL 17 + pgvector
- **Packages**: `packages/core`, `packages/shared`; `apps/tools-api`, `apps/mcp-client`, `apps/opencode-plugin`, `apps/claude-plugin`, `apps/web-ui`
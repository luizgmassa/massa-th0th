# Design: Skills & Install Migration

## Architecture

Single-pass migration + new TS installer. No database, no binary, no external API. All work is file movement, content adaptation, and new TypeScript code.

```
┌─────────────────────────────────────────────────────────┐
│  scripts/install-skills.ts  (NEW — unified installer)    │
│  ├─ resolve repo root via import.meta.url (F1)         │
│  ├─ discover skills/*/SKILL.md                          │
│  ├─ extract bootstrap block from skills/AGENTS.md       │
│  ├─ per-platform: symlink skills + write bootstrap      │
│  ├─ state: ~/.config/massa-ai/install-state.json     │
│  └─ --apply | --uninstall | --dry-run | --check         │
└─────────────────────────────────────────────────────────┘
         │ symlinks into
    ┌────┼────┬────────┬──────────┐
    ▼    ▼    ▼        ▼          ▼
~/.claude  ~/.codex  ~/.cursor  ~/.config/opencode
/skills/   /skills/  /skills/   /skills/
+AGENTS.md +AGENTS.md +AGENTS.md (opencode: ~/.config/opencode/AGENTS.md)
```

## Components

### 1. `scripts/install-skills.ts` (NEW)

**Purpose:** Unified symlink-based skill + bootstrap installer for all four tools. Port of `agent_integrations.py` logic to TypeScript.

**Location:** `scripts/install-skills.ts`

**Interfaces:**
```
bun scripts/install-skills.ts [--apply|--uninstall|--dry-run|--check] \
  [--platform claude|codex|cursor|opencode|all] [--target /path/to/home] \
  [--repo-root /path] [--yes]
```

**Dependencies:** Node `fs/promises`, `path`, `os`, `child_process` (for `which` detection). No external npm deps — stdlib only.

**What it reuses:** Logic structure from `agent_integrations.py` (state v1→v2 migration, platform detection, bootstrap block extraction/replacement, symlink creation, idempotent checks). Adapted markers: `massa-ai:bootstrap:start/end`. State dir: `~/.config/massa-ai/install-state.json`.

**Key design decisions:**
- **Repo root resolution (F1):** `path.resolve(path.dirname(fileURLToPath(import.meta.url)))` → `parents[1]` for repo root. Override via `--repo-root`.
- **Symlink creation:** `fs.symlink(source, target, 'file')` — source is absolute resolved skill path, target is in tool config dir. If target exists as non-symlink, abort (IntegrationError).
- **Bootstrap extraction:** Read `skills/AGENTS.md`, extract block between `<!-- massa-ai:bootstrap:start -->` and `<!-- massa-ai:bootstrap:end -->` markers. Write/replace into tool's AGENTS.md using same markers.
- **Platform roots:**
  - claude: `~/.claude` (skills → `~/.claude/skills/<name>` as symlinks to `skills/<name>/`)
  - codex: `~/.codex` (skills → `~/.codex/skills/<name>`)
  - cursor: `~/.cursor` (skills → `~/.cursor/skills/<name>`)
  - opencode: `~/.config/opencode` (skills → `~/.config/opencode/skills/<name>`)
- **Detection:** `which`-equivalent via `child_process.execSync('command -v <tool>')`. PLATFORM_EXECUTABLES: codex→`codex`, claude→`claude`, cursor→`cursor-agent|cursor`, opencode→`opencode`.
- **State v1→v2:** Same migration logic as Python: v1 has `platforms: []`, v2 has `platforms: {name: {root, skills: []}}`.

### 2. `skills/AGENTS.md` (MODIFIED)

**Purpose:** Merge bootstrap contract (top) + existing sub-agent registry (bottom).

**Structure:**
```
<!-- massa-ai:bootstrap:start -->
# Coding Session Startup Contract
[... adapted bootstrap from old repo root AGENTS.md ...]
<!-- massa-ai:bootstrap:end -->

# Sub-Agent Registry
[... existing 112-line content unchanged ...]
```

**Adaptations:**
- `useful-agent-skills` → `massa-ai` in all marker names and references
- `UAS_HOOK_PROFILE` → `MASSA_AI_HOOK_PROFILE` (even though hooks skipped, the env var reference in bootstrap text is adapted)
- `UAS_DISABLED_HOOKS` → `MASSA_AI_DISABLED_HOOKS`
- Keep the global skill references (caveman, coding-guidelines, massa-ai, persona-router) as-is — those are global skills loaded from `~/.config/opencode/skills/`, not repo-local.
- Remove the "Repository Harness" section (lines 296-358 of old AGENTS.md) — it references hooks/init.sh that aren't being migrated.

### 3. `docs/` migration (MODIFIED)

**Purpose:** Move 7 workflow guide files from old `docs/skills/` to new `docs/`.

**Files:** context-slices.md, massa-ai-commit.md, massa-ai-maestro.md, massa-ai-mobile-figma.md, massa-ai-rfc.md, massa-ai-spec-driven.md, massa-ai-tdd.md, massa-ai-ticket.md

**Adaptations:** Path references updated from old structure to new (e.g., `skills/massa-ai/workflows/` stays the same since the new repo has the same path). Remove any `Useful-Agent-Skills` or `useful-agent-skills` references.

### 4. `skills/persona-router/` + `skills/massa-ai/personas/` (NEW)

**Purpose:** Migrate persona-router skill and persona catalog.

**Structure:**
```
skills/persona-router/SKILL.md          (adapted from old repo)
skills/massa-ai/personas/
  catalog.json                          (prompt_path = filename only)
  ai-native-nodejs-cli-architect.md
  context-skill-harness-engineer-architect.md
  product-manager.md
  senior-mobile-engineer.md
  senior-mobile-qa-automation-engineer.md
```

**Adaptations:**
- catalog.json: `prompt_path` changed from `references/personas/<name>.md` to just `<name>.md` (relative to `skills/massa-ai/personas/`)
- persona-router SKILL.md: update library-root resolution to find catalog at `../massa-ai/personas/catalog.json` relative to the SKILL.md location

### 5. Tests (NEW)

**Files:**
- `scripts/__tests__/validate-repository.test.ts` — structural validation
- `scripts/__tests__/install-skills.test.ts` — installer + hook gating scenarios

**Test framework:** `bun test` (already used by `scripts/__tests__/install-agents.test.ts`)

**Porting strategy:**
- `test_validate_repository.py` (234 tests) → port applicable scenarios. Many test the massa-ai skill structure which exists in the new repo. Skip removed-skill-absence tests for skills that never existed in the new repo. Adapt all path constants.
- `test_agent_integrations.py` (34 tests) → port to test `install-skills.ts`. Use temp dirs for fake HOME. Test idempotency, dry-run, uninstall, state migration, conflict detection.
- `test_hooks.py` (40 tests) → port only scenarios that don't require the Python hooks layer. Bad stdin handling, profile-based selection logic (as data structure tests), config protection path validation. Skip Python hook execution tests.

## Risks & Concerns

| # | Concern | Mitigation |
|---|---------|------------|
| R1 | TS installer `which` detection differs from Python `shutil.which` | Use `child_process.execSync('command -v <exe> 2>/dev/null')` with try/catch; test on macOS + Linux |
| R2 | Symlink creation on Windows (untested) | Document as macOS/Linux-only; `fs.symlink` type param handles file vs dir |
| R3 | catalog.json schema validation not enforced | Add a test that validates catalog.json schema (schema_version=1, required fields) |
| R4 | Existing `install-agents.ts` and new `install-skills.ts` naming confusion | Clear docstrings: install-agents = MCP config; install-skills = skills+bootstrap symlinks |
| R5 | Per-plugin install.sh copies skills; new installer symlinks — coexistence | MIG-06 aborts on non-symlink conflict; document "run one, not both" |
| R6 | Pre-mortem F3: ported tests validate wrong structure | All path constants adapted; N/A marked for never-existed structures |

## Code Reuse

- `agent_integrations.py` → port logic to TS (state management, platform detection, bootstrap extraction, symlink ops)
- `install_agent_integrations.py` → port CLI arg parsing pattern
- Existing `scripts/__tests__/install-agents.test.ts` → reuse test patterns (temp HOME, mock configs)
- Existing `scripts/install-agents.ts` → reference ownership marker pattern (`_massaAiOwned`)

## Verification Design

- **Gate:** `bun run type-check` (must pass — install-skills.ts is TypeScript)
- **Test:** `bun test scripts/__tests__/validate-repository.test.ts scripts/__tests__/install-skills.test.ts`
- **Drift:** `rg "useful-agent-skills|UAS_" skills/ docs/ scripts/ --ignore-case` → 0 matches
- **Sensor:** inject wrong symlink target in test HOME; verify drift check catches it; inject malformed state JSON; verify abort
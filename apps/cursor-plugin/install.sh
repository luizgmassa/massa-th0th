#!/usr/bin/env bash
#
# massa-ai Cursor plugin installer
#
# Copies the plugin bundle (skills, hooks.json, mcp.json, agents, optional
# manifest, binary symlink) into the user's or project's Cursor config
# directory and merges the 7 massa-ai hook events into
# ~/.cursor/hooks.json (or ./.cursor/hooks.json) using an array-append merge
# that preserves existing user hooks.
#
# Idempotent: re-running is a no-op when owned entries already present.
# Uninstall removes only ownership-marked entries + the plugin directory.
#
# Usage:
#   apps/cursor-plugin/install.sh             # install at user scope (~/.cursor)
#   apps/cursor-plugin/install.sh --user      #   (same)
#   apps/cursor-plugin/install.sh --project  # install at project scope (./.cursor)
#   apps/cursor-plugin/install.sh --uninstall # remove owned entries + plugin dir
#   apps/cursor-plugin/install.sh -h|--help   # show this help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLAUDE_PLUGIN_BIN="$REPO_ROOT/apps/claude-plugin/hooks/massa-ai-hook.ts"

SCOPE="user"
UNINSTALL=0

for arg in "$@"; do
  case "$arg" in
    --user) SCOPE="user" ;;
    --project) SCOPE="project" ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# Banner
source "$SCRIPT_DIR/../../scripts/banner.sh"
massa_ai_banner

# Resolve target base dir
if [[ "$SCOPE" == "project" ]]; then
  CURSOR_DIR="$(pwd)/.cursor"
else
  CURSOR_DIR="$HOME/.cursor"
fi
PLUGIN_DIR="$CURSOR_DIR/plugins/massa-ai"
HOOKS_JSON="$CURSOR_DIR/hooks.json"

# The 7 Cursor events → binary subcommands. The command path uses the
# INSTALLED plugin dir (not the placeholder), so Cursor invokes the copy.
# Cursor hooks.json shape: { "version": 1, "hooks": { "<event>": [...] } }
massa_ai_event_entry() {
  local subcommand="$1"
  cat <<JSON
{ "command": "$PLUGIN_DIR/hooks/massa-ai-hook $subcommand", "_massaAiOwned": true }
JSON
}

# Array-append merge (F5 mitigation): for each of the 7 events, append the
# massa-ai hook entry to the event's array inside the nested "hooks"
# object if no entry with _massaAiOwned: true already exists. Preserves
# the top-level "version" field (defaults to 1). Backup before first write.
# Uses node (preferred) or bun for safe JSON manipulation.
merge_hooks_json() {
  local file="$1"
  local mode="$2" # "install" or "uninstall"
  local ts
  ts="$(date +%Y%m%d%H%M%S)"

  local runner=""
  if command -v node &>/dev/null; then
    runner="node"
  elif command -v bun &>/dev/null; then
    runner="bun"
  else
    echo "Error: node or bun required to merge hooks.json (JSON manipulation)" >&2
    exit 3
  fi

  "$runner" - "$file" "$mode" "$ts" "$PLUGIN_DIR" <<'NODE'
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
const mode = process.argv[3];
const ts = process.argv[4];
const pluginDir = process.argv[5];

const EVENTS = [
  ["sessionStart", "session-start"],
  ["sessionEnd", "stop"],
  ["beforeSubmitPrompt", "user-prompt-submit"],
  ["preToolUse", "pre-tool-use"],
  ["postToolUse", "post-tool-use"],
  ["preCompact", "pre-compact"],
  ["stop", "stop"],
];

let cfg = {};
let existed = false;
try {
  const raw = fs.readFileSync(file, "utf8");
  if (raw.trim()) {
    cfg = JSON.parse(raw);
    existed = true;
  }
} catch (e) {
  if (e.code === "ENOENT") {
    // no file — start empty
  } else {
    throw e;
  }
}

// Ensure the nested hooks object + version field
if (typeof cfg.version !== "number") cfg.version = 1;
if (typeof cfg.hooks !== "object" || cfg.hooks === null) cfg.hooks = {};

const hooks = cfg.hooks;

function hasOwned(arr) {
  return Array.isArray(arr) && arr.some((e) => e && e._massaAiOwned === true);
}

if (mode === "uninstall") {
  for (const [evt] of EVENTS) {
    if (Array.isArray(hooks[evt])) {
      hooks[evt] = hooks[evt].filter((e) => !(e && e._massaAiOwned === true));
      if (hooks[evt].length === 0) delete hooks[evt];
    }
  }
} else {
  // install: backup before first write if file existed
  if (existed) {
    const bak = `${file}.massa-ai.bak-${ts}`;
    fs.copyFileSync(file, bak);
  }
  for (const [evt, sub] of EVENTS) {
    if (!Array.isArray(hooks[evt])) hooks[evt] = [];
    if (!hasOwned(hooks[evt])) {
      hooks[evt].push({
        command: `${pluginDir}/hooks/massa-ai-hook ${sub}`,
        _massaAiOwned: true,
      });
    }
  }
}

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
NODE
}

# ── Uninstall ───────────────────────────────────────────────────────────────
if [[ "$UNINSTALL" -eq 1 ]]; then
  echo "Uninstalling massa-ai Cursor plugin (scope: $SCOPE)..."
  # Remove owned hook entries (preserves user hooks)
  if [[ -f "$HOOKS_JSON" ]]; then
    merge_hooks_json "$HOOKS_JSON" "uninstall"
    echo "  - removed massa-ai hook entries from $HOOKS_JSON"
  fi
  # Remove plugin directory
  if [[ -d "$PLUGIN_DIR" ]]; then
    rm -rf "$PLUGIN_DIR"
    echo "  - removed $PLUGIN_DIR"
  fi
  echo ""
  echo "Done. User hooks preserved."
  exit 0
fi

# ── Install ──────────────────────────────────────────────────────────────────
echo "Installing massa-ai Cursor plugin to: $PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR/.cursor-plugin" "$PLUGIN_DIR/skills" "$PLUGIN_DIR/hooks" "$PLUGIN_DIR/agents"

# Copy manifest
cp "$SCRIPT_DIR/.cursor-plugin/plugin.json" "$PLUGIN_DIR/.cursor-plugin/plugin.json"
echo "  + .cursor-plugin/plugin.json"

# Copy skills (each in a subdirectory: skills/<name>/SKILL.md)
for src in "$SCRIPT_DIR/skills/"*/SKILL.md; do
  name="$(basename "$(dirname "$src")")"
  mkdir -p "$PLUGIN_DIR/skills/$name"
  cp "$src" "$PLUGIN_DIR/skills/$name/SKILL.md"
  echo "  + skills/$name/SKILL.md"
done

# Copy hooks.json (the placeholder version — installer replaces paths)
cp "$SCRIPT_DIR/hooks/hooks.json" "$PLUGIN_DIR/hooks/hooks.json"
echo "  + hooks/hooks.json"

# Copy mcp.json
cp "$SCRIPT_DIR/mcp.json" "$PLUGIN_DIR/mcp.json"
echo "  + mcp.json"

# Copy agents — navigator + 12 subagent specialists (auto-discovered by Cursor
# from the plugin's agents/ dir). The existing navigator is preserved; the 12
# specialists are additive (CRS-04).
cp "$SCRIPT_DIR/agents/massa-ai-navigator.md" "$PLUGIN_DIR/agents/massa-ai-navigator.md"
echo "  + agents/massa-ai-navigator.md"
specialist_count=0
for src in "$SCRIPT_DIR/agents/"massa-ai-*.md; do
  [[ -f "$src" ]] || continue
  name="$(basename "$src")"
  [[ "$name" == *navigator* ]] && continue
  cp "$src" "$PLUGIN_DIR/agents/$name"
  specialist_count=$((specialist_count + 1))
done
echo "  + ${specialist_count} subagent specialists: investigator, planner, builder, reviewer, context-curator, verification-agent, requirements-analyst, architecture-specialist, test-engineer, documentation-agent, audit-specialist, mobile-specialist"

# Create the binary symlink → repo's claude-plugin binary (resolved at install
# time via SCRIPT_DIR → REPO_ROOT). This keeps a single source of truth.
if [[ -f "$CLAUDE_PLUGIN_BIN" ]]; then
  ln -sfn "$CLAUDE_PLUGIN_BIN" "$PLUGIN_DIR/hooks/massa-ai-hook"
  echo "  + hooks/massa-ai-hook → $CLAUDE_PLUGIN_BIN"
else
  echo "  ⚠ Warning: claude-plugin binary not found at $CLAUDE_PLUGIN_BIN" >&2
  echo "    Hooks will not fire until the binary is available." >&2
fi

# Merge hooks.json (array-append, backup, idempotent)
echo ""
echo "Merging hooks into $HOOKS_JSON..."
merge_hooks_json "$HOOKS_JSON" "install"
echo "  + 7 massa-ai hook events wired (array-append, user hooks preserved)"

echo ""
echo "Done. Restart Cursor to pick up the plugin."
echo "💡 If you also run install-agents.ts --agent cursor, skip MCP — the plugin already registers it."
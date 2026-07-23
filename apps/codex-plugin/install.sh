#!/usr/bin/env bash
#
# massa-th0th Codex plugin installer
#
# Copies the plugin bundle (manifest, skills, hooks.json, .mcp.json, binary
# symlink) into the user's or project's Codex config directory and merges the
# 6 massa-th0th hook events into ~/.codex/hooks.json (or ./.codex/hooks.json)
# using an array-append merge that preserves existing user hooks.
#
# Idempotent: re-running is a no-op when owned entries already present.
# Uninstall removes only ownership-marked entries + the plugin directory.
#
# Usage:
#   apps/codex-plugin/install.sh             # install at user scope (~/.codex)
#   apps/codex-plugin/install.sh --user      #   (same)
#   apps/codex-plugin/install.sh --project  # install at project scope (./.codex)
#   apps/codex-plugin/install.sh --uninstall # remove owned entries + plugin dir
#   apps/codex-plugin/install.sh -h|--help   # show this help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLAUDE_PLUGIN_BIN="$REPO_ROOT/apps/claude-plugin/hooks/massa-th0th-hook.ts"

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
massa_th0th_banner

# Resolve target base dir
if [[ "$SCOPE" == "project" ]]; then
  CODEX_DIR="$(pwd)/.codex"
else
  CODEX_DIR="$HOME/.codex"
fi
PLUGIN_DIR="$CODEX_DIR/plugins/massa-th0th"
HOOKS_JSON="$CODEX_DIR/hooks.json"

# The 6 Codex events → binary subcommands. The command path uses the
# INSTALLED plugin dir (not the placeholder), so Codex invokes the copy.
massa_th0th_event_entry() {
  local subcommand="$1"
  cat <<JSON
{ "type": "command", "command": "$PLUGIN_DIR/hooks/massa-th0th-hook $subcommand", "_massaTh0thOwned": true }
JSON
}

# Array-append merge (F5 mitigation): for each of the 6 events, append the
# massa-th0th hook entry to the event's array if no entry with
# _massaTh0thOwned: true already exists. Backup before first write. Uses node
# (preferred) or bun for safe JSON manipulation — bash cannot do JSON safely.
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
  ["SessionStart", "session-start"],
  ["UserPromptSubmit", "user-prompt-submit"],
  ["PreToolUse", "pre-tool-use"],
  ["PostToolUse", "post-tool-use"],
  ["PreCompact", "pre-compact"],
  ["Stop", "stop"],
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

function hasOwned(arr) {
  return Array.isArray(arr) && arr.some((e) => e && e._massaTh0thOwned === true);
}

if (mode === "uninstall") {
  for (const [evt] of EVENTS) {
    if (Array.isArray(cfg[evt])) {
      cfg[evt] = cfg[evt].filter((e) => !(e && e._massaTh0thOwned === true));
      if (cfg[evt].length === 0) delete cfg[evt];
    }
  }
} else {
  // install: backup before first write if file existed
  if (existed) {
    const bak = `${file}.massa-th0th.bak-${ts}`;
    fs.copyFileSync(file, bak);
  }
  for (const [evt, sub] of EVENTS) {
    if (!Array.isArray(cfg[evt])) cfg[evt] = [];
    if (!hasOwned(cfg[evt])) {
      cfg[evt].push({
        type: "command",
        command: `${pluginDir}/hooks/massa-th0th-hook ${sub}`,
        _massaTh0thOwned: true,
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
  echo "Uninstalling massa-th0th Codex plugin (scope: $SCOPE)..."
  # Remove owned hook entries (preserves user hooks)
  if [[ -f "$HOOKS_JSON" ]]; then
    merge_hooks_json "$HOOKS_JSON" "uninstall"
    echo "  - removed massa-th0th hook entries from $HOOKS_JSON"
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
echo "Installing massa-th0th Codex plugin to: $PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR/.codex-plugin" "$PLUGIN_DIR/skills" "$PLUGIN_DIR/hooks"

# Copy manifest
cp "$SCRIPT_DIR/.codex-plugin/plugin.json" "$PLUGIN_DIR/.codex-plugin/plugin.json"
echo "  + .codex-plugin/plugin.json"

# Copy skills
for src in "$SCRIPT_DIR/skills/"*.md; do
  name="$(basename "$src")"
  cp "$src" "$PLUGIN_DIR/skills/$name"
  echo "  + skills/$name"
done

# Copy hooks.json (the placeholder version — installer replaces paths)
cp "$SCRIPT_DIR/hooks/hooks.json" "$PLUGIN_DIR/hooks/hooks.json"
echo "  + hooks/hooks.json"

# Copy .mcp.json
cp "$SCRIPT_DIR/.mcp.json" "$PLUGIN_DIR/.mcp.json"
echo "  + .mcp.json"

# Create the binary symlink → repo's claude-plugin binary (resolved at install
# time via SCRIPT_DIR → REPO_ROOT). This keeps a single source of truth.
if [[ -f "$CLAUDE_PLUGIN_BIN" ]]; then
  ln -sfn "$CLAUDE_PLUGIN_BIN" "$PLUGIN_DIR/hooks/massa-th0th-hook"
  echo "  + hooks/massa-th0th-hook → $CLAUDE_PLUGIN_BIN"
else
  echo "  ⚠ Warning: claude-plugin binary not found at $CLAUDE_PLUGIN_BIN" >&2
  echo "    Hooks will not fire until the binary is available." >&2
fi

# Merge hooks.json (array-append, backup, idempotent)
echo ""
echo "Merging hooks into $HOOKS_JSON..."
merge_hooks_json "$HOOKS_JSON" "install"
echo "  + 6 massa-th0th hook events wired (array-append, user hooks preserved)"

echo ""
echo "Done. Restart Codex to pick up the plugin."
echo ""
echo "⚠ Run /hooks in Codex to trust massa-th0th hooks, or no observations will be captured."
echo "💡 If you also run install-agents.ts --agent codex, skip MCP — the plugin already registers it."
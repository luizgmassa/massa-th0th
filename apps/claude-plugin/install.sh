#!/usr/bin/env bash
#
# massa-th0th Claude Code plugin installer
#
# Copies slash commands and the massa-th0th-navigator subagent into the user's
# Claude Code config directory AND auto-writes the 5 massa-th0th hook events
# into ~/.claude/settings.json (or ./.claude/settings.json) using an
# array-append merge that preserves existing user hooks. The hooks block uses
# Claude Code's nested matcher-group + hooks[] form, each owned entry marked
# with _massaTh0thOwned: true.
#
# Idempotent: re-running is a no-op when owned hooks already present.
# Uninstall removes only ownership-marked hook entries + commands/agents,
# preserving user keys and user hooks.
#
# Usage:
#   apps/claude-plugin/install.sh             # install at user scope (~/.claude)
#   apps/claude-plugin/install.sh --user      #   (same)
#   apps/claude-plugin/install.sh --project   # install at project scope (./.claude)
#   apps/claude-plugin/install.sh --uninstall # remove owned hooks + commands/agents
#   apps/claude-plugin/install.sh -h|--help   # show this help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

if [[ "$SCOPE" == "project" ]]; then
  TARGET="$(pwd)/.claude"
else
  TARGET="$HOME/.claude"
fi
SETTINGS_JSON="$TARGET/settings.json"
# The shared binary lives in the repo (not copied) — settings.json references
# its absolute path so Claude Code can invoke `bun run <path> <subcommand>`.
HOOK_BIN="$SCRIPT_DIR/hooks/massa-th0th-hook.ts"

# The 5 Claude Code events → binary subcommands. The matcher-group entry shape:
#   { "hooks": [{ "type": "command", "command": "bun run \"<HOOK_BIN>\" <sub>" }],
#     "_massaTh0thOwned": true }
# The merge appends one owned matcher-group entry per event array, preserving
# any pre-existing user matcher-group entries (F5 mitigation).
merge_settings_hooks() {
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
    echo "Error: node or bun required to merge settings.json (JSON manipulation)" >&2
    exit 3
  fi

  "$runner" - "$file" "$mode" "$ts" "$HOOK_BIN" <<'NODE'
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
const mode = process.argv[3];
const ts = process.argv[4];
const hookBin = process.argv[5];

const EVENTS = [
  ["SessionStart", "session-start"],
  ["UserPromptSubmit", "user-prompt-submit"],
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
  const hooks = cfg.hooks;
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    for (const [evt] of EVENTS) {
      if (Array.isArray(hooks[evt])) {
        hooks[evt] = hooks[evt].filter((e) => !(e && e._massaTh0thOwned === true));
        if (hooks[evt].length === 0) delete hooks[evt];
      }
    }
    if (Object.keys(hooks).length === 0) delete cfg.hooks;
  }
} else {
  // install: backup before first write if file existed
  if (existed) {
    const bak = `${file}.massa-th0th.bak-${ts}`;
    fs.copyFileSync(file, bak);
  }
  if (!cfg.hooks || typeof cfg.hooks !== "object" || Array.isArray(cfg.hooks)) {
    cfg.hooks = {};
  }
  for (const [evt, sub] of EVENTS) {
    if (!Array.isArray(cfg.hooks[evt])) cfg.hooks[evt] = [];
    if (!hasOwned(cfg.hooks[evt])) {
      cfg.hooks[evt].push({
        hooks: [
          {
            type: "command",
            command: `bun run "${hookBin}" ${sub}`,
          },
        ],
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
  echo "Uninstalling massa-th0th Claude Code plugin (scope: $SCOPE)..."
  # Remove owned hook entries (preserves user hooks + user keys)
  if [[ -f "$SETTINGS_JSON" ]]; then
    merge_settings_hooks "$SETTINGS_JSON" "uninstall"
    echo "  - removed massa-th0th hook entries from $SETTINGS_JSON"
  fi
  # Remove owned command files
  if [[ -d "$TARGET/commands" ]]; then
    for src in "$SCRIPT_DIR/commands/"*.md; do
      name="$(basename "$src" .md)"
      rm -f "$TARGET/commands/massa-th0th-${name}.md"
    done
    echo "  - removed massa-th0th-* commands from $TARGET/commands/"
  fi
  # Remove the 12 subagent specialists (exclude navigator — R1: name-prefix glob
  # would catch massa-th0th-navigator.md; preserve it per CLA-05).
  if [[ -d "$TARGET/agents" ]]; then
    for src in "$TARGET/agents/"massa-th0th-*.md; do
      [[ -f "$src" ]] || continue
      name="$(basename "$src")"
      [[ "$name" == *navigator* ]] && continue
      rm -f "$src"
    done
    echo "  - removed 12 subagent specialists from $TARGET/agents/ (navigator preserved)"
  fi
  echo ""
  echo "Done. User hooks, keys, and navigator agent preserved."
  exit 0
fi

# ── Install ──────────────────────────────────────────────────────────────────
echo "Installing massa-th0th Claude Code plugin to: $TARGET"
mkdir -p "$TARGET/commands" "$TARGET/agents"

# Slash commands — prefix with 'massa-th0th-' to avoid collisions with user commands
for src in "$SCRIPT_DIR/commands/"*.md; do
  name="$(basename "$src" .md)"
  dest="$TARGET/commands/massa-th0th-${name}.md"
  cp "$src" "$dest"
  echo "  + /massa-th0th-${name}"
done

# Subagent — keep original name
cp "$SCRIPT_DIR/agents/massa-th0th-navigator.md" "$TARGET/agents/massa-th0th-navigator.md"
echo "  + agent: massa-th0th-navigator"

# 12 subagent specialists (generated from skills/*/SKILL.md). Exclude navigator
# from the loop (it is copied above and preserved on uninstall per CLA-05/R1).
specialist_count=0
for src in "$SCRIPT_DIR/agents/"massa-th0th-*.md; do
  [[ -f "$src" ]] || continue
  name="$(basename "$src")"
  [[ "$name" == *navigator* ]] && continue
  cp "$src" "$TARGET/agents/$name"
  specialist_count=$((specialist_count + 1))
done
echo "  + ${specialist_count} subagent specialists: investigator, planner, builder, reviewer, context-curator, verification-agent, requirements-analyst, architecture-specialist, test-engineer, documentation-agent, audit-specialist, mobile-specialist"

# Merge hooks into settings.json (array-append, backup, idempotent)
echo ""
echo "Merging hooks into $SETTINGS_JSON..."
if [[ ! -f "$HOOK_BIN" ]]; then
  echo "  ⚠ Warning: hook binary not found at $HOOK_BIN" >&2
  echo "    Hooks will not fire until the binary is available." >&2
fi
merge_settings_hooks "$SETTINGS_JSON" "install"
echo "  + 5 massa-th0th hook events wired (array-append, user hooks preserved)"

echo ""
echo "Done. Restart Claude Code to pick up the new commands and hooks."
echo ""
echo "Next steps:"
echo "  1. Make sure the massa-th0th MCP server is registered (see apps/mcp-client/README.md)."
echo "  2. Try: /massa-th0th-status"
echo "  3. Try: /massa-th0th-map (on an indexed project)"
echo "💡 If you also run install-agents.ts --agent claude-code, skip it — hooks + MCP are already wired by this plugin."
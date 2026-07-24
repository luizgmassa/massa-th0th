#!/bin/sh
# Claude Code SessionStart hook → massa-ai observation (event: session-start).
# Wire in .claude/settings.json under hooks.SessionStart.
EVENT="session-start"
. "$(dirname "$0")/_post.sh"

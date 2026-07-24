# massa-ai Hook Scripts (Passive Capture)

These POSIX shell scripts wire Claude Code lifecycle hooks into the massa-ai
observation ingestion endpoint (`POST /api/v1/hook`). Each forwards the hook
payload as an Observation so the consolidation bridge can later summarize it
into a structured memory.

| Script | Claude Code hook | massa-ai event |
| --- | --- | --- |
| `session-start.sh` | `SessionStart` | `session-start` |
| `user-prompt-submit.sh` | `UserPromptSubmit` | `user-prompt` |
| `post-tool-use.sh` | `PostToolUse` | `post-tool-use` |
| `stop.sh` | `Stop` | `session-end` |
| `pre-compact.sh` | `PreCompact` | `pre-compact` + snapshot |

## Behavior

- **Fire-and-forget:** each script `curl`s the endpoint with a **2s timeout**
  and always `exit 0`. The agent is never blocked, even if the API is down or
  `curl` is missing.
- **No stdout:** scripts produce no output (Claude Code would surface it).
- **Config via env:** `MASSA_AI_API_BASE` (default `http://localhost:3333`),
  `MASSA_AI_API_KEY` (optional), `MASSA_AI_PROJECT_ID` (optional; defaults to the
  current directory's basename).

## Install (Claude Code)

1. `chmod +x` the scripts (already executable in this repo).
2. Add them to your project or user `.claude/settings.json` `hooks` block:

```jsonc
{
  "hooks": {
    "SessionStart":      [{ "command": "/abs/path/to/session-start.sh" }],
    "UserPromptSubmit":  [{ "command": "/abs/path/to/user-prompt-submit.sh" }],
    "PostToolUse":       [{ "command": "/abs/path/to/post-tool-use.sh" }],
    "PreCompact":        [{ "command": "/abs/path/to/pre-compact.sh" }],
    "Stop":              [{ "command": "/abs/path/to/stop.sh" }]
  }
}
```

3. Start the API: `bun run dev:api` (defaults to `http://localhost:3333`).
4. Run a Claude Code session — Observation rows appear in
   PostgreSQL and are consolidated into memories when the LLM is
   on (`RLM_LLM_ENABLED=true`); otherwise they're stored raw and the bridge
   silently skips.

## Non-Claude hosts

Use the MCP tool `hook_ingest` or POST directly to
`/api/v1/hook/batch` with `{ events: [...] }`.

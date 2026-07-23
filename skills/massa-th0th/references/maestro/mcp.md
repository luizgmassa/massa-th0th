# Maestro MCP Reference

Use this only when the task mentions Maestro MCP, agent/device automation through MCP tools, Maestro Viewer, or Cloud MCP tooling.

## MCP Surface

Maestro MCP ships inside the Maestro CLI and is started with:

```bash
maestro mcp
```

Agent configs generally use stdio with command `maestro` and args `["mcp"]`. If the agent launches from a minimal shell, use full binary path and explicit `JAVA_HOME` when needed.

## Install Examples

Codex CLI:

```bash
codex mcp add maestro -- maestro mcp
```

Manual config:

```toml
[mcp_servers.maestro]
command = "maestro"
args = ["mcp"]
```

Do not install or modify MCP config unless the user asks or the active workflow explicitly owns integration setup.

## Tool Metadata

Official docs list these MCP tools:

- `list_devices`
- `inspect_screen`
- `take_screenshot`
- `run`
- `cheat_sheet`
- `list_cloud_devices`
- `run_on_cloud`
- `get_cloud_run_status`
- `open_maestro_viewer`

`run` accepts exactly one execution shape: inline YAML, specific files, or directory with include/exclude tags. `list_cloud_devices`, `run_on_cloud`, and `get_cloud_run_status` require Maestro Cloud authentication.

## Viewer

Maestro Viewer embeds a device/browser surface for inspection and interaction. Use it as an optional runtime sensor when available; do not treat screenshot success alone as full product or Figma parity.

## CLI Help Caveat

Some installed Maestro versions may print `maestro mcp` usage while returning a non-zero code for `maestro mcp --help`. Record command, exit code, stdout, and stderr exactly. Use official MCP docs plus `maestro --help` for normative MCP availability unless subcommand help succeeds.

## Boundary

MCP can speed authoring and live verification, but it does not replace repository state, official docs, saved audit reports, or deterministic closure evidence. Record skipped reason when MCP is not configured.

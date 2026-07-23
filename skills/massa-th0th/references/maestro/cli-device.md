# Maestro CLI And Device Reference

Use this for CLI preflight, local command syntax, device/platform readiness, and local execution constraints.

## Mandatory Preflight

Before tracked Maestro flow edits, executable audit runs, or `MST-*` fixes:

1. Run `command -v maestro`.
2. Run `maestro --version` or `maestro --help`.
3. Run relevant subcommand help for the surface: `maestro test --help`, `maestro cloud --help`, `maestro record --help`, or MCP startup/help.
4. Check device/emulator readiness through repository convention when one exists; otherwise record `device-readiness: not available` with reason.

Required transcript fields: command, exit code, stdout summary, stderr summary. If `maestro --version` or `maestro --help` fails, block mutation and executable audit/fix runs; do not install or repair Maestro automatically.

## CLI Shape

Official CLI pattern: `maestro [options] [subcommand] [subcommand options]`.

Global options include `--[no-]ansi`, `--[no-]color`, `--device`/`--udid`, `--platform`, `--verbose`, `--version`, and `--help`. Prefer putting global `--device` before the subcommand for clarity, while noting live `maestro test --help` may also expose `--device`.

Current official subcommands include `test`, `cloud`, `record`, `download-samples`, `login`, `logout`, `start-device`, `list-devices`, `list-cloud-devices`, `chat`, `bugreport`, `driver-setup`, and `mcp`. Treat subcommands visible only in live help, such as `hierarchy`, as `live-help` unless official docs also list them. Treat `maestro query` as `excluded/unverified` unless official docs or live help confirms it in the active environment.

## `maestro test`

Use for local simulator/emulator/device/web execution.

Important options from official docs/live help:

- `--config=<configFile>`: workspace config override.
- `-e`, `--env=<Key=Value>`: inject flow variables.
- `--include-tags` and `--exclude-tags`: run or remove flows by tag filters.
- `--format=<format>` and `--output=<path>`: report generation and report path.
- `--test-output-dir=<dir>`: screenshots, videos, command JSON, and AI report artifacts.
- `--debug-output=<dir>`: `maestro.log` and debug outputs.
- `--flatten-debug-output`: CI-friendly debug output layout.
- `--headless` and `--screen-size`: web-only.
- `--shards`, `--shard-all`, `--shard-split`: local sharding/parallel distribution across connected devices.
- `--test-suite-name`: report suite name.
- `--device`/`--udid` and `--platform`: target selection.
- `--analyze`: beta AI analysis, requiring Maestro Cloud-backed authentication.

Do not document unsupported aliases such as `--flavor`, singular `--shard`, or generic `--debug` as valid unless current live help confirms them. Use `--debug-output`, `--shards`, `--shard-all`, or `--shard-split` instead when supported.

## Device And Platform Readiness

Official platform support:

- Android: emulators and physical devices; physical devices need USB debugging; app must already be installed.
- iOS: Xcode-managed simulators; target app uses Bundle ID and simulator-compatible `.app`.
- Web: beta support for Chromium-based browser automation; web flows use `url` instead of `appId`.

For local sharding, require explicit device inventory before planning parallel local runs. Do not claim exact failure behavior for device-count mismatch unless a live run, official docs, or repo convention proves it.

If a WSL caveat matters, verify it against official docs or repository convention first. Otherwise record WSL details as `excluded/unverified`.

## Execution Command Template

Prefer repository-specific wrappers when present. Otherwise use explicit outputs:

```bash
maestro test --format junit --output <report.xml> --test-output-dir <artifact-dir> <flow-or-directory>
```

Add `--debug-output <debug-dir>` when JavaScript logging or `maestro.log` is needed. Use `--no-ansi` in CI when supported by current CLI help or repo convention.

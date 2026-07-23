# Maestro Reference Index

Use this small index from `workflows/maestro/maestro.md`, `workflows/maestro/maestro-audit.md`, and `workflows/maestro/maestro-fix.md` to select the minimum focused Maestro reference for the current step. Do not treat this index as the full Maestro source of truth.

## Source Policy

Load `references/maestro/fact-ledger.md` before making any normative Maestro claim. Every Maestro claim must be tagged as `official-doc`, `live-help`, `repo-convention`, or `excluded/unverified`.

Use `/Users/luizmassa/Downloads/questions.md` only as a coverage checklist. If a checklist item is not supported by official Maestro docs, live CLI help, or repository convention, quarantine it as `excluded/unverified`.

Official source anchors:

- CLI commands/options: https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options.md
- Commands available: https://docs.maestro.dev/reference/commands-available.md
- Selectors: https://docs.maestro.dev/reference/selectors.md
- Workspace configuration: https://docs.maestro.dev/reference/workspace-configuration.md
- Test reports/artifacts: https://docs.maestro.dev/maestro-flows/workspace-management/test-reports-and-artifacts.md
- Cloud build requirements: https://docs.maestro.dev/maestro-cloud/build-your-app-for-the-cloud.md
- Cloud limits: https://docs.maestro.dev/maestro-cloud/limits.md
- Maestro MCP: https://docs.maestro.dev/get-started/maestro-mcp.md

## Load Map

| Need | Load |
|---|---|
| Source authority, Q&A checklist handling, unsupported facts, transcript requirements | `references/maestro/fact-ledger.md` |
| CLI preflight, device/platform readiness, local command flags, sharding, live help capture | `references/maestro/cli-device.md` |
| YAML commands, flow headers, AI commands, examples | `references/maestro/yaml-commands.md` |
| Core, relational, trait, state, dimension, platform, regex, and web-only selector behavior | `references/maestro/selectors.md` |
| Flow discovery, config.yaml discovery patterns, tags, execution order, suite isolation | `references/maestro/workspace-execution.md` |
| Flow header/config/env/report-output boundaries | `references/maestro/config-env-output.md` |
| `evalScript`, `runScript`, `output`, `faker`, logging, `maestro.log` | `references/maestro/js-scripting.md` |
| JUnit/HTML reports, artifact directories, debug output, screenshots, videos, AI reports, recording | `references/maestro/artifacts-reports.md` |
| Cloud binary eligibility, auth/plan needs, app-binary reuse, Cloud device flags, Cloud limits | `references/maestro/cloud.md` |
| Maestro MCP install/use, tool metadata, Viewer, Cloud-auth tools | `references/maestro/mcp.md` |
| Stable suite design, setup/teardown, selectors, fixtures, output contracts, skipped checks | `references/maestro/patterns.md` |

## Minimum Step Selection

- Flow implementation: load `fact-ledger.md`, `cli-device.md`, then only the focused files for the flow surface being edited: commonly `yaml-commands.md`, `selectors.md`, `workspace-execution.md`, `config-env-output.md`, `js-scripting.md`, and `patterns.md`.
- Audit: load `fact-ledger.md`, `cli-device.md`, `workspace-execution.md`, `artifacts-reports.md`, `patterns.md`, and `references/audit-report-io.md`.
- Fix: load `fact-ledger.md`, `cli-device.md`, `artifacts-reports.md`, `patterns.md`, and whichever focused file owns the saved `MST-*` finding.
- Cloud or MCP work: load `cloud.md` or `mcp.md` only when the requested flow, audit, fix, or CI wiring actually touches that surface.

## Closure Reminder

All Maestro workflow closures must report scenario source, changed flows, setup/teardown, command, exit status, JUnit path, artifact directory, device/platform, skipped reason, validation assets, and residual risk.

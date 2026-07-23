# Maestro Fact Ledger

Use this before making Maestro claims. It defines source authority, fact tags, local transcript requirements, and quarantine rules for unsupported checklist items.

## Authority Order

1. `official-doc`: current official Maestro documentation, preferably `.md` pages under `https://docs.maestro.dev/`.
2. `live-help`: successful local CLI transcript from the installed Maestro binary, including command, exit code, stdout, and stderr.
3. `repo-convention`: current repository flows, config, CI, scripts, report paths, and existing naming/tag patterns.
4. `excluded/unverified`: NotebookLM answers, `/Users/luizmassa/Downloads/questions.md`, blog posts, memory, or assumptions that are not confirmed by the first three sources.

If sources conflict, prefer `official-doc` for product behavior and `live-help` for installed CLI syntax. Mention version drift when `live-help` differs from docs.

## Fact Tag Rules

Every normative statement in Maestro workflows, reports, or implementation notes must carry a source class in the agent's working notes:

- `official-doc`: cite the page URL or title.
- `live-help`: include command, exit code, stdout summary, stderr summary, and Maestro version when available.
- `repo-convention`: cite local path or command evidence.
- `excluded/unverified`: name the unsupported claim and do not use it as a requirement, fix direction, or verification gate.

Do not copy long transcripts into final reports. Summarize exact evidence and keep raw logs behind context-firewall boundaries.

## Required Live CLI Transcript Gate

Before using a live CLI fact, capture:

| Probe | Required evidence |
|---|---|
| `command -v maestro` | command, exit code, stdout path, stderr |
| `maestro --version` | command, exit code, stdout version, stderr |
| `maestro --help` | command, exit code, stdout subcommand/global option summary, stderr |
| Relevant subcommand help | command, exit code, stdout option summary, stderr |

Run relevant subcommand help for the surface in use: `maestro test --help`, `maestro cloud --help`, `maestro record --help`, `maestro mcp` or supported MCP help shape, and any repo-specific command wrapper.

If PATH cannot resolve `maestro`, mark local CLI validation blocked. If the binary exists but cannot start, record the failure and avoid claiming executable readiness. Do not install Maestro automatically.

## Coverage Checklist Handling

Use `/Users/luizmassa/Downloads/questions.md` as a checklist to ask "did we cover this surface?" Never cite it as source truth.

Checklist-only facts that must stay non-normative unless independently verified:

- `maestro query` as a CLI subcommand.
- Dashboard polling URL or API response shape not found in official docs or Maestro MCP tool metadata.
- Unsupported flags such as `--flavor`, singular `--shard`, generic `--debug`, or non-web `--headless` when current docs/live help do not support them.
- Obsolete BYO AI guidance such as `MAESTRO_CLI_AI_KEY` or `MAESTRO_CLI_AI_MODEL`.
- WSL-specific caveats unless official docs or repo convention explicitly establish them for the target project.

## Current Source Anchors

Use these pages first:

- CLI command matrix: https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options.md
- YAML commands: https://docs.maestro.dev/reference/commands-available.md
- Selectors: https://docs.maestro.dev/reference/selectors.md
- Workspace config: https://docs.maestro.dev/reference/workspace-configuration.md
- Reports/artifacts: https://docs.maestro.dev/maestro-flows/workspace-management/test-reports-and-artifacts.md
- JavaScript: https://docs.maestro.dev/maestro-flows/javascript/run-and-debug-javascript.md
- Cloud build: https://docs.maestro.dev/maestro-cloud/build-your-app-for-the-cloud.md
- Cloud limits: https://docs.maestro.dev/maestro-cloud/limits.md
- MCP: https://docs.maestro.dev/get-started/maestro-mcp.md

## Failure Handling

- Missing official page: use the docs query interface or `llms.txt`; otherwise tag the fact `excluded/unverified`.
- Live help blocked by sandbox or permissions: retry only when allowed, then record blocked reason and proceed with official-doc facts only.
- Repo has no Maestro flows: ask for the target test root before creating one.
- Repo convention conflicts with official docs: preserve repo behavior for existing suites, but do not generalize it beyond that repository without a source tag.

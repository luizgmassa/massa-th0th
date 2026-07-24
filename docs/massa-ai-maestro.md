# massa-ai Maestro

Human-facing guide for Maestro mobile E2E workflow support built into `massa-ai`. Canonical agent instructions live in [`workflows/maestro/`](../../skills/massa-ai/workflows/maestro/) and the focused reference index at [`references/maestro.md`](../../skills/massa-ai/references/maestro.md).

## Routes

- `maestro`: implement new Maestro flows from Jira/Confluence, attached or local scenario files, prompt text, or explored/inferred scenarios.
- `maestro-audit`: run and inspect existing Maestro flows, compare against scenario sources or explored behavior, and save `MST-*` findings.
- `maestro-fix`: child-only remediation for saved `MST-*` findings from a `maestro-audit` report or handoff.

## Guardrails

- Maestro facts must be source tagged as `official-doc`, `live-help`, `repo-convention`, or `excluded/unverified`. Checklist-only answers are never source truth.
- Maestro CLI transcript evidence is mandatory before flow mutation or executable audit/fix work: `command -v maestro`, `maestro --version` or `maestro --help`, and relevant subcommand help with command, exit status, stdout, and stderr.
- Missing CLI, app build, device/emulator, credentials, signing, or backend state blocks runtime execution; the workflow records the skipped-check reason rather than implying coverage.
- New flows follow existing repo structure. If no Maestro root exists, the workflow asks for the target test root before creating one.
- `maestro-fix` may edit only Maestro flows, subflows, fixtures, setup/teardown, test data, and directly scoped Maestro CI/report wiring. App bugs or product gaps route to debug, feature, or requirements workflows.
- Focused references cover CLI/device, YAML commands, selectors, workspace execution, config/env/output, JavaScript, artifacts/reports, Cloud, MCP, and stable patterns. Agents load only the files needed for the current step.

## Audit Reports

Maestro audits save under:

```text
audits/maestro/<YYYY-MM-DD maestro-audit.md>
```

Reports use `Workflow: maestro-audit` and finding IDs `MST-<N>`. Runtime runs should use JUnit reports and a separate artifact directory, for example:

```bash
maestro test --format junit --output build/maestro/report.xml --test-output-dir build/maestro/artifacts .maestro
```

Report generation uses CLI `--format` and `--output`; it is not configured in `config.yaml`. Use `--debug-output` when `maestro.log` or JavaScript logs matter.

## Examples

```text
Add Maestro coverage for the checkout coupon scenario from this Jira ticket.
Audit all Maestro release-smoke flows and save a report.
Fix MST-1 and MST-3 from audits/maestro/2026-06-29 maestro-audit.md.
```

# Maestro Artifacts And Reports Reference

Use this when running, auditing, or fixing flows that need report paths, artifact directories, screenshots, videos, debug output, or recording.

## Reports

Report generation is CLI-dependent. Use `--format` and `--output`; do not put report generation in `config.yaml`.

Supported report formats from current official docs/live help:

- `junit`
- `html`
- `html-detailed` when supported by current CLI help
- `noop`/default no report when no format is selected

JUnit reports default to `report.xml` in the current working directory when `--output` is omitted. Prefer explicit report paths in CI.

```bash
maestro test --format junit --output build/maestro/report.xml .maestro
```

## Artifact Directories

`--test-output-dir` captures screenshots, videos, `commands-*.json`, and AI report files. `--debug-output` captures `maestro.log` and debug-oriented output.

If both flags point to the same directory, artifacts consolidate there. If they differ, `maestro.log` stays in `--debug-output` while screenshots/videos/commands/AI reports stay in `--test-output-dir`.

```bash
maestro test \
  --format junit \
  --output build/maestro/report.xml \
  --test-output-dir build/maestro/artifacts \
  --debug-output build/maestro/debug \
  .maestro
```

## Common Artifact Fields

Record these in audit/fix reports and closure summaries:

- command
- exit status
- JUnit or HTML report path
- artifact directory
- debug output directory
- `maestro.log` path when JS logging matters
- `commands-*.json` presence or absence
- screenshots/videos presence or absence
- AI report path when `--analyze` or AI commands run
- device/platform/app build/flavor
- skipped-check reason

## Recording

Use `maestro record --local` when a local MP4 recording is requested. Current official docs/live help mark local rendering as beta and restrict the optional output file to local rendering.

```bash
maestro record --local flows/checkout.yaml build/maestro/checkout.mp4
```

Remote recording behavior is not a normative contract here. Prefer `--local` for privacy and repeatability unless repository convention says otherwise.

## AI Reports

AI analysis via `maestro test --analyze` and AI assertion commands is experimental and Cloud-auth-backed. It can produce HTML/JSON insight reports in artifacts. Do not replace missing AI execution with model self-evaluation.

## No-Coverage Rule

A passing flow proves the flow's selected path on the selected device/platform. It does not prove full scenario coverage, Figma parity, accessibility compliance, or absence of app bugs unless those claims have separate deterministic evidence.

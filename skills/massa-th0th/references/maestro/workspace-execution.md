# Maestro Workspace And Execution Reference

Use this when discovering Maestro roots, config files, tags, execution order, suite isolation, and CI invocation.

## Discovery

Search current source for:

- `.maestro/`, `maestro/`, `e2e/`, `flows/`
- `*.yaml`, `*.yml`
- `config.yaml`
- CI or scripts that invoke `maestro`
- Existing report/artifact paths

Prefer the existing repository root, naming, tags, setup, teardown, fixtures, and artifact directories. If no Maestro workspace exists, ask for the target test root before creating one. If multiple roots exist, ask which root owns the app, platform, or suite.

## `config.yaml`

Official workspace configuration is structured around global workspace settings, execution/filtering, platform settings, and Cloud-only settings.

Key fields:

- `flows`: glob patterns for suite discovery; `*` covers root-level YAML, `**` covers recursive patterns.
- `testOutputDir`: default artifact directory override for screenshots, logs, and metadata.
- `includeTags` and `excludeTags`: global tag filters.
- `executionOrder.continueOnFailure`: whether ordered execution stops after a failure.
- `executionOrder.flowsOrder`: ordered flow names or filenames.
- `platform.ios.snapshotKeyHonorModalViews`
- `platform.ios.disableAnimations` and `platform.android.disableAnimations`: Cloud-only animation settings.
- `baselineBranch` and `notifications`: Cloud-only configuration.

Report generation is not configured in `config.yaml`; use CLI `--format` and `--output`.

## Tags

Tags live in individual Flow headers and can also be configured globally in `config.yaml`.

```yaml
appId: com.example.app
tags:
  - smoke
  - checkout
---
- launchApp
```

CLI `--include-tags` and `--exclude-tags` override global config filters. Multiple tags inside one include/exclude flag use OR logic. Combining include and exclude applies inclusion first, then exclusion.

## Execution Order And Isolation

Default execution order is non-deterministic so flows stay isolated. Use `executionOrder` only for goal-driven flows that truly need sequencing.

Even ordered flows should be able to run on a reset device. Prefer `runFlow` hooks/subflows for setup rather than relying on previous flow side effects.

```yaml
executionOrder:
  continueOnFailure: false
  flowsOrder:
    - signup_flow
    - verify_email_flow
```

## Local And CI Execution

Use repository wrappers when present. Otherwise prefer:

```bash
maestro test --format junit --output build/maestro/report.xml --test-output-dir build/maestro/artifacts .maestro
```

Add `--debug-output build/maestro/debug` when `maestro.log` or JavaScript logs matter. Add `--no-ansi` only when supported by current live help or repo convention.

For local sharding, capture connected devices first. `--shards`, `--shard-all`, and `--shard-split` are local CLI options; do not claim exact device-count failure behavior without official docs, live run evidence, or repo convention.

## Workspace Risks To Audit

- Config discovery misses nested flows because `flows` lacks recursive patterns.
- Tags configured in both Flow headers and CLI/config produce unexpected selection.
- Ordered flows depend on prior side effects instead of explicit setup.
- CI reports are stored in current directory because `--output` is omitted.
- `testOutputDir`, `--test-output-dir`, and `--debug-output` are treated as the same location when they are not.

# Maestro Config, Env, And Output Boundaries

Use this when deciding whether a fact belongs in a Flow header, `config.yaml`, CLI invocation, report metadata, or artifact output.

## Boundary Matrix

| Surface | Owns | Does not own |
|---|---|---|
| Flow header | `appId` or `url`, `name`, `tags`, `env`, hooks, JUnit `properties` | Workspace discovery policy for all flows |
| `config.yaml` | `flows`, `testOutputDir`, global tags, `executionOrder`, platform config, Cloud notifications/baseline | JUnit/HTML report generation |
| CLI flags | `--env`, `--config`, `--format`, `--output`, `--test-output-dir`, `--debug-output`, tag overrides, device/platform | Persistent source truth |
| Report file | JUnit/HTML result selected by `--format` and `--output` | Screenshots/videos/debug logs by default |
| Artifact dirs | screenshots, videos, `commands-*.json`, AI reports, and optionally `maestro.log` | Test result XML unless explicitly written there by `--output` |

## Flow Header Fields

```yaml
appId: com.example.app
name: Checkout Critical Path
tags:
  - smoke
env:
  REGION: us
onFlowStart:
  - runFlow: setup/user.yaml
onFlowComplete:
  - runFlow: cleanup/user.yaml
properties:
  junitId: TC-CHECKOUT-001
  junitClassname: com.example.CheckoutE2E
---
- launchApp
```

Use `properties` for JUnit metadata. `junitId` and `junitClassname` are reserved report attributes; other properties are emitted as JUnit properties.

## Env Injection

Pass runtime values through CLI or flow/subflow/script env:

```bash
maestro test -e APP_ID=com.example.android -e USER_KIND=admin flows/login.yaml
```

```yaml
- runFlow:
    file: login.yaml
    env:
      USER_KIND: admin
- runScript:
    file: setupUser.js
    env:
      role: admin
```

Do not hardcode secrets in YAML. Use repo-approved secret injection, Maestro Cloud secrets, or CI environment variables.

## Output Rules

- `--format junit --output <path>` creates CI-readable JUnit XML.
- `--format html` or `--format html-detailed` creates HTML reports.
- `--test-output-dir` stores screenshots, videos, `commands-*.json`, and AI reports.
- `--debug-output` stores `maestro.log`; when same as `--test-output-dir`, outputs consolidate.
- config.yaml cannot configure report generation; it can configure `testOutputDir`.

## Closure Evidence

Every Maestro closure should include:

- command and exit status
- report format and report path
- `--test-output-dir`
- `--debug-output` when used or skipped reason
- app/platform/device
- environment source, with secrets redacted
- validation assets protected

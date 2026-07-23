# Maestro Cloud Reference

Use this only when a Maestro task touches Cloud execution, CI upload, Cloud devices, Cloud-auth-backed AI, or app binary reuse.

## Cloud Command

Maestro Cloud uses the normal Maestro CLI `cloud` subcommand, not a separate Cloud CLI.

Prefer named parameters:

```bash
maestro cloud \
  --app-file app/build/outputs/apk/debug/app-debug.apk \
  --flows .maestro \
  --format junit \
  --output build/maestro/cloud-report.xml
```

Named parameters such as `--app-file` and `--flows` can appear in any order and are safer for CI scripts than positional arguments.

## Auth And Plan Requirements

- Cloud test execution requires Maestro Cloud access and a Cloud plan.
- Cloud CLI calls need API key/login/project configuration according to repo convention.
- AI commands and `maestro test --analyze` are Cloud-infrastructure-backed but can be enabled with a free account; do not confuse that with Cloud device execution plan requirements.

Never commit API keys. Use `maestro login`, `MAESTRO_CLOUD_API_KEY`, or CI secrets according to repository policy.

## App Binary Eligibility

Android Cloud requirements:

- Upload APK, not AAB.
- APK must be ARM-compatible or multi-architecture; x86-only APKs fail in Cloud.
- Debug and release builds are supported.

iOS Cloud requirements:

- Upload `.app` bundle.
- Build for iOS Simulator, not physical iOS devices.

Project-specific build steps are authoritative. Check README, build scripts, and CI before inventing build commands.

## Reuse And Device Selection

Use `--app-binary-id` to reuse a previously uploaded binary when official docs/repo convention expose the ID.

Cloud device flags:

- `--device-model`
- `--device-os`
- `--device-locale`
- `maestro list-cloud-devices` for supported pairs

Do not hardcode model/OS values unless requested or repo convention fixes them.

## Cloud Limits

Official Cloud limit: 15-minute soft execution limit per test execution. After that, a test may be stopped at any time. Split long suites into smaller, parallelizable flows.

## Cloud Output And Async

`maestro cloud` can block until analyses complete by default; current live help exposes `--async` to submit and exit immediately. Record upload/dashboard output when available, but do not invent dashboard polling schemas unless official docs, live MCP metadata, or repo convention provides them.

## Cloud Boundary

Use Cloud for hosted device execution, device matrix coverage, PR checks, and Cloud-only platform settings. Keep local CLI checks, static YAML checks, and repository validation as separate evidence.

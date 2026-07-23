# Mobile Context

Use this reference when a non-debug workflow touches KMP, iOS, Android, native bridges, mobile app lifecycle, offline sync, permissions, push/background work, local persistence, or backend-mobile contracts.

Mobile is a context modifier, not a primary workflow. Keep the selected workflow based on user intent:

- New capability -> `workflows/feature.md`
- Behavior-preserving structure change -> `workflows/refactor.md`
- Broken behavior, crashes, regressions, or device-specific failures -> `workflows/debug.md` plus `references/mobile-diagnosis.md`
- New Maestro mobile E2E flow implementation -> `workflows/maestro/maestro.md`
- Findings-only Maestro mobile E2E audit -> `workflows/maestro/maestro-audit.md`
- Child-only fix for saved Maestro audit findings -> `workflows/maestro/maestro-fix.md`
- Findings-only test coverage review -> `workflows/tests/tests-audit.md`
- Fix findings from a tests audit report -> `workflows/tests/tests-fix.md`
- Direct Android Views/Compose, UIKit/SwiftUI, or KMP Compose Multiplatform implementation from Figma or screenshot context -> `workflows/design.md`
- Findings-only platform-detected mobile comparison with Figma -> `workflows/mobile-figma/mobile-figma-audit.md`
- Fix saved platform-detected mobile Figma findings -> `workflows/mobile-figma/mobile-figma-fix.md`
- Findings-only security review -> `workflows/security/security-audit.md`
- Fix findings from a security audit report -> `workflows/security/security-fix.md`
- Broad, cross-boundary, unclear, or multi-platform implementation -> `workflows/spec-driven.md`

For `feature`, `spec-driven`, `rfc`, `adr`, and `tdd`, supported mobile UI work can use the optional design-source gate. Ask for one or more Figma links, node IDs, a readable desktop selection, supplied screenshots, or explicit `none` only when the request is Android, iOS, KMP Compose Multiplatform UI, or plausibly mobile UI. Clear backend, CLI, docs, infrastructure, and non-UI requests skip the prompt.

Maestro is a first-class mobile E2E workflow family when the primary target is flow implementation, existing-flow audit, or saved `MST-*` remediation. Generic test coverage, assertion quality, or regression-risk review still belongs to `workflows/tests/tests-audit.md` or `workflows/tests/tests-fix.md` when the target is not Maestro-specific.

When Figma sources or screenshots are supplied for supported Android, iOS, or KMP Compose Multiplatform UI implementation, keep the parent workflow as the lifecycle owner and invoke `workflows/design.md` only for the affected UI slice or visual feasibility context. Use `workflows/mobile-figma/mobile-figma-audit.md` for compare/audit intent and `workflows/mobile-figma/mobile-figma-fix.md` for saved `MFM-*` findings.

Treat `none` as a first-class answer: record `Figma Source: none by user choice` and do not re-ask unless the mobile UI scope changes. For unsupported targets such as Flutter, React Native, web, desktop, or generic design exploration, record supplied design sources as outside mobile Figma scope, do not run mobile Figma, and continue the parent workflow. Screenshots are context-only unless paired with structured Figma evidence; do not claim exact Figma parity, tokens, variables, or dimensions from screenshots alone.

## Mobile Context Packet

Capture only the fields needed for the active workflow:

- Platform scope: Android, iOS, KMP shared logic, native bridge, React Native, Flutter, webview, or backend-mobile contract
- Shared boundary: KMP shared code, native bridge, backend contract, local persistence, navigation, platform-only UI, or platform service
- App/build context: debug/release, flavor, app version/build, distribution channel, signing/profile when relevant
- Device matrix: impacted or targeted OS/API versions, real device vs simulator/emulator, and screen/accessibility constraints when UI is involved
- Runtime state: online/offline, background/foreground, process death, permissions, locale/timezone, feature flags, remote config, account/tenant, and local data/cache state when relevant
- Parity target: Android-only, iOS-only, shared behavior, or both platforms

Do not collect a full device matrix when the task only changes pure shared logic and deterministic shared tests are sufficient.

## Boundary Decisions

Before changing mobile behavior, decide where the change belongs:

- KMP shared logic: domain rules, shared repositories, serialization, retry/backoff, validation, state machines, and platform-neutral contracts
- Platform-specific code: permissions, OS APIs, lifecycle hooks, background execution, native storage, push providers, UI layout, accessibility, navigation shell, and signing/build behavior
- Native bridge: payload shape, nullability, serialization, threading, callback lifetime, event ordering, error mapping, and backward compatibility
- Backend-mobile contract: API versioning, auth refresh, pagination, schema nullability, media limits, upload retries, clock skew, and feature flag or remote config behavior

Prefer shared logic only when both platforms need the same behavior and the platform APIs can support it cleanly. Keep platform-specific behavior explicit when OS rules, permissions, lifecycle, or UI conventions differ.

## Platform Parity

Any mobile change must state:

- Impacted platform or shared boundary
- Expected comparison platform result
- Validation run for each affected platform, or skipped platform with reason
- Risk if one platform cannot be checked

For shared-code changes, run or document Android and iOS/KMP validation. For platform-only changes, prove the affected platform and state whether the other platform is unaffected, untested, or out of scope.

## Verification Sensors

Use the cheapest deterministic sensor that proves the workflow claim:

- KMP/shared: shared unit tests, common fixtures, platform-specific `actual` tests, serialization contract tests, or KMP compiler tasks
- Android: unit tests, instrumentation tests, Compose/Espresso tests, Gradle build/test tasks, emulator commands, deep-link intents, or focused lint/static checks
- iOS: unit tests, XCTest/UI tests, scheme build/test, simulator commands, universal/deep-link checks, or focused lint/static checks
- Cross-platform E2E: existing repo tools such as Maestro, Detox, Appium, XCTest UI, Espresso, or Compose UI tests
- Mobile artifacts: screenshots, videos, sanitized logs, crash reports, device logs, or human-in-the-loop scripts only when deterministic harnesses are unavailable

For design, mobile Figma audit, or mobile Figma fix, load `references/mobile-figma-matcher/repository-detection.md` and `references/mobile-figma-matcher/core.md`, then only the stack references selected by the Target Surface Packet. Maestro MCP/CLI is an optional runtime sensor: prefer existing safe flows and fixed device configurations, and never treat flow success or screenshots alone as parity proof.

Never rely on model self-evaluation. If device access, signing, credentials, provisioning, or hardware is unavailable, state the missing dependency and use the strongest available artifact or static proof.

## Tests Lens

When auditing or executing test work, check mobile-specific coverage for:

- KMP shared logic and platform-specific `actual` behavior
- Native bridge payloads, nullability, serialization, callbacks, threading, and error paths
- Permissions, deep links, push/background flows, lifecycle transitions, offline/online sync, local persistence, migrations, and auth refresh
- UI layout, accessibility font size, safe areas/notches, keyboard, rotation, navigation/back stack, and locale/timezone behavior when relevant
- Fixture drift between backend contracts, KMP models, Android models, and iOS bridge payloads
- Snapshot or screenshot assertions that were weakened, over-broadened, or made nondeterministic

## Security Lens

When auditing or executing security work, check mobile-specific trust boundaries:

- Secure storage/keychain/keystore use, token lifecycle, refresh behavior, and logout/session invalidation
- Permission prompts, denied/restricted states, background permission behavior, and OS-version permission changes
- Deep links, universal/app links, intent filters, route params, and auth guards
- Push tokens, APNs/FCM environment, notification tap actions, background tasks, and token privacy
- Biometrics, device credentials, fallback paths, and local lockout behavior
- Local DB/cache, offline queues, pending writes, sync conflict handling, and data retention
- Logs, crash reports, analytics, screenshots, and breadcrumbs for secret or personal data exposure
- Backend-mobile contract skew, schema nullability, media upload limits, retry idempotency, and clock skew

## Memory Guidance

Persist durable mobile lessons only after recall and importance scoring:

- KMP/shared vs platform-specific boundary decisions
- Native bridge payload contracts or compatibility constraints
- Project-specific mobile verification recipes or device matrix constraints
- Security boundaries involving secure storage, permissions, deep links, push, biometrics, local data, logs, or backend-mobile contracts
- Repeated mobile testing gaps, fixture drift patterns, or platform parity gotchas

Do not persist one-off device details, raw logs, screenshots, customer data, tokens, device IDs, or temporary debugging artifacts.

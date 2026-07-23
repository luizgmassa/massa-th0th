# Mobile Diagnosis

Use this reference when `workflows/debug.md` handles broken behavior involving KMP, iOS, Android, native bridges, real devices, simulators, emulators, mobile app lifecycle, or device-specific failures.

This extends `references/debug-diagnosis-loop.md`. Do not use it instead of the general debug loop.

For non-debug mobile feature, refactor, tests, or security work, keep the intent-specific workflow and load `references/mobile-context.md` instead. Use `references/mobile-context.md` from Debug only when shared mobile vocabulary or non-bug parity/security/test framing is needed.

## Mobile Intake

Add these fields to the normal debug intake packet:

- Platform: Android, iOS, KMP shared logic, native bridge, React Native, Flutter, webview, or backend-mobile contract
- OS/API version and device model
- Real device vs simulator/emulator
- App version, build number, build flavor, distribution channel, and signing/profile context when relevant
- Debug, release, staging, production, or TestFlight/internal track
- Network state: online, offline, captive portal, cellular, Wi-Fi, VPN, proxy, low bandwidth, or packet loss
- Locale, timezone, calendar, text direction, region, and accessibility settings
- Permission state: notifications, location, camera, contacts, Bluetooth, background refresh, biometrics, files, or photos
- Battery, power saver, background/foreground state, app termination, process death, and cold/warm start state
- Account, tenant, feature flags, remote config, entitlement, and experiment bucket
- Data state: local DB/cache version, migration history, sync queue, pending writes, and corrupted or stale local records
- Crash/log artifact availability: stack trace, sanitized `logcat`, iOS device logs, crash report, screenshot, video, or repro script

If the bug is platform-specific, record the impacted platform and at least one unaffected or untested comparison platform.

## Mobile Feedback Loops

Choose the first loop that can reproduce the mobile failure, preserves the reported signal, and can later prove the fix:

- KMP shared unit tests, common test fixtures, or platform-specific `actual` tests
- Android unit tests, instrumentation tests, UI tests, Gradle task, emulator command, or deep-link intent command
- iOS unit tests, UI tests, scheme build/test, simulator command, or universal link/deep-link command
- Existing E2E tools already in the repo, such as Maestro, Detox, Appium, XCTest UI, Espresso, or Compose UI tests
- App kill/restart, cold start, background/foreground transition, rotation, keyboard, notification tap, or deep-link flow
- Push notification, background task, location, permission prompt, biometric, or offline/online simulation only when supported by local tools
- Sanitized `logcat`, iOS device logs, crash reports, breadcrumbs, screenshots, videos, or trace exports
- Device-farm, crash analytics, performance, or observability checks only when the project already has approved access
- Structured human-in-the-loop script when a real device or account state is required

Use skipped-reason enum values from `references/debug-diagnosis-loop.md` for unavailable mobile loops, especially `missing-hardware`, `missing-credentials`, `tool-missing`, `unsafe-production`, and `destructive-risk`.

Loop quality rules:

- Prefer deterministic local tests for KMP/shared logic before full-device loops.
- For device-only failures, keep the device matrix explicit and avoid claiming global coverage from one simulator/emulator.
- Preserve the original user-visible mobile failure signal, such as a crash, blank screen, lost sync item, permission failure, missing push, bad layout, or wrong navigation target.
- If a loop needs unavailable hardware, credentials, signing, provisioning, or production data, state the missing dependency and use the strongest root-cause proof available.

## Mobile Hypothesis Prompts

Use these prompts to build the normal 3-5 item hypothesis board:

- Lifecycle: cold start, warm start, process death, background resume, app switch, orientation, keyboard, memory pressure, or foreground service state
- Permissions: denied, not determined, one-time grant, restricted, background-only, OS-version permission changes, or prompt timing
- Native bridge: payload shape, nullability, serialization, threading, callback lifecycle, event ordering, or platform-specific type conversion
- KMP boundary: `expect/actual` mismatch, coroutine dispatcher, freezing/thread confinement, platform clock/filesystem/network behavior, or shared persistence abstraction
- Offline sync: queue ordering, conflict resolution, retry backoff, idempotency, cache invalidation, local DB migration, or partial-write recovery
- Navigation/deep links: auth guard, universal/app link entitlement, intent filter, route params, nested navigator state, back stack, or cold-start restoration
- Push/background: token registration, APNs/FCM environment mismatch, notification permission, background fetch limits, collapse keys, or tap-action routing
- Build/runtime config: debug vs release behavior, minification/ProGuard/R8, bitcode/symbols, signing/profile, build flavor, env file, remote config, or feature flag
- OS/device regression: API level, iOS version, OEM behavior, screen size, notch/safe area, locale/timezone, accessibility font size, battery saver, or low-memory behavior
- Backend-mobile contract: API version skew, clock skew, auth refresh, pagination, schema nullability, media upload limits, or network retry semantics

For each hypothesis, name the impacted boundary and the expected platform parity result.

## Crash And Log Discipline

Use crash and log artifacts as evidence, not as raw context:

- Keep only sanitized frames, exception names, thread names, relevant app logs, event breadcrumbs, and source pointers.
- Redact tokens, user IDs, device IDs, emails, phone numbers, precise locations, and customer data before memory or final output.
- Symbolicate or deobfuscate when concrete project tools exist; otherwise state that stack evidence is partial.
- Compare app frames against platform/framework frames to avoid fixing symptoms outside project code.
- Load `references/context-firewall.md` before inspecting verbose device logs or crash exports.

## Platform Parity

Mobile fixes need explicit parity framing:

- Impacted platform: where the failure occurs.
- Comparison platform: unaffected, untested, or unknown.
- Shared boundary: KMP shared code, native bridge, backend contract, local persistence, navigation, or platform-only UI.
- Required validation: impacted platform fixed, unaffected platform still passes or is explicitly not in scope.

If a shared-code change affects both platforms, run or document Android and iOS/KMP validation. If only one platform can be checked, state the skipped platform and risk.

## Output Extension

Add these fields to the normal Debug output contract:

- Device Matrix: platform, OS/API, device/simulator, app build/flavor, network, permissions, and lifecycle state checked
- Mobile Evidence: crash/log artifact, screenshot/video, deep-link command, device test, KMP test, or human-in-the-loop script
- Platform Parity: impacted platform, comparison platform, shared boundary, and skipped platform checks
- Mobile Prevention: regression test, device-matrix note, crash/logging improvement, runbook step, or durable mobile constraint memory

## Memory Guidance

Persist durable mobile lessons only after recall and importance scoring:

- Platform-specific root causes that future agents might misdiagnose
- KMP or native bridge boundary decisions
- Reusable device commands, simulator/emulator recipes, or log-filter commands
- Mobile verification matrices that prevent repeated false confidence
- OS-version, permission, lifecycle, or build-flavor gotchas with project impact

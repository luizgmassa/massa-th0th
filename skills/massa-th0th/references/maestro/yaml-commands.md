# Maestro YAML Commands Reference

Use this when authoring or auditing Maestro flow commands. Official command inventory lives at https://docs.maestro.dev/reference/commands-available.md.

## Flow Header

Flow headers can define target identity and metadata before `---`:

```yaml
appId: com.example.app
name: Login Smoke
tags:
  - smoke
env:
  USER_KIND: standard
onFlowStart:
  - runFlow: setup.yaml
onFlowComplete:
  - runFlow: cleanup.yaml
properties:
  testCaseId: TC-LOGIN-001
---
- launchApp
```

For web flows, use `url` instead of `appId`.

## Command Inventory

Official command categories:

- App/device state: `launchApp`, `stopApp`, `killApp`, `clearState`, `clearKeychain`, `setPermissions`, `setAirplaneMode`, `toggleAirplaneMode`, `setOrientation`, `setLocation`, `travel`, `addMedia`.
- Interactions: `tapOn`, `doubleTapOn`, `longPressOn`, `swipe`, `scroll`, `scrollUntilVisible`, `pressKey`, `back`, `openLink`, `hideKeyboard`.
- Input/clipboard: `inputText`, `eraseText`, `copyTextFrom`, `setClipboard`, `pasteText`.
- Flow control: `runFlow`, `runScript`, `evalScript`, `repeat`, `retry`, `extendedWaitUntil`, `waitForAnimationToEnd`, `assertTrue`.
- Assertions and media: `assertVisible`, `assertNotVisible`, `assertScreenshot`, `takeScreenshot`, `startRecording`, `stopRecording`.
- AI commands: `assertWithAI`, `assertNoDefectsWithAI`, `extractTextWithAI`.

## App Lifecycle Examples

```yaml
- launchApp:
    appId: com.example.app
    clearState: true
    clearKeychain: true
    stopApp: true
    permissions:
      camera: allow
      location: allow

- stopApp: com.example.app
- killApp: com.example.app
- clearState: com.example.app
- clearKeychain
```

## Interaction Examples

```yaml
- tapOn:
    id: submit_button
    retryTapIfNoChange: true

- tapOn:
    text: Add to cart
    rightOf: Product A
    index: 0

- tapOn:
    point: "50%,50%"

- tapOn:
    id: increment_counter
    repeat: 3
    delay: 200

- doubleTapOn:
    id: hero_image

- longPressOn:
    text: Delete

- swipe:
    direction: LEFT
    duration: 400
```

Use point/coordinate targeting only as a last resort when the element is not available in the accessibility tree.

## Assertions And Waits

```yaml
- assertVisible:
    id: login_success_banner
    enabled: true
    timeout: 10000

- assertNotVisible:
    text: Loading

- extendedWaitUntil:
    visible:
      id: payment_confirmation
    timeout: 15000

- waitForAnimationToEnd:
    timeout: 5000
```

Prefer observable state waits over fixed sleeps.

## Input And Clipboard

```yaml
- inputText: "jane.doe@example.com"
- eraseText: 50
- copyTextFrom:
    id: verification_code
- setClipboard: "123456"
- pasteText
- hideKeyboard
```

## Flow Control

```yaml
- runFlow:
    file: login.yaml
    env:
      USER_KIND: admin
    when:
      visible: Login

- runScript:
    file: setupUser.js
    env:
      role: admin

- repeat:
    times: 3
    commands:
      - tapOn: Add item

- retry:
    maxRetries: 2
    commands:
      - tapOn: Retry
      - assertVisible: Success

- assertTrue:
    condition: ${output.total > 0}
    label: total computed
```

Conditions commonly use visibility, absence, platform, or JavaScript expressions. Re-check command-specific docs before using uncommon fields.

## Screenshots And Recording

```yaml
- takeScreenshot: checkout/confirmation
- assertScreenshot:
    path: checkout/confirmation
    thresholdPercentage: 1
- startRecording: checkout-run
- stopRecording
```

When visual artifacts matter, record the artifact directory and whether screenshots/videos came from `--test-output-dir`, `--debug-output`, or `maestro record --local`.

## Device/System Commands

```yaml
- setLocation:
    latitude: 37.7749
    longitude: -122.4194
- setPermissions:
    camera: allow
    location: deny
- setAirplaneMode: true
- toggleAirplaneMode
- setOrientation: LANDSCAPE
- pressKey: Home
- back
- openLink: myapp://checkout
- addMedia:
    - ./fixtures/photo.png
- travel:
    days: 1
```

Verify platform support for each command before treating it as portable.

## AI Commands

AI test analysis and AI assertions are experimental and routed through Maestro Cloud infrastructure. Current official docs say users no longer provide their own AI model/key variables; authentication is through `maestro login` or `MAESTRO_CLOUD_API_KEY`.

```yaml
- assertWithAI: "Verify the success message is in Spanish"
- assertNoDefectsWithAI
- extractTextWithAI: "Extract the order number"
```

Do not add obsolete BYO AI env guidance. If AI is unavailable, mark the check blocked or skipped rather than replacing it with model self-evaluation.

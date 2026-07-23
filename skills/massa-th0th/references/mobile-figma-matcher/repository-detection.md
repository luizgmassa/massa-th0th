# Mobile Figma Repository Detection

Use this reference before loading any stack-specific matcher reference. Classify the concrete target module and files, not the repository root or repository name.

Monorepositories may contain several valid mobile stacks; classify only modules connected to the requested target.

## Target Surface Packet

Produce one immutable packet before Figma extraction or implementation comparison:

```text
Repository Classification: <Android | iOS | KMP | monorepo/mixed>
Target Feature/Flow: <requested target>
Target Module(s): <module paths>
Surface IDs: <stable IDs used by matrices and findings>
Surface Matrix: <surface ID -> module/source set -> UI stack -> Figma node -> runtime targets>
Detection Evidence: <build files, manifests/projects, source sets, imports, resources, entry points>
Ambiguities Resolved: <evidence or user decision>
Excluded Surfaces: <found but out of scope, with reason>
```

## Detection Order

1. Resolve the requested feature, flow, files, symbols, commits, branch comparison, or modified-file set.
2. Locate candidate modules using build configuration, manifests/projects, source sets, and ownership boundaries.
3. Classify each target surface using at least one build/configuration signal and one source/resource signal when available.
4. Map each selected surface to its Figma node. A single node may map to several surfaces; separate platform frames require explicit mappings.
5. Load only the references required by selected surface IDs.

## Stack Signals

### Android Views XML

- Android Gradle plugin or Android module plus `AndroidManifest.xml`.
- `res/layout`, layout qualifiers, data/view binding, layout inflation, `View`/`ViewGroup`, Fragment/Activity views, story-equivalent navigation hosts, or XML Material components.

### Android Jetpack Compose

- Android Gradle plugin plus Compose build features/compiler/dependencies.
- `setContent`, `@Composable`, `androidx.compose` imports, Compose navigation, previews, or Compose UI tests.

### iOS UIKit

- Xcode project/workspace or Swift package with Apple platform target.
- `import UIKit`, `UIView`, `UIViewController`, `AppDelegate`/`SceneDelegate`, storyboards, XIBs, Auto Layout constraints, or UIKit snapshot/UI tests.

### iOS SwiftUI

- Xcode project/workspace or Swift package with Apple platform target.
- `import SwiftUI`, `View`, `@main App`, hosting controllers, previews, SwiftUI navigation, or SwiftUI snapshot/UI tests.

### KMP Compose Multiplatform

- Kotlin Multiplatform plugin and source sets such as `commonMain`, `androidMain`, `iosMain`, or configured equivalents.
- Compose Multiplatform plugin/dependencies and shared `@Composable` UI in a common source set.
- Common resources, shared UI modules, platform adapters, and `expect`/`actual` declarations affecting presentation.

## Mixed And KMP Composition

- Do not classify every Compose file in a KMP repository as shared.
- Shared Compose UI in `commonMain` or the configured common UI source set loads the KMP contract.
- Compose in `androidMain`, an Android application module, or Android-only host loads Android Compose.
- Android XML hosts or interop load Android Views in addition to any shared KMP contract.
- Swift/UIKit/SwiftUI hosts, wrappers, or surrounding native screens load the matching iOS contract.
- Audit shared composables once, then capture and report runtime evidence separately for each requested Android or iOS target.
- When a shared fix affects both targets, verify both. Unavailable targets remain `NOT EVALUATED` with explicit risk.

## Ambiguity Gate

Ask the user only when evidence cannot resolve one of these cases:

- The requested feature maps to multiple plausible modules.
- Legacy and replacement UI stacks both implement the target with no current ownership evidence.
- Shared Compose Multiplatform UI serves Android and iOS but requested runtime coverage is unspecified.
- Separate Figma platform frames cannot be mapped reliably to code surfaces.

Do not ask merely because the repository contains several mobile stacks. Exclude unrelated surfaces and record why.

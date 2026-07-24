# massa-ai Mobile Figma

Use mobile Figma workflows for production UI work backed by a readable Figma node or screenshot context and a concrete Android, iOS, or Kotlin Multiplatform target. Screenshot-only sources are context, not exact Figma parity evidence.

## Routes

- `design`: implement or update a target directly from Figma without a saved mobile Figma report.
- `mobile-figma-audit`: compare existing source with Figma and produce findings without editing code.
- `mobile-figma-fix`: fix confirmed `MFM-*` findings from a saved mobile Figma report.

Flutter, React Native, web UI, generic Figma exploration, variable-only queries, and MCP troubleshooting are outside these routes.

When a broader `feature`, `rfc`, `adr`, or `tdd` request touches supported mobile UI, that parent workflow can use optional Figma links, nodes, desktop selections, screenshots, or explicit `none`. Supplied sources route only the affected Android, iOS, or KMP Compose Multiplatform UI slice or design context into `design`; the parent workflow keeps requirements, decision, document, task, and completion ownership.

## Required Inputs

Design and audit need:

1. A Figma URL/node ID, readable Figma desktop selection, or supplied screenshot context. Exact parity requires structured Figma evidence.
2. A concrete feature, flow, module, source set, file set, screen, view/composable, commit range, branch comparison, or modified-file target.
3. Required states and a requirements source for behavior that Figma does not define.

Fix needs the saved report path or a concrete target that identifies one report under `audits/mobile-figma/`.

## Stack Detection

The workflow inspects the target module before loading implementation guidance:

- Android Views XML from Android configuration plus layouts, inflation, binding, and View usage.
- Android Jetpack Compose from Android configuration plus Compose dependencies and composables.
- UIKit from Apple targets plus UIKit source, storyboards, XIBs, or view controllers.
- SwiftUI from Apple targets plus SwiftUI views, app entry points, hosting, and previews.
- KMP Compose Multiplatform from the Kotlin Multiplatform and Compose plugins plus shared composables in common source sets.

Monorepositories are classified per target module. The workflow asks only when source evidence cannot identify module ownership, active legacy/replacement stack, runtime platform coverage, or Figma frame mapping.

## KMP Behavior

KMP does not replace native platform guidance:

- Shared Compose UI in `commonMain` uses the Compose Multiplatform contract.
- Android-only Compose or XML surfaces load Android guidance.
- UIKit or SwiftUI hosts and wrappers load the corresponding iOS guidance.
- Shared composables are audited once, while Android and iOS runtime evidence remains separate.
- A shared fix is verified on every affected requested platform or the unavailable platform is reported as `NOT EVALUATED`.

## Evidence And Assets

The workflow extracts design context, screenshots, variables, Code Connect mappings, states, annotations, and assets before judging or implementing source when Figma is available. Screenshot-only work records provenance and uncertainty, then avoids token, variable, dimension, or exact parity claims. Temporary Figma MCP asset URLs are transport endpoints, not durable application references; required assets are saved through the repository's existing asset pipeline.

Comparison rows use `MATCH`, `MISMATCH`, `CONSTRAINT DEVIATION`, or `NOT EVALUATED`. Only confirmed `MISMATCH` rows create `MFM-*` findings. Maestro may prove reachability and interaction but never proves Figma parity by itself.

## Examples

```text
Implement this Figma checkout frame in our SwiftUI target.
Audit the modified Android XML and Compose files against this Figma node.
Compare the shared KMP screen on Android and iOS, including the native hosts.
Fix MFM-2 and MFM-5 from audits/mobile-figma/2026-06-15 mobile-figma-audit.md.
```

Legacy Android-only mobile Figma reports without repository classification, a Target Surface Matrix, surface IDs, and per-surface configurations must be regenerated with a fresh audit.

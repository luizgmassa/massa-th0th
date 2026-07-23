### Design

Use this workflow to implement or update a concrete Android, iOS, or KMP Compose Multiplatform UI from structured Figma evidence or supplied screenshot context when no saved mobile Figma audit report is the source of truth. Route findings-only comparison to `mobile-figma-audit` and saved `MFM-*` remediation to `mobile-figma-fix`.

Do not use this workflow for Flutter, React Native, web UI, generic Figma exploration, variable-only queries, or MCP troubleshooting.

1. Resolve/reuse `workflowSessionId`: `design-[entity]`.
2. Load `references/mobile-figma-matcher/repository-detection.md`, `references/mobile-figma-matcher/core.md`, `references/mobile-context.md`, `references/codebase-investigation.md`, and `references/verification-ladder.md`. Load `references/context-firewall.md` before large design/runtime artifacts and `references/synapse-policy.md` when repeated th0th searches are expected.
3. `recall` -> load current component conventions, design-system rules, approved platform/accessibility deviations, prior Figma mappings, asset pipelines, and reusable render recipes. Memory is context, not proof.
4. Require a concrete feature/module target plus at least one design source: readable Figma node/selection or supplied screenshots. Resolve required visual and interactive states plus a requirements source for behavior not represented in the design source. Ask only when target ownership, runtime platforms, platform-frame mappings, or screenshot authority remain ambiguous after source inspection.
5. Build the immutable Target Surface Packet before loading stack guidance. Classify each selected surface and load only its contracts:
   - Android Views XML -> `references/mobile-figma-matcher/android-views.md`.
   - Android Jetpack Compose -> `references/mobile-figma-matcher/android-compose.md`.
   - iOS UIKit -> `references/mobile-figma-matcher/ios-uikit.md`.
   - iOS SwiftUI -> `references/mobile-figma-matcher/ios-swiftui.md`.
   - Shared KMP Compose Multiplatform -> `references/mobile-figma-matcher/kmp-compose-multiplatform.md` plus native contracts only for selected native source sets, hosts, wrappers, or runtime targets.
6. Build the Figma Evidence Packet with metadata when needed, design context, screenshot, variables, current Code Connect mappings, variants/states, annotations, and asset inventory. For screenshot-only sources, build a Screenshot Context Packet with provenance, target state, visible constraints, uncertainty, and `Design Evidence Class: screenshot-context-only`; do not infer exact Figma tokens, dimensions, variables, variants, or parity from screenshots alone. Stop if neither structured Figma evidence nor supplied screenshot context is available.
7. Resolve current components, tokens, resources, assets, source-set ownership, platform adapters, requirements, and existing validation sensors. Create the Design-To-Code Mapping Matrix and one comparison configuration for every selected runtime surface; screenshot-only rows must use inferred visual intent rather than `Figma Value`.
8. Size the work with the Verification Ladder. Route broad application work, unresolved architecture, cross-feature design-system migration, or implementation that will not fit one clean context window to `spec-driven`.
9. Establish the verification recipe before editing. Protect tests, snapshots, screenshot baselines, fixtures, previews, accessibility identifiers, test tags, and automation flows from weakening.
10. Implement coherent slices using the smallest correct ownership boundary:
    - Reuse existing components and tokens only after resolving semantics, states, accessibility, and values.
    - Save required temporary Figma-served assets into the repository's existing durable asset pipeline before referencing them.
    - Keep shared KMP UI in common source sets only when ownership is genuinely shared; keep platform UI and adapters explicit.
    - Apply shared KMP root fixes before platform-local overrides when the cause is shared.
    - Preserve platform accessibility, safe areas/insets, localization, adaptive behavior, and native conventions.
11. After each coherent slice, rebuild affected mapping/comparison rows and run the cheapest deterministic sensors. When a shared KMP change affects Android and iOS, verify both requested targets or mark the unavailable platform `NOT EVALUATED`.
12. Refresh the Figma node, when available, and all selected target surfaces before completion. Completion requires zero unresolved selected `MISMATCH` rows for structured Figma evidence; `NOT EVALUATED` rows remain explicit residual risk and prohibit complete parity claims. Screenshot-only completion may claim implementation against supplied screenshot context, never exact Figma parity.
13. Report changed files, final per-surface matrix, saved assets, strongest verification level, skipped checks, and residual risk.
14. Persist only durable token/component mappings, approved deviations, source-set ownership rules, asset-pipeline rules, or reusable render recipes after Importance Calibration. Use `workflow:design` and required project/session/entity/memory tags.
15. Complete `references/evidence-gate.md`. Model visual judgment alone cannot satisfy completion.

## Examples

User asks: "Implement this Figma checkout screen in the app's SwiftUI module."

1. Detect the Xcode target and SwiftUI surface from build and source evidence.
2. Load the shared core plus SwiftUI contract, map Figma states to current styles/views/assets, implement, and verify with existing previews, snapshots, XCTest/XCUITest, or simulator sensors.

User asks: "Build this screen in our KMP app for Android and iOS."

1. Detect whether UI is shared Compose Multiplatform or native per platform.
2. Load the KMP contract for shared composables and add Android Compose, Android Views, UIKit, or SwiftUI contracts only for actual hosts/source sets.
3. Verify shared source once and runtime parity separately for Android and iOS.

User asks: "Use this screenshot as context for the Android settings screen."

1. Classify screenshot context, target surface, and uncertainty before editing.
2. Implement only visible/in-scope intent and preserve behavior requirements from separate sources.
3. Report that exact Figma parity, tokens, and variables were not evaluated.

### Mobile Figma Audit

Use this workflow for a findings-only audit of whether an existing Android Views XML, Android Jetpack Compose, iOS UIKit, iOS SwiftUI, KMP Compose Multiplatform, or mixed KMP/native implementation matches a specific Figma design. It compares Figma MCP evidence with a concrete feature, file set, screen, class/composable/view, commit range, branch comparison, or modified-file target.

Do not edit code. Route direct design implementation to `design`. Do not use this workflow for Flutter, React Native, web styling, generic Figma exploration, or MCP troubleshooting.

1. Resolve/reuse `workflowSessionId`: `mobile-figma-audit-[entity]`.
2. Load shared references:
   - `references/mobile-figma-matcher/repository-detection.md` before platform guidance.
   - `references/mobile-figma-matcher/core.md` for Figma, assets, mapping, comparison, Maestro, and claim contracts.
   - `references/mobile-context.md` for mobile boundaries, parity, and verification context.
   - `references/audit-scope.md` for target resolution and freshness.
   - `references/audit-report-io.md` before producing the report.
   - `references/codebase-investigation.md` for unfamiliar source.
   - `references/context-firewall.md` before large Figma payloads, screenshots, hierarchy dumps, logs, or reports.
   - `references/synapse-policy.md` when repeated th0th searches are expected.
3. `recall` -> load current component/design-system conventions, accepted Figma deviations, prior mappings, source-set boundaries, accessibility constraints, asset pipelines, and project render recipes. Apply the audit Memory Freshness Gate; memory is not proof.
4. Require both inputs before analysis:
   - Figma source: URL/node ID or an explicit desktop selection accessible through Figma MCP.
   - Concrete implementation target: feature/flow, files/globs, screen name, classes/composables, commits/range, branch comparison, or modified files.
   - Ask for the missing input rather than guessing or defaulting to the whole app.
5. Resolve one immutable audit scope packet and Target Surface Packet before Figma extraction or detailed source analysis. Classify every selected target module/source set and load only applicable contracts: Android Views, Android Compose, UIKit, SwiftUI, and/or KMP Compose Multiplatform. Mixed KMP targets load native contracts only for actual native hosts, wrappers, source sets, or requested runtime targets.
6. Verify Figma MCP and build the Figma Evidence Packet from `references/mobile-figma-matcher/core.md` using `get_metadata` when needed, `get_design_context`, `get_screenshot`, `get_variable_defs`, and current Code Connect mappings when available. Stop if the node cannot be read; do not substitute a screenshot-only design contract.
7. Establish one Platform Comparison Configuration per selected runtime surface. Record the fields required by that stack contract. Never compare Figma pixels directly with Android `dp`/`sp`, UIKit/SwiftUI points, or rendered pixels without the recorded density/display scale and text scaling.
8. Extract a numbered design checklist covering only visible/in-scope elements and required states:
   - Structure and ordering.
   - Geometry, constraints, alignment, spacing, sizing, and insets.
   - Typography, text content/wrapping, colors, opacity, shapes, borders, elevation/shadows, assets, and clipping.
   - Interactive/semantic states represented by the design or target implementation.
   - Adaptive, locale, font-scale, dark-mode, and accessibility constraints when relevant.
9. Resolve implementation values to final values and record resource/token/asset chains. Verify existing components by source, semantics, states, and usage; never select a resource or variant because its name resembles a Figma token.
10. For KMP, audit common composables/resources once, classify Android-only and iOS-native boundaries separately, and create distinct runtime rows for every requested platform target. Verify `expect`/`actual`, platform adapters, safe areas/insets, resource loading, and host integration when they affect the surface.
11. Detect and run the strongest safe existing runtime sensors using the order in `references/mobile-figma-matcher/core.md`. Do not install screenshot tooling or rewrite baselines during audit.
12. Detect Maestro MCP, Maestro CLI, device availability, and applicable existing flows independently:
   - If MCP and a safe device are available, use non-destructive launch/navigation, hierarchy inspection, and screenshots for the target state.
   - If CLI and an existing applicable flow are available, run it with an explicit artifact directory and compact report output.
   - Prefer existing flows; do not create tracked Maestro flows during audit.
   - If Maestro, device, or flows are unavailable, mark only those checks `NOT EVALUATED` and continue.
13. Build the complete comparison matrix using required evidence classes and statuses. Every row carries a `Surface ID`. Try to disprove each mismatch through current source, resolved aliases, runtime configuration, platform constraints, source-set ownership, and design variants before reporting it.
14. Create actionable findings only for confirmed `MISMATCH` rows:
   - IDs: `MFM-<N>`.
   - Severity: `critical` only for unusable/release-blocking target states; `high` for major structural or interaction mismatch; `medium` for clear visible component/layout mismatch; `low` for localized visual drift.
   - Required fields: surface ID, UI stack, source set/module, element/state, property/constraint, Figma value, resolved implementation value, runtime evidence, evidence class, platform configuration, file/line, impact, smallest fix direction, and verification suggestion.
   - Preserve justified deviations and unmeasured rows separately; do not convert them into false findings.
15. Save or propose `audits/mobile-figma/<YYYY-MM-DD mobile-figma-audit>.md` using the report contract in `references/audit-report-io.md`. Include repository classification, Target Surface Matrix, Figma packet/mappings, per-surface configurations, capability matrix, comparison matrix, findings, justified deviations, not-evaluated rows, scope/evidence, and execution handoff.
   - Include the Verification/Test Fidelity Checklist from `references/audit-report-io.md` as the proof layer over the comparison/capability matrices. Tie every `MFM-*` finding or no-finding claim to deterministic sensors, commands/artifacts, results, validation assets, or skipped-check reasons. Model judgment alone cannot satisfy verification/testing all-clear.
16. Persist only durable token/component mappings, source-set ownership rules, approved accessibility/platform deviations, asset-pipeline rules, or reusable render recipes after Importance Calibration. Use `workflow:mobile-figma-audit` and required tags. Never persist screenshots, hierarchy dumps, raw logs, device IDs, or user data.
17. Complete `references/evidence-gate.md`. A model visual impression cannot satisfy the gate.

## Examples

User asks: "Compare the LoginScreen Compose preview and modified files against this Figma node."

1. Resolve the node, modified files, `LoginScreen`, theme/tokens, previews, and screenshot-test capability.
2. Run existing preview/runtime sensors and optional Maestro evidence when available.
3. Save a matrix-backed audit report with only confirmed mismatches as `MFM-*` findings.

User asks: "Audit `res/layout/checkout.xml` against my current Figma selection."

1. Resolve the desktop selection, XML layout, included resources, styles, drawables, and target device configuration.
2. Use an existing XML/runtime render sensor if available; otherwise limit the claim to static values and mark visual runtime rows `NOT EVALUATED`.

User asks: "Audit the shared checkout screen in our KMP app on Android and iOS."

1. Detect shared Compose Multiplatform UI plus any Android/iOS hosts and map each surface to the Figma frame.
2. Audit common composables once, then capture separate Android and iOS runtime/configuration evidence. Load native contracts only where native code participates.

# Mobile Figma Core

Use this shared reference after `repository-detection.md` identifies one or more target surfaces. It defines Figma evidence, requirements boundaries, asset handling, mapping and comparison semantics, runtime evidence, and parity-claim limits. Load only the platform references named by the Target Surface Packet.

## Boundaries

- Supported UI stacks are Android Views XML, Android Jetpack Compose, iOS UIKit, iOS SwiftUI, and Kotlin Multiplatform Compose Multiplatform.
- Flutter, React Native, web styling, generic Figma exploration, variable-only queries, and MCP troubleshooting are out of scope.
- Figma MCP is mandatory design evidence. A screenshot or pasted description alone is not a design contract.
- Figma defines visible design intent and represented variants. Product behavior, navigation, data, analytics, error handling, and state transitions require a separate requirements source.
- Accessibility, platform conventions, localization, safe areas/insets, minimum touch targets, Dynamic Type/font scale, and explicit product requirements outrank literal replication when supported by evidence. Record these as `CONSTRAINT DEVIATION`.

## Figma Evidence Packet

Build one packet per selected Figma node or desktop selection:

```text
Figma File/Selection: <URL, file key, or desktop selection>
Figma Node: <node ID and name>
Figma Evidence Timestamp: <local timestamp>
Metadata: <node outline or not needed>
Design Context: <nodes fetched>
Screenshot: <artifact/tool result>
Variables: <variable names, aliases, and resolved values>
Code Connect: <mapped components or none>
States/Variants: <default, pressed, disabled, loading, error, dark, etc.>
Annotations: <relevant design notes or none>
Assets: <asset inventory and intended repository destinations>
```

- Use `get_metadata` first for a large or truncated selection, then fetch only relevant children with `get_design_context`.
- Always obtain `get_design_context` and `get_screenshot` for each comparison frame.
- Use `get_variable_defs` to resolve colors, typography, spacing, effects, and aliases.
- Use current Code Connect mappings when available, but verify every mapping against current source and semantics.
- Treat generated React, Tailwind, or other sample output as design representation, never implementation guidance for a mobile stack.
- Stop if the selected node cannot be read. Do not replace structured Figma evidence with visual inference.

## Asset Contract

- Inventory images, icons, SVGs, vectors, animations, and fonts returned by Figma before editing.
- Figma MCP asset URLs, including localhost URLs, are temporary transport endpoints. Save required assets into the target repository using its existing asset pipeline and reference the durable project asset.
- Do not leave temporary MCP URLs in source, tests, fixtures, documentation, or generated configuration.
- Reuse an existing project asset only after verifying visual content, semantics, licensing, scale behavior, and platform rendering.
- Do not install icon packages or create placeholders when the design supplies the real asset.
- Preserve vector data when the target stack supports it; otherwise record any conversion and verify rendered output.

## Design-To-Code Mapping Matrix

Before implementation, or as the basis of an audit, map every visible in-scope element and required state:

| ID | Surface ID | Figma Element/State | Existing Component/Token/Asset | Intended Implementation | Requirements Source | Validation Sensor |
|---|---|---|---|---|---|---|

- Reuse existing components only when semantics, states, accessibility, and visual contract match.
- Prefer established tokens when their resolved values satisfy the Figma contract. A name match is not evidence.
- When project tokens differ materially, report the conflict and choose the smallest scoped change that preserves system consistency and design intent.
- Do not promote a screen-local need into a shared design-system API without evidence of reuse or an established local pattern.

## Runtime Sensors And Maestro

Use the cheapest existing sensor that proves the claim:

1. Static source, resource, token, and asset resolution.
2. Existing previews, layout renderers, or screenshot/snapshot tests.
3. Existing instrumentation, XCTest, UI tests, or project render harnesses.
4. Existing emulator, simulator, or device workflow.
5. Optional Maestro MCP/CLI evidence.
6. Human or model visual comparison only as labeled `inferential-visual` evidence.

Detect Maestro MCP, Maestro CLI, device availability, and applicable existing flows independently. Prefer existing safe flows and fixed configurations. Never install Maestro, start a device, clear app state, change permissions, seed accounts, mutate backend data, or run a destructive flow without explicit approval. Temporary approved flows stay outside tracked source and do not count as durable regression coverage.

A passing flow proves reachability and interaction for the tested journey. It does not prove Figma parity. A screenshot is runtime evidence only when its surface, configuration, state, and provenance are recorded.

Sensor matrix:

| Need | Required evidence |
|---|---|
| Relevant state | Explicit Figma variant, requirement, platform default, or touched code path names the state. |
| Token match | Resolved value equality or documented tolerance from Figma variable -> project token/resource -> rendered value. Name equality alone is insufficient. |
| Static parity | Source/resource/asset/constraint chain resolves every in-scope row. |
| Runtime parity | Static parity plus screenshot/snapshot/render/device evidence with surface, configuration, state, and provenance. |
| Maestro evidence | Existing safe flow only; do not create tracked flows or mutate app/backend/device state without approval. |
| Complete parity | No unexplained `MISMATCH`, no required `NOT EVALUATED`, and strongest safe runtime sensor recorded for every in-scope surface. |

## Comparison Matrix

Use one complete matrix across all selected surfaces:

| ID | Surface ID | Element/State | Property/Constraint | Figma Value | Resolved Implementation Value | Runtime Evidence | Evidence Class | Status | Confidence | Fix Direction |
|---|---|---|---|---|---|---|---|---|---|---|

Evidence classes:

- `deterministic-source`: resolved source, token, resource, asset, or constraint evidence.
- `deterministic-runtime`: measured hierarchy, geometry, snapshot result, UI assertion, or fixed-configuration artifact.
- `inferential-visual`: labeled visual comparison without deterministic measurement.
- `missing`: required evidence is unavailable or unsafe to obtain.

Statuses:

- `MATCH`: sufficient evidence supports parity for the row and configuration.
- `MISMATCH`: concrete evidence shows a difference without an overriding constraint.
- `CONSTRAINT DEVIATION`: an evidenced platform, accessibility, localization, safe-area, or product constraint intentionally differs.
- `NOT EVALUATED`: evidence is unavailable, ambiguous, stale, or unsafe to obtain.

Only `MISMATCH` rows create `MFM-*` findings. Every row and finding must retain its `Surface ID`.

## Claim Rules

- Never claim complete parity while an in-scope surface has unexplained `MISMATCH` or required `NOT EVALUATED` rows. `NOT EVALUATED` always blocks complete parity for the affected surface.
- Complete parity requires fixed Figma evidence, a Target Surface Packet, per-surface configurations, deterministic source evidence, strongest available runtime sensors, zero unexplained mismatches, and explicit residual risk.
- A shared KMP row may match statically while Android or iOS runtime rows remain `NOT EVALUATED`; report those separately.
- When only source evidence exists, state: `Resolved implementation values align with the extracted Figma contract; runtime visual parity was not evaluated.`

## Attribution

Read `ATTRIBUTION.md` when modifying this contract or redistributing adapted Figma implementation guidance.

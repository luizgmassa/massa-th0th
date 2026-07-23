### Mobile Figma Fix

Use this workflow only to fix confirmed `MFM-*` findings from a saved mobile Figma audit report.

Do not execute from chat summaries, screenshots alone, remembered findings, or an unsaved comparison table. The saved `audits/mobile-figma/<YYYY-MM-DD mobile-figma-audit>.md` report is the source of truth. Route fresh comparison work to `mobile-figma-audit`.

1. Resolve/reuse `workflowSessionId`: `mobile-figma-fix-[entity]`.
2. Load shared references:
   - `references/mobile-figma-matcher/repository-detection.md` before platform guidance.
   - `references/mobile-figma-matcher/core.md` for Figma, assets, mapping, Maestro, matrix, and claim contracts.
   - `references/lessons.md` to load confirmed project lessons
   - `references/mobile-context.md` for mobile boundary and verification guidance.
   - `references/audit-report-io.md` before any source or validation-asset edit.
   - `references/audit-scope.md` and `references/codebase-investigation.md` for freshness and current source.
   - `references/verification-ladder.md` before edits.
   - `references/context-firewall.md` before large design/runtime artifacts.
3. `recall` -> load current design-system rules, accepted deviations, prior component mappings, source-set boundaries, accessibility constraints, asset-pipeline rules, and render recipes for the target.
4. Select a report and target focus:
   - Prefer an exact report path plus optional `MFM-*` IDs.
   - For `latest` or omitted path, require a concrete target focus, then select only from `audits/mobile-figma/`.
   - Stop if no report exists or metadata does not identify `Workflow: mobile-figma-audit`, project/session, target/focus/scope, source timestamp, repository classification, Target Surface Matrix, Figma source/node mappings/timestamp, per-surface platform configurations, capability matrix, and comparison matrix.
   - Reject legacy Android-only reports without the Target Surface Matrix and `Surface ID` fields. Require a fresh audit; do not infer or migrate the missing schema.
5. Validate report freshness before editing:
   - Re-resolve the target files, rebuild the Target Surface Packet, and verify git scope/base/head when relevant.
   - Stop and re-audit when current module/source-set classification no longer matches the report.
   - Re-read the same Figma node/selection and verify its current identity, variants, values, and screenshot. Stop and re-audit if material design drift invalidates findings.
   - Verify every platform configuration is reproducible or explicitly accept a documented substitute.
   - Recheck every selected finding's surface ID, UI stack, source-set/module, source location, resolved token/resource/asset chain, evidence, and constraint rationale.
   - Reject `NOT EVALUATED`, `CONSTRAINT DEVIATION`, unknown, stale, or low-confidence rows as executable findings unless the user explicitly changes scope after re-audit.
6. Load only platform contracts named by the selected findings and current Target Surface Packet. Build a remediation matrix: finding -> surface -> element/state/property -> Figma value -> current implementation value -> shared/platform root change -> affected files -> validation assets -> runtime sensor -> optional Maestro packet -> order -> status.
7. Size work with the Verification Ladder. Route broad design-system migrations, unclear accessibility/product conflicts, or cross-feature component redesign to `spec-driven` before editing.
8. Apply the smallest root fix:
   - Prefer existing shared components, theme tokens, resources, dimensions, typography, shapes, and state definitions before local overrides.
   - Preserve stack-specific accessibility, minimum touch targets, localization, safe areas/insets, adaptive behavior, and native platform conventions.
   - For KMP, apply shared root fixes before platform-local overrides when the cause is shared, then verify every affected platform target.
   - Keep XML/Compose, UIKit/SwiftUI, and KMP/native interoperability explicit. Do not duplicate one visual rule across layers when an established shared source owns it.
   - Do not weaken screenshot tests, previews, fixtures, assertions, test tags, resource IDs, content descriptions, or Maestro selectors to hide a mismatch.
   - Modify tracked Maestro flows only when the selected finding explicitly identifies the flow as incorrect or missing and the user-approved scope includes that change.
9. Verify after each coherent finding group:
   - If verification found a reusable signal (`ac_gap`, `surviving_mutant`, `spec_precision_gap`, `spec_deviation`, `gate_fail`), record it via `references/lessons.md`:
     `python3 skills/massa-th0th/scripts/lessons.py --root . add --feature "<slug>" --signal "<signal>" --source "<ref>" --text "<one terse lesson>"`
   - Apply the Mandatory Verification Fix Gate from `references/verification-ladder.md`: run the report's Verification Suggestion or an equivalent deterministic command/artifact check for each selected `MFM-*` finding or coherent group.
   - A finding cannot be marked `fixed` when a target-relevant command, render sensor, comparison artifact, or Maestro reproduction exists but was not attempted; if verification cannot run, mark it `blocked`, `deferred`, or `skipped` with an allowed skipped-check reason.
   - Re-resolve every affected comparison row, not only the previous mismatch.
   - Run focused static checks and existing preview/screenshot/instrumentation sensors.
   - Re-evaluate every affected surface, including surfaces changed indirectly by a shared KMP fix.
   - When Maestro evidence was used in audit and remains available, reproduce each recorded device/configuration/content state and rerun the same flow or navigation steps; capture equivalent hierarchy and screenshots.
   - If Maestro becomes unavailable, record the regression gap instead of claiming equivalent runtime verification.
10. Rebuild the final comparison matrix using fresh Figma and per-surface implementation evidence. Completion requires zero unresolved selected mismatches; all newly `NOT EVALUATED` rows remain residual risk. A passing Maestro flow does not change an unmatched visual row to `MATCH`.
11. Produce a closure matrix with `MFM-*` ID, surface ID, status (`fixed`, `deferred`, `blocked`, `skipped`), changed files, final Figma/implementation values, command/artifact, result, skipped reason or `none`, highest Verification Ladder level reached, validation assets protected, static evidence, per-platform render evidence, optional Maestro evidence, and residual risk.
12. Persist only durable token mappings, source-set ownership rules, approved constraint deviations, component reuse rules, asset-pipeline rules, or reusable verification recipes after Importance Calibration. Use `workflow:mobile-figma-fix` and required tags.
13. Complete `references/evidence-gate.md` and report the highest Verification Ladder level reached.

## Examples

User asks: "Fix MFM-1 and MFM-3 from the latest LoginScreen mobile Figma audit."

1. Select the latest report matching LoginScreen and validate the Figma node, reported target surfaces, and both findings.
2. Fix shared theme/component causes before screen-local overrides.
3. Rebuild every affected matrix row and rerun the strongest existing runtime sensors.

User asks: "Apply the checkout mobile Figma report and verify with Maestro."

1. Verify the report used Maestro and that the same safe device/flow remains available.
2. Apply confirmed fixes, rerun the recorded flow, capture equivalent hierarchy/screenshots, and keep visual parity conclusions separate from flow success.

User asks: "Fix the shared KMP spacing finding and its iOS host mismatch."

1. Re-detect the common Compose and iOS host surfaces, load KMP plus the matching UIKit or SwiftUI contract, and verify the report schema/freshness.
2. Apply the shared fix first, then the host-specific fix only if the mismatch remains; rebuild Android/iOS rows affected by the shared change.

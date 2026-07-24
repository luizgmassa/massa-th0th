### Maestro Audit

Use this workflow for findings-only audit of existing Maestro mobile E2E flows, fixtures, setup/teardown, reports, artifacts, CI invocation, selector stability, flake risk, and scenario coverage.

Do not edit code or flows in this workflow. Do not use it for new flow implementation; route that to `workflows/maestro/maestro.md`. Do not fix findings directly; invoke `workflows/maestro/maestro-fix.md` as a bounded child workflow only after a saved audit report or audit handoff exists.

1. Resolve/reuse `workflowSessionId`: `maestro-audit-[entity]`.
2. Load shared references:
   - `references/maestro.md` as the index before choosing focused Maestro references.
   - `references/maestro/fact-ledger.md` before making any Maestro claim; tag facts as `official-doc`, `live-help`, `repo-convention`, or `excluded/unverified`.
   - `references/maestro/cli-device.md` before CLI checks, device/platform readiness, local sharding, or executable runs.
   - `references/maestro/workspace-execution.md` before discovering flows, tags, config, CI commands, execution order, or suite isolation.
   - `references/maestro/artifacts-reports.md` before report/artifact/debug-output, screenshot, video, recording, or AI report claims.
   - `references/maestro/selectors.md` before selector stability findings.
   - `references/maestro/config-env-output.md` before env/config/report-output findings.
   - `references/maestro/cloud.md` only when Cloud execution, Cloud devices, auth/plan, or Cloud artifact evidence is in scope.
   - `references/maestro/mcp.md` only when Maestro MCP or Viewer evidence is in scope.
   - `references/maestro/patterns.md` before flake, setup/teardown, coverage, and execution-handoff judgments.
   - `references/audit-report-io.md` before producing the report.
   - `references/mobile-context.md` for platform scope, parity, and device/emulator assumptions.
   - `references/audit-scope.md` for scope packet, budgets, skipped depth checks, and freshness.
   - `references/context-firewall.md` before large logs, screenshots, videos, JUnit XML, generated artifacts, or broad search output.
   - `references/synapse-policy.md` when repeated massa-ai searches are expected.
   - `references/agent-orchestration.md` only for large scopes, explicit parallel/subagent requests, or independent verification of high-impact findings.
3. Run the mandatory Maestro CLI transcript gate from `references/maestro/cli-device.md` and `references/maestro/fact-ledger.md`: `command -v maestro`, `maestro --version` or `maestro --help`, and relevant subcommand help with command, exit code, stdout, and stderr. If missing or failing, block executable audit runs and produce only a blocked static-readiness report when source inspection is still useful.
4. Establish the audit target:
   - Explicit Maestro root, suite, flow file, tag, app/module, platform, branch comparison, commit range, modified files, or whole Maestro workspace.
   - For omitted target, discover all developed Maestro flows and ask before whole-workspace audit if multiple roots exist.
5. Resolve expected behavior sources in scenario input order: Jira/Confluence via Atlassian MCP, attached/local file, prompt text, then explored/inferred repository behavior. If no requirements source exists, run `workflows/exploration.md` before comparing behavior and label inferred expectations as inference.
6. Discover all in-scope Maestro flows, subflows, fixtures, setup/teardown, config, tags, CI commands, report paths, and artifact paths.
7. Run every existing in-scope Maestro flow when the CLI, app build, device/emulator, credentials, and backend dependencies are available. Use deterministic output:
   - `maestro test --format junit --output <report.xml> --test-output-dir <artifact-dir> <flow-or-directory>`.
   - Capture command, exit code, JUnit report, artifact directory, platform/device, app build/flavor, environment, and skipped-check reason.
8. Compare current flows and run results against supplied or discovered expected behavior:
   - Scenario coverage and acceptance criteria.
   - Setup/teardown completeness, data isolation, feature flags, permissions, locale/timezone, cleanup, and app state reset.
   - Selector/test-ID stability, synchronization, fixed sleeps, coordinates, screenshot/image coupling, brittle text, and flow ordering.
   - CI report/artifact retention, runtime cost, device assumptions, retry/quarantine behavior, and flake diagnostics.
9. Produce findings first, ordered by severity. IDs: `MST-<N>`.
   - Each finding must include severity, confidence, flow/subflow/file location, scenario source, concrete evidence, impacted journey, flake or coverage risk, simplest sufficient fix, and Verification Suggestion.
   - If no findings are found, say that clearly and list flows, scenarios, commands/artifacts, and skipped checks.
   - Include the Verification/Test Fidelity Checklist from `references/audit-report-io.md`; tie every `MST-*` finding or no-finding claim to deterministic sensors, commands/artifacts, validation assets, skipped-check reasons, and runtime artifacts. Model judgment alone cannot satisfy verification/testing all-clear.
10. Save or propose `audits/maestro/<YYYY-MM-DD maestro-audit.md>` using the report contract in `references/audit-report-io.md`. The enriched report must preserve flow inventory, run matrix, scenario coverage, JUnit report path, artifact directory, device/emulator readiness, validation assets, and execution handoff.
11. Invoke `workflows/maestro/maestro-fix.md` only as a bounded child workflow for failed executable `MST-*` findings when requested or when the parent audit explicitly includes auto-fix handoff. The child may edit only Maestro flows, subflows, fixtures, setup/teardown, and test data.
12. Persist only durable Maestro conventions, flake classes, selector/test-ID policy, device matrix constraints, or reusable verification recipes after Importance Calibration. Use `workflow:maestro-audit` and required memory tags.
13. Complete the Evidence Gate from `references/evidence-gate.md`.

## Examples

User asks: "Run a Maestro audit for the checkout suite."

1. Scope to the checkout Maestro root or tag, run CLI/device preflight, and discover expected behavior.
2. Execute in-scope flows with JUnit report and artifact output when dependencies are available.
3. Save `audits/maestro/<YYYY-MM-DD maestro-audit.md>` with `MST-*` findings and execution handoff.

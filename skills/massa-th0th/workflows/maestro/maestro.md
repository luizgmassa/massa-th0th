### Maestro

Use this workflow to implement new Maestro mobile E2E flows from Jira/Confluence, prompt text, attached or local scenario files, or inferred scenarios when no explicit source is supplied.

Do not use this workflow for findings-only review of existing flows; route that to `workflows/maestro/maestro-audit.md`. Do not use it to execute saved audit findings; route those to `workflows/maestro/maestro-fix.md`. Do not use it for app bug fixes or product behavior changes; route those to `workflows/debug.md`, `workflows/feature.md`, or `workflows/requirements/requirements-audit.md`.

1. Resolve/reuse `workflowSessionId`: `maestro-[entity]`.
2. Load shared references:
   - `references/maestro.md` as the index before choosing focused Maestro references.
   - `references/maestro/fact-ledger.md` before making any Maestro claim; tag facts as `official-doc`, `live-help`, `repo-convention`, or `excluded/unverified`.
   - `references/maestro/cli-device.md` before CLI checks, device/platform readiness, or local execution planning.
   - `references/maestro/yaml-commands.md` before writing unfamiliar YAML commands, flow headers, AI commands, or command examples.
   - `references/maestro/selectors.md` before choosing or changing selectors.
   - `references/maestro/workspace-execution.md` before flow discovery, tags, execution ordering, sharding, or workspace config changes.
   - `references/maestro/config-env-output.md` before editing flow header env/properties or CLI output/report flags.
   - `references/maestro/js-scripting.md` before adding `evalScript`, `runScript`, `output`, `faker`, or JavaScript logs.
   - `references/maestro/artifacts-reports.md` before report, artifact, debug-output, screenshot, video, recording, or AI report claims.
   - `references/maestro/cloud.md` only when Cloud execution, app binary upload/reuse, Cloud devices, or Cloud auth is in scope.
   - `references/maestro/mcp.md` only when Maestro MCP or Maestro Viewer is in scope.
   - `references/maestro/patterns.md` before designing flow segmentation, setup/teardown, validation assets, or closure output.
   - `references/mobile-context.md` for platform scope, parity, device assumptions, and mobile verification sensors.
   - `references/codebase-investigation.md` before unfamiliar app, test, fixture, or CI source inspection.
   - `references/verification-ladder.md` before non-trivial edits.
   - `references/context-firewall.md` before inspecting large logs, generated reports, screenshots, videos, or broad flow output.
   - `references/naming-standards.md` before naming flows, subflows, fixtures, tags, selectors, or test data.
3. Run the mandatory Maestro CLI transcript gate from `references/maestro/cli-device.md` and `references/maestro/fact-ledger.md`: `command -v maestro`, `maestro --version` or `maestro --help`, and relevant subcommand help with command, exit code, stdout, and stderr. If missing or failing, block mutation and report install guidance.
4. Resolve scenario input order:
   - Jira/Confluence via Atlassian MCP.
   - Attached/local file.
   - Prompt text.
   - Inferred scenarios.
   If inference is used, warn the user and run `workflows/exploration.md` to ground expected behavior before writing flows.
5. Discover existing Maestro structure using `references/maestro/workspace-execution.md`; follow existing repo structure, naming, tags, setup, teardown, fixtures, and artifact paths. If no Maestro workspace exists, ask for the target test root before creating one.
6. Build the mobile context packet:
   - Platform scope, app/build context, device/emulator assumptions, runtime state, feature flags, account/test data, locale/timezone, and parity target.
   - Required setup, teardown, data isolation, and cleanup.
   - Expected behavior and the deterministic sensor that proves it.
7. Design the flow set using `references/maestro/patterns.md`:
   - Keep flows readable and segmented by suite intent.
   - Reuse existing subflows for login, onboarding, permissions, navigation, setup, and teardown.
   - Prefer stable selectors, accessibility labels, test IDs, and observable states over text that changes often, coordinates, images, or fixed delays.
   - Use deep links, API/fixture setup, and app state reset to avoid long UI-only preparation.
8. Edit only Maestro flows, subflows, fixtures, setup/teardown, test data, and directly required docs/CI wiring for the new flow. If implementation requires product hooks, selectors, app code, or backend behavior changes, stop and route that work through the appropriate parent workflow.
9. Verify with the strongest available deterministic command:
   - Prefer repository-specific Maestro test commands.
   - Otherwise run `maestro test --format junit --output <report.xml> --test-output-dir <artifact-dir> <flow-or-directory>`.
   - If device/app/backend access is unavailable, run static YAML, path, selector, or CI configuration checks and mark runtime verification blocked, deferred, or skipped with an allowed reason.
10. Produce a closure summary with scenario source, changed flows/subflows/fixtures/setup/teardown, command, exit status, JUnit path, artifact dir, device/platform/app build, skipped reason, highest Verification Ladder level reached, validation assets protected, memory outcome, and residual risk.
11. Persist only durable Maestro conventions, selector/test-ID policy, fixture/setup recipes, device matrix constraints, or reusable verification recipes after scoring with the Importance Calibration System. Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:maestro`, `entity:<entity>`, and one `memory:<tier>` tag.
12. Complete the Evidence Gate from `references/evidence-gate.md`.

## Examples

User asks: "Add Maestro coverage for the Jira checkout coupon scenario."

1. Resolve the Jira source through Atlassian MCP, run the Maestro CLI preflight, and discover the existing flow root.
2. Create or update the smallest flow/subflow set that covers the coupon journey.
3. Run the focused Maestro command with JUnit report and artifact output, or record the blocked runtime dependency.

User asks: "Create a Maestro login smoke test from this YAML scenario file."

1. Read the local scenario file, map setup/teardown and expected states, and reuse existing login fixtures/subflows.
2. Add the flow under the existing smoke suite.
3. Verify with the repository's Maestro smoke command.

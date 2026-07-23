# Maestro Workflow Patterns

Use this for stable suite design, setup/teardown strategy, validation assets, and workflow output contracts.

## Stable Flow Design

- Keep flows readable, short, and scoped to one user journey or smoke path.
- Reuse subflows for login, onboarding, permissions, setup, teardown, and navigation.
- Prefer deep links, API fixtures, or app state reset over long UI-only setup when the repo already supports them.
- Prefer stable selectors and observable states over fixed waits, coordinates, images, and copy that changes often.
- Keep setup and teardown explicit, idempotent, and isolated.
- Preserve existing flows, subflows, fixtures, snapshots, baselines, and CI report consumers unless the scoped task explicitly changes them.

## Suite Segmentation

Common suite intents:

- smoke
- critical path
- release-blocking
- nightly
- platform-specific
- quarantined
- device-farm-only
- Cloud-only

Use tags and config rather than duplicate flow logic when possible.

## Setup And Cleanup

Use the smallest deterministic setup:

1. reset app state (`clearState`, launch options, fixture cleanup)
2. set permissions and locale/timezone assumptions
3. create test data through repo-approved fixture/API helpers
4. navigate by deep link or reusable subflow
5. verify initial state before exercising the journey
6. clean up in `onFlowComplete` or explicit teardown

If cleanup cannot be guaranteed, isolate test data and record residual risk.

## Output Contracts

`maestro` closure summary must include:

- scenario source
- changed flows/subflows/fixtures/setup/teardown
- setup/teardown strategy
- command
- exit status
- JUnit report path
- artifact directory
- device/platform/app build
- skipped reason
- validation assets protected
- residual risk

`maestro-audit` report must include:

- flow inventory
- scenario source matrix
- Maestro run matrix
- artifact evidence
- `MST-*` findings or explicit no-finding evidence
- execution handoff

`maestro-fix` closure matrix must include:

- selected `MST-*` IDs
- status: `fixed`, `blocked`, `deferred`, or `skipped`
- changed files
- command/artifact evidence
- skipped reason or `none`
- JUnit/artifact paths
- validation assets protected
- residual risk

## Routing Boundaries

- Product bugs, missing test IDs, app architecture changes, backend data setup changes, or unclear requirements route to parent workflows.
- `maestro-fix` may edit only Maestro flows, subflows, fixtures, setup/teardown, test data, or directly scoped Maestro CI/report wiring from a saved `MST-*` finding.
- Passing Maestro flows do not prove full requirements coverage. Pair run evidence with scenario-source coverage when making all-clear claims.

## Skipped Checks

Allowed skipped/blocker reasons include:

- Maestro CLI unavailable or cannot start
- app binary/build unavailable
- device/emulator/simulator unavailable
- credentials/signing/backend unavailable
- Cloud auth/plan unavailable
- target report is stale or invalid
- official docs or live help do not support requested flag/command

Always state the strongest evidence still collected, such as static YAML validation, path inspection, config scan, or report artifact inspection.

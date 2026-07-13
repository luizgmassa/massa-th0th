# Web UI Asset Resolution — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/web-ui-to-visually-streamed-blossom.md` — fix
for CSS and JavaScript asset resolution at the no-trailing-slash `/ui` entry
URL.

## Intent and scope

The plan attributes a non-interactive, unstyled `/ui` page to relative
`styles.css` and `app.js` references: browser resolution from `/ui` requests
`/styles.css` and `/app.js` instead of assets mounted at `/ui/*`. It recommends
changing those two references to absolute `/ui/*` paths and pinning them in the
existing serve test. It explicitly leaves a root redirect out of scope.

## Implemented outcome

Verified commit evidence shows `index.html` now references
`/ui/styles.css` and `/ui/app.js`. The serve test asserts both exact paths.
The same commit also changed the HTML shell and SPA fallback to return Buffers,
preserving `text/html` on the Node adapter's real socket path, and added
real-wire regression tests for that behavior.

## Commit evidence

### Direct plan implementation and related delivery fix

- `767892cb712a934b681770edbf90bbf07c982069` — `fix(web-ui): serve /ui as HTML and fix asset resolution`
  - Changes both planned asset references and adds exact `/ui/*` assertions to
    `web-ui-serve.test.ts`.
  - Also adds Buffer-based HTML responses and real-node-adapter tests for the
    separately reported `text/plain` wire behavior.

### Enabling Web UI delivery

- `71f0727e8bd126959c8b9b0b9c4b250dbe8a8af2` — `feat(web-ui): scaffold apps/web-ui + serve static via tools-api (8a)`
- `46c2995185e9d3940628d069c90e53be13a69c6c` — `feat(web-ui): api client + 5 read-only views + markdown + dark mode (8b)`
- `58a1d5e9e5add0cc9883e4d29c7f9279703d7f81` — `test(web-ui): serve + 5 views + markdown + dark mode + read-only (8d)`
- `55e5c005feffa8d96d8095d0318b3dd72013aec5` — `fix(web-ui): robust static-dir resolution across test-runner cwds`

## Spec/acceptance facts now worth preserving

- R8-SERVE-01 requires the UI shell at its configured prefix to return HTML
  and its CSS/JS assets to return 200 with correct content types.
- The Web UI is served by Tools API under `/ui` and remains read-only; it uses
  existing REST read routes rather than new core logic.
- Exact absolute references are a regression contract for opening `/ui`
  without a trailing slash.

## Deviations or unresolved gaps

- The two requested reference changes and test assertions are present.
- Implementation was broader than the plan's proposed two-line HTML change:
  it included the related Buffer/content-type correction and real-wire tests.
- This record did not rerun the plan's dev-server, curl, unit-test, or browser
  verification matrix; only permitted documentation checks were run.
- No evidence in the inspected implementation adds the optional `GET /` to
  `/ui` redirect.

## Cross-references existing specs

- [Phase 8 Web UI spec](../../phase-8-web-ui/spec.md) — R8-SERVE-01 and
  read-only UI boundary.
- [Phase 8 Web UI tasks](../../phase-8-web-ui/tasks.md) — static route,
  asset-serving, and serve-test design.

## Verification evidence

- Read the source plan and focused commit history/patches inside
  `c1d37b8120025a69e2de0e5fd054ca8177e205de..81d33606fb6826e1759a073006b165419d0e3ba4`.
- Confirmed `767892c` changes the two references from relative URLs to exact
  `/ui/*` paths and adds the specified expectations.
- Documentation checks: output file is non-empty and `git diff --check` was
  run after the edit.

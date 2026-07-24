# Phase 8 — Web UI [G5] (tasks)

Atomic, one commit per task. Conventional Commits. Gate (`bun run test` +
`bun run type-check`) must pass before each task's commit.

## Task 1 — Scaffold `apps/web-ui` package + Tools API static route

**Files:**
- `apps/web-ui/package.json` — `@massa-ai/web-ui`, private, zero deps, script
  `type-check` (`tsc --noEmit` on an empty-ish tsconfig — or skip tsconfig and
  rely on the JS being type-checked via the API's reference; simplest: a
  tsconfig that includes `src/**/*.ts` only, and we keep app logic in `.js` so
  nothing to type-check → `type-check` is a no-op `tsc --noEmit` with no inputs).
- `apps/web-ui/tsconfig.json` — standalone, `noEmit`, includes nothing strict
  (vanilla JS bundle).
- `apps/web-ui/src/static/index.html` — app shell: `<nav>` (5 view links +
  project selector + theme toggle), `<main id="app">`, inline no-FOUC theme
  `<script>` in `<head>`, `<link rel="stylesheet" href="styles.css">`,
  `<script type="module" src="app.js" defer>`.
- `apps/web-ui/README.md` — launch instructions.
- `apps/tools-api/src/routes/web-ui.ts` — Elysia route serving `/ui/*` from the
  static root; content-type map; traversal guard; `index.html` fallback; 404 when
  `webUi.enabled=false` (local default-true read).
- `apps/tools-api/src/index.ts` — import + `.use(webUiRoutes)` after
  `.use(proposalRoutes)`; add `webUi` swagger tag.
- Root `package.json` workspaces already includes `apps/*` (confirmed).

**Gate:** type-check clean (no new TS errors); `GET /ui/` smoke (asserted in the
test task). Commit: `feat(web-ui): scaffold apps/web-ui + serve static via tools-api (8a)`.

## Task 2 — API client + views (project list, memory browser, search, handoff, checkpoint)

**Files:**
- `apps/web-ui/src/static/app.js` — exports (for testing) + wires the app:
  - `api(path, { method, body })` — fetch wrapper; reads `MASSA_AI_API_BASE` from
    `window.__MASSA_AI_API_BASE__` or `""` (same-origin); injectable for tests.
  - View renderers (pure `({ data, state }) => string`): `renderProjects`,
    `renderMemoryBrowser`, `renderSearch`, `renderHandoffs`, `renderCheckpoints`.
  - `markdownToHtml(md)` — minimal renderer (headings/bold/italic/lists/links/
    fenced code/paragraphs) with HTML-escape.
  - `toggleTheme()` + `initTheme()` — `data-theme` + `localStorage`.
  - Hash router (`#/projects`, `#/memory`, `#/search`, `#/handoffs`, `#/checkpoints`).
- `apps/web-ui/src/static/styles.css` — variables, `[data-theme="dark"]`,
  per-view tables/cards, nav, theme toggle.

**Behavior:** each view fetches its route, renders rows, handles empty/error
states. Memory browser has type/level/minImportance controls + pagination.
Search has a query input. Handoff/checkpoint require a selected project (from the
nav selector). Read-only: no mutating controls anywhere.

**Gate:** type-check clean. Commit:
`feat(web-ui): api client + 5 read-only views + markdown + dark mode (8b)`.

## Task 3 — Additive `level` filter on `/api/v1/memory/list`

**Files:**
- `apps/tools-api/src/routes/memory.ts` — add optional `level` body field
  (`t.Optional(t.Number())`); in the SQLite branch add `if (body.level)
  { conditions.push("level = ?"); params.push(body.level); }`; PG branch maps it
  to the existing `search`-based path (level filter applied client-side there or
  via an additional condition — kept minimal, mirrors `type`). Update the body
  schema + detail description.

**No core change** — `MemoryRepository` already selects `level`; this is a route
read condition only. No migration.

**Gate:** `bun run test` (no regression; the existing memory-list tests stay
green — `level` is optional). type-check clean. Commit:
`feat(tools-api): add level filter to /memory/list (read-only) (8c)`.

## Task 4 — Tests (serve, views, markdown, dark mode, read-only)

**Approach (final, no duplication, zero browser build):** `app.js` is the single
source of the pure helpers (`markdownToHtml`, the five renderers, theme helpers).
It is written so the browser-init code is guarded by a `typeof window !==
"undefined"` check and the helpers are attached to `globalThis` (or exported).
Tests `await import(...)` the `app.js` file directly — bun runs JS natively, no
DOM needed for the pure helpers. The serve route is tested by invoking the
Elysia route handler directly (or via the app's `handle`/fetch) with injected
file reads.

**Files:**
- `apps/tools-api/src/__tests__/web-ui-serve.test.ts`

**Tests:**
- `web-ui-serve.test.ts` — `GET /ui/` 200 + `<div id="app">`; `/ui/styles.css`
  200 + `text/css`; `/ui/app.js` 200 + JS content-type; `/ui/missing` →
  `index.html` fallback (200 + `<div id="app">`); `WEB_UI_ENABLED=false` → 404.
- `web-ui-views.test.ts` — import renderers from `app.js`; for each view, pass a
  deterministic fixture (matching the verified response shape) and assert the
  returned HTML string contains the fixture's key fields. Covers all 5 views +
  empty + error states.
- `web-ui-render.test.ts` — `markdownToHtml` fixture (heading/bold/list/fenced
  code/link/inline-code) → assert HTML structure; HTML-escape (raw `<script>`
  in input does not appear as a live tag). `toggleTheme`/`initTheme` — simulate
  by calling with a fake `localStorage` + `documentElement`.
- `web-ui-readonly.test.ts` — read `app.js` source; assert none of the mutating
  path strings appear; assert `index.html` source has no mutating control.

**Test location:** `apps/tools-api/src/__tests__/`. The turbo `test` task runs
per-package; tools-api currently has no test script — add `"test": "bun test"`
to `apps/tools-api/package.json` so `bun run test` (turbo) picks it up.

**Gate:** `bun run test` green (893 baseline + new tests, 0 regressions);
type-check clean. Commit: `test(web-ui): serve + 5 views + markdown + dark mode + read-only (8d)`.

## Task 5 — Validation + ledger + STATE/FEATURES/HANDOFF

- Run discrimination sensor (inject `/memory/store` into a copy of `app.js` in
  scratch → R8-READONLY-01 scan fails → revert).
- Write `.specs/features/phase-8-web-ui/validation.md`.
- Append Phase-8 delta to `.specs/PHASE-INTEGRATION.md` + commit-ledger row.
- Update `.specs/project/STATE.md`, `.specs/project/FEATURES.json` (phase-8 row),
  `.specs/HANDOFF.md`.

Commit: `docs(specs): phase-8 validation + STATE/FEATURES/HANDOFF/integration-ledger updates`.

## Gate check commands

```
bun run test          # expect ≥893 pass / 0 fail / 46 skip (no regressions)
bun run type-check    # 5/5 clean (apps/web-ui adds a 6th task — confirm)
```

## Test coverage matrix

| AC | Test file:block |
| --- | --- |
| R8-SERVE-01 | web-ui-serve.test.ts (root + asset + fallback + disabled) |
| R8-VIEW-PROJECTS-01 | web-ui-views.test.ts (projects render + empty) |
| R8-VIEW-MEMORY-01 | web-ui-views.test.ts (memory render + filters + pagination) |
| R8-VIEW-SEARCH-01 | web-ui-views.test.ts (search render + empty query) |
| R8-VIEW-HANDOFF-01 | web-ui-views.test.ts (handoff render + no-project prompt) |
| R8-VIEW-CHECKPOINT-01 | web-ui-views.test.ts (checkpoint render) |
| R8-RENDER-01 | web-ui-render.test.ts (markdown + escape + theme toggle) |
| R8-READONLY-01 | web-ui-readonly.test.ts (path scan + no mutating control) |

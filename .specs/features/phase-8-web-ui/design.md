# Phase 8 — Web UI [G5] (design)

Slug: `phase-8-web-ui`. Companion to `spec.md`. Covers serve strategy, view→API
mapping, rendering/dark-mode approach, dependency choices, and why no new core
logic is introduced.

## Serve strategy: Tools API (Elysia) static prefix — chosen

**Decision:** serve the `apps/web-ui/` static bundle from the existing Tools API
via a new Elysia route that reads assets from disk and returns them with correct
content-types. Single deployment, single port (`MASSA_TH0TH_API_PORT`, default 3333),
no new process. URL: `http://localhost:3333/ui/` (prefix chosen to never collide
with `/api/v1/*`, `/health`, `/swagger`).

**Why not standalone static server:**
- A second process doubles operational surface (port management, CORS, API-key
  propagation) for a read-only browser.
- The Tools API already has `cors()` + the REST surfaces the UI consumes; serving
  the UI from the same origin avoids CORS entirely for same-host use.
- The UI is read-only and dependency-free; there is no build step that would
  benefit from a separate static host (e.g. Vite).
- A standalone server can still be used by pointing any static file server at
  `apps/web-ui/src/static/` and setting `MASSA_TH0TH_API_BASE` — the bundle is
  origin-agnostic (configurable API base).

**Static serving mechanism:** Elysia does not ship a static plugin in this repo
(`@elysiajs/static` is not installed and the project stays dependency-light).
Implementation: a single Elysia route registered in `apps/tools-api/src/index.ts`
that maps `/ui/*` to files under `apps/web-ui/src/static/`, reads the file with
`fs/promises`, and returns it with a content-type derived from the extension
(`.html`→`text/html`, `.css`→`text/css`, `.js`→text/javascript, `.svg`→image/svg+xml).
Path traversal is guarded by resolving against the static root and rejecting
paths that escape it (mirrors the existing `upload-and-index` traversal guard).
A catch-all serves `index.html` for unknown paths under `/ui/` (SPA-style
fallback not required — it's a single page — but harmless).

**Asset location:** `apps/web-ui/src/static/{index.html, styles.css, app.js}`.
The Tools API resolves the static root relative to its own `src/` directory
(`../../web-ui/src/static` in source; for the bundled `dist` build, the path is
resolved via `import.meta.url`/`process.cwd()` fallback so both `bun src/index.ts`
and `bun run start` work). To avoid bundler complexity, the static root is
computed at runtime: `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web-ui/src/static')`
with a `process.cwd()/apps/web-ui/src/static` fallback.

**Config:** `webUi.enabled` (default `true`, env `WEB_UI_ENABLED`); when false,
`/ui/*` returns 404. No new core config block — lives in the Tools API layer only
(reads `config.get("webUi")` defensively with a local default, mirroring how
`handoffs`/`hooks` routes gate locally without core changes).

## View → API mapping (all read-only, all pre-existing routes)

| View | Method + Route | Body/Params | Read surface (core) |
| --- | --- | --- | --- |
| Project list | `GET /api/v1/project/list` | — | `VectorStore.listProjects()` (Phase 0) |
| Memory browser | `POST /api/v1/memory/list` | `{ type?, level?, minImportance?, limit, offset }` | `MemoryRepository` raw SQL list (Phase 0/1) |
| Search | `POST /api/v1/memory/search` | `{ query, projectId?, types?, limit?, minImportance? }` | `SearchMemoriesTool` → FTS5 + semantic (Phase 0/2) |
| Handoff list | `POST /api/v1/handoff/list` | `{ projectId, targetAgent? }` | `HandoffService.listPending` (Phase 6) |
| Checkpoint list | `POST /api/v1/checkpoints/list` | `{ projectId?, taskId?, checkpointType?, limit? }` | `ListCheckpointsTool` (Phase 0d) |

**New read-only route: NONE required** for the 5 core views. The existing
`/api/v1/memory/list` already supports `type` + `minImportance`; **`level` is not
yet a filter on that route**. To satisfy R8-VIEW-MEMORY-01 (level filter) without
new core logic, the route gains a thin additive `level` filter (one SQL
condition, mirrors the existing `type` filter). This is a read-only route
enhancement, not new core logic — the `MemoryRepository` already selects `level`;
no service/repository signature changes. (If minimizing route churn is
preferred, the UI can client-side-filter `level` from the returned rows; the
route enhancement is chosen because it keeps the filter server-side and
pagination correct. Documented as an accepted tradeoff.)

**Response shapes consumed (verified from source this session):**
- `GET /project/list` → `{ success, data: { projects: ProjectInfo[], total } }`.
- `POST /memory/list` → `{ success, data: { memories: FormattedRow[], total, limit, offset } }`
  where `FormattedRow = { id, content, type, level, agentId, importance, tags, score, createdAt, accessCount }`.
- `POST /memory/search` → `SearchMemoriesTool.handle` output (`success` + results
  in `toon` or `json` format; the UI requests `format:"json"` and reads
  `data.results`).
- `POST /handoff/list` → `{ success, data: { pending: HandoffRecord[], count } }`.
- `POST /checkpoints/list` → `ListCheckpointsTool.handle` output.

## Markdown rendering + dark mode (dependency-free)

**Markdown:** no `marked`/`markdown-it` installed and the plan keeps the UI
dependency-light. A **minimal vanilla renderer** in `app.js` handles the subset
that appears in memory content:
- ATX headings `#`→`<h1>`…`######`→`<h6>`.
- Bold `**x**`, italics `*x*`, inline code `` `x` ``.
- Unordered lists `- `/`*` and ordered lists `1.`.
- Fenced code blocks ```` ```lang ```` → `<pre><code>` (language class optional;
  no highlighting library — monospace + a subtle background suffice for a memory
  browser).
- Paragraphs / blank-line separation.
- Links `[t](u)` (rendered with `rel="noopener noreferrer" target="_blank"`).
HTML-escaping is applied to raw text first (XSS hardening — memory content is
trusted-ish but the UI must not inject unescaped HTML). This is ~80 lines, well
within scope, and covers real memory content (decisions, patterns, code
snippets).

**Dark mode:** a toggle button sets `document.documentElement.dataset.theme` to
`"dark"` or `"light"`; the choice is read from `localStorage["massa-th0th-ui-theme"]`
on load (default `"light"` when absent — no FOUC because the attribute is set by
a tiny inline `<script>` in `<head>` before the stylesheet applies). CSS uses
`[data-theme="dark"]` selectors overriding CSS variables.

## Dependency choices (justification)

- **No framework** (React/Vue/Svelte): not installed; a 5-view read-only browser
  is trivially vanilla. Keeps `apps/web-ui` zero-dependency.
- **No markdown library:** minimal subset renderer (above) — avoids a new dep.
- **No syntax highlighter:** code fences render as styled `<pre><code>`. A future
  enhancement can lazy-load highlight.js from a CDN; out of scope for v1.
- **No CSS framework:** a single hand-written `styles.css` (~200 lines) using CSS
  variables + a system-font stack. Keeps the bundle tiny.
- **Elysia static route over `@elysiajs/static`:** the plugin isn't installed;
  adding it would introduce a dependency for ~30 lines of file-serving code. The
  inline route is simpler and matches the repo's existing route style.

## Why no new core logic

- Every view consumes an **already-exposed** REST read surface (Phase 0/0d/6
  routes + `project/list`).
- The single additive change (`level` filter on `/memory/list`) is a read-only
  route condition mirroring the existing `type`/`minImportance` conditions — no
  service/repository signature change, no migration, no new store.
- No new EventBus events, no new tables, no new services, no migrations.
- Backend-polymorphic dispatch is untouched (the routes already use
  `getMemoryRepository()` etc.).

## Package layout

```
apps/web-ui/
  package.json          # name @massa-th0th/web-ui, private, no deps, scripts: type-check
  tsconfig.json         # standalone, no project refs (vanilla JS consumed)
  src/
    static/
      index.html        # app shell + nav + inline no-FOUC theme script
      styles.css        # variables + [data-theme=dark] + per-view styles
      app.js            # router (hash-based), view renderers, markdown, api client
  README.md             # how to launch (bun run dev:api → http://localhost:3333/ui/)
```

The Tools API wires the static route (`apps/tools-api/src/routes/web-ui.ts`) and
registers it in `index.ts` after `proposalRoutes`. A new `webUi` swagger tag is
added.

## Test approach (spec-anchored, not impl-mirroring)

- **R8-SERVE-01:** boot the Tools API Elysia app in-process (or use a fetch
  against the static file) — assert `GET /ui/` is 200 + `text/html` + contains
  `<div id="app">`; assert `/ui/app.js` is 200 + JS content-type.
- **Per-view:** each view test (a) primes a deterministic REST fixture (either by
  hitting the real route with an injected fake tool/store via the existing
  ctor-seam pattern, or by asserting the view's render function transforms a
  fixed response shape into the expected DOM) and (b) asserts the rendered DOM
  contains the fixture's data. View render functions are exported as pure
  `(data) => htmlString` from `app.js`-equivalent module so they are unit-testable
  without a DOM. The fetch wrapper is injectable (dependency injection of the API
  client) so tests don't need network.
- **R8-RENDER-01:** unit-test the markdown renderer (`markdownToHtml(input)`)
  with a fixture containing heading/bold/list/fenced-code; assert the output
  HTML structure. Assert `toggleTheme` flips the attribute + writes
  `localStorage`.
- **R8-READONLY-01:** static scan — read `app.js` source and assert none of the
  mutating-path strings (`/memory/store`, `/delete`, `/update`, `/handoff/begin`,
  `/accept`, `/cancel`, `/checkpoint/create`, `/checkpoint/restore`,
  `/proposal/approve`, `/proposal/reject`, `/project/reset`, `/hook`) appear as
  fetch targets. Plus assert `index.html` contains no `type="submit"` form and no
  element with a `data-action` mutating attribute.

## Discrimination sensor (planned)

Mutant: add a mutating fetch (e.g. `/memory/store`) to the API client. Killing
test: R8-READONLY-01 static scan fails (the path string appears). Reverted before
commit.

## Risks / accepted assumptions

- **Accepted:** minimal markdown renderer is not spec-complete (tables, nested
  lists, raw HTML). Real memory content is LLM/agent-generated prose + code
  fences — the subset covers it; edge cases degrade gracefully (raw text shown).
- **Accepted:** no live updates (refresh to see new data) — v1 is static; EventBus
  SSE is a future enhancement (Phase-7 integration notes explicitly allow this).
- **Accepted:** `level` filter added to `/memory/list` is the only route change —
  kept additive + read-only, no core change.
- **Risk S:** static-route content-type mapping must cover the 3 asset types;
  covered by R8-SERVE-01 sub-AC.
- **Risk S:** the static-root path resolution differs between `bun src/index.ts`
  (source) and `bun run start` (dist) — resolved via `import.meta.url` + cwd
  fallback, covered by a serve test.

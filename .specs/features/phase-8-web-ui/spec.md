# Phase 8 — Web UI [G5] (spec)

Slug: `phase-8-web-ui`. Workflow: `spec-driven` (TLC v3). Branch: `main`.
Plan ref: `i-want-to-understand-virtual-lantern.md` § "Phase 8 — Web UI [G5]" +
cross-cutting decisions §1–5. Final phase of the 0→8 plan.

## Goal

A **read-only** HTML browser over the SQLite-canonical memories + FTS5 search +
handoffs + checkpoints + indexed projects. No new core logic; consumes existing
REST read surfaces already exposed by `apps/tools-api`. Vanilla HTML/CSS/JS only
(no SPA framework, no markdown/highlight dependency — none installed; see
`design.md`).

## In scope

1. `apps/web-ui/` package: static HTML + CSS + JS bundle served by the existing
   Tools API (Elysia) on a dedicated prefix — single deployment, single port.
2. Five views (all read-only):
   - **Project list** — indexed projects.
   - **Memory browser** — list memories, filter by type / level / importance.
   - **Search interface** — FTS5 memory search.
   - **Handoff list** — pending (open) handoffs.
   - **Checkpoint list** — saved checkpoints.
3. Markdown rendering (minimal, vanilla) + dark-mode toggle (persisted in
   `localStorage`). No syntax-highlight library — fenced code blocks rendered as
   `<pre><code>` with monospace styling (sufficient for a memory browser).
4. Tests: the bundle is served (HTTP 200 root); each view renders against a
   deterministic fixture via the underlying REST read surfaces; read-only
   assertion (no mutating action reachable from the UI).

## Requirement IDs + acceptance criteria

### R8-SERVE-01 — UI is served by the Tools API
- **AC:** `GET /` (or the configured UI prefix root) returns HTTP 200 with
  `text/html` and a body containing the app shell element `id="app"` (the
  mount target, `<main id="app">`).
- **AC:** The static assets (CSS, JS) under the UI prefix return 200 with the
  correct content-type.

### R8-VIEW-PROJECTS-01 — Project list view
- **AC:** The view calls `GET /api/v1/project/list` and renders one row per
  project from `data.projects[]`, including `projectId` and document count when
  present.
- **AC:** Empty list → renders an explicit "no projects" state (not a blank).

### R8-VIEW-MEMORY-01 — Memory browser view (filters)
- **AC:** The view calls `POST /api/v1/memory/list` and renders memory rows from
  `data.memories[]` with `id`, `type`, `level`, `importance`, `content` (truncated).
- **AC:** Filter controls for **type** (critical/conversation/code/decision/pattern),
  **level** (numeric), and **minImportance** (0–1) are present and are reflected
  in the request body.
- **AC:** Paginates via `limit`/`offset` and shows `total`.

### R8-VIEW-SEARCH-01 — FTS search view
- **AC:** The view calls `POST /api/v1/memory/search` with the query and renders
  results from the response (`data.results[]` / toon-formatted — the test asserts
  against a deterministic fixture response shape).
- **AC:** Empty/whitespace query does not fire a request (client guard) OR the
  server returns an empty result set without error.

### R8-VIEW-HANDOFF-01 — Handoff list view
- **AC:** The view calls `POST /api/v1/handoff/list` with `projectId` and renders
  pending handoffs from `data.pending[]` with `id`, `targetAgent`, `summary`, `status`.
- **AC:** Missing `projectId` (no project selected) → renders a "select a project"
  prompt instead of firing the request.

### R8-VIEW-CHECKPOINT-01 — Checkpoint list view
- **AC:** The view calls `POST /api/v1/checkpoints/list` (optionally filtered by
  `projectId`) and renders checkpoints from the response with `taskId`,
  `description`, `status`, `checkpointType`.

### R8-RENDER-01 — Markdown rendering + dark mode
- **AC:** A memory content string containing markdown (headings, bold, lists,
  fenced code) is rendered as structured HTML (not raw markdown). Fenced code
  becomes `<pre><code>`.
- **AC:** A dark-mode toggle switches a `data-theme="dark"` attribute on
  `<html>` and the choice persists across reloads via `localStorage`.

### R8-READONLY-01 — Read-only guarantee
- **AC:** The UI bundle contains **no** call to a mutating endpoint
  (`/memory/store`, `/memory/update`, `/memory/delete`, `/handoff/begin`,
  `/handoff/accept`, `/handoff/cancel`, `/checkpoint/create`, `/checkpoint/restore`,
  `/proposal/approve`, `/proposal/reject`, `/project/reset`, `/hook`).
  Verified by a static scan of the JS bundle in the test suite.
- **AC:** No mutating control (create/edit/delete/approve/reject button) is
  present in the HTML.

## Edge cases

- API returns `{ success: false, error }` → view renders the error message, not a
  crash.
- API unreachable (network) → view renders a connection-error state.
- `projectId`-scoped views (handoff) with no project selected → prompt, no request.
- Empty result sets across all views → explicit empty state.
- Very long memory content → truncated in list, full (markdown-rendered) in a
  detail expansion.
- Dark-mode preference absent → defaults to light (no flash).

## Out of scope

- Wiki / git second store (rejected G4 — SQLite-canonical).
- Write/edit/delete/approve/reject UI (read-only by design).
- Live updates via EventBus SSE (a static/refresh UI is fine for v1; events are
  informational for a future live UI per Phase-7 integration notes).
- Symbol-graph / code-search views (the FTS5 *memory* search is the scope; code
  search is a separate existing surface).
- New core services, repositories, or migrations (NONE — consume existing REST).
- Authentication UI (the API key header is a deployment concern; the UI assumes
  local unauthenticated access, matching the existing swagger/health surfaces).

## Test-isolation notes (carry-forward)

- The UI tests assert against (a) the served bundle (HTTP) and (b) deterministic
  REST response fixtures — they do NOT touch the real `MemoryRepository`
  singleton (which is closed by `memory-crud.test.ts` in the full suite).
- No `mock.module("@massa-th0th/shared")` is added.
- A thin read-only route (if any) follows the existing route-test harness pattern
  (inject fakes / isolated temp DBs).

# th0th Web UI (read-only)

A dependency-free HTML browser over the th0th SQLite-canonical memories, FTS5
search, handoffs, checkpoints, and indexed projects. **Read-only** — no mutating
controls. Served by the Tools API.

## Launch

```bash
# from repo root
bun run dev:api        # or: bun run --filter @th0th-ai/tools-api dev
# then open:
#   http://localhost:3333/ui/
```

The Tools API serves the static bundle at `/ui/*` (configured in
`apps/tools-api/src/routes/web-ui.ts`). The UI talks to the same origin's
`/api/v1/*` REST surfaces.

To disable serving, set `WEB_UI_ENABLED=false` (the `/ui/*` routes then 404).

## Project selection

The project `<select>` in the top bar drives the project-scoped views (handoffs,
checkpoints, and the memory/search filters when a project is chosen). It is
populated from `GET /api/v1/project/list`.

## Read-only guarantee

The UI bundle contains no call to any mutating endpoint
(`/memory/store|update|delete`, `/handoff/{begin,accept,cancel}`,
`/checkpoint/{create,restore}`, `/proposal/{approve,reject}`, `/project/reset`,
`/hook`). This is enforced by a static-scan test
(`web-ui-readonly.test.ts`).

## Theme

Dark mode toggle persists in `localStorage["th0th-ui-theme"]` (default: light).

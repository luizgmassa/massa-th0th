# Web UI Asset Resolution Specification

Slug: `web-ui-asset-resolution`. Source: `web-ui-to-visually-streamed-blossom.md`.

## Requirements

- Opening `/ui` without a trailing slash loads exact absolute asset paths `/ui/styles.css` and `/ui/app.js`.
- Tools API serves the UI shell as HTML and static assets with their correct content types.
- Serve tests pin both asset paths; UI remains read-only and uses existing REST read routes.

## Out of Scope

Root-to-`/ui` redirect and a browser-level verification run.

## Verification Approach

Commit `767892c` supplies implementation evidence, including the related Buffer/content-type repair; current-session checks are documentation-only.

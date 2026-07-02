/**
 * @th0th-ai/web-ui — entrypoint module (type-check anchor).
 *
 * The actual browser bundle is the zero-build static set in `src/static/`
 * (`index.html`, `styles.css`, `app.js`), served verbatim by the Tools API at
 * `/ui/*` (see `apps/tools-api/src/routes/web-ui.ts`). Those files are plain
 * HTML/CSS/JS and are intentionally NOT type-checked here (allowJs + checkJs
 * false); this `.ts` file only exists so `tsc --noEmit` has a TS input to
 * target. No runtime code is exported from this package — it is a static asset
 * root, not an importable module.
 */

export const WEB_UI_PACKAGE_MARKER = "@th0th-ai/web-ui";

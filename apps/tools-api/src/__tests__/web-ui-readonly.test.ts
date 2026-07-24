/**
 * Phase 8 / Wave 7 — read-only guarantee (R8-READONLY-01) + discrimination sensor.
 *
 * The UI talks to the backend exclusively via the `api.request(path)` helper.
 * Read-only is enforced by asserting every request target is one of the known
 * READ paths, and that none of the FORBIDDEN_MUTATING_PATHS is ever a request
 * target. A separate check confirms index.html has no mutating control.
 *
 * Wave 7 T9 added a proposals view (`/api/v1/proposal/list`) as a 6th read path.
 * Wave 7 T9 also added gated write-mode handlers (PUT/DELETE
 * /api/v1/memory/<id>, POST /api/v1/proposal/<action>). These use dynamic
 * string concatenation (`"/api/v1/memory/" + id`), not literal `request("...")`,
 * so the static regex extracts only the literal prefix. We allow these
 * write-mode prefixes explicitly here; a separate test verifies the UI buttons
 * that trigger them are only rendered when `isWriteModeEnabled()` is true.
 *
 * Discrimination sensor: build a mutant that calls request("/memory/store")
 * and confirm the assertion catches it.
 */

import { describe, test, expect } from "bun:test";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ui = require("../../../web-ui/src/static/app.js") as {
  FORBIDDEN_MUTATING_PATHS: string[];
  isWriteModeEnabled: () => boolean;
  renderMemoryBrowser: (data: unknown, opts: unknown) => string;
  renderProposals: (data: unknown, opts: unknown) => string;
};

const STATIC_DIR = path.resolve(__dirname, "../../../web-ui/src/static");
const APP_JS = fs.readFileSync(path.join(STATIC_DIR, "app.js"), "utf-8");
const INDEX_HTML = fs.readFileSync(path.join(STATIC_DIR, "index.html"), "utf-8");

// 6 read-only endpoints. Wave 7 T9 added /api/v1/proposal/list for the
// proposals view.
const READ_PATHS = [
  "/api/v1/project/list",
  "/api/v1/memory/list",
  "/api/v1/memory/search",
  "/api/v1/handoff/list",
  "/api/v1/checkpoints/list",
  "/api/v1/proposal/list",
];

// Wave 7 T9 write-mode targets use dynamic concatenation, so the static regex
// below extracts only their literal prefix. These prefixes are allowed because
// the handlers that issue them are only reachable from buttons rendered under
// `isWriteModeEnabled()` (verified in a dedicated test).
const WRITE_MODE_PREFIXES = ["/api/v1/memory/", "/api/v1/proposal/"];

function isWriteModePrefix(t: string): boolean {
  return WRITE_MODE_PREFIXES.some((p) => t === p);
}

/** Extract every `request("...")` / `request('...')` first-arg string literal. */
function extractRequestTargets(src: string): string[] {
  const targets: string[] = [];
  const re = /request\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    targets.push(m[1]);
  }
  return targets;
}

describe("web-ui read-only guarantee (R8-READONLY-01)", () => {
  test("FORBIDDEN_MUTATING_PATHS list is non-empty + covers known mutating routes", () => {
    expect(ui.FORBIDDEN_MUTATING_PATHS.length).toBeGreaterThan(0);
    expect(ui.FORBIDDEN_MUTATING_PATHS).toContain("/memory/store");
    expect(ui.FORBIDDEN_MUTATING_PATHS).toContain("/handoff/begin");
    expect(ui.FORBIDDEN_MUTATING_PATHS).toContain("/proposal/approve");
    expect(ui.FORBIDDEN_MUTATING_PATHS).toContain("/project/reset");
    expect(ui.FORBIDDEN_MUTATING_PATHS).toContain("/hook");
  });

  test("every request() target in app.js is a known read path or a gated write-mode prefix", () => {
    const targets = extractRequestTargets(APP_JS);
    // 6 read paths + 2 write-mode prefixes (memory PUT/DELETE, proposal POST).
    expect(targets.length).toBeGreaterThanOrEqual(READ_PATHS.length);
    for (const t of targets) {
      expect(READ_PATHS.includes(t) || isWriteModePrefix(t)).toBe(true);
    }
  });

  test("no forbidden mutating path is a request() target", () => {
    const targets = extractRequestTargets(APP_JS);
    for (const t of targets) {
      for (const f of ui.FORBIDDEN_MUTATING_PATHS) {
        expect(t.endsWith(f)).toBe(false);
      }
    }
  });

  test("discrimination sensor — a mutant request('/memory/store') would be caught", () => {
    // Inject a mutating request target (the mutant).
    const mutant = APP_JS + '\napi.request("/memory/store", { method: "POST" });\n';
    const targets = extractRequestTargets(mutant);
    const caught = targets.some((t) =>
      ui.FORBIDDEN_MUTATING_PATHS.some((f) => t.endsWith(f)),
    );
    expect(caught).toBe(true);
    // And the real source is clean.
    const realTargets = extractRequestTargets(APP_JS);
    const realCaught = realTargets.some((t) =>
      ui.FORBIDDEN_MUTATING_PATHS.some((f) => t.endsWith(f)),
    );
    expect(realCaught).toBe(false);
  });

  test("write-mode buttons are only rendered when isWriteModeEnabled() is true", () => {
    const memData = {
      data: {
        memories: [{ id: "mem-1", type: "code", level: 1, importance: 0.8, content: "test" }],
        total: 1,
        limit: 50,
        offset: 0,
      },
    };
    const propData = {
      data: { proposals: [{ id: "prop-1", type: "edit", status: "pending", description: "test" }] },
    };

    // Write mode OFF: no edit/delete/approve/reject buttons.
    (globalThis as any).MASSA_AI_WEB_WRITE_MODE = undefined;
    expect(ui.isWriteModeEnabled()).toBe(false);
    expect(ui.renderMemoryBrowser(memData, { filters: {} })).not.toContain(
      'data-action="memory-edit"',
    );
    expect(ui.renderProposals(propData, { project: "p" })).not.toContain(
      'data-action="proposal-approve"',
    );

    // Write mode ON: buttons render (the write-mode request() handlers are
    // only reachable from these gated buttons).
    (globalThis as any).MASSA_AI_WEB_WRITE_MODE = true;
    expect(ui.isWriteModeEnabled()).toBe(true);
    expect(ui.renderMemoryBrowser(memData, { filters: {} })).toContain(
      'data-action="memory-edit"',
    );
    expect(ui.renderProposals(propData, { project: "p" })).toContain(
      'data-action="proposal-approve"',
    );

    delete (globalThis as any).MASSA_AI_WEB_WRITE_MODE;
  });

  test("index.html has no mutating control (no submit form / no type=submit)", () => {
    expect(INDEX_HTML).not.toContain('type="submit"');
    // Nav contains only the read-only view links.
    expect(INDEX_HTML).toContain("#/projects");
    expect(INDEX_HTML).toContain("#/memory");
    expect(INDEX_HTML).toContain("#/search");
    expect(INDEX_HTML).toContain("#/handoffs");
    expect(INDEX_HTML).toContain("#/checkpoints");
  });
});

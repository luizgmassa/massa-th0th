/**
 * Phase 8 — Web UI view tests (R8-VIEW-*-01).
 *
 * Imports the pure renderers from app.js (bun runs JS natively; the browser-init
 * block is guarded by `typeof document` so it is skipped under Node). Each view
 * is fed a deterministic fixture matching the verified REST response shape, and
 * the returned HTML string is asserted to contain the fixture's key fields.
 * Covers empty + error states. No real MemoryRepository / network is touched.
 */

import { describe, test, expect } from "bun:test";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ui = require("../../../web-ui/src/static/app.js") as {
  renderProjects: (d: unknown) => string;
  renderMemoryBrowser: (d: unknown, state?: unknown) => string;
  renderSearch: (d: unknown, state?: unknown) => string;
  renderHandoffs: (d: unknown, state?: unknown) => string;
  renderCheckpoints: (d: unknown) => string;
};

describe("web-ui views (R8-VIEW-*-01)", () => {
  test("R8-VIEW-PROJECTS-01: project list renders rows from data.projects", () => {
    const html = ui.renderProjects({
      projects: [
        { projectId: "massa-ai", documentCount: 42 },
        { projectId: "other", docCount: 7 },
      ],
    });
    expect(html).toContain("massa-ai");
    expect(html).toContain("42");
    expect(html).toContain("other");
    expect(html).toContain("7");
  });

  test("R8-VIEW-PROJECTS-01: empty project list → explicit empty state", () => {
    const html = ui.renderProjects({ projects: [] });
    expect(html).toContain("No indexed projects");
  });

  test("R8-VIEW-MEMORY-01: memory browser renders rows + filter controls", () => {
    const data = {
      success: true,
      data: {
        memories: [
          {
            id: "mem-1",
            type: "decision",
            level: 1,
            importance: 0.9,
            content: "Use PostgreSQL-canonical",
            tags: [],
          },
          {
            id: "mem-2",
            type: "pattern",
            level: 2,
            importance: 0.5,
            content: "factory dispatch",
            tags: [],
          },
        ],
        total: 2,
        limit: 50,
        offset: 0,
      },
    };
    const html = ui.renderMemoryBrowser(data, { filters: {} });
    expect(html).toContain("decision");
    expect(html).toContain("pattern");
    expect(html).toContain("Use PostgreSQL-canonical");
    expect(html).toContain("factory dispatch");
    // filter controls present
    expect(html).toContain('data-filter="type"');
    expect(html).toContain('data-filter="level"');
    expect(html).toContain('data-filter="minImportance"');
    // pagination reflects total
    expect(html).toContain("of 2");
  });

  test("R8-VIEW-MEMORY-01: filters state reflected in controls", () => {
    const data = { success: true, data: { memories: [], total: 0, limit: 50, offset: 0 } };
    const html = ui.renderMemoryBrowser(data, {
      filters: { type: "decision", level: 1, minImportance: 0.5 },
    });
    expect(html).toContain('value="decision" selected');
    expect(html).toContain('value="1" selected');
    expect(html).toContain('value="0.5"');
  });

  test("R8-VIEW-MEMORY-01: empty memories → empty state", () => {
    const html = ui.renderMemoryBrowser({
      success: true,
      data: { memories: [], total: 0, limit: 50, offset: 0 },
    });
    expect(html).toContain("No memories match");
  });

  test("R8-VIEW-MEMORY-01: error response → error block with message", () => {
    const html = ui.renderMemoryBrowser({ success: false, error: "boom" });
    expect(html).toContain("error");
    expect(html).toContain("boom");
  });

  test("R8-VIEW-SEARCH-01: search renders results from data.results", () => {
    const data = {
      success: true,
      data: {
        results: [
          { content: "auth middleware", score: 0.9 },
          { content: "session handling", score: 0.7 },
        ],
      },
    };
    const html = ui.renderSearch(data, { query: "auth" });
    expect(html).toContain("auth middleware");
    expect(html).toContain("session handling");
    expect(html).toContain("0.9");
  });

  test("R8-VIEW-SEARCH-01: empty query → prompt, no result list", () => {
    const html = ui.renderSearch(null, { query: "" });
    expect(html).toContain("Enter a query");
    expect(html).not.toContain("result-list");
  });

  test("R8-VIEW-SEARCH-01: empty results → empty state with query echoed", () => {
    const html = ui.renderSearch(
      { success: true, data: { results: [] } },
      { query: "rareterm" },
    );
    expect(html).toContain("No results");
    expect(html).toContain("rareterm");
  });

  test("R8-VIEW-HANDOFF-01: handoff list renders pending from data.pending", () => {
    const data = {
      success: true,
      data: {
        pending: [
          {
            id: "h-1",
            targetAgent: "implementer",
            summary: "finish phase 8",
            status: "open",
          },
        ],
        count: 1,
      },
    };
    const html = ui.renderHandoffs(data, { project: "massa-ai" });
    expect(html).toContain("implementer");
    expect(html).toContain("finish phase 8");
    expect(html).toContain("h-1");
    expect(html).toContain("open");
  });

  test("R8-VIEW-HANDOFF-01: no project selected → prompt, no request shape", () => {
    const html = ui.renderHandoffs(null, { project: "" });
    expect(html).toContain("Select a project");
  });

  test("R8-VIEW-HANDOFF-01: empty pending → empty state", () => {
    const html = ui.renderHandoffs(
      { success: true, data: { pending: [], count: 0 } },
      { project: "massa-ai" },
    );
    expect(html).toContain("No pending handoffs");
  });

  test("R8-VIEW-CHECKPOINT-01: checkpoint list renders rows", () => {
    const data = {
      success: true,
      data: {
        checkpoints: [
          {
            taskId: "task-1",
            description: "scaffold web-ui",
            status: "completed",
            checkpointType: "manual",
          },
        ],
      },
    };
    const html = ui.renderCheckpoints(data);
    expect(html).toContain("task-1");
    expect(html).toContain("scaffold web-ui");
    expect(html).toContain("completed");
    expect(html).toContain("manual");
  });

  test("R8-VIEW-CHECKPOINT-01: empty checkpoints → empty state", () => {
    const html = ui.renderCheckpoints({ success: true, data: { checkpoints: [] } });
    expect(html).toContain("No checkpoints");
  });
});

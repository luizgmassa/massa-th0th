/**
 * Compaction Snapshot + Event Taxonomy tests (Phase 3, C1).
 *
 * Tests:
 *  1. Taxonomy extraction for several categories (files-read, git-changes,
 *     tasks, errors, decisions, user-prompts, rules, searches, etc.)
 *  2. Snapshot is bounded (<~2KB) + contains runnable references, NOT inlined data
 *  3. Snapshot round-trip: observation ids point to real events in the store
 *  4. compact_snapshot tool handler shape (success + error cases)
 *
 * Test-isolation rule: construct stores with explicit temp dbPath; do NOT mock
 * @massa-th0th/shared process-wide.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { tmpdir } from "os";
import path from "path";
import fs from "fs";
import {
  SqliteObservationStore,
  MemoryObservationStore,
  newObservationId,
  OBSERVATION_CATEGORIES,
  type Observation,
  type LifecycleEventKind,
} from "../data/memory/observation-repository.js";
import { extractCategory, CATEGORY_LABELS } from "../services/hooks/observation-extractor.js";
import { CompactionSnapshotService } from "../services/hooks/compaction-snapshot-service.js";
import { CompactSnapshotTool } from "../tools/compact_snapshot.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "massa-th0th-snap-"));
  return path.join(dir, "observations.db");
}

function makeObs(
  store: SqliteObservationStore | MemoryObservationStore,
  over: Partial<Observation> & { source: LifecycleEventKind; payload: Record<string, unknown> },
): Observation {
  const source = over.source;
  const payload = over.payload;
  const category = over.category ?? extractCategory(source, payload);
  const obs: Observation = {
    id: over.id ?? newObservationId(),
    projectId: over.projectId ?? "proj-test",
    sessionId: over.sessionId ?? "sess-test",
    source,
    category,
    payloadJson: JSON.stringify(payload),
    importance: over.importance ?? 0.5,
    createdAt: over.createdAt ?? Date.now(),
  };
  store.insert(obs);
  return obs;
}

// ── Part 1: Taxonomy extraction ─────────────────────────────────────────────

describe("Event taxonomy extraction (Phase 3 C1)", () => {
  it("OBSERVATION_CATEGORIES has ~30 categories", () => {
    expect(OBSERVATION_CATEGORIES.length).toBeGreaterThanOrEqual(30);
    // Verify a representative sample is present.
    const expected = [
      "files-read",
      "files-written",
      "git-changes",
      "tasks",
      "errors",
      "decisions",
      "user-prompts",
      "rules",
      "skills-invoked",
      "subagents-spawned",
      "compaction-snapshots",
      "searches",
      "memories-stored",
    ];
    for (const cat of expected) {
      expect(OBSERVATION_CATEGORIES).toContain(cat);
    }
  });

  it("extracts files-read from a Read tool call", () => {
    const cat = extractCategory("post-tool-use", {
      tool_name: "Read",
      file_path: "/repo/src/index.ts",
    });
    expect(cat).toBe("files-read");
  });

  it("extracts files-written from an Edit tool call", () => {
    const cat = extractCategory("post-tool-use", {
      tool_name: "Edit",
      file_path: "/repo/src/foo.ts",
    });
    expect(cat).toBe("files-written");
  });

  it("extracts git-changes from a Bash git commit", () => {
    const cat = extractCategory("post-tool-use", {
      tool_name: "Bash",
      command: "git commit -m 'feat: add snapshot'",
    });
    expect(cat).toBe("git-changes");
  });

  it("extracts tasks from a TodoWrite tool call", () => {
    const cat = extractCategory("post-tool-use", {
      tool_name: "TodoWrite",
      todos: [{ content: "task 1" }, { content: "task 2" }],
    });
    expect(cat).toBe("tasks");
  });

  it("extracts errors from a failed tool response", () => {
    const cat = extractCategory("post-tool-use", {
      tool_name: "Bash",
      command: "npm test",
      tool_response: { is_error: true, error: "test failed" },
    });
    expect(cat).toBe("errors");
  });

  it("extracts decisions from a user prompt with decision signal", () => {
    const cat = extractCategory("user-prompt", {
      prompt: "Let's go with the reference-based snapshot approach",
    });
    expect(cat).toBe("decisions");
  });

  it("extracts user-prompts from a generic user prompt", () => {
    const cat = extractCategory("user-prompt", {
      prompt: "What files did we read?",
    });
    expect(cat).toBe("user-prompts");
  });

  it("extracts goal from a /goal user prompt", () => {
    const cat = extractCategory("user-prompt", {
      prompt: "/goal implement compaction snapshot",
    });
    expect(cat).toBe("goal");
  });

  it("extracts constraints from a user prompt with constraint signal", () => {
    const cat = extractCategory("user-prompt", {
      prompt: "Constraint: must not touch scheduler files",
    });
    expect(cat).toBe("constraints");
  });

  it("extracts rules from reading CLAUDE.md", () => {
    const cat = extractCategory("post-tool-use", {
      tool_name: "Read",
      file_path: "/repo/CLAUDE.md",
    });
    expect(cat).toBe("rules");
  });

  it("extracts searches from a th0th search tool call", () => {
    const cat = extractCategory("post-tool-use", {
      tool_name: "search",
      query: "compaction snapshot",
    });
    expect(cat).toBe("searches");
  });

  it("extracts memories-stored from a store_memory tool call", () => {
    const cat = extractCategory("post-tool-use", {
      tool_name: "store_memory",
      content: "important decision",
    });
    expect(cat).toBe("memories-stored");
  });

  it("extracts compaction-snapshots from pre-compact source", () => {
    const cat = extractCategory("pre-compact", { trigger: "auto" });
    expect(cat).toBe("compaction-snapshots");
  });

  it("extracts session-settings from session-start with settings", () => {
    const cat = extractCategory("session-start", {
      model: "claude-sonnet",
      settings: { temperature: 0.7 },
    });
    expect(cat).toBe("session-settings");
  });

  it("extracts mcp-calls from namespaced MCP tool names", () => {
    const cat = extractCategory("post-tool-use", {
      tool_name: "mcp__maestro__run",
    });
    expect(cat).toBe("mcp-calls");
  });

  it("falls back to lifecycle-raw for unknown payloads", () => {
    const cat = extractCategory("session-end", { random: "data" });
    expect(cat).toBe("lifecycle-raw");
  });

  it("CATEGORY_LABELS covers all categories", () => {
    for (const cat of OBSERVATION_CATEGORIES) {
      expect(CATEGORY_LABELS[cat]).toBeDefined();
      expect(typeof CATEGORY_LABELS[cat]).toBe("string");
    }
  });
});

// ── Part 2: Snapshot bounded + runnable references ──────────────────────────

describe("CompactionSnapshotService — bounded + references (Phase 3 C1)", () => {
  let store: MemoryObservationStore;
  let service: CompactionSnapshotService;

  beforeEach(() => {
    store = new MemoryObservationStore();
    service = new CompactionSnapshotService(store);
  });

  it("builds a bounded snapshot (<~2KB)", () => {
    // Seed diverse observations.
    makeObs(store, {
      source: "post-tool-use",
      payload: { tool_name: "Read", file_path: "/repo/src/index.ts" },
      createdAt: 1000,
    });
    makeObs(store, {
      source: "post-tool-use",
      payload: { tool_name: "Edit", file_path: "/repo/src/foo.ts" },
      createdAt: 2000,
    });
    makeObs(store, {
      source: "post-tool-use",
      payload: { tool_name: "Bash", command: "git commit -m feat" },
      createdAt: 3000,
    });
    makeObs(store, {
      source: "user-prompt",
      payload: { prompt: "Let's go with reference-based snapshots" },
      createdAt: 4000,
    });

    const snapshot = service.build({
      sessionId: "sess-test",
      projectId: "proj-test",
    });

    expect(snapshot.bytes).toBeLessThanOrEqual(2048);
    expect(snapshot.xml.length).toBeGreaterThan(0);
    expect(snapshot.eventCount).toBe(4);
    expect(snapshot.sections.length).toBeGreaterThan(0);
  });

  it("contains runnable recall/search references, NOT inlined raw payloads", () => {
    const rawPayload = { tool_name: "Read", file_path: "/very/long/path/to/some/file.ts" };
    makeObs(store, {
      source: "post-tool-use",
      payload: rawPayload,
    });

    const snapshot = service.build({
      sessionId: "sess-test",
      projectId: "proj-test",
    });

    // The XML must contain a retrieval call (recall or search).
    expect(snapshot.xml).toContain("recall(");
    expect(snapshot.xml).toContain("search(");

    // The XML must NOT contain the full raw payload JSON (no inlined data).
    const fullPayloadJson = JSON.stringify(rawPayload);
    expect(snapshot.xml).not.toContain(fullPayloadJson);

    // Each section must have a retrievalCall string.
    for (const section of snapshot.sections) {
      expect(section.retrievalCall).toContain("recall(");
      expect(section.observationIds.length).toBeGreaterThan(0);
    }
  });

  it("has the how_to_search instruction block", () => {
    makeObs(store, {
      source: "user-prompt",
      payload: { prompt: "test prompt" },
    });

    const snapshot = service.build({
      sessionId: "sess-test",
      projectId: "proj-test",
    });

    expect(snapshot.xml).toContain("<how_to_search>");
    expect(snapshot.xml).toContain("TABLE OF CONTENTS");
  });

  it("groups observations by category and sorts by count descending", () => {
    // 3 file reads, 1 git change, 1 user prompt
    for (let i = 0; i < 3; i++) {
      makeObs(store, {
        source: "post-tool-use",
        payload: { tool_name: "Read", file_path: `/repo/file${i}.ts` },
        createdAt: 1000 + i,
      });
    }
    makeObs(store, {
      source: "post-tool-use",
      payload: { tool_name: "Bash", command: "git commit" },
      createdAt: 2000,
    });
    makeObs(store, {
      source: "user-prompt",
      payload: { prompt: "hello" },
      createdAt: 3000,
    });

    const snapshot = service.build({
      sessionId: "sess-test",
      projectId: "proj-test",
    });

    // files-read should be first (3 events), then git-changes and user-prompts (1 each).
    expect(snapshot.sections[0].category).toBe("files-read");
    expect(snapshot.sections[0].count).toBe(3);
    expect(snapshot.eventCount).toBe(5);
  });
});

// ── Part 3: Snapshot round-trip points to real events ───────────────────────

describe("CompactionSnapshotService — round-trip verification (Phase 3 C1)", () => {
  it("observation ids in the snapshot point to real events in the store", () => {
    const store = new MemoryObservationStore();
    const service = new CompactionSnapshotService(store);

    const obs1 = makeObs(store, {
      source: "post-tool-use",
      payload: { tool_name: "Read", file_path: "/repo/a.ts" },
      createdAt: 1000,
    });
    const obs2 = makeObs(store, {
      source: "post-tool-use",
      payload: { tool_name: "Bash", command: "git commit" },
      createdAt: 2000,
    });

    const snapshot = service.build({
      sessionId: "sess-test",
      projectId: "proj-test",
    });

    // Collect all observation ids referenced by the snapshot.
    const referencedIds = new Set<string>();
    for (const section of snapshot.sections) {
      for (const id of section.observationIds) {
        referencedIds.add(id);
      }
    }

    // The snapshot must reference at least one of our observations.
    expect(referencedIds.size).toBeGreaterThan(0);
    expect(referencedIds.has(obs1.id) || referencedIds.has(obs2.id)).toBe(true);

    // Every referenced id must exist in the store.
    const allStoreObs = store.listBySession("sess-test", 100);
    const storeIds = new Set(allStoreObs.map((o) => o.id));
    for (const id of referencedIds) {
      expect(storeIds.has(id)).toBe(true);
    }
  });

  it("works with SqliteObservationStore (real DB round-trip)", () => {
    const dbPath = tempDbPath();
    const store = new SqliteObservationStore(dbPath);
    const service = new CompactionSnapshotService(store);

    const obs = makeObs(store, {
      source: "post-tool-use",
      payload: { tool_name: "Read", file_path: "/repo/CLAUDE.md" },
      sessionId: "sess-sqlite",
      createdAt: 1000,
    });

    const snapshot = service.build({
      sessionId: "sess-sqlite",
      projectId: "proj-test",
    });

    // The snapshot should reference our observation.
    const allReferenced = snapshot.sections.flatMap((s) => s.observationIds);
    expect(allReferenced).toContain(obs.id);
    expect(snapshot.eventCount).toBe(1);
    expect(snapshot.bytes).toBeLessThanOrEqual(2048);
  });
});

// ── Part 4: Tool handler shape ──────────────────────────────────────────────

describe("CompactSnapshotTool — handler shape (Phase 3 C1)", () => {
  it("has correct name and description", () => {
    const tool = new CompactSnapshotTool();
    expect(tool.name).toBe("compact_snapshot");
    expect(tool.description).toContain("reference-based");
    expect(tool.description).toContain("bounded");
  });

  it("has inputSchema with sessionId required", () => {
    const tool = new CompactSnapshotTool();
    expect(tool.inputSchema.type).toBe("object");
    expect((tool.inputSchema as any).properties.sessionId).toBeDefined();
    expect((tool.inputSchema as any).required).toContain("sessionId");
  });

  it("returns success with snapshot data for valid params", async () => {
    const store = new MemoryObservationStore();
    // We need to inject the store into the tool — but the tool uses the
    // singleton getObservationStore(). For testing, we reset and the factory
    // will pick up our injected store via the module-level cache.
    const { resetObservationStore } = await import("../data/memory/observation-repository.js");
    const { resetCompactionSnapshotService } = await import("../services/hooks/compaction-snapshot-service.js");
    resetObservationStore();
    resetCompactionSnapshotService();

    // Seed an observation via the store that getObservationStore() will return.
    // Since we can't easily inject, we test the tool's shape with a
    // no-observations session (should still succeed with an empty snapshot).
    const tool = new CompactSnapshotTool();
    const result = await tool.handle({
      sessionId: "sess-empty",
      projectId: "proj-test",
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    const data = result.data as any;
    expect(data.snapshot).toBeDefined();
    expect(typeof data.snapshot).toBe("string");
    expect(data.bytes).toBeDefined();
    expect(data.eventCount).toBe(0);
    expect(data.sections).toBeDefined();
    expect(Array.isArray(data.sections)).toBe(true);
    expect(data.generatedAt).toBeDefined();
  });

  it("returns error when sessionId is missing", async () => {
    const tool = new CompactSnapshotTool();
    const result = await tool.handle({ projectId: "proj-test" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("sessionId");
  });
});

// ── Store: listBySession ────────────────────────────────────────────────────

describe("ObservationStore.listBySession (Phase 3 C1)", () => {
  it("MemoryObservationStore lists by session newest-first", () => {
    const store = new MemoryObservationStore();
    makeObs(store, {
      sessionId: "s1",
      source: "user-prompt",
      payload: { prompt: "first" },
      createdAt: 1000,
    });
    makeObs(store, {
      sessionId: "s1",
      source: "user-prompt",
      payload: { prompt: "second" },
      createdAt: 3000,
    });
    makeObs(store, {
      sessionId: "s2",
      source: "user-prompt",
      payload: { prompt: "other session" },
      createdAt: 2000,
    });

    const s1 = store.listBySession("s1", 10);
    expect(s1.length).toBe(2);
    expect(s1[0].createdAt).toBeGreaterThanOrEqual(s1[1].createdAt);
    expect(s1[0].payloadJson).toContain("second");

    const s2 = store.listBySession("s2", 10);
    expect(s2.length).toBe(1);
  });

  it("SqliteObservationStore lists by session newest-first", () => {
    const store = new SqliteObservationStore(tempDbPath());
    makeObs(store, {
      sessionId: "s1",
      source: "user-prompt",
      payload: { prompt: "first" },
      createdAt: 1000,
    });
    makeObs(store, {
      sessionId: "s1",
      source: "user-prompt",
      payload: { prompt: "second" },
      createdAt: 3000,
    });

    const s1 = store.listBySession("s1", 10);
    expect(s1.length).toBe(2);
    expect(s1[0].createdAt).toBeGreaterThanOrEqual(s1[1].createdAt);
  });

  it("SqliteObservationStore persists + reads back category column", () => {
    const store = new SqliteObservationStore(tempDbPath());
    const obs = makeObs(store, {
      source: "post-tool-use",
      payload: { tool_name: "Read", file_path: "/repo/file.ts" },
    });

    const listed = store.listBySession(obs.sessionId!, 10);
    expect(listed.length).toBe(1);
    expect(listed[0].category).toBe("files-read");
  });

  it("SqliteObservationStore survives reopen with category column migration", () => {
    const dbPath = tempDbPath();
    const store1 = new SqliteObservationStore(dbPath);
    makeObs(store1, {
      source: "post-tool-use",
      payload: { tool_name: "Read", file_path: "/repo/file.ts" },
    });

    // Reopen — should trigger migration check and not throw.
    const store2 = new SqliteObservationStore(dbPath);
    const listed = store2.listBySession("sess-test", 10);
    expect(listed.length).toBe(1);
    expect(listed[0].category).toBe("files-read");
  });
});

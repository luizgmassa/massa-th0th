/**
 * Unit tests for SymbolGraphService.projectRootCache LRU cap.
 *
 * Side-finding from T3: projectRootCache was an unbounded Map keyed by
 * projectId. Same class of bug as the read_file fileCache/projectRootCache
 * (process-lifetime growth). Mirrors ReadFileTool's FILE_CACHE_MAX_ENTRIES /
 * evictOldest pattern: 512-cap, LRU promotion on GET (delete+set), and
 * oldest-first eviction on SET while over the cap.
 *
 * We drive the cap logic through the private members directly via a cast,
 * since exercising CAP+1 distinct projectIds through getProjectRoot would
 * require stubbing the workspaceManager and is wasteful when the eviction
 * helper is agnostic to the cached value.
 */

import { describe, test, expect } from "bun:test";

import { SymbolGraphService } from "../services/symbol/symbol-graph.service.js";

describe("SymbolGraphService — projectRootCache LRU cap + promotion", () => {
  // CAP+1 distinct inserts → oldest evicted, a touched (LRU-promoted) hot key
  // survives. Mirrors the read-file.test.ts eviction suite shape.
  const CAP = 512;

  test("PROJECT_ROOT_CACHE_MAX_ENTRIES is 512", () => {
    // Fresh instance — the module exports a singleton, but the private cap is
    // a per-instance readonly field; assert it on the singleton.
    const svc = SymbolGraphService.getInstance() as unknown as {
      PROJECT_ROOT_CACHE_MAX_ENTRIES: number;
    };
    expect(svc.PROJECT_ROOT_CACHE_MAX_ENTRIES).toBe(CAP);
  });

  test("inserting CAP+1 distinct keys evicts the oldest; a promoted hot key survives", () => {
    const svc = SymbolGraphService.getInstance() as unknown as {
      projectRootCache: Map<string, string>;
      evictOldestProjectRoot: () => void;
      PROJECT_ROOT_CACHE_MAX_ENTRIES: number;
    };

    // Reset to a known-empty state so the singleton doesn't leak across tests.
    svc.projectRootCache.clear();

    // Seed CAP entries. The first-inserted is the eviction candidate.
    for (let i = 0; i < CAP; i++) {
      svc.evictOldestProjectRoot();
      svc.projectRootCache.set(`proj-${i}`, `/roots/r${i}`);
    }
    expect(svc.projectRootCache.size).toBe(CAP);
    expect(svc.projectRootCache.has("proj-0")).toBe(true);

    // Touch proj-0 (LRU promote via delete+set) — it must NOT be evicted next.
    const v0 = svc.projectRootCache.get("proj-0")!;
    svc.projectRootCache.delete("proj-0");
    svc.projectRootCache.set("proj-0", v0);

    // Insert one more → evict oldest in insertion order. After the proj-0
    // promotion, the oldest is now proj-1.
    svc.evictOldestProjectRoot();
    svc.projectRootCache.set(`proj-${CAP}`, `/roots/r${CAP}`);

    expect(svc.projectRootCache.size).toBe(CAP);
    // Hot (promoted) key survived.
    expect(svc.projectRootCache.has("proj-0")).toBe(true);
    // Oldest non-promoted key evicted.
    expect(svc.projectRootCache.has("proj-1")).toBe(false);
    // New key present.
    expect(svc.projectRootCache.has(`proj-${CAP}`)).toBe(true);

    // Cleanup so the singleton doesn't leak into sibling suites.
    svc.projectRootCache.clear();
  });
});

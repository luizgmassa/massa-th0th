/**
 * compact_snapshot attribution (M45/HAR-01, plan-critic C4): the tool persists
 * outside HookService, so its persist seam must route through the attribution
 * resolver. DB-free: injected MemoryObservationStore + fake resolver.
 */
import { describe, expect, test } from "bun:test";
import { CompactSnapshotTool } from "../tools/compact_snapshot.js";
import { MemoryObservationStore } from "../data/memory/observation-repository.js";
import type {
  AttributionInput,
  AttributionResult,
  AttributionResolverLike,
} from "../services/hooks/attribution-resolver.js";

class FakeResolver implements AttributionResolverLike {
  calls: AttributionInput[] = [];
  pins: Array<{ sessionId: string; projectId: string; source: string }> = [];
  constructor(private readonly result: AttributionResult) {}
  async resolve(input: AttributionInput): Promise<AttributionResult> {
    this.calls.push(input);
    return this.result;
  }
  pinSession(sessionId: string | null | undefined, projectId: string, source: AttributionResult["source"]): void {
    if (!sessionId) return;
    this.pins.push({ sessionId, projectId, source });
  }
}

function seededStore(): MemoryObservationStore {
  const store = new MemoryObservationStore();
  store.insert({
    id: "obs-seed-1",
    projectId: "anything",
    sessionId: "s1",
    source: "user-prompt",
    category: "user-prompts",
    payloadJson: JSON.stringify({ prompt: "hello" }),
    importance: 0.5,
    createdAt: Date.now(),
  });
  return store;
}

describe("CompactSnapshotTool attribution seam", () => {
  test("persist=true routes through the resolver with wire cwd and stamps provenance", async () => {
    const store = seededStore();
    const resolver = new FakeResolver({ projectId: "resolved-proj", source: "containment" });
    const tool = new CompactSnapshotTool({ store, resolver });
    const out = await tool.handle({
      sessionId: "s1",
      projectId: "junk",
      persist: true,
      cwd: "/repo/sub",
    });
    expect(out.success).toBe(true);
    expect(resolver.calls).toEqual([
      { callerProjectId: "junk", sessionId: "s1", cwd: "/repo/sub" },
    ]);
    const rows = store.listRecent("resolved-proj", 10);
    expect(rows.length).toBe(1);
    expect(rows[0].category).toBe("compaction-snapshots");
    expect(rows[0].attributionSource).toBe("containment");
    expect(store.countByProject("junk")).toBe(0);
  });

  test("persist without cwd resolves with undefined cwd", async () => {
    const store = seededStore();
    const resolver = new FakeResolver({ projectId: "junk", source: "verbatim" });
    const tool = new CompactSnapshotTool({ store, resolver });
    const out = await tool.handle({ sessionId: "s1", projectId: "junk", persist: true });
    expect(out.success).toBe(true);
    expect(resolver.calls[0].cwd).toBeUndefined();
    const rows = store.listRecent("junk", 10);
    expect(rows.some((r) => r.category === "compaction-snapshots")).toBe(true);
    expect(rows.find((r) => r.category === "compaction-snapshots")?.attributionSource).toBe("verbatim");
  });

  test("persist=false never resolves and never inserts", async () => {
    const store = seededStore();
    const resolver = new FakeResolver({ projectId: "resolved-proj", source: "containment" });
    const tool = new CompactSnapshotTool({ store, resolver });
    const out = await tool.handle({ sessionId: "s1", projectId: "junk", persist: false, cwd: "/repo" });
    expect(out.success).toBe(true);
    expect(resolver.calls.length).toBe(0);
    expect(store.rows.length).toBe(1); // seed only
  });

  test("eventCount=0 skips persist entirely", async () => {
    const store = new MemoryObservationStore(); // empty
    const resolver = new FakeResolver({ projectId: "resolved-proj", source: "containment" });
    const tool = new CompactSnapshotTool({ store, resolver });
    const out = await tool.handle({ sessionId: "ghost", projectId: "junk", persist: true, cwd: "/repo" });
    expect(out.success).toBe(true);
    expect(resolver.calls.length).toBe(0);
    expect(store.rows.length).toBe(0);
  });
});

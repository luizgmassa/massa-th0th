import { describe, expect, test } from "bun:test";
import {
  MemoryProposalStore,
  type ProposalRecord,
} from "../data/proposal/proposal-contract.js";
import { PgProposalStore } from "../data/proposal/proposal-repository-pg.js";
import { SearchServiceError } from "../services/search/search-diagnostics.js";

function proposal(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: "proposal-1",
    projectId: "project-1",
    kind: "memory.create",
    targetMemoryId: null,
    payload: { content: "hello" },
    rationale: "because",
    status: "pending",
    createdAt: 1_000,
    decidedAt: null,
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "proposal-1",
    project_id: "project-1",
    kind: "memory.create",
    target_memory_id: null,
    payload_json: JSON.stringify({ content: "hello" }),
    rationale: "because",
    status: "pending",
    created_at: new Date(1_000),
    decided_at: null,
    ...overrides,
  };
}

function client(query: () => Promise<unknown>, execute = async () => 1): any {
  return { $queryRaw: query, $executeRaw: execute };
}

describe("async proposal stores", () => {
  test("memory store exposes awaited clone-safe operations", async () => {
    const store = new MemoryProposalStore();
    const record = proposal();
    const insertion = store.insert(record);
    expect(insertion).toBeInstanceOf(Promise);
    await insertion;
    const loaded = await store.getById(record.id);
    expect(loaded).toEqual(record);
    (loaded!.payload as { content: string }).content = "mutated";
    expect((await store.getById(record.id))!.payload).toEqual({ content: "hello" });
    expect(await store.journalMode()).toBe("memory");
  });

  test("reads wait for hydration before observing the mirror", async () => {
    let resolveRows!: (rows: unknown[]) => void;
    const rows = new Promise<unknown[]>((resolve) => {
      resolveRows = resolve;
    });
    const store = new PgProposalStore(client(() => rows));
    let settled = false;
    const pending = store.getById("proposal-1").then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveRows([row()]);
    expect(await pending).toEqual(proposal());
  });

  test.each([
    ["invalid syntax", "{", "memory.create"],
    ["array payload", "[]", "memory.create"],
    ["missing create content", "{}", "memory.create"],
    ["empty update", "{}", "memory.update"],
    ["invalid update tags", JSON.stringify({ tags: [1] }), "memory.update"],
    ["invalid tag payload", JSON.stringify({ content: "x" }), "memory.tag"],
  ])("surfaces %s in stored payload", async (_label, raw, kind) => {
    const store = new PgProposalStore(
      client(async () => [row({ payload_json: raw, kind })]),
    );
    await expect(store.listPending("project-1")).rejects.toMatchObject({
      code: "STORE_CORRUPTION",
      component: "proposal.payload_json",
    });
  });

  test.each([
    ["kind", { kind: "unknown" }, "proposal.kind"],
    ["status", { status: "unknown" }, "proposal.status"],
    ["created date", { created_at: new Date(Number.NaN) }, "proposal.created_at"],
    ["decided date", { status: "approved", decided_at: "bad" }, "proposal.decided_at"],
    ["pending decision", { decided_at: new Date(2_000) }, "proposal.decided_at"],
    ["missing decision", { status: "approved" }, "proposal.decided_at"],
  ])("surfaces invalid %s", async (_label, overrides, component) => {
    const store = new PgProposalStore(client(async () => [row(overrides)]));
    await expect(store.getById("proposal-1")).rejects.toMatchObject({
      code: "STORE_CORRUPTION",
      component,
    });
  });

  test("failed hydration is a sanitized backend failure", async () => {
    const store = new PgProposalStore(
      client(async () => {
        throw new Error("database detail");
      }),
    );
    try {
      await store.getById("proposal-1");
      throw new Error("expected backend error");
    } catch (error) {
      expect(error).toBeInstanceOf(SearchServiceError);
      expect((error as SearchServiceError).code).toBe("SEARCH_BACKEND_UNAVAILABLE");
      expect((error as SearchServiceError).component).toBe("proposal_store");
      expect((error as Error).message).not.toContain("database detail");
    }
  });

  test("failed durable insert leaves the mirror unchanged", async () => {
    const store = new PgProposalStore(
      client(async () => [], async () => {
        throw new Error("database detail");
      }),
    );
    await expect(store.insert(proposal())).rejects.toMatchObject({
      code: "SEARCH_BACKEND_UNAVAILABLE",
      component: "proposal_store",
    });
    expect(await store.getById("proposal-1")).toBeNull();
  });
});

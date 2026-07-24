/**
 * SymbolRepositoryPg — characterization tests (Wave 6 N31, T01)
 *
 * Purpose: pin observable behavior of the god-class BEFORE the Phase 2
 * facade split so any drift is caught. These tests are mutation-killing
 * anchors — each assertion is hand-computed against the live SQL helpers
 * and module functions.
 *
 * DB-free seam: `mock.module` replaces the Prisma client with a
 * capture-and-return engine. Each test registers the canned `rawRows`
 * a method should receive, then asserts (a) the exact SQL fragment the
 * method emitted and (b) the mapped domain object the method returned.
 * This pins BOTH the SQL shape (contract) AND the mapper output
 * (behavior) without emulating PG semantics.
 *
 * Discrimination spot-check (run before reporting): flip one expected
 * mapper field and remove the `parseStructuralFqn` throw guard; each
 * must FAIL. See commit message.
 */

import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import { createHash } from "node:crypto";

// ── Restore any stale mocks from other test files (shared module registry) ───
mock.restore();
// Each test wires `nextRows` to the rows the NEXT $queryRaw should return;
// `lastSql` / `lastValues` record what the method emitted. $executeRaw
// returns 1 (one affected row) and records its SQL too.

interface StubState {
  nextRows: unknown[] | (() => unknown[]);
  nextRowsQueue: Array<unknown[] | (() => unknown[])>;
  lastSql: string;
  lastValues: unknown[];
  execSqls: Array<{ sql: string; values: unknown[] }>;
  inTx: boolean;
}

const STATE: StubState = {
  nextRows: [],
  nextRowsQueue: [],
  lastSql: "",
  lastValues: [],
  execSqls: [],
  inTx: false,
};

function makeStub() {
  const queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    STATE.lastSql = sql;
    STATE.lastValues = values;
    return dequeueRows();
  };
  const executeRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    STATE.execSqls.push({ sql, values });
    return 1;
  };
  const unsafeQuery = async (sql: string, ...values: unknown[]) => {
    STATE.lastSql = sql;
    STATE.lastValues = values;
    return dequeueRows();
  };
  const unsafeExec = async (sql: string, ...values: unknown[]) => {
    STATE.execSqls.push({ sql, values });
    return 1;
  };
  const transaction = async (fn: (tx: any) => Promise<unknown>) => {
    STATE.inTx = true;
    try {
      return await fn({
        $queryRaw: queryRaw,
        $executeRaw: executeRaw,
        $queryRawUnsafe: unsafeQuery,
        $executeRawUnsafe: unsafeExec,
      });
    } finally {
      STATE.inTx = false;
    }
  };
  return { $queryRaw: queryRaw, $executeRaw: executeRaw, $queryRawUnsafe: unsafeQuery, $executeRawUnsafe: unsafeExec, $transaction: transaction };
}

function dequeueRows(): unknown[] {
  if (STATE.nextRowsQueue.length > 0) {
    const next = STATE.nextRowsQueue.shift()!;
    return typeof next === "function" ? (next as () => unknown[])() : (next as unknown[]);
  }
  const r = STATE.nextRows;
  return typeof r === "function" ? (r as () => unknown[])() : r;
}

mock.module("../services/query/prisma-client.ts", () => {
  return { getPrismaClient: () => STUB };
});

// The stub instance must be STABLE across getPrismaClient() calls so the
// capture state persists. Build it AFTER mock.module registration so the
// factory closure can reference it (TDZ-safe: factory runs lazily on import).
const STUB = makeStub();

mock.module("@massa-ai/shared", () => {
  const actual = require("@massa-ai/shared");
  return {
    ...actual,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
});

import { SymbolRepositoryPg } from "../data/symbol/symbol-repository-pg.js";

// ── Test fixtures ────────────────────────────────────────────────────────────

function defRaw(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "src/a.ts#Foo",
    project_id: "p1",
    file_path: "src/a.ts",
    name: "Foo",
    kind: "class",
    line_start: 1,
    line_end: 10,
    exported: true,
    doc_comment: null,
    indexed_at: new Date(1000),
    qualified_name: "Foo",
    canonical_signature: null,
    signature_hash: null,
    legacy_fqn: "src/a.ts#Foo",
    source_span: null,
    ...over,
  };
}

function refRaw(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 1,
    project_id: "p1",
    from_file: "src/b.ts",
    from_line: 2,
    symbol_name: "Foo",
    target_fqn: "src/a.ts#Foo",
    ref_kind: "call",
    meta: null,
    source_span: null,
    ...over,
  };
}

function impRaw(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 1,
    project_id: "p1",
    from_file: "src/b.ts",
    to_file: "src/a.ts",
    specifier: "./a",
    imported_names: ["Foo"],
    is_external: false,
    is_type_only: false,
    ...over,
  };
}

function wsRaw(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    project_id: "p1",
    project_path: "/proj/p1",
    display_name: null,
    status: "indexed",
    last_indexed_at: new Date(2000),
    last_error: null,
    files_count: 2,
    chunks_count: 2,
    symbols_count: 3,
    created_at: new Date(1000),
    updated_at: new Date(2000),
    ...over,
  };
}

function resetState() {
  STATE.nextRows = [];
  STATE.nextRowsQueue = [];
  STATE.lastSql = "";
  STATE.lastValues = [];
  STATE.execSqls = [];
  STATE.inTx = false;
}

describe("SymbolRepositoryPg — characterization (T01)", () => {
  let repo: SymbolRepositoryPg;

  beforeEach(() => {
    resetState();
    (SymbolRepositoryPg as any).instance = null;
    repo = SymbolRepositoryPg.getInstance();
  });

  afterEach(() => {
    mock.restore();
  });

  // ── getProjectMapSnapshot ──────────────────────────────────────────────────

  test("getProjectMapSnapshot returns null when workspace row is missing", async () => {
    STATE.nextRows = [];
    const snap = await repo.getProjectMapSnapshot("nope");
    expect(snap).toBeNull();
    // First query: SELECT * FROM workspaces WHERE project_id = ? FOR SHARE
    expect(STATE.lastSql).toContain("FROM workspaces");
    expect(STATE.lastSql).toContain("FOR SHARE");
  });

  test("getProjectMapSnapshot returns empty graph when generationId is null", async () => {
    STATE.nextRowsQueue = [
      [{ ...wsRaw(), active_graph_generation_id: null }],
    ];
    const snap = await repo.getProjectMapSnapshot("p1");
    expect(snap).not.toBeNull();
    expect(snap!.generationId).toBeNull();
    expect(snap!.counts.files).toBe(0);
    expect(snap!.counts.definitions).toBe(0);
    expect(snap!.architecture.files).toEqual([]);
  });

  test("getProjectMapSnapshot aggregates kinds, edges, languages, centrality", async () => {
    // Queue: workspace, files, kindRows, definitionRows, importRows, edgeRows,
    // httpRows, callRows, centralityRows.
    STATE.nextRowsQueue = [
      [{ ...wsRaw(), active_graph_generation_id: "gen-1" }],
      [
        { relative_path: "src/a.ts", indexed_at: new Date(3000), language: "typescript", parser_status: "ok", parser_error_count: 0, is_stale: false },
        { relative_path: "src/b.ts", indexed_at: new Date(4000), language: "typescript", parser_status: "ok", parser_error_count: 0, is_stale: false },
      ],
      [
        { kind: "class", count: BigInt(1) },
        { kind: "function", count: BigInt(1) },
      ],
      [defRaw()],
      [{ from_file: "src/b.ts", to_file: "src/a.ts" }],
      [
        { ref_kind: "call", count: BigInt(1) },
        { ref_kind: "http_call", count: BigInt(1) },
      ],
      [refRaw({ ref_kind: "http_call" })],
      [refRaw({ ref_kind: "call" })],
      [{ file_path: "src/a.ts", score: 0.9, updated_at: new Date(5000) }],
    ];
    const snap = await repo.getProjectMapSnapshot("p1");
    expect(snap).not.toBeNull();
    expect(snap!.generationId).toBe("gen-1");
    expect(snap!.counts.files).toBe(2);
    expect(snap!.counts.definitions).toBe(2); // kindRows counts
    expect(snap!.counts.references).toBe(2);
    expect(snap!.counts.imports).toBe(1);
    expect(snap!.counts.centrality).toBe(1);
    expect(snap!.symbolsByKind["class"]).toBe(1);
    expect(snap!.symbolsByKind["function"]).toBe(1);
    expect(snap!.edgesByKind["call"]).toBe(1);
    expect(snap!.edgesByKind["http_call"]).toBe(1);
    expect(snap!.languages["typescript"]).toBe(2);
    expect(snap!.topCentralFiles.length).toBe(1);
    expect(snap!.topCentralFiles[0].file_path).toBe("src/a.ts");
    expect(snap!.architecture.importEdges.length).toBe(1);
    expect(snap!.architecture.httpEdges.length).toBe(1);
    expect(snap!.architecture.callEdges.length).toBe(1);
    expect(snap!.architecture.centrality.get("src/a.ts")).toBe(0.9);
  });

  // ── searchDefinitions ──────────────────────────────────────────────────────

  test("searchDefinitions emits ILIKE + ORDER BY name ASC + LIMIT", async () => {
    STATE.nextRows = [defRaw(), defRaw({ id: "src/a.ts#Bar", name: "Bar", kind: "method" })];
    const out = await repo.searchDefinitions("p1", "Foo", undefined, undefined, 20);
    expect(out.length).toBe(2);
    expect(out[0].name).toBe("Foo");
    expect(out[0].kind).toBe("class");
    expect(out[0].file_path).toBe("src/a.ts");
    // Contract: SQL must scope by project + active generation + ILIKE + ORDER BY + LIMIT.
    expect(STATE.lastSql).toContain("symbol_definitions");
    expect(STATE.lastSql).toContain("ILIKE");
    expect(STATE.lastSql).toContain("ORDER BY name ASC");
    expect(STATE.lastSql).toContain("LIMIT");
    // The query param carries the %wildcards% pattern.
    expect(STATE.lastValues).toContain("%Foo%");
  });

  test("searchDefinitions with kindList emits ANY(text[]) cast", async () => {
    STATE.nextRows = [];
    await repo.searchDefinitions("p1", undefined, ["class", "function"], undefined, 50);
    expect(STATE.lastSql).toContain("kind = ANY");
    expect(STATE.lastValues.some((v) => Array.isArray(v) && v[0] === "class" && v[1] === "function")).toBe(true);
  });

  test("searchDefinitions with exportedOnly=true emits exported = true guard", async () => {
    STATE.nextRows = [];
    await repo.searchDefinitions("p1", undefined, undefined, true, 50);
    expect(STATE.lastSql).toContain("exported = true");
  });

  // ── countDefinitions (same code path as searchDefinitions) ──────────────────

  test("countDefinitions emits COUNT(*) on the same WHERE clauses", async () => {
    STATE.nextRows = [{ count: BigInt(3) }];
    const total = await repo.countDefinitions("p1");
    expect(total).toBe(3);
    expect(STATE.lastSql).toContain("SELECT COUNT(*)::bigint AS count");
    expect(STATE.lastSql).toContain("symbol_definitions");
  });

  // ── batchUpsertDefinitions ──────────────────────────────────────────────────

  test("batchUpsertDefinitions is a no-op on empty input", async () => {
    await repo.batchUpsertDefinitions([]);
    expect(STATE.execSqls.length).toBe(0);
  });

  test("batchUpsertDefinitions writes one INSERT per def + locks active generations first", async () => {
    // First query inside the tx: lockActiveGenerations → returns gen id.
    STATE.nextRowsQueue = [
      [{ active_graph_generation_id: "gen-1" }],
    ];
    await repo.batchUpsertDefinitions([
      {
        id: "src/x.ts#Qux", project_id: "p1", file_path: "src/x.ts",
        name: "Qux", kind: "function", line_start: 1, line_end: 5,
        exported: true, indexed_at: Date.now(), qualified_name: "Qux",
        legacy_fqn: "src/x.ts#Qux",
      },
    ]);
    // First exec: the generation lock SELECT (queryRaw). Then one INSERT.
    const inserts = STATE.execSqls.filter((e) => /insert into symbol_definitions/i.test(e.sql));
    expect(inserts.length).toBe(1);
    expect(inserts[0].sql).toContain("ON CONFLICT (project_id, generation_id, id) DO UPDATE SET");
    // Identity columns flow into the INSERT values.
    expect(inserts[0].values.some((v) => v === "Qux")).toBe(true); // qualifiedName
  });

  // ── findEdges ──────────────────────────────────────────────────────────────

  test("findEdges builds parameterized WHERE with types IN clause", async () => {
    STATE.nextRows = [refRaw({ ref_kind: "call" })];
    const calls = await repo.findEdges("p1", { types: ["call"] });
    expect(calls.length).toBe(1);
    expect(calls[0].ref_kind).toBe("call");
    // Uses $queryRawUnsafe with positional params.
    expect(STATE.lastSql).toContain("symbol_references");
    expect(STATE.lastSql).toContain("ref_kind IN");
    expect(STATE.lastValues[0]).toBe("p1");
  });

  test("findEdges with fromSymbol splits file#name and emits callerFqn meta predicate", async () => {
    STATE.nextRows = [];
    await repo.findEdges("p1", { fromSymbol: "src/a.ts#Foo", direction: "outgoing" });
    expect(STATE.lastSql).toContain("from_file =");
    expect(STATE.lastSql).toContain("meta->>'callerFqn' =");
    expect(STATE.lastValues).toContain("src/a.ts");
    expect(STATE.lastValues).toContain("src/a.ts#Foo");
  });

  // ── countEdgesByKind ───────────────────────────────────────────────────────

  test("countEdgesByKind groups references by ref_kind", async () => {
    STATE.nextRows = [
      { ref_kind: "call", count: BigInt(1) },
      { ref_kind: "http_call", count: BigInt(2) },
    ];
    const out = await repo.countEdgesByKind("p1");
    expect(out["call"]).toBe(1);
    expect(out["http_call"]).toBe(2);
    expect(Object.keys(out).length).toBe(2);
    expect(STATE.lastSql).toContain("GROUP BY ref_kind");
  });

  // ── runBfsCteImpact ────────────────────────────────────────────────────────

  test("runBfsCteImpact emits WITH RECURSIVE bfs + LIMIT", async () => {
    STATE.nextRows = [
      { file: "src/a.ts", hop: 0 },
      { file: "src/b.ts", hop: 1 },
    ];
    const rows = await repo.runBfsCteImpact("p1", ["src/a.ts"], { depth: 2, maxImpacted: 100 });
    expect(rows.length).toBe(2);
    expect(rows[0].file).toBe("src/a.ts");
    expect(rows[0].hop).toBe(0);
    expect(rows[1].file).toBe("src/b.ts");
    expect(rows[1].hop).toBe(1);
    expect(STATE.lastSql).toContain("WITH RECURSIVE bfs");
    expect(STATE.lastSql).toContain("LIMIT");
    // Changed files flow as a text[] param.
    expect(STATE.lastValues.some((v) => Array.isArray(v) && v[0] === "src/a.ts")).toBe(true);
  });

  test("runBfsCteImpact clamps depth to [0,4] and maxImpacted to [1,1000]", async () => {
    STATE.nextRows = [];
    await repo.runBfsCteImpact("p1", ["src/a.ts"], { depth: 99, maxImpacted: 99999 });
    // The clamped values appear in the SQL params.
    expect(STATE.lastValues).toContain(4);
    expect(STATE.lastValues).toContain(1000);
  });

  test("runBfsCteImpact empty changedFiles → empty result without a query", async () => {
    const rows = await repo.runBfsCteImpact("p1", [], { depth: 2, maxImpacted: 100 });
    expect(rows).toEqual([]);
  });

  // ── resolveDefinitionFqn ───────────────────────────────────────────────────

  test("resolveDefinitionFqn returns not-found for inputs without '#'", async () => {
    const res = await repo.resolveDefinitionFqn("p1", "noHashHere");
    expect(res.found).toBe(false);
    expect(res.ambiguous).toBe(false);
    // No query emitted — the method short-circuits.
  });

  test("resolveDefinitionFqn returns the exact definition when id matches", async () => {
    // Queue: generation scope, exact-by-id match.
    STATE.nextRowsQueue = [
      [{ generation_id: "gen-1" }],
      [defRaw()],
    ];
    const res = await repo.resolveDefinitionFqn("p1", "src/a.ts#Foo");
    expect(res.found).toBe(true);
    expect(res.ambiguous).toBe(false);
    if (res.found) {
      expect(res.definition.name).toBe("Foo");
      expect(res.definition.kind).toBe("class");
    }
  });

  test("resolveDefinitionFqn returns ambiguous when multiple legacy_fqn aliases exist", async () => {
    // Queue: generation scope, exact-by-id miss, aliases (2 rows).
    // The candidate builder requires a signature_hash OR a qualified FQN that
    // carries one. Use a qualified FQN so definitionCandidate resolves cleanly.
    const sig = (n: number) => createHash("sha256").update(`sig${n}`).digest("hex");
    STATE.nextRowsQueue = [
      [{ generation_id: "gen-1" }],
      [],
      [
        defRaw({ id: `qualified:src/a.ts#Foo::class.${sig(1)}`, legacy_fqn: "src/a.ts#Foo", signature_hash: sig(1) }),
        defRaw({ id: `qualified:src/a.ts#Foo::class.${sig(2)}`, legacy_fqn: "src/a.ts#Foo", signature_hash: sig(2) }),
      ],
    ];
    const res = await repo.resolveDefinitionFqn("p1", "src/a.ts#Foo");
    expect(res.found).toBe(false);
    expect(res.ambiguous).toBe(true);
  });

  // ── getProjectMapAggregates ────────────────────────────────────────────────

  test("getProjectMapAggregates groups symbolsByKind and filesByLanguage", async () => {
    // Queue: scope, kindRows, langRows, recentRows.
    STATE.nextRowsQueue = [
      [{ generation_id: "gen-1" }],
      [
        { kind: "class", count: BigInt(1) },
        { kind: "function", count: BigInt(1) },
      ],
      [{ ext: "ts", count: BigInt(2) }],
      [
        { relative_path: "src/a.ts", indexed_at: new Date(3000) },
        { relative_path: "src/b.ts", indexed_at: new Date(4000) },
      ],
    ];
    const agg = await repo.getProjectMapAggregates("p1", 10);
    expect(agg.symbolsByKind["class"]).toBe(1);
    expect(agg.symbolsByKind["function"]).toBe(1);
    expect(agg.filesByLanguage["ts"]).toBe(2);
    expect(agg.recentFiles.length).toBe(2);
  });
});
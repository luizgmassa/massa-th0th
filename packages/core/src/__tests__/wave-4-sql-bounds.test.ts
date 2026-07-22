/**
 * T18 (WAVE4-N10): SQL bounds regression test.
 *
 * Asserts the 3 bounded SQL placeholder builders stay bounded + zero C-style
 * fixed-buffer formatting in TypeScript:
 *   1. searchTwoPhase Phase 1 LIMIT 200 (Math.min(limit*20, 200))
 *   2. findEdges ref_kind enum ≤9 valid values, all parameterized
 *   3. populateVocabulary INSERT_BATCH_SIZE=5000 per batch
 *   4. zero snprintf/sprintf in packages/ (TS has no C fixed buffers)
 *
 * Discrimination:
 *   - remove the LIMIT cap → candidates > 200 for limit > 10 → test 1 fails
 *   - string-interpolate ref_kind values → SQL contains literal strings → test 2 fails
 *   - change INSERT_BATCH_SIZE to 999999 → single batch of 5001 → test 3 fails
 *   - introduce sprintf → rg match → test 4 fails
 */
import { describe, test, expect, mock } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ── Test 2 mock: intercept getPrismaClient BEFORE importing the repo ─────────
let capturedSql = "";
let capturedParams: unknown[] = [];

mock.module("../services/query/prisma-client.js", () => ({
  getPrismaClient: () => ({
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      capturedSql = sql;
      capturedParams = [...params];
      return [];
    },
  }),
}));

import { SymbolRepositoryPg } from "../data/symbol/symbol-repository-pg.js";
import { PostgresVectorStore } from "../data/vector/postgres-vector-store.js";
import { KeywordSearchPg } from "../data/keyword/keyword-search-pg.js";

const PACKAGES_DIR = path.resolve(import.meta.dir, "../../..");

const VALID_REF_KINDS = [
  "call",
  "type_ref",
  "import",
  "extend",
  "implement",
  "data_flow",
  "http_call",
  "emit",
  "listen",
] as const;

// ── Test 1: searchTwoPhase Phase 1 LIMIT 200 ─────────────────────────────────

describe("N10: searchTwoPhase Phase 1 LIMIT cap at 200", () => {
  test("candidates clamped to 200 when limit*20 > 200, uncapped when below", async () => {
    const store = new PostgresVectorStore({ connectionString: "postgres://test" });
    (store as any).schemaDimensions = 8;
    (store as any).tableName = "vector_documents_test";

    const queries: { text: string; params: unknown[] }[] = [];
    const mockPool = {
      query: async (text: string, params: unknown[]) => {
        queries.push({ text, params });
        return { rows: [] };
      },
    };

    // limit=20 → candidates = Math.min(20*20, 200) = 200 (clamped)
    await (store as any).searchTwoPhase(mockPool, [0.1, -0.2, 0.3, -0.4], 20, "proj-1");
    expect(queries.length).toBeGreaterThanOrEqual(1);
    const clampedCandidates = queries[0].params[queries[0].params.length - 1];
    expect(clampedCandidates).toBe(200);

    // limit=5 → candidates = Math.min(5*20, 200) = 100 (below cap)
    queries.length = 0;
    await (store as any).searchTwoPhase(mockPool, [0.1, -0.2, 0.3, -0.4], 5, "proj-1");
    const uncappedCandidates = queries[0].params[queries[0].params.length - 1];
    expect(uncappedCandidates).toBe(100);
  });
});

// ── Test 2: findEdges ref_kind enum ≤9, parameterized ─────────────────────────

describe("N10: findEdges ref_kind enum bounded + parameterized", () => {
  test("9 valid RefKind values, all parameterized in SQL (no string interpolation)", async () => {
    // Source-level: assert the RefKind type union has exactly 9 values
    const source = fs.readFileSync(
      path.resolve(import.meta.dir, "../data/symbol/symbol-repo-types.ts"),
      "utf-8",
    );
    const refKindMatch = source.match(/export type RefKind =\s*([\s\S]*?);/);
    expect(refKindMatch).not.toBeNull();
    const refKindValues = [...refKindMatch![1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(refKindValues.length).toBeLessThanOrEqual(9);
    expect(refKindValues).toEqual([...VALID_REF_KINDS]);

    // Behavioral: findEdges uses parameterized placeholders for ref_kind
    capturedSql = "";
    capturedParams = [];

    const repo = SymbolRepositoryPg.getInstance();
    await repo.findEdges("proj-test", { types: [...VALID_REF_KINDS] });

    expect(capturedSql).toContain("ref_kind IN (");
    const inClauseMatch = capturedSql.match(/ref_kind IN \(([^)]+)\)/);
    expect(inClauseMatch).not.toBeNull();
    const placeholders = inClauseMatch![1].split(",");
    expect(placeholders.length).toBe(9);
    for (const p of placeholders) {
      expect(p.trim()).toMatch(/^\$\d+::text$/);
    }
    // No ref_kind value should appear as a literal string in the SQL
    for (const kind of VALID_REF_KINDS) {
      expect(capturedSql).not.toContain(`'${kind}'`);
      expect(capturedSql).not.toContain(`"${kind}"`);
    }
    // Params should include all 9 ref_kind values
    const kindParams = capturedParams.filter(
      (p) => typeof p === "string" && (VALID_REF_KINDS as readonly string[]).includes(p),
    );
    expect(kindParams.length).toBe(9);
  });
});

// ── Test 3: populateVocabulary INSERT_BATCH_SIZE=5000 ────────────────────────

describe("N10: populateVocabulary batches at 5000", () => {
  test("5001 unique words → 2 batches, each ≤5000", async () => {
    const search = new KeywordSearchPg();
    const queries: { text: string; params: unknown[] }[] = [];
    const mockPool = {
      query: async (text: string, params: unknown[]) => {
        queries.push({ text, params });
        return { rows: [] };
      },
    };

    // Generate 5001 unique words (each ≥ 3 chars, no camelCase splits)
    const words = Array.from({ length: 5001 }, (_, i) => `word${i}`);
    const contents = [words.join(" ")];

    await (search as any).populateVocabulary(mockPool, contents, "test-source");

    expect(queries.length).toBe(2);
    expect(queries[0].params.length).toBe(5000);
    expect(queries[1].params.length).toBe(1);
    for (const q of queries) {
      expect(q.params.length).toBeLessThanOrEqual(5000);
    }
  });
});

// ── Test 4: zero snprintf/sprintf in packages/ ────────────────────────────────

describe("N10: no snprintf or sprintf in packages/", () => {
  test("rg snprintf|sprintf packages/ returns zero matches (source only)", () => {
    const result = spawnSync(
      "rg",
      ["-n", "--glob", "!**/__tests__/**", "--glob", "!*.test.ts", "snprintf|sprintf", PACKAGES_DIR],
      { encoding: "utf-8" },
    );

    if (result.error) {
      // rg not available — use grep fallback
      const grepResult = spawnSync(
        "grep",
        ["-r", "-n", "--include=*.ts", "--exclude-dir=__tests__", "-E", "snprintf|sprintf", PACKAGES_DIR],
        { encoding: "utf-8" },
      );
      expect(grepResult.stdout.trim()).toBe("");
    } else {
      // rg exit 1 = no matches (success); exit 0 = matches (failure)
      expect(result.stdout.trim()).toBe("");
    }
  });
});

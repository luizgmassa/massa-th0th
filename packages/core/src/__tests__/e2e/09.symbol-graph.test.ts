/**
 * T4 — Symbol graph (E2E, live stack).
 *
 * Domain: list_projects, project_map, search_definitions, get_references,
 * go_to_definition.
 * Targets the RUNNING Tools API (http://localhost:3333) + Ollama + the MCP
 * subprocess. Read-only: no production source, schema, or dist changes.
 *
 * Backend: owned PostgreSQL. Auth: off. Indexes only the exact 33-file polyglot
 * fixture and asserts deterministic active-generation and transport contracts.
 */
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test";
import {
  E2E_ENABLED,
  probeAvailability,
  httpGet,
  assertMatrix,
  POLY_FIXTURE_PATH,
  POLY_PROJECT_ID,
  indexAndAwait,
  resetProject,
} from "./_helpers";
import { startMcp, mcpCall, requireTool, type McpHandle } from "./_mcp";
import { POLYGLOT_EXPECTATIONS, inspectPolyglotFixture } from "./polyglot-fixture.js";
import { parseStructuralFqn } from "../../services/structural/fqn-codec.js";

setDefaultTimeout(900_000);

// ── Gating ──────────────────────────────────────────────────────────────────
// Requested runs fail closed unless the owned PostgreSQL/Ollama/API stack is ready.
let READY = false;
if (E2E_ENABLED) {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("symbol-graph E2E is frozen to macOS arm64");
  }
  const availability = await probeAvailability();
  if (!availability.API_UP || !availability.OLLAMA_UP || availability.BACKEND !== "postgres") {
    throw new Error(`owned PostgreSQL E2E stack is not ready: ${JSON.stringify(availability)}`);
  }
  READY = true;
}

const POLY_PID = POLY_PROJECT_ID;

describe.skipIf(!READY)("T4 symbol graph", () => {
  let mcp: McpHandle;
  const pid = POLY_PID;
  let generationId = "";

  beforeAll(async () => {
    const indexed = await indexAndAwait(POLY_FIXTURE_PATH, POLY_PID, { timeoutMs: 600_000 });
    expect(indexed.status).toBe("completed");
    generationId = indexed.result?.activatedGraphGenerationId ?? "";
    expect(generationId).toEqual(expect.any(String));
    mcp = await startMcp();
    requireTool(mcp.toolNames, "list_projects");
    requireTool(mcp.toolNames, "project_map");
    requireTool(mcp.toolNames, "search_definitions");
    requireTool(mcp.toolNames, "get_references");
    requireTool(mcp.toolNames, "go_to_definition");
  });

  afterAll(async () => {
    if (mcp) {
      try {
        await mcp.stop();
      } catch {
        /* ignore */
      }
    }
    await resetProject(POLY_PID);
  });

  // ── list_projects (F37, F38) ─────────────────────────────────────────────

  test(
    "F37: list_projects returns the polyglot project (indexed)",
    async () => {
      const r = await httpGet<any>("/api/v1/workspace/list");
      expect(r?.success).toBe(true);
      const workspaces = r?.data?.workspaces ?? [];
      expect(workspaces.length).toBeGreaterThan(0);
      const shared = workspaces.find((w: any) => w.projectId === pid);
      expect(shared).toBeDefined();
      expect(shared.projectId).toBe(pid);
      expect(shared.status).toBe("indexed");
      // Sanity: an indexed project carries non-zero file/symbol counts.
      expect(typeof shared.filesCount).toBe("number");
      expect(shared.filesCount).toBeGreaterThan(0);
      expect(typeof shared.symbolsCount).toBe("number");
      expect(shared.symbolsCount).toBeGreaterThan(0);
    },
    30_000,
  );

  test(
    "F38: status:indexed filter excludes non-indexed projects",
    async () => {
      const all = await httpGet<any>("/api/v1/workspace/list");
      const indexed = await httpGet<any>("/api/v1/workspace/list", {
        status: "indexed",
      });
      expect(all?.success).toBe(true);
      expect(indexed?.success).toBe(true);
      const allList = all?.data?.workspaces ?? [];
      const indexedList = indexed?.data?.workspaces ?? [];
      // Every workspace in the filtered list must be status:indexed.
      for (const w of indexedList) {
        expect(w.status).toBe("indexed");
      }
      // The shared project is indexed → must survive the filter.
      expect(indexedList.find((w: any) => w.projectId === pid)).toBeDefined();
      // The filtered list is no larger than the unfiltered list.
      expect(indexedList.length).toBeLessThanOrEqual(allList.length);
    },
    30_000,
  );

  // ── project_map (F39, F40) ───────────────────────────────────────────────

  test(
    "F39: project_map aggregate has stats + central files + symbols-by-kind + files-by-language + recent files",
    async () => {
      const r = await httpGet<any>(`/api/v1/workspace/${pid}/map`);
      expect(r?.success).toBe(true);
      const data = r?.data ?? {};
      expect(data.projectId).toBe(pid);
      expect(data.stats).toEqual(expect.any(Object));
      expect(data.stats?.files).toBe(33);
      expect(typeof data.stats?.chunks).toBe("number");
      expect(typeof data.stats?.symbols).toBe("number");
      expect(data.stats?.status).toBe("indexed");
      expect(Array.isArray(data.topCentralFiles)).toBe(true);
      expect((data.topCentralFiles ?? []).length).toBeGreaterThan(0);
      const top0 = data.topCentralFiles[0];
      expect(top0).toEqual(
        expect.objectContaining({ filePath: expect.any(String), score: expect.any(Number) }),
      );
      expect(data.symbolsByKind).toEqual(expect.any(Object));
      expect(data.symbolsByKind).toMatchObject({ class: expect.any(Number), function: expect.any(Number), key: expect.any(Number), heading: expect.any(Number) });
      expect(data.filesByLanguage).toEqual(expect.any(Object));
      expect(Object.values(data.filesByLanguage).reduce((total: number, count) => total + Number(count), 0)).toBe(33);
      expect(Array.isArray(data.recentFiles)).toBe(true);
      expect(data.activatedGraphGenerationId).toBe(generationId);
      expect(data.parserDiagnostics).toMatchObject({ diagnosticsCount: 0, recoveredFiles: 0, hardFailureFiles: 0, staleFiles: 0 });
    },
    30_000,
  );

  test(
    "F40: centralityLimit:5 / recentLimit:3 honored",
    async () => {
      const r = await httpGet<any>(`/api/v1/workspace/${pid}/map`, {
        centralityLimit: 5,
        recentLimit: 3,
      });
      expect(r?.success).toBe(true);
      const data = r?.data ?? {};
      expect((data.topCentralFiles ?? []).length).toBeLessThanOrEqual(5);
      expect((data.recentFiles ?? []).length).toBeLessThanOrEqual(3);
    },
    30_000,
  );

  // ── search_definitions (F41–F44) ─────────────────────────────────────────
  //
  // All four filters (search/kind/file/exportedOnly) and the limit cap are now
  // honored on the PostgreSQL backend. F41 asserts search+kind, F42 exportedOnly,
  // F43 the file filter, F44 the limit cap.

  test(
    "F41: search + kind filter returns the matching class (PG honors both filters)",
    async () => {
      const r = await httpGet<any>("/api/v1/symbol/definitions", {
        projectId: pid,
        search: "PolyRoot",
        kind: "class",
        limit: 20,
      });
      expect(r?.success).toBe(true);
      const defs = r?.data?.definitions ?? [];
      expect(defs.length).toBeGreaterThan(0);
      const hit = defs.find((d: any) => d.name === "PolyRoot");
      expect(hit).toBeDefined();
      expect(hit.kind).toBe("class");
      expect(hit.file).toBe("decorator-heavy.ts");
      // Every returned row honors the search AND kind filters.
      for (const d of defs) {
        expect(d.kind).toBe("class");
        expect(String(d.name).toLowerCase()).toContain("polyroot");
      }
    },
    30_000,
  );

  test(
    "F42: exportedOnly:true returns only exported symbols (subset)",
    async () => {
      const all = await httpGet<any>("/api/v1/symbol/definitions", {
        projectId: pid,
        limit: 30,
      });
      const exported = await httpGet<any>("/api/v1/symbol/definitions", {
        projectId: pid,
        exportedOnly: "true",
        limit: 30,
      });
      expect(all?.success).toBe(true);
      expect(exported?.success).toBe(true);
      const allDefs = all?.data?.definitions ?? [];
      const expDefs = exported?.data?.definitions ?? [];
      // Every def in the exportedOnly result must have exported === true.
      for (const d of expDefs) {
        expect(d.exported).toBe(true);
      }
      // The exported subset is no larger than the unfiltered set.
      expect(expDefs.length).toBeLessThanOrEqual(allDefs.length);
    },
    30_000,
  );

  test(
    "F43: file filter returns only definitions in the target file (PG honors the file filter)",
    async () => {
      const target = "decorator-heavy.ts";
      const r = await httpGet<any>("/api/v1/symbol/definitions", {
        projectId: pid,
        file: target,
        limit: 50,
      });
      expect(r?.success).toBe(true);
      const defs = r?.data?.definitions ?? [];
      expect(defs.length).toBeGreaterThan(0);
      // Every returned row honors the file filter.
      for (const d of defs) {
        expect(d.file).toBe(target);
      }
      // The file's class is expected to surface.
      const names = new Set(defs.map((d: any) => d.name));
      expect(names.has("PolyRoot")).toBe(true);
    },
    30_000,
  );

  test(
    "F44: limit:3 caps the returned definitions count",
    async () => {
      // `limit` IS honored on the PG backend (passed through to LIMIT clause).
      const r = await httpGet<any>("/api/v1/symbol/definitions", {
        projectId: pid,
        limit: 3,
      });
      expect(r?.success).toBe(true);
      const defs = r?.data?.definitions ?? [];
      expect(defs.length).toBeLessThanOrEqual(3);
    },
    30_000,
  );

  // ── get_references (F45–F47) ─────────────────────────────────────────────

  test(
    "F45: get_references returns references with refKind in known set",
    async () => {
      const r = await httpGet<any>("/api/v1/symbol/references", {
        projectId: pid,
        symbolName: "ghost",
        limit: 20,
      });
      expect(r?.success).toBe(true);
      const refs = r?.data?.references ?? [];
      expect(refs.length).toBeGreaterThan(0);
      const knownKinds = new Set([
        "call",
        "import",
        "type_ref",
        "type_ref/import",
        "extend",
        "implement",
        "definition",
        "reference",
        "http_call",
        "data_flow",
        "emit",
      ]);
      for (const ref of refs) {
        expect(typeof ref.fromFile).toBe("string");
        expect(typeof ref.fromLine).toBe("number");
        expect(typeof ref.refKind).toBe("string");
        expect(knownKinds.has(ref.refKind)).toBe(true);
      }
    },
    30_000,
  );

  test(
    "F46: overloaded legacy FQN returns exact ambiguity candidates",
    async () => {
      const definitions = await httpGet<any>("/api/v1/symbol/definitions", {
        projectId: pid,
        search: "run",
        file: "sentinel.java",
        kind: "method",
        limit: 10,
      });
      const fqns = definitions.data.definitions.map((definition: any) => definition.fqn).sort();
      expect(fqns).toHaveLength(2);
      const legacyFqn = "sentinel.java#run";
      const ambiguous = await httpGet<any>("/api/v1/symbol/definition", {
        projectId: pid,
        symbolName: legacyFqn,
      });
      expect(ambiguous.data.identity).toMatchObject({ status: "ambiguous", legacyFqn });
      expect(ambiguous.data.identity.candidates.map((candidate: any) => candidate.fqn).sort()).toEqual(fqns);
    },
    30_000,
  );

  test(
    "F47: limit cap honored + shown/total present",
    async () => {
      const big = await httpGet<any>("/api/v1/symbol/references", {
        projectId: pid,
        symbolName: "ghost",
        limit: 200,
      });
      const small = await httpGet<any>("/api/v1/symbol/references", {
        projectId: pid,
        symbolName: "ghost",
        limit: 2,
      });
      expect(big?.success).toBe(true);
      expect(small?.success).toBe(true);
      // shown + total are part of the contract (see workspace.ts:209-216).
      expect(typeof small?.data?.shown).toBe("number");
      expect(typeof small?.data?.total).toBe("number");
      expect(small.data.shown).toBeLessThanOrEqual(2);
      expect((small?.data?.references ?? []).length).toBe(small.data.shown);
      // total is stable across limit changes (it's the full match count).
      expect(small.data.total).toBe(big.data.total);
    },
    30_000,
  );

  // ── go_to_definition (F48–F50) ───────────────────────────────────────────

  test(
    "F48: go_to_definition resolves PolyRoot to its source file",
    async () => {
      const r = await httpGet<any>("/api/v1/symbol/definition", {
        projectId: pid,
        symbolName: "PolyRoot",
      });
      expect(r?.success).toBe(true);
      expect(r?.data?.found).toBe(true);
      expect(r?.data?.symbolName).toBe("PolyRoot");
      const defs = r?.data?.definitions ?? [];
      expect(defs.length).toBeGreaterThan(0);
      const top = defs[0];
      expect(top.kind).toBe("class");
      expect(top.file).toBe("decorator-heavy.ts");
      expect(typeof top.lineStart).toBe("number");
    },
    30_000,
  );

  test(
    "F49: bare-name lookup reports explicit bare identity",
    async () => {
      const response = await httpGet<any>("/api/v1/symbol/definition", {
        projectId: pid,
        symbolName: "PolyRoot",
      });
      expect(response.success).toBe(true);
      expect(response.data.identity).toEqual({ status: "bare", query: "PolyRoot" });
      expect(response.data.definitions).toHaveLength(1);
    },
    30_000,
  );

  test(
    "F50: unknown symbol → {found:false} with empty definitions",
    async () => {
      const r = await httpGet<any>("/api/v1/symbol/definition", {
        projectId: pid,
        symbolName: "ZZZNoSuchSymbolXYZ_t4",
      });
      expect(r?.success).toBe(true);
      expect(r?.data?.found).toBe(false);
      expect(r?.data?.symbolName).toBe("ZZZNoSuchSymbolXYZ_t4");
      expect(Array.isArray(r?.data?.definitions)).toBe(true);
      expect((r?.data?.definitions ?? []).length).toBe(0);
    },
    30_000,
  );

  // ── Polyglot active-generation contract ──────────────────────────────────

  describe("all-33 polyglot structural graph", () => {
    test(
      "every allowed extension exposes its exact sentinel and manifest-tier kind",
      async () => {
        const fixture = await inspectPolyglotFixture();
        const map = await httpGet<any>(`/api/v1/workspace/${POLY_PID}/map`);
        expect(map?.success).toBe(true);
        expect(map.data.activatedGraphGenerationId).toBe(generationId);
        expect(map.data.stats.files).toBe(fixture.files.length);
        expect(map.data.parserDiagnostics).toMatchObject({
          diagnosticsCount: 0,
          recoveredFiles: 0,
          hardFailureFiles: 0,
          staleFiles: 0,
        });

        for (const expected of POLYGLOT_EXPECTATIONS) {
          const response = await httpGet<any>("/api/v1/symbol/definitions", {
            projectId: POLY_PID,
            search: expected.sentinel,
            file: expected.file,
            kind: expected.kind,
            limit: 20,
          });
          expect(response?.success, expected.extension).toBe(true);
          const exact = (response?.data?.definitions ?? []).filter((definition: any) =>
            definition.name === expected.sentinel &&
            definition.file === expected.file &&
            definition.kind === expected.kind,
          );
          expect(exact, `${expected.extension}:${expected.tier}`).toHaveLength(1);
          if (expected.qualifiedName) {
            expect(parseStructuralFqn(exact[0].fqn)).toEqual({
              format: "qualified",
              file: expected.file,
              qualifiedName: expected.qualifiedName,
              kind: expected.kind,
              signatureHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            });
          } else {
            expect(exact[0].fqn).toBe(`${expected.file}#${expected.sentinel}`);
          }

          const references = await httpGet<any>("/api/v1/symbol/references", {
            projectId: POLY_PID,
            symbolName: expected.flowTarget ?? expected.sentinel,
            limit: 200,
          });
          expect(references.success).toBe(true);
          const fromFixtureFile = references.data.references.filter((reference: any) =>
            reference.fromFile === expected.file
          );
          if (expected.tier === "flow") {
            expect(fromFixtureFile.length, `${expected.extension}:${expected.flowTarget}`)
              .toBeGreaterThan(0);
          } else {
            expect(fromFixtureFile, `${expected.extension}:structure-only`).toEqual([]);
          }
        }
      },
      180_000,
    );

    test(
      "modern FQNs resolve exactly and overloaded legacy FQNs return stable ambiguity",
      async () => {
        const defs = await httpGet<any>("/api/v1/symbol/definitions", {
          projectId: POLY_PID,
          search: "run",
          file: "sentinel.java",
          kind: "method",
          limit: 10,
        });
        const overloads = (defs?.data?.definitions ?? []).filter((definition: any) =>
          definition.name === "run" && definition.file === "sentinel.java",
        );
        expect(overloads).toHaveLength(2);
        const modernFqns = overloads.map((definition: any) => definition.fqn).sort();
        expect(new Set(modernFqns).size).toBe(2);
        const parsedModern = modernFqns.map((fqn: string) => parseStructuralFqn(fqn));
        for (const parsed of parsedModern) {
          expect(parsed).toEqual({
            format: "qualified",
            file: "sentinel.java",
            qualifiedName: "PolyJava.run",
            kind: "method",
            signatureHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          });
        }
        expect(new Set(parsedModern.map((parsed) =>
          parsed.format === "qualified" ? parsed.signatureHash : ""
        )).size).toBe(2);

        const legacyFqn = "sentinel.java#run";
        const legacy = await httpGet<any>("/api/v1/symbol/definition", {
          projectId: POLY_PID,
          symbolName: legacyFqn,
        });
        expect(legacy.data.identity).toEqual({
          status: "ambiguous",
          legacyFqn,
          candidates: legacy.data.identity.candidates,
        });
        expect(legacy.data.identity.candidates.map((candidate: any) => candidate.fqn).sort())
          .toEqual(modernFqns);
        expect(legacy.data.definitions).toEqual([]);

        for (const fqn of modernFqns) {
          const modern = await httpGet<any>("/api/v1/symbol/definition", {
            projectId: POLY_PID,
            symbolName: fqn,
          });
          expect(modern.data.identity).toEqual({ status: "resolved", fqn });
          expect(modern.data.definitions.map((definition: any) => definition.fqn)).toEqual([fqn]);
        }
      },
      60_000,
    );

    test(
      "unresolved import references are retained without poisoning activation",
      async () => {
        const definitions = await httpGet<any>("/api/v1/symbol/definitions", {
          projectId: POLY_PID,
          search: "usesGhost",
          file: "decorator-heavy.ts",
          kind: "function",
          limit: 5,
        });
        expect(definitions.data.definitions).toHaveLength(1);
        const references = await httpGet<any>("/api/v1/symbol/references", {
          projectId: POLY_PID,
          symbolName: "ghost",
          limit: 20,
        });
        expect(references.success).toBe(true);
        expect(references.data.references).toEqual(expect.arrayContaining([
          expect.objectContaining({
            fromFile: "decorator-heavy.ts",
            symbolName: "ghost",
          }),
        ]));
        const map = await httpGet<any>(`/api/v1/workspace/${POLY_PID}/map`);
        expect(map.data.activatedGraphGenerationId).toBe(generationId);
      },
      60_000,
    );

    test(
      "HTTP and MCP preserve exact diagnostics plus modern and legacy identity payloads",
      async () => {
        const httpMap = await httpGet<any>(`/api/v1/workspace/${POLY_PID}/map`, {
          centralityLimit: 5,
          recentLimit: 5,
        });
        const mcpMap = await mcpCall(mcp.client, "project_map", {
          id: POLY_PID,
          centralityLimit: 5,
          recentLimit: 5,
        });
        assertMatrix(httpMap, mcpMap, {
          dropKeys: ["lastIndexedAt", "indexedAt", "updatedAt", "score"],
        }, "polyglot project_map");

        const legacyFqn = "sentinel.java#run";
        const httpDefinition = await httpGet<any>("/api/v1/symbol/definition", {
          projectId: POLY_PID,
          symbolName: legacyFqn,
        });
        const mcpDefinition = await mcpCall(mcp.client, "go_to_definition", {
          projectId: POLY_PID,
          symbolName: legacyFqn,
        });
        expect(httpDefinition.data.identity.status).toBe("ambiguous");
        expect(mcpDefinition.data.identity.status).toBe("ambiguous");
        assertMatrix(httpDefinition, mcpDefinition, {}, "polyglot ambiguity");

        const overloads = await httpGet<any>("/api/v1/symbol/definitions", {
          projectId: POLY_PID,
          search: "run",
          file: "sentinel.java",
          kind: "method",
          limit: 10,
        });
        const modernFqn = overloads.data.definitions
          .map((definition: any) => definition.fqn)
          .sort()[0];
        expect(parseStructuralFqn(modernFqn)).toMatchObject({
          format: "qualified",
          file: "sentinel.java",
          qualifiedName: "PolyJava.run",
          kind: "method",
        });
        const httpModern = await httpGet<any>("/api/v1/symbol/definition", {
          projectId: POLY_PID,
          symbolName: modernFqn,
        });
        const mcpModern = await mcpCall(mcp.client, "go_to_definition", {
          projectId: POLY_PID,
          symbolName: modernFqn,
        });
        for (const response of [httpModern, mcpModern]) {
          expect(response.data.identity).toEqual({ status: "resolved", fqn: modernFqn });
          expect(response.data.definitions.map((definition: any) => definition.fqn))
            .toEqual([modernFqn]);
        }
        assertMatrix(httpModern, mcpModern, {}, "polyglot modern identity");
      },
      60_000,
    );
  });

  // ── Matrix (MCP ≡ HTTP) ───────────────────────────────────────────────────
  //
  // All T4 tools are bucket C (no `format` param) → the MCP proxy returns the
  // full {success,data} envelope directly comparable to the HTTP body. Volatile
  // keys (timestamps, lastIndexedAt, centrality scores, counts that depend on
  // extraction nondeterminism) are dropped via assertMatrix before comparison.

  test(
    "matrix: list_projects equivalent on both transports",
    async () => {
      const http = await httpGet<any>("/api/v1/workspace/list");
      const fresh = await startMcp();
      let mcpRes: any;
      try {
        mcpRes = await mcpCall(fresh.client, "list_projects", {});
      } finally {
        await fresh.stop();
      }
      expect(http?.success).toBe(true);
      expect(mcpRes?.success).toBe(true);
      assertMatrix(http, mcpRes, { dropKeys: ["lastIndexedAt"] }, "list_projects");
    },
    60_000,
  );

  test(
    "matrix: project_map equivalent on both transports",
    async () => {
      const args = { id: pid, centralityLimit: 5, recentLimit: 3 };
      const http = await httpGet<any>(`/api/v1/workspace/${pid}/map`, {
        centralityLimit: 5,
        recentLimit: 3,
      });
      const fresh = await startMcp();
      let mcpRes: any;
      try {
        mcpRes = await mcpCall(fresh.client, "project_map", args);
      } finally {
        await fresh.stop();
      }
      expect(http?.success).toBe(true);
      expect(mcpRes?.success).toBe(true);
      // Drop centrality scores (float nondeterminism) and timestamps. The
      // structural shape + integer counts + file lists are the parity contract.
      assertMatrix(
        http,
        mcpRes,
        { dropKeys: ["lastIndexedAt", "indexedAt", "updatedAt", "score"] },
        "project_map",
      );
    },
    60_000,
  );

  test(
    "matrix: search_definitions equivalent on both transports",
    async () => {
      // Exercise search + kind + exportedOnly + limit (all PG filters now honored)
      // so the matrix compares a deterministic, filtered result set.
      const http = await httpGet<any>("/api/v1/symbol/definitions", {
        projectId: pid,
        search: "PolyRoot",
        kind: "class",
        exportedOnly: "true",
        limit: 5,
      });
      const fresh = await startMcp();
      let mcpRes: any;
      try {
        mcpRes = await mcpCall(fresh.client, "search_definitions", {
          projectId: pid,
          search: "PolyRoot",
          kind: "class",
          exportedOnly: true,
          limit: 5,
        });
      } finally {
        await fresh.stop();
      }
      expect(http?.success).toBe(true);
      expect(mcpRes?.success).toBe(true);
      assertMatrix(http, mcpRes, { dropKeys: ["centralityScore"] }, "search_definitions");
    },
    60_000,
  );

  test(
    "matrix: get_references equivalent on both transports",
    async () => {
      const http = await httpGet<any>("/api/v1/symbol/references", {
        projectId: pid,
        symbolName: "ghost",
        limit: 5,
      });
      const fresh = await startMcp();
      let mcpRes: any;
      try {
        mcpRes = await mcpCall(fresh.client, "get_references", {
          projectId: pid,
          symbolName: "ghost",
          limit: 5,
        });
      } finally {
        await fresh.stop();
      }
      expect(http?.success).toBe(true);
      expect(mcpRes?.success).toBe(true);
      // `context` is a file-read enrichment that can vary if the underlying file
      // changes between calls; drop it. `targetFqn` is stable.
      assertMatrix(http, mcpRes, { dropKeys: ["context"] }, "get_references");
    },
    60_000,
  );

  test(
    "matrix: go_to_definition equivalent on both transports",
    async () => {
      const http = await httpGet<any>("/api/v1/symbol/definition", {
        projectId: pid,
        symbolName: "PolyRoot",
      });
      const fresh = await startMcp();
      let mcpRes: any;
      try {
        mcpRes = await mcpCall(fresh.client, "go_to_definition", {
          projectId: pid,
          symbolName: "PolyRoot",
        });
      } finally {
        await fresh.stop();
      }
      expect(http?.success).toBe(true);
      expect(mcpRes?.success).toBe(true);
      // snippet + centralityScore are enrichment that can vary; drop them.
      assertMatrix(
        http,
        mcpRes,
        { dropKeys: ["snippet", "centralityScore"] },
        "go_to_definition",
      );
    },
    60_000,
  );
});

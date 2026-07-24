import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import {
  GraphController,
  indexJobTracker,
  symbolGraphService,
  type DefinitionLookupResult,
} from "@massa-ai/core";
import { projectRoutes } from "../routes/project.js";
import { workspaceRoutes } from "../routes/workspace.js";

const projectId = "transport-project";
const legacyFqn = "src/service.ts#run";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const candidates = [
  {
    fqn: `src/service.ts#Service.run~method~${hashA}`,
    file: "src/service.ts",
    name: "run",
    displayName: "Service.run",
    qualifiedName: "Service.run",
    kind: "method" as const,
    signatureHash: hashA,
  },
  {
    fqn: `src/service.ts#Service.run~method~${hashB}`,
    file: "src/service.ts",
    name: "run",
    displayName: "Service.run",
    qualifiedName: "Service.run",
    kind: "method" as const,
    signatureHash: hashB,
  },
] as const;

const ambiguous: DefinitionLookupResult = {
  status: "ambiguous",
  legacyFqn,
  candidates,
};

const app = new Elysia().use(workspaceRoutes);
const projectApp = new Elysia().use(projectRoutes);
const graphController = GraphController.getInstance();
const originals = {
  lookupDefinition: symbolGraphService.lookupDefinition,
  goToDefinition: symbolGraphService.goToDefinition,
  getReferences: symbolGraphService.getReferences,
  getProjectMap: symbolGraphService.getProjectMap,
  tracePath: graphController.tracePath,
};

async function get(path: string): Promise<any> {
  const response = await app.handle(new Request(`http://localhost${path}`));
  return response.json();
}

describe("Tools API structural transport", () => {
  beforeEach(() => {
    symbolGraphService.lookupDefinition = async () => ambiguous;
    symbolGraphService.goToDefinition = async () => {
      throw new Error("ambiguous identity must not choose a definition");
    };
    symbolGraphService.getReferences = async () => {
      throw new Error("ambiguous identity must not choose references");
    };
    graphController.tracePath = async () => ({
      found: false,
      symbol: legacyFqn,
      projectId,
      identityResolution: ambiguous,
      hint: "unused for explicit ambiguity",
    });
    symbolGraphService.getProjectMap = originals.getProjectMap;
  });

  afterAll(() => {
    symbolGraphService.lookupDefinition = originals.lookupDefinition;
    symbolGraphService.goToDefinition = originals.goToDefinition;
    symbolGraphService.getReferences = originals.getReferences;
    symbolGraphService.getProjectMap = originals.getProjectMap;
    graphController.tracePath = originals.tracePath;
  });

  test("definition, references, and trace return one stable ambiguity payload", async () => {
    const definition = await get(
      `/api/v1/symbol/definition?projectId=${projectId}&symbolName=${encodeURIComponent(legacyFqn)}`,
    );
    const references = await get(
      `/api/v1/symbol/references?projectId=${projectId}&symbolName=run&fqn=${encodeURIComponent(legacyFqn)}`,
    );
    const trace = await get(
      `/api/v1/symbol/trace?projectId=${projectId}&qualifiedName=${encodeURIComponent(legacyFqn)}`,
    );

    const expected = { status: "ambiguous", legacyFqn, candidates };
    expect(definition.success).toBe(true);
    expect(references.success).toBe(true);
    expect(trace.success).toBe(true);
    expect(definition.data.identity).toEqual(expected);
    expect(references.data.identity).toEqual(expected);
    expect(trace.data.identity).toEqual(expected);
    expect(definition.data.definitions).toEqual([]);
    expect(references.data.references).toEqual([]);
    expect(trace.data.found).toBe(false);

  });

  test("modern and unique legacy FQNs serialize the same resolved identity", async () => {
    const modernFqn = candidates[0].fqn;
    const uniqueLegacyFqn = "src/service.ts#uniqueRun";
    const resolvedDefinition = {
      id: modernFqn,
      project_id: projectId,
      file_path: "src/service.ts",
      name: "run",
      kind: "method" as const,
      line_start: 3,
      line_end: 4,
      exported: true,
      indexed_at: 1,
    };
    symbolGraphService.lookupDefinition = async () => ({
      status: "resolved",
      definition: resolvedDefinition,
    });
    symbolGraphService.goToDefinition = async () => [{
      fqn: modernFqn,
      name: "run",
      kind: "method",
      file: "src/service.ts",
      lineStart: 3,
      lineEnd: 4,
      exported: true,
      centralityScore: 0.5,
    }];
    symbolGraphService.getReferences = async () => [{
      fromFile: "src/caller.ts",
      fromLine: 8,
      refKind: "call",
      symbolName: "run",
      targetFqn: modernFqn,
    }];
    graphController.tracePath = async () => ({
      found: true,
      result: {
        projectId,
        symbol: modernFqn,
        mode: "calls",
        direction: "outbound",
        edgeTypes: ["call"],
        seeds: [modernFqn],
        truncated: false,
        nodeCount: 1,
        edgeCount: 0,
        chains: [],
        nodes: [],
        edges: [],
        // N4 (WAVE4-N4, T8): TracePathOutput requires the total/shown/omitted
        // fields on every response. The mock returns a non-truncated result
        // (nodeCount=1, well under MAX_NODES=2000), so all three are equal to
        // the displayed count and omitted is 0.
        nodes_total: 1,
        nodes_shown: 1,
        nodes_omitted: 0,
        identity: { status: "resolved", fqn: modernFqn },
      },
    });

    for (const fqn of [modernFqn, uniqueLegacyFqn]) {
      const definition = await get(
        `/api/v1/symbol/definition?projectId=${projectId}&symbolName=${encodeURIComponent(fqn)}`,
      );
      const references = await get(
        `/api/v1/symbol/references?projectId=${projectId}&symbolName=run&fqn=${encodeURIComponent(fqn)}`,
      );
      const trace = await get(
        `/api/v1/symbol/trace?projectId=${projectId}&qualifiedName=${encodeURIComponent(fqn)}`,
      );
      const expected = { status: "resolved", fqn: modernFqn };
      expect(definition.data.identity).toEqual(expected);
      expect(references.data.identity).toEqual(expected);
      expect(trace.data.identity).toEqual(expected);
      expect(definition.data.definitions[0].fqn).toBe(modernFqn);
      expect(references.data.references[0].targetFqn).toBe(modernFqn);
      expect(trace.data.seeds).toEqual([modernFqn]);

    }
  });

  test("missing identity has one exact HTTP schema for every graph consumer", async () => {
    const missingFqn = "src/missing.ts#gone";
    const missing: DefinitionLookupResult = {
      status: "missing",
      query: missingFqn,
    };
    symbolGraphService.lookupDefinition = async () => missing;
    graphController.tracePath = async () => ({
      found: false,
      symbol: missingFqn,
      projectId,
      identityResolution: missing,
      hint: "No active definition",
    });

    const definition = await get(
      `/api/v1/symbol/definition?projectId=${projectId}&symbolName=${encodeURIComponent(missingFqn)}`,
    );
    const references = await get(
      `/api/v1/symbol/references?projectId=${projectId}&symbolName=gone&fqn=${encodeURIComponent(missingFqn)}`,
    );
    const trace = await get(
      `/api/v1/symbol/trace?projectId=${projectId}&qualifiedName=${encodeURIComponent(missingFqn)}`,
    );

    const expected = { status: "missing", query: missingFqn };
    expect(definition.data.identity).toEqual(expected);
    expect(references.data.identity).toEqual(expected);
    expect(trace.data.identity).toEqual(expected);
  });

  test("project map preserves exact active diagnostics and separate extension counts", async () => {
    const map = {
      projectId,
      stats: { files: 3, chunks: 4, symbols: 5, status: "indexed", lastIndexedAt: null },
      topCentralFiles: [],
      symbolsByKind: { method: 2 },
      activatedGraphGenerationId: "generation-active",
      parserDiagnostics: {
        diagnosticsCount: 27,
        recoveredFiles: 2,
        hardFailureFiles: 3,
        staleFiles: 1,
        languages: { typescript: 2, vue: 1 },
      },
      filesByLanguage: { ts: 2, vue: 1 },
      recentFiles: [],
    };
    symbolGraphService.getProjectMap = async () => map;

    const response = await get(`/api/v1/workspace/${projectId}/map`);
    expect(response.success).toBe(true);
    expect(response.data.activatedGraphGenerationId).toBe("generation-active");
    expect(response.data.parserDiagnostics).toEqual(map.parserDiagnostics);
    expect(response.data.filesByLanguage).toEqual({ ts: 2, vue: 1 });
    expect(response.data).not.toHaveProperty("diagnostics");
  });

  test("durable index-status HTTP payload exposes exact diagnostics and generation identity", async () => {
    indexJobTracker.clear();
    const job = indexJobTracker.createJob(projectId, "/tmp/transport-project");
    indexJobTracker.setResult(job.jobId, {
      filesIndexed: 3,
      chunksIndexed: 4,
      errors: 27,
      duration: 42,
      activatedGraphGenerationId: "generation-active",
      parserDiagnostics: {
        diagnosticsCount: 27,
        recoveredFiles: 2,
        hardFailureFiles: 3,
        staleFiles: 1,
        languages: { typescript: 2, vue: 1 },
      },
    });
    const response = await projectApp.handle(new Request(
      `http://localhost/api/v1/project/index/status/${job.jobId}`,
    ));
    const http = await response.json() as any;
    expect(http.success).toBe(true);
    expect(http.data.result.activatedGraphGenerationId).toBe("generation-active");
    expect(http.data.result.parserDiagnostics.diagnosticsCount).toBe(27);
  });
});

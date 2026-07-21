import { beforeAll, describe, expect, mock, test } from "bun:test";
import { describeNative } from "./_helpers/native-skip.js";
import { resetParserReadinessForTests } from "../services/structural/parser-readiness.js";
import { LANGUAGE_MANIFEST } from "../services/structural/language-manifest.js";
import { grammarArtifactKey } from "../services/structural/grammar-loaders.js";
import { buildGraphInputSnapshotHash } from "../services/etl/graph-generation-coordinator.js";

const invalidations: string[] = [];
let releaseInvalidation!: () => void;

mock.module("../services/search/cache-factory.js", () => ({
  getSearchCache: () => ({
    invalidateProject: async (projectId: string) => {
      invalidations.push(projectId);
      await new Promise<void>((resolve) => {
        releaseInvalidation = resolve;
      });
      return 1;
    },
  }),
}));

function stubGrammarSet(): { Parser: any; grammars: Map<string, unknown> } {
  const grammars = new Map<string, unknown>();
  for (const entry of LANGUAGE_MANIFEST) {
    grammars.set(grammarArtifactKey(entry.grammarArtifact), { lang: entry.extension });
  }
  class StubParser {
    setLanguage() {}
    parse(source: string) {
      return {
        rootNode: { hasError: false, endIndex: Buffer.byteLength(source, "utf8"), type: "program" },
        delete() {},
      };
    }
  }
  return { Parser: StubParser as any, grammars };
}

let pipeline: any;
let indexJobTracker: any;
let originalGraphGenerations: any;
let symbolRepo: any;
let originalGetActiveGraphSnapshot: any;

beforeAll(async () => {
  const pipelineModule = await import("../services/etl/pipeline.js");
  pipeline = pipelineModule.EtlPipeline.getInstance();
  ({ indexJobTracker } = await import("../services/jobs/index-job-tracker.js"));
  originalGraphGenerations = pipeline.graphGenerations;
  const { getSymbolRepository } = await import("../data/symbol/symbol-repository-factory.js");
  symbolRepo = getSymbolRepository();
  originalGetActiveGraphSnapshot = symbolRepo.getActiveGraphSnapshot;
});

describeNative("ETL search-cache consistency", () => {
  test("invalidates project cache before exposing a completed job", async () => {
    resetParserReadinessForTests(async () => stubGrammarSet());
    const emptySnapshotHash = buildGraphInputSnapshotHash([]);
    const fakeLease = { generationId: "g1", projectId: "cache-project", expectedActiveGenerationId: null, leaseToken: "t1", leaseExpiresAt: Date.now() + 60000, fingerprint: "f", inputSnapshotHash: emptySnapshotHash, expectedFilesCount: 0 };
    pipeline.graphGenerations = {
      begin: async () => fakeLease,
      heartbeat: async () => {},
      activate: async () => ({ status: "activated", generationId: "g1", activeGenerationId: "g1" }),
      abort: async () => {},
      cleanup: async () => {},
    };
    let snapshotCall = 0;
    symbolRepo.getActiveGraphSnapshot = async () => {
      snapshotCall++;
      return snapshotCall === 1 ? null : { generationId: "g1", languages: {}, diagnostics: { errors: 0, recovered: 0, hardFailures: 0, staleFiles: 0 } };
    };
    const job = indexJobTracker.createJob("cache-project", "/tmp");
    indexJobTracker.updateStatus(job.jobId, "running");

    pipeline.discover.run = async () => [];
    pipeline.parse.run = async () => [];
    pipeline.resolve.run = async () => [];
    pipeline.load.run = async () => ({
      filesLoaded: 1,
      chunksLoaded: 1,
      symbolsLoaded: 1,
      errors: 0,
    });

    const run = pipeline.run({
      projectId: "cache-project",
      projectPath: "/tmp",
      jobId: job.jobId,
    });

    while (invalidations.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(invalidations).toEqual(["cache-project"]);
    expect(indexJobTracker.getJob(job.jobId)?.status).toBe("running");

    releaseInvalidation();
    await run;

    expect(indexJobTracker.getJob(job.jobId)?.status).toBe("completed");
    pipeline.graphGenerations = originalGraphGenerations;
    symbolRepo.getActiveGraphSnapshot = originalGetActiveGraphSnapshot;
    resetParserReadinessForTests();
  });
});

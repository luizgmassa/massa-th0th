import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { describeNative } from "./_helpers/native-skip.js";
import { EtlPipeline } from "../services/etl/pipeline.js";
import { indexJobTracker } from "../services/jobs/index-job-tracker.js";
import { resetParserReadinessForTests } from "../services/structural/parser-readiness.js";
import { LANGUAGE_MANIFEST } from "../services/structural/language-manifest.js";
import { grammarArtifactKey } from "../services/structural/grammar-loaders.js";
import { ProjectIdentityAliasResolver, setProjectIdentityAliasResolverForTests } from "../services/project-identity/alias-resolver.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function result(errors = 0) {
  return {
    filesDiscovered: 1,
    filesIndexed: errors === 0 ? 1 : 0,
    filesSkipped: 0,
    chunksIndexed: errors === 0 ? 1 : 0,
    symbolsIndexed: errors === 0 ? 1 : 0,
    errors,
    durationMs: 1,
    stageTimings: { discover: 0, parse: 0, resolve: 0, load: 0 },
  };
}

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

describeNative("EtlPipeline per-project run queue", () => {
  const pipeline = EtlPipeline.getInstance() as any;
  let originalRunInternal: (input: any) => Promise<any>;
  let originalDiscoverRun: (context: any, input: any) => Promise<any>;
  let originalParseRun: (context: any, input: any) => Promise<any>;
  let originalResolveRun: (context: any, input: any) => Promise<any>;
  let originalLoadRun: (context: any, input: any) => Promise<any>;
  let originalGraphGenerations: any;

  beforeEach(() => {
    originalRunInternal = pipeline.runInternal;
    originalDiscoverRun = pipeline.discover.run;
    originalParseRun = pipeline.parse.run;
    originalResolveRun = pipeline.resolve.run;
    originalLoadRun = pipeline.load.run;
    originalGraphGenerations = pipeline.graphGenerations;
    (EtlPipeline as any).runTails = new Map();
    resetParserReadinessForTests(async () => stubGrammarSet());
    setProjectIdentityAliasResolverForTests(new ProjectIdentityAliasResolver({ querier: { async lookupCanonical() { return null; } } }));
    const fakeLease = { generationId: "g1", projectId: "stub", expectedActiveGenerationId: null, leaseToken: "t1", leaseExpiresAt: Date.now() + 60000, fingerprint: "f", inputSnapshotHash: "h", expectedFilesCount: 0 };
    pipeline.graphGenerations = {
      begin: async () => fakeLease,
      heartbeat: async () => {},
      activate: async () => ({ status: "activated", generationId: "g1", activeGenerationId: "g1" }),
      abort: async () => {},
      cleanup: async () => {},
    };
  });

  afterEach(() => {
    pipeline.runInternal = originalRunInternal;
    pipeline.discover.run = originalDiscoverRun;
    pipeline.parse.run = originalParseRun;
    pipeline.resolve.run = originalResolveRun;
    pipeline.load.run = originalLoadRun;
    pipeline.graphGenerations = originalGraphGenerations;
    (EtlPipeline as any).runTails = new Map();
    resetParserReadinessForTests();
    setProjectIdentityAliasResolverForTests(null);
  });

  test("A, B, and C for one project execute in FIFO order", async () => {
    const gates = [deferred(), deferred(), deferred()];
    const order: string[] = [];
    let call = 0;
    pipeline.runInternal = async (input: { jobId: string }) => {
      const gate = gates[call++];
      order.push(`start:${input.jobId}`);
      await gate.promise;
      order.push(`end:${input.jobId}`);
      return result();
    };

    const runs = ["A", "B", "C"].map((jobId) =>
      pipeline.run({ projectId: "same", projectPath: "/tmp", jobId }),
    );
    await tick();
    expect(order).toEqual(["start:A"]);

    gates[0].resolve();
    await tick();
    expect(order).toEqual(["start:A", "end:A", "start:B"]);

    gates[1].resolve();
    await tick();
    expect(order).toEqual(["start:A", "end:A", "start:B", "end:B", "start:C"]);

    gates[2].resolve();
    await Promise.all(runs);
    expect(order).toEqual(["start:A", "end:A", "start:B", "end:B", "start:C", "end:C"]);
    expect((EtlPipeline as any).runTails.size).toBe(0);
  });

  test("different projects execute independently", async () => {
    const blocked = deferred();
    const order: string[] = [];
    pipeline.runInternal = async (input: { projectId: string }) => {
      order.push(`start:${input.projectId}`);
      if (input.projectId === "blocked") await blocked.promise;
      order.push(`end:${input.projectId}`);
      return result();
    };

    const first = pipeline.run({ projectId: "blocked", projectPath: "/tmp", jobId: "A" });
    const second = pipeline.run({ projectId: "independent", projectPath: "/tmp", jobId: "B" });
    await tick();

    expect(order).toContain("start:blocked");
    expect(order).toContain("start:independent");
    expect(order).toContain("end:independent");
    expect(order).not.toContain("end:blocked");

    blocked.resolve();
    await Promise.all([first, second]);
  });

  test("a failed run releases the next same-project run and cleans up", async () => {
    const order: string[] = [];
    pipeline.runInternal = async (input: { jobId: string }) => {
      order.push(input.jobId);
      if (input.jobId === "A") throw new Error("boom");
      return result();
    };

    const first = pipeline
      .run({ projectId: "same", projectPath: "/tmp", jobId: "A" })
      .catch((error: Error) => error.message);
    const second = pipeline.run({ projectId: "same", projectPath: "/tmp", jobId: "B" });

    expect(await first).toBe("boom");
    expect(await second).toEqual(result());
    expect(order).toEqual(["A", "B"]);
    expect((EtlPipeline as any).runTails.size).toBe(0);
  });

  test("a partial ETL result marks the job failed instead of completed", async () => {
    const job = indexJobTracker.createJob("partial", "/tmp");
    indexJobTracker.updateStatus(job.jobId, "running");

    pipeline.discover.run = async () => [];
    pipeline.parse.run = async () => [];
    pipeline.resolve.run = async () => [];
    pipeline.load.run = async () => ({
      filesLoaded: 0,
      chunksLoaded: 0,
      symbolsLoaded: 0,
      errors: 1,
    });

    await expect(
      pipeline.run({ projectId: "partial", projectPath: "/tmp", jobId: job.jobId }),
    ).rejects.toThrow("ETL completed with 1 file error");
    expect(indexJobTracker.getJob(job.jobId)?.status).toBe("failed");
    expect(indexJobTracker.getJob(job.jobId)?.error).toBe("ETL completed with 1 file error");
  });
});

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { describeNative } from "../_helpers/native-skip.js";
import { DEFAULT_ALLOWED_EXTENSIONS } from "@massa-ai/shared";
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StructuralRuntime } from "../../services/structural/structural-runtime.js";
import {
  E2E_ENABLED,
  PREFIX,
  POLY_FIXTURE_PATH,
  RUN_STAMP,
  getJobStatus,
  httpGet,
  httpPost,
  indexAndAwait,
  pollUntil,
  probeAvailability,
  resetProject,
} from "./_helpers.js";
import {
  POLYGLOT_EXPECTATIONS,
  assertPolyglotContractStatic,
  inspectPolyglotFixture,
} from "./polyglot-fixture.js";

const PID = `${PREFIX}index-poly-${RUN_STAMP}`;
const fixture = await inspectPolyglotFixture();
setDefaultTimeout(900_000);

describeNative("polyglot fixture contract", () => {
  test("covers exactly all 33 allowed extensions with a deterministic sentinel", () => {
    assertPolyglotContractStatic();
    expect(DEFAULT_ALLOWED_EXTENSIONS).toHaveLength(33);
    expect(new Set(DEFAULT_ALLOWED_EXTENSIONS).size).toBe(33);
    expect(fixture.files).toHaveLength(33);
    expect(fixture.extensions).toEqual([...DEFAULT_ALLOWED_EXTENSIONS].sort());
    expect(POLYGLOT_EXPECTATIONS).toHaveLength(33);
    for (const expected of POLYGLOT_EXPECTATIONS) {
      expect(fixture.files).toContain(expected.file);
    }
  });

  test("native parsing extracts the exact sentinel kind from every fixture file", async () => {
    const runtime = new StructuralRuntime();
    for (const expected of POLYGLOT_EXPECTATIONS) {
      const source = await readFile(path.join(POLY_FIXTURE_PATH, expected.file));
      const outcome = await runtime.parse({ extension: expected.extension, source });
      expect(outcome.status, expected.extension).toBe("ok");
      if (outcome.status !== "ok") continue;
      expect(outcome.diagnosticCount, expected.extension).toBe(0);
      expect(outcome.structure.symbols, expected.extension).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: expected.sentinel, kind: expected.kind }),
      ]));
      if (expected.tier === "flow") {
        expect(outcome.structure.edges.some((edge) => {
          const target = edge.target.status === "unresolved" ? edge.target.name : edge.target.fqn;
          return target.includes(expected.flowTarget!);
        }), `${expected.extension}:${expected.flowTarget}`).toBe(true);
      } else {
        expect(outcome.structure.edges, expected.extension).toEqual([]);
      }
    }
  }, 120_000);
});

let READY = false;
if (E2E_ENABLED) {
  const isDarwinArm64 = process.platform === "darwin" && process.arch === "arm64";
  const isLinuxX64 = process.platform === "linux" && process.arch === "x64";
  if (!isDarwinArm64 && !isLinuxX64) {
    throw new Error("polyglot E2E is frozen to macOS arm64 or Linux glibc x64");
  }
  const availability = await probeAvailability();
  if (!availability.API_UP || !availability.OLLAMA_UP || availability.BACKEND !== "postgres") {
    throw new Error(`owned PostgreSQL E2E stack is not ready: ${JSON.stringify(availability)}`);
  }
  READY = true;
}

describe.skipIf(!READY)("polyglot indexing lifecycle", () => {
  let activeGeneration = "";
  let temporaryRoot = "";
  let temporaryFixture = "";
  let originalTypeScript: Buffer;
  let originalZig: Buffer;

  beforeAll(async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), "massa-ai-polyglot-e2e-"));
    temporaryFixture = path.join(temporaryRoot, "polyglot");
    await cp(POLY_FIXTURE_PATH, temporaryFixture, { recursive: true });
    originalTypeScript = await readFile(path.join(temporaryFixture, "decorator-heavy.ts"));
    originalZig = await readFile(path.join(temporaryFixture, "sentinel.zig"));

    const indexed = await indexAndAwait(temporaryFixture, PID, {
      forceReindex: true,
      timeoutMs: 600_000,
    });
    expect(indexed.status).toBe("completed");
    expect(indexed.jobId).toEqual(expect.any(String));
    const status = await getJobStatus(indexed.jobId!);
    const result = status?.data?.result;
    activeGeneration = result?.activatedGraphGenerationId;
    expect(activeGeneration).toEqual(expect.any(String));
    expect(result).toMatchObject({
      filesIndexed: fixture.files.length,
      errors: 0,
      parserDiagnostics: {
        diagnosticsCount: 0,
        recoveredFiles: 0,
        hardFailureFiles: 0,
        staleFiles: 0,
      },
    });
    expect(status.data.progress).toEqual({
      current: fixture.files.length,
      total: fixture.files.length,
      percentage: 100,
    });
  });

  afterAll(async () => {
    try {
      await resetProject(PID);
    } finally {
      if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("active project map exposes the exact generation, file count, and language totals", async () => {
    const response = await httpGet<any>(`/api/v1/workspace/${PID}/map`);
    expect(response?.success).toBe(true);
    const map = response.data;
    expect(map.activatedGraphGenerationId).toBe(activeGeneration);
    expect(map.stats.files).toBe(fixture.files.length);
    expect(map.parserDiagnostics).toEqual({
      diagnosticsCount: 0,
      recoveredFiles: 0,
      hardFailureFiles: 0,
      staleFiles: 0,
      languages: map.parserDiagnostics.languages,
    });
    expect(Object.values(map.parserDiagnostics.languages).reduce(
      (total: number, count) => total + Number(count),
      0,
    )).toBe(fixture.files.length);
  }, 60_000);

  test("recoverable syntax activates a complete generation and retains valid declarations", async () => {
    const recoveredSource = Buffer.concat([
      originalTypeScript,
      Buffer.from("\nexport class RecoveryKept {}\nexport function broken( {\n"),
    ]);
    await writeFile(path.join(temporaryFixture, "decorator-heavy.ts"), recoveredSource);
    const reindexed = await indexAndAwait(temporaryFixture, PID, {
      forceReindex: true,
      timeoutMs: 600_000,
    });
    expect(reindexed.status).toBe("completed");
    expect(reindexed.result?.parserDiagnostics).toMatchObject({
      diagnosticsCount: 1,
      recoveredFiles: 1,
      hardFailureFiles: 0,
      staleFiles: 0,
    });
    const recoveredGeneration = reindexed.result?.activatedGraphGenerationId;
    expect(recoveredGeneration).toEqual(expect.any(String));
    expect(recoveredGeneration).not.toBe(activeGeneration);
    const map = await httpGet<any>(`/api/v1/workspace/${PID}/map`);
    expect(map.data.activatedGraphGenerationId).toBe(recoveredGeneration);
    expect(map.data.stats.files).toBe(fixture.files.length);
    expect(map.data.parserDiagnostics).toMatchObject({
      diagnosticsCount: 1,
      recoveredFiles: 1,
      hardFailureFiles: 0,
      staleFiles: 0,
    });
    const kept = await httpGet<any>("/api/v1/symbol/definitions", {
      projectId: PID,
      search: "RecoveryKept",
      file: "decorator-heavy.ts",
      kind: "class",
      limit: 5,
    });
    expect(kept.data.definitions).toHaveLength(1);
    activeGeneration = recoveredGeneration;
  }, 700_000);

  test("an accepted stale-snapshot generation fails and preserves the complete active graph", async () => {
    const typeScriptPath = path.join(temporaryFixture, "decorator-heavy.ts");
    const zigPath = path.join(temporaryFixture, "sentinel.zig");
    const gateSourcePath = path.join(temporaryRoot, "stale-gate.source.ts");
    const firstReadAckPath = path.join(temporaryRoot, "stale-gate.first-read");
    await writeFile(gateSourcePath, originalTypeScript);
    await unlink(typeScriptPath);
    const fifo = Bun.spawn(["/usr/bin/mkfifo", typeScriptPath], {
      stdout: "ignore",
      stderr: "pipe",
    });
    expect(await fifo.exited).toBe(0);
    let release: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const started = await httpPost<any>("/api/v1/project/index", {
        projectPath: temporaryFixture,
        projectId: PID,
        forceReindex: true,
        warmCache: false,
      });
      expect(started.success).toBe(true);
      const jobId = started.data?.jobId;
      expect(jobId).toEqual(expect.any(String));
      const running = await pollUntil(async () =>
        (await getJobStatus(jobId)).data?.status === "running",
      { timeoutMs: 30_000, intervalMs: 10 });
      expect(running).toBe(true);
      const blockedMap = await httpGet<any>(`/api/v1/workspace/${PID}/map`);
      expect(blockedMap.data.activatedGraphGenerationId).toBe(activeGeneration);
      expect(blockedMap.data.stats.files).toBe(33);
      expect(blockedMap.data.parserDiagnostics).toMatchObject({
        diagnosticsCount: 1,
        recoveredFiles: 1,
      });

      release = Bun.spawn([
        "/bin/sh",
        "-c",
        "/bin/cat \"$GATE_SOURCE\" > \"$GATE_FIFO\" && /usr/bin/touch \"$FIRST_READ_ACK\" && /bin/cat \"$GATE_SOURCE\" > \"$GATE_FIFO\"",
      ], {
        env: {
          ...process.env,
          FIRST_READ_ACK: firstReadAckPath,
          GATE_SOURCE: gateSourcePath,
          GATE_FIFO: typeScriptPath,
        },
        stdout: "ignore",
        stderr: "pipe",
      });
      const firstReadAcknowledged = await pollUntil(async () =>
        readFile(firstReadAckPath).then(() => true, () => false),
      { timeoutMs: 30_000, intervalMs: 10 });
      expect(firstReadAcknowledged).toBe(true);
      const initialSnapshotComplete = await pollUntil(async () => {
        const status = await getJobStatus(jobId);
        return status.data?.progress?.total === fixture.files.length
          && status.data?.progress?.current === fixture.files.length;
      }, { timeoutMs: 600_000, intervalMs: 10 });
      expect(initialSnapshotComplete).toBe(true);
      await unlink(zigPath);
      const failed = await pollUntil(async () =>
        (await getJobStatus(jobId)).data?.status === "failed",
      { timeoutMs: 600_000, intervalMs: 10 });
      expect(failed).toBe(true);
      const terminal = await getJobStatus(jobId);
      expect(terminal.data.status).toBe("failed");
      expect(terminal.data.error).toBe("graph_generation_stale_snapshot");
      expect(await release.exited).toBe(0);
    } finally {
      release?.kill();
      if (release) await release.exited.catch(() => -1);
      await rm(typeScriptPath, { force: true });
      await writeFile(typeScriptPath, originalTypeScript);
      await writeFile(zigPath, originalZig);
    }

    const after = await httpGet<any>(`/api/v1/workspace/${PID}/map`);
    expect(after.data.activatedGraphGenerationId).toBe(activeGeneration);
    expect(after.data.stats.files).toBe(33);
    expect(after.data.parserDiagnostics).toMatchObject({
      diagnosticsCount: 1,
      recoveredFiles: 1,
      hardFailureFiles: 0,
      staleFiles: 0,
    });
    for (const [search, file, kind] of [
      ["PolyRoot", "decorator-heavy.ts", "class"],
      ["PolyZig", "sentinel.zig", "class"],
    ] as const) {
      const definition = await httpGet<any>("/api/v1/symbol/definitions", {
        projectId: PID,
        search,
        file,
        kind,
        limit: 5,
      });
      expect(definition.data.definitions).toHaveLength(1);
    }
  }, 700_000);

  test("readers observe only complete old or new generations across one atomic switch", async () => {
    const typeScriptPath = path.join(temporaryFixture, "decorator-heavy.ts");
    const gateSourcePath = path.join(temporaryRoot, "decorator-heavy.source.ts");
    await writeFile(gateSourcePath, originalTypeScript);
    await unlink(typeScriptPath);
    const fifo = Bun.spawn(["/usr/bin/mkfifo", typeScriptPath], {
      stdout: "ignore",
      stderr: "pipe",
    });
    expect(await fifo.exited).toBe(0);
    const oldGeneration = activeGeneration;
    let jobId = "";
    const observed: Array<{
      generation: string;
      files: number;
      diagnosticsCount: number;
      recoveredFiles: number;
    }> = [];
    let release: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const oldMap = await httpGet<any>(`/api/v1/workspace/${PID}/map`);
      expect(oldMap.data.activatedGraphGenerationId).toBe(oldGeneration);
      expect(oldMap.data.stats.files).toBe(33);
      expect(oldMap.data.parserDiagnostics).toMatchObject({
        diagnosticsCount: 1,
        recoveredFiles: 1,
        hardFailureFiles: 0,
        staleFiles: 0,
      });
      const started = await httpPost<any>("/api/v1/project/index", {
        projectPath: temporaryFixture,
        projectId: PID,
        forceReindex: true,
        warmCache: false,
      });
      expect(started.success).toBe(true);
      jobId = started.data?.jobId;
      expect(jobId).toEqual(expect.any(String));

      const blocked = await pollUntil(async () => {
        const status = await getJobStatus(jobId);
        return status.data?.status === "running";
      }, { timeoutMs: 30_000, intervalMs: 10 });
      expect(blocked).toBe(true);
      const gatedStatus = await getJobStatus(jobId);
      expect(gatedStatus.data.status).toBe("running");
      const gatedMap = await httpGet<any>(`/api/v1/workspace/${PID}/map`);
      expect(gatedMap.data.activatedGraphGenerationId).toBe(oldGeneration);
      expect(gatedMap.data.stats.files).toBe(33);
      expect(gatedMap.data.parserDiagnostics).toMatchObject({
        diagnosticsCount: 1,
        recoveredFiles: 1,
        hardFailureFiles: 0,
        staleFiles: 0,
      });
      observed.push({
        generation: oldGeneration,
        files: gatedMap.data.stats.files,
        diagnosticsCount: gatedMap.data.parserDiagnostics.diagnosticsCount,
        recoveredFiles: gatedMap.data.parserDiagnostics.recoveredFiles,
      });
      release = Bun.spawn([
        "/bin/sh",
        "-c",
        "for gate_read in 1 2; do /bin/cat \"$GATE_SOURCE\" > \"$GATE_FIFO\"; done",
      ], {
        env: { ...process.env, GATE_SOURCE: gateSourcePath, GATE_FIFO: typeScriptPath },
        stdout: "ignore",
        stderr: "pipe",
      });
      const completed = await pollUntil(async () => {
        const [status, map] = await Promise.all([
          getJobStatus(jobId),
          httpGet<any>(`/api/v1/workspace/${PID}/map`),
        ]);
        observed.push({
          generation: map.data.activatedGraphGenerationId,
          files: map.data.stats.files,
          diagnosticsCount: map.data.parserDiagnostics.diagnosticsCount,
          recoveredFiles: map.data.parserDiagnostics.recoveredFiles,
        });
        const terminal = ["completed", "indexed", "failed"].includes(status.data?.status);
        if (terminal) return status.data.status === "completed";
        return false;
      }, { timeoutMs: 600_000, intervalMs: 10 });
      expect(completed).toBe(true);
      expect(await release.exited).toBe(0);
    } finally {
      release?.kill();
      if (release) await release.exited.catch(() => -1);
      await rm(typeScriptPath, { force: true });
      await writeFile(typeScriptPath, originalTypeScript);
    }

    const status = await getJobStatus(jobId);
    const newGeneration = status.data.result?.activatedGraphGenerationId;
    expect(newGeneration).toEqual(expect.any(String));
    expect(newGeneration).not.toBe(oldGeneration);
    const after = await httpGet<any>(`/api/v1/workspace/${PID}/map`);
    observed.push({
      generation: after.data.activatedGraphGenerationId,
      files: after.data.stats.files,
      diagnosticsCount: after.data.parserDiagnostics.diagnosticsCount,
      recoveredFiles: after.data.parserDiagnostics.recoveredFiles,
    });
    expect(after.data.activatedGraphGenerationId).toBe(newGeneration);
    expect(after.data.stats.files).toBe(33);
    expect(after.data.parserDiagnostics).toMatchObject({
      diagnosticsCount: 0,
      recoveredFiles: 0,
      hardFailureFiles: 0,
      staleFiles: 0,
    });
    for (const snapshot of observed) {
      expect(snapshot.files).toBe(33);
      if (snapshot.generation === oldGeneration) {
        expect(snapshot).toMatchObject({ diagnosticsCount: 1, recoveredFiles: 1 });
      } else if (snapshot.generation === newGeneration) {
        expect(snapshot).toMatchObject({ diagnosticsCount: 0, recoveredFiles: 0 });
      } else {
        throw new Error(`unexpected generation snapshot: ${JSON.stringify(snapshot)}`);
      }
    }
    const firstNew = observed.findIndex((snapshot) => snapshot.generation === newGeneration);
    expect(firstNew).toBeGreaterThan(0);
    expect(observed.slice(firstNew).every((snapshot) => snapshot.generation === newGeneration)).toBe(true);
    activeGeneration = newGeneration;
  }, 700_000);

  test("deleting one extension activates an exact 33-to-32 generation without its definition", async () => {
    await writeFile(path.join(temporaryFixture, "decorator-heavy.ts"), originalTypeScript);
    await unlink(path.join(temporaryFixture, "sentinel.zig"));
    const reindexed = await indexAndAwait(temporaryFixture, PID, {
      forceReindex: true,
      timeoutMs: 600_000,
    });
    expect(reindexed.status).toBe("completed");
    const deletedGeneration = reindexed.result?.activatedGraphGenerationId;
    expect(deletedGeneration).toEqual(expect.any(String));
    expect(deletedGeneration).not.toBe(activeGeneration);
    const map = await httpGet<any>(`/api/v1/workspace/${PID}/map`);
    expect(map.data.activatedGraphGenerationId).toBe(deletedGeneration);
    expect(map.data.stats.files).toBe(32);
    const removed = await httpGet<any>("/api/v1/symbol/definitions", {
      projectId: PID,
      search: "PolyZig",
      file: "sentinel.zig",
      kind: "class",
      limit: 5,
    });
    expect(removed.data.definitions).toEqual([]);
    activeGeneration = deletedGeneration;
  }, 700_000);

});

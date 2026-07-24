import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { mcpCall, startMcp } from "./_mcp.js";

const execFileAsync = promisify(execFile);
const ENABLED = process.env.RUN_OWNED_DESTRUCTIVE === "1";
const REPO = path.resolve(import.meta.dir, "../../../../../");
const API = "http://127.0.0.1:3334";
const DATABASE_URL = "postgresql://test:test@127.0.0.1:5433/massa_ai_test";
const PORTS = { api: 3334, postgres: 5433, ollama: 11435 } as const;

type Child = ReturnType<typeof Bun.spawn>;
type Kind = "api" | "postgres" | "ollama";
interface OwnedChild {
  kind: Kind;
  child: Child;
  port: number;
  commandNeedle: string;
  executable: string;
  startedAt: string;
}

let root = "";
let pgData = "";
let home = "";
let configHome = "";
let configPath = "";
let api: OwnedChild | null = null;
let postgres: OwnedChild | null = null;
let ollama: OwnedChild | null = null;
const ownedChildren = new Map<Kind, OwnedChild>();
let sharedBefore: { pid: number; health: any } | null = null;
const evidence: Record<string, unknown> = {};

async function output(command: string, args: string[], cwd = REPO): Promise<string> {
  const result = await execFileAsync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function listenerPid(port: number): Promise<number | null> {
  try {
    const raw = await output("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    const pid = Number(raw.split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(100);
  }
  throw new Error(`condition did not settle within ${timeoutMs}ms`);
}

async function health(url = `${API}/health`): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function sharedSnapshot(): Promise<{ pid: number; health: any }> {
  const pid = await listenerPid(3333);
  if (!pid) throw new Error("developer-owned :3333 listener is absent");
  return { pid, health: await health("http://127.0.0.1:3333/health") };
}

async function spawnOwned(
  kind: Kind,
  command: string[],
  port: number,
  commandNeedle: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<OwnedChild> {
  const child = Bun.spawn(command, {
    cwd: options.cwd ?? REPO,
    env: { ...process.env, ...options.env },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const startedAt = await output("ps", ["-p", String(child.pid), "-o", "lstart="]);
  const executable = await realpath(command[0]);
  const owned = { kind, child, port, commandNeedle, executable, startedAt };
  ownedChildren.set(kind, owned);
  await waitFor(async () => await listenerPid(port) === child.pid, 30_000);
  await assertOwned(owned);
  return owned;
}

async function assertOwned(owned: OwnedChild): Promise<void> {
  const listener = await listenerPid(owned.port);
  const ps = await output("ps", ["-p", String(owned.child.pid), "-o", "lstart=,command="]);
  const textFiles = await output("lsof", [
    "-a",
    "-p", String(owned.child.pid),
    "-d", "txt",
    "-Fn",
  ]);
  const executablePaths = await Promise.all(
    textFiles
      .split("\n")
      .filter((line) => line.startsWith("n"))
      .map(async (line) => await realpath(line.slice(1)).catch(() => line.slice(1))),
  );
  expect(listener).toBe(owned.child.pid);
  expect(ps).toContain(owned.startedAt);
  expect(ps).toContain(owned.commandNeedle);
  expect(executablePaths).toContain(owned.executable);
  if (owned.kind === "postgres") {
    const postmasterPid = Number((await readFile(path.join(pgData, "postmaster.pid"), "utf8")).split("\n")[0]);
    expect(postmasterPid).toBe(owned.child.pid);
    expect(await realpath(pgData)).toBe(await realpath(path.dirname(path.join(pgData, "postmaster.pid"))));
  }
}

async function stopOwned(owned: OwnedChild): Promise<void> {
  await assertOwned(owned);
  if (owned.kind === "postgres") {
    await output("/opt/homebrew/bin/pg_ctl", ["-D", pgData, "stop", "-m", "fast", "-w"]);
  } else {
    owned.child.kill("SIGTERM");
  }
  await owned.child.exited;
  await waitFor(async () => await listenerPid(owned.port) === null, 10_000);
  ownedChildren.delete(owned.kind);
}

async function cleanupOwned(owned: OwnedChild): Promise<void> {
  const listener = await listenerPid(owned.port);
  if (listener === owned.child.pid) {
    await stopOwned(owned);
    return;
  }
  if (listener !== null) {
    throw new Error(
      `refusing cleanup: port ${owned.port} moved from owned PID ${owned.child.pid} to PID ${listener}`,
    );
  }
  const ps = await output("ps", ["-p", String(owned.child.pid), "-o", "pid="]).catch(() => "");
  if (ps.trim()) {
    throw new Error(
      `refusing cleanup: owned PID ${owned.child.pid} is alive without its attested listener ${owned.port}`,
    );
  }
  await owned.child.exited;
  ownedChildren.delete(owned.kind);
}

async function writeConfig(hooksEnabled: boolean): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({
    embedding: {
      provider: "ollama",
      model: "qwen3-embedding:8b",
      dimensions: 4096,
      baseURL: "http://127.0.0.1:11435",
    },
    hooks: { enabled: hooksEnabled },
  }, null, 2));
}

function serviceEnv(): Record<string, string> {
  return {
    HOME: home,
    XDG_CONFIG_HOME: configHome,
    DATABASE_URL,
    MASSA_AI_DEDICATED: "1",
    MASSA_AI_API_URL: API,
    MASSA_AI_API_PORT: "3334",
    MASSA_AI_API_KEY: "",
    MASSA_AI_SCHEDULER_ENABLED: "false",
    MASSA_AI_JOB_STALE_MS: "300000",
    MASSA_AI_JOB_REAPER_INTERVAL_MS: "60000",
    OLLAMA_BASE_URL: "http://127.0.0.1:11435",
    OLLAMA_HOST: "127.0.0.1:11435",
    OLLAMA_MODELS: path.join(homedir(), ".ollama", "models"),
    EMBEDDING_PROVIDER: "ollama",
    OLLAMA_EMBEDDING_MODEL: "qwen3-embedding:8b",
    OLLAMA_EMBEDDING_DIMENSIONS: "4096",
  };
}

async function startPostgres(initial = false): Promise<void> {
  if (initial) {
    await output("/opt/homebrew/bin/initdb", [
      "-D", pgData, "-U", "test", "--auth=trust", "--no-locale", "--encoding=UTF8",
    ]);
  }
  postgres = await spawnOwned(
    "postgres",
    ["/opt/homebrew/bin/postgres", "-D", pgData, "-h", "127.0.0.1", "-p", "5433"],
    PORTS.postgres,
    "postgres",
  );
  if (initial) {
    await output("/opt/homebrew/bin/createdb", ["-h", "127.0.0.1", "-p", "5433", "-U", "test", "massa_ai_test"]);
    await output("/opt/homebrew/bin/psql", [DATABASE_URL, "-c", "CREATE EXTENSION IF NOT EXISTS vector"]);
    await output(path.join(REPO, "packages/core/node_modules/.bin/prisma"), ["migrate", "deploy"], path.join(REPO, "packages/core"));
  }
}

async function startOllama(): Promise<void> {
  ollama = await spawnOwned(
    "ollama",
    ["/usr/local/bin/ollama", "serve"],
    PORTS.ollama,
    "ollama serve",
    { env: serviceEnv() },
  );
  await waitFor(async () => fetch("http://127.0.0.1:11435/api/tags").then((r) => r.ok).catch(() => false));
}

async function startApi(overrides: Record<string, string> = {}): Promise<void> {
  api = await spawnOwned(
    "api",
    [process.execPath, "src/index.ts"],
    PORTS.api,
    "src/index.ts",
    {
      cwd: path.join(REPO, "apps/tools-api"),
      env: { ...serviceEnv(), ...overrides },
    },
  );
  await waitFor(async () => health().then(() => true).catch(() => false));
}

async function json(endpoint: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${API}${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed };
}

async function indexProject(projectPath: string, projectId: string): Promise<string> {
  const started = await json("/api/v1/project/index", {
    projectPath,
    projectId,
    forceReindex: true,
  });
  expect(started.body?.success).toBe(true);
  const jobId = started.body?.data?.jobId;
  await waitFor(async () => {
    const status = await json(`/api/v1/project/index/status/${jobId}`);
    const value = status.body?.data?.status;
    return value === "completed" || value === "indexed" || value === "failed";
  }, 420_000);
  const final = await json(`/api/v1/project/index/status/${jobId}`);
  if (!["completed", "indexed"].includes(final.body?.data?.status)) {
    throw new Error(`index job failed: ${JSON.stringify(final.body?.data)}`);
  }
  return jobId;
}

async function createFixture(name: string, files: number): Promise<string> {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  for (let i = 0; i < files; i++) {
    await writeFile(
      path.join(directory, `owned-${i}.ts`),
      `export function owned_${name.replaceAll("-", "_")}_${i}() { return "${crypto.randomUUID()}"; }\n`,
    );
  }
  return directory;
}

async function hook(statusExpected: number): Promise<void> {
  const single = await json("/api/v1/hook/", {
    event: "user-prompt",
    projectId: "e2e-ai-owned-hooks",
    sessionId: crypto.randomUUID(),
    payload: { owned: true },
  });
  const batch = await json("/api/v1/hook/batch", {
    events: [{
      event: "user-prompt",
      projectId: "e2e-ai-owned-hooks",
      sessionId: crypto.randomUUID(),
      payload: { owned: true },
    }],
  });
  expect(single.status).toBe(statusExpected);
  expect(batch.status).toBe(statusExpected);
}

describe.skipIf(!ENABLED)("owned destructive recovery harness", () => {
  beforeAll(async () => {
    for (const port of Object.values(PORTS)) {
      if (await listenerPid(port)) throw new Error(`dedicated port ${port} is occupied; refusing ownership`);
    }
    sharedBefore = await sharedSnapshot();
    root = await mkdtemp(path.join(tmpdir(), "massa-ai-owned-destructive-"));
    pgData = path.join(root, "postgres");
    home = path.join(root, "home");
    configHome = path.join(root, "config");
    configPath = path.join(configHome, "massa-ai", "config.json");
    await mkdir(home, { recursive: true });
    await writeConfig(true);
    Object.assign(process.env, serviceEnv());
    await startPostgres(true);
    await startOllama();
    await startApi();
    evidence.ownership = {
      root,
      postgres: {
        pid: postgres!.child.pid,
        startedAt: postgres!.startedAt,
        executable: postgres!.executable,
        data: pgData,
      },
      ollama: { pid: ollama!.child.pid, startedAt: ollama!.startedAt, executable: ollama!.executable },
      api: { pid: api!.child.pid, startedAt: api!.startedAt, executable: api!.executable },
    };
    evidence.runtime = {
      backend: "postgresql+pgvector",
      database: "127.0.0.1:5433/massa_ai_test",
      provider: "ollama",
      model: "qwen3-embedding:8b",
      dimensions: 4096,
    };
  }, 180_000);

  afterAll(async () => {
    const cleanupErrors: Error[] = [];
    try {
      for (const kind of ["api", "ollama", "postgres"] as const) {
        const child = ownedChildren.get(kind);
        if (!child) continue;
        try {
          await cleanupOwned(child);
        } catch (error) {
          cleanupErrors.push(error as Error);
        }
      }
      const sharedAfter = await sharedSnapshot();
      expect(sharedAfter.pid).toBe(sharedBefore?.pid);
      expect(sharedAfter.health?.status).toBe("ok");
      evidence.shared = { before: sharedBefore, after: sharedAfter };
      console.log(`[owned-destructive-evidence] ${JSON.stringify(evidence)}`);
      if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "owned cleanup failed closed");
    } finally {
      const allDedicatedPortsFree = await Promise.all(
        Object.values(PORTS).map(async (port) => await listenerPid(port) === null),
      );
      if (root && allDedicatedPortsFree.every(Boolean)) {
        await rm(root, { recursive: true, force: true });
      }
    }
  }, 120_000);

  test("N1: uncached search, recall, and remember fail while owned Ollama is down and recover", async () => {
    const fixture = await createFixture("n1", 1);
    const projectId = "e2e-ai-owned-n1";
    await indexProject(fixture, projectId);
    expect((await json("/api/v1/search/project", {
      query: "owned n1 warm operation",
      projectId,
      maxResults: 1,
      minScore: 0,
      format: "json",
    })).body?.success).toBe(true);
    expect((await json("/api/v1/memory/store", {
      content: "owned n1 warm memory operation",
      type: "decision",
      projectId,
      format: "json",
    })).body?.success).toBe(true);
    expect((await json("/api/v1/memory/search", {
      query: "owned n1 warm memory operation",
      projectId,
      format: "json",
    })).body?.success).toBe(true);

    await stopOwned(ollama!);
    ollama = null;
    const unique = crypto.randomUUID();
    const search = await json("/api/v1/search/project", {
      query: `uncached search ${unique}`,
      projectId,
      maxResults: 1,
      format: "json",
    });
    const recall = await json("/api/v1/memory/search", {
      query: `uncached recall ${unique}`,
      projectId,
      format: "json",
    });
    const remember = await json("/api/v1/memory/store", {
      content: `uncached remember ${unique}`,
      type: "decision",
      projectId,
      format: "json",
    });
    expect(search.body?.success).toBe(false);
    expect(recall.body?.success).toBe(false);
    expect(remember.body?.success).toBe(false);

    await startOllama();
    const recovered = await json("/api/v1/search/project", {
      query: `recovered search ${unique}`,
      projectId,
      maxResults: 1,
      minScore: 0,
      format: "json",
    });
    expect(recovered.body?.success).toBe(true);
    evidence.N1 = {
      search: { status: search.status, success: search.body?.success },
      recall: { status: recall.status, success: recall.body?.success },
      remember: { status: remember.status, success: remember.body?.success },
      recovered: { status: recovered.status, success: recovered.body?.success },
      ollamaRestartPid: ollama!.child.pid,
    };
  }, 600_000);

  test("N3: owned PostgreSQL outage is structured over HTTP and MCP, then recovers", async () => {
    await stopOwned(postgres!);
    postgres = null;
    const http = await json("/api/v1/search/project", {
      query: `pg outage ${crypto.randomUUID()}`,
      projectId: "e2e-ai-owned-n1",
      maxResults: 1,
      format: "json",
    });
    expect(http.body?.success).toBe(false);
    let mcpSuccess: boolean | undefined;
    const mcp = await startMcp(serviceEnv());
    try {
      const result = await mcpCall(mcp.client, "search", {
        query: `mcp pg outage ${crypto.randomUUID()}`,
        projectId: "e2e-ai-owned-n1",
        maxResults: 1,
        format: "json",
      });
      expect(result?.success).toBe(false);
      mcpSuccess = result?.success;
    } finally {
      await mcp.stop();
    }
    await startPostgres(false);
    await stopOwned(api!);
    api = null;
    await startApi();
    const recovered = await json("/api/v1/search/project", {
      query: "owned n1 warm operation",
      projectId: "e2e-ai-owned-n1",
      maxResults: 1,
      minScore: 0,
      format: "json",
    });
    expect(recovered.body?.success).toBe(true);
    evidence.N3 = {
      http: { status: http.status, success: http.body?.success },
      mcp: { success: mcpSuccess },
      recovered: { status: recovered.status, success: recovered.body?.success },
      postgresRestartPid: postgres!.child.pid,
      apiRestartPid: api!.child.pid,
    };
  }, 300_000);

  test("E25: owned API restart marks a durable running job failed and a new job completes", async () => {
    const fixture = await createFixture("e25-long", 12);
    const started = await json("/api/v1/project/index", {
      projectPath: fixture,
      projectId: "e2e-ai-owned-e25-old",
      forceReindex: true,
    });
    const jobId = started.body?.data?.jobId;
    await waitFor(async () => {
      const status = await json(`/api/v1/project/index/status/${jobId}`);
      return status.body?.data?.status === "running";
    });
    await stopOwned(api!);
    api = null;
    await Bun.sleep(1_300);
    await startApi({
      MASSA_AI_JOB_STALE_MS: "1000",
      MASSA_AI_JOB_REAPER_INTERVAL_MS: "250",
    });
    await waitFor(async () => {
      const status = await json(`/api/v1/project/index/status/${jobId}`);
      return status.body?.data?.status === "failed";
    });
    const failed = await json(`/api/v1/project/index/status/${jobId}`);
    expect(failed.body?.data?.error).toContain("process restart");
    await stopOwned(api!);
    api = null;
    await startApi();

    const recoveryFixture = await createFixture("e25-recovery", 1);
    const recoveryJob = await indexProject(
      recoveryFixture,
      "e2e-ai-owned-e25-new",
    );
    evidence.E25 = {
      staleJob: jobId,
      staleError: failed.body?.data?.error,
      recoveryJob,
      apiRestartPid: api!.child.pid,
    };
  }, 600_000);

  test("F88: owned API rejects single and batch hooks while disabled, then recovers", async () => {
    await hook(202);
    await stopOwned(api!);
    api = null;
    await writeConfig(false);
    await startApi({ HOOKS_ENABLED: "false" });
    const disabledApiPid = api!.child.pid;
    await hook(423);
    await stopOwned(api!);
    api = null;
    await writeConfig(true);
    await startApi();
    await hook(202);
    evidence.F88 = {
      enabled: 202,
      disabled: 423,
      recovered: 202,
      disabledApiPid,
      recoveredApiPid: api!.child.pid,
    };
  }, 180_000);
});

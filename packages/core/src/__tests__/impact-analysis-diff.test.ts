import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultDiffRunner, ImpactAnalysisService } from "../services/symbol/impact-analysis.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function git(dir: string, args: string[], env?: Record<string, string>): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf-8",
    env: { ...process.env, ...env },
  }).trim();
}

describe("defaultDiffRunner committed scope", () => {
  test("resolves an ISO date to a commit before building the diff range", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "massa-ai-impact-git-"));
    tempDirs.push(dir);
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);

    await fs.writeFile(path.join(dir, "before.ts"), "export const before = 1;\n");
    git(dir, ["add", "before.ts"]);
    git(dir, ["commit", "-qm", "before"], {
      GIT_AUTHOR_DATE: "2026-01-01T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T12:00:00Z",
    });

    await fs.writeFile(path.join(dir, "after.ts"), "export const after = 2;\n");
    git(dir, ["add", "after.ts"]);
    git(dir, ["commit", "-qm", "after"], {
      GIT_AUTHOR_DATE: "2026-02-01T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-02-01T12:00:00Z",
    });

    expect(defaultDiffRunner(dir, "committed", undefined, "2026-01-15")).toEqual({
      paths: ["after.ts"],
      untrackedFiltered: 0,
    });
    expect(defaultDiffRunner(dir, "committed", undefined, "2025-01-01")).toEqual({
      paths: ["after.ts", "before.ts"],
      untrackedFiltered: 0,
    });
  });

  test("continues to accept a commit ref", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "massa-ai-impact-ref-"));
    tempDirs.push(dir);
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);
    await fs.writeFile(path.join(dir, "one.ts"), "one\n");
    git(dir, ["add", "one.ts"]);
    git(dir, ["commit", "-qm", "one"]);
    const first = git(dir, ["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(dir, "two.ts"), "two\n");
    git(dir, ["add", "two.ts"]);
    git(dir, ["commit", "-qm", "two"]);

    expect(defaultDiffRunner(dir, "committed", undefined, first)).toEqual({
      paths: ["two.ts"],
      untrackedFiltered: 0,
    });
  });
});

test("impact analysis never falls back from exact identity to a bare overload name", async () => {
  let nameFallbacks = 0;
  const changed = {
    id: "src/changed.ts#run~function~" + "a".repeat(64), project_id: "p", generation_id: "active",
    file_path: "src/changed.ts", name: "run", qualified_name: "run", kind: "function" as const,
    line_start: 1, line_end: 1, exported: true, indexed_at: 1,
  };
  const repo = {
    allFiles: async () => ["src/changed.ts"],
    listDefinitions: async () => [changed],
    allImportEdges: async () => [],
    getCentrality: async () => new Map(),
    findReferencesByFqn: async () => [],
    findReferencesByName: async () => { nameFallbacks += 1; return []; },
  };
  const result = await ImpactAnalysisService.getInstance().analyze({
    projectId: "p", projectPath: ".", scope: "unstaged", depth: 1,
    diffRunner: () => ({ paths: ["src/changed.ts"], untrackedFiltered: 0 }), repoOverride: repo as never,
  });
  expect(result.changedFiles[0]?.symbols[0]?.fqn).toBe(changed.id);
  expect(result.impacted).toEqual([]);
  expect(nameFallbacks).toBe(0);
});

// ── Wall-clock deadline (M7) ─────────────────────────────────────────────────
// A runaway reverse-BFS must abort with truncated=true and partial impacted
// results instead of hanging. Forced deterministically with an injectable
// clock — no PG, no wall-clock timing dependence.

test("impact analysis deadline aborts reverse-BFS with truncated=true", async () => {
  // importerOf graph: src/changed.ts ← a.ts ← b.ts ← c.ts  (depth 3 chain).
  // With depth=4 the BFS would normally walk all three importers; a deadline
  // that fires on the first dequeue must abort before c.ts is reached.
  const changed = {
    id: "src/changed.ts#run", project_id: "p", generation_id: "active",
    file_path: "src/changed.ts", name: "run", qualified_name: "run",
    kind: "function" as const, line_start: 1, line_end: 1, exported: true, indexed_at: 1,
  };
  const def = (file: string, name: string) => ({
    id: `${file}#${name}`, project_id: "p", generation_id: "active",
    file_path: file, name, qualified_name: name,
    kind: "function" as const, line_start: 1, line_end: 1, exported: true, indexed_at: 1,
  });
  const repo = {
    allFiles: async () => ["src/changed.ts", "a.ts", "b.ts", "c.ts"],
    listDefinitions: async (_pid: string, opts: { file: string }) => {
      const f = opts.file;
      if (f === "src/changed.ts") return [changed];
      if (f === "a.ts") return [def("a.ts", "fnA")];
      if (f === "b.ts") return [def("b.ts", "fnB")];
      if (f === "c.ts") return [def("c.ts", "fnC")];
      return [];
    },
    allImportEdges: async () => [
      { from_file: "a.ts", to_file: "src/changed.ts", is_external: false },
      { from_file: "b.ts", to_file: "a.ts", is_external: false },
      { from_file: "c.ts", to_file: "b.ts", is_external: false },
    ],
    getCentrality: async () => new Map([["a.ts", 0.5], ["b.ts", 0.5], ["c.ts", 0.5]]),
    findReferencesByFqn: async () => [],
    findReferencesByName: async () => [],
  };

  // Clock: first call captures deadlineAt = start + 1; every BFS dequeue then
  // returns start + 1000 (past the deadline) → the guard fires immediately and
  // the walk aborts with truncated=true before any importer is reached.
  let ticks = 0;
  const start = 10_000;
  const now = () => {
    const v = ticks === 0 ? start : start + 1000;
    ticks++;
    return v;
  };

  const result = await ImpactAnalysisService.getInstance().analyze({
    projectId: "p", projectPath: ".", scope: "unstaged", depth: 4,
    deadlineMs: 1, now,
    diffRunner: () => ({ paths: ["src/changed.ts"], untrackedFiltered: 0 }), repoOverride: repo as never,
  });

  expect(result.truncated).toBe(true);
  // The deadline fires on the first dequeue → no importer symbols collected.
  // (Without the deadline, depth=4 would reach fnA/fnB/fnC.)
  expect(result.impacted.length).toBe(0);
});

test("impact analysis default deadline (unset) does not truncate a normal walk", async () => {
  const changed = {
    id: "src/changed.ts#run", project_id: "p", generation_id: "active",
    file_path: "src/changed.ts", name: "run", qualified_name: "run",
    kind: "function" as const, line_start: 1, line_end: 1, exported: true, indexed_at: 1,
  };
  const repo = {
    allFiles: async () => ["src/changed.ts", "a.ts"],
    listDefinitions: async (_pid: string, opts: { file: string }) =>
      opts.file === "src/changed.ts" ? [changed] : [def2("a.ts", "fnA")],
    allImportEdges: async () => [
      { from_file: "a.ts", to_file: "src/changed.ts", is_external: false },
    ],
    getCentrality: async () => new Map([["a.ts", 0.5]]),
    findReferencesByFqn: async () => [],
    findReferencesByName: async () => [],
  };
  function def2(file: string, name: string) {
    return {
      id: `${file}#${name}`, project_id: "p", generation_id: "active",
      file_path: file, name, qualified_name: name,
      kind: "function" as const, line_start: 1, line_end: 1, exported: true, indexed_at: 1,
    };
  }

  // No deadlineMs / no clock → default 5s. Behavior unchanged from pre-M7:
  // the normal 1-hop walk completes and is NOT truncated.
  const result = await ImpactAnalysisService.getInstance().analyze({
    projectId: "p", projectPath: ".", scope: "unstaged", depth: 2,
    diffRunner: () => ({ paths: ["src/changed.ts"], untrackedFiltered: 0 }), repoOverride: repo as never,
  });

  expect(result.truncated).toBe(false);
  expect(result.impacted.map((s) => s.name)).toContain("fnA");
});

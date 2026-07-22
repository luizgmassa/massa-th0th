import { afterEach, expect, test } from "bun:test";
import { describeNative } from "./_helpers/native-skip.js";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ParseStage } from "../services/etl/stages/parse.js";
import { ResolveStage } from "../services/etl/stages/resolve.js";
import { buildSymbolPersistenceBatch } from "../services/etl/stages/load.js";
import { matchesStructuralPathAlias, resolveStructuralSpecifier } from "../services/structural/resolvers/typescript.js";
import { smartChunk } from "../services/search/smart-chunker.js";
import { StructuralRuntime } from "../services/structural/structural-runtime.js";
import { buildHeaderLanguageEvidence } from "../services/etl/pipeline.js";
import { LANGUAGE_MANIFEST } from "../services/structural/language-manifest.js";
import type { EtlStageContext, ParsedFile } from "../services/etl/stage-context.js";
import type { NormalizedStructure, SourceSpan } from "../services/structural/types.js";

const tempDirs: string[] = [];
const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const POINT = Object.freeze({ row: 0, column: 0 });
const SPAN: SourceSpan = Object.freeze({ startByte: 0, endByte: 0, start: POINT, end: POINT });
const EMPTY: NormalizedStructure = Object.freeze({ symbols: Object.freeze([]), edges: Object.freeze([]), imports: Object.freeze([]) });

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function fixture(relativePath: string, content: string, needsReparse = true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "massa-th0th-structural-etl-"));
  tempDirs.push(dir);
  const absolutePath = path.join(dir, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content);
  return {
    dir,
    file: { absolutePath, relativePath, mtime: 0, size: Buffer.byteLength(content), contentHash: "fixture", needsReparse },
  };
}

function context(projectPath: string): EtlStageContext {
  return { projectId: "structural-etl", projectPath, jobId: "job", emit: () => {} };
}

describeNative("TS/JS structural ETL adapter", () => {
  test("routes every manifest extension through the structural runtime", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "massa-th0th-manifest-etl-"));
    tempDirs.push(dir);
    const seen: string[] = [];
    const files = await Promise.all(LANGUAGE_MANIFEST.map(async ({ extension }) => {
      const name = `sentinel${extension}`;
      const absolutePath = path.join(dir, name);
      await fs.writeFile(absolutePath, "sentinel\n");
      return {
        absolutePath,
        relativePath: name,
        mtime: 0,
        size: 9,
        contentHash: extension,
        needsReparse: true,
      };
    }));
    const runtime = {
      parse: async ({ extension }: { extension: string }) => {
        seen.push(extension);
        return {
          status: "ok" as const,
          structure: EMPTY,
          diagnostics: [],
          diagnosticCount: 0,
        };
      },
    };

    await new ParseStage(runtime).run(context(dir), files);

    expect(seen.sort()).toEqual(LANGUAGE_MANIFEST.map((entry) => entry.extension).sort());
  });

  test("derives AST importer and directory-aware build evidence through the real ParseStage seam", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "massa-th0th-header-evidence-"));
    tempDirs.push(dir);
    const discovered = (relativePath: string, snapshotContent: string, needsReparse = true) => ({
      absolutePath: path.join(dir, relativePath), relativePath, snapshotContent,
      mtime: 0, size: Buffer.byteLength(snapshotContent), contentHash: relativePath, needsReparse,
    });
    const files = [
      discovered("include/default.h", "int stable(void);"),
      discovered("include/cpp.h", "class Child {};"),
      discovered("include/conflict.h", "int conflict(void);"),
      discovered("include/build-only.h", "class BuildOnly {};"),
      discovered("src/main.cpp", '#include "../include/cpp.h"\n#include "../include/conflict.h"\n', false),
      discovered("src/fake.cpp", '// #include "../include/default.h"\nconst char* fake = "#include \\\"../include/default.h\\\"";\n'),
      discovered("src/main.c", '#include "../include/conflict.h"\n'),
      discovered("compile_commands.json", JSON.stringify([
        { directory: path.join(dir, "build"), file: "../include/cpp.h", command: "clang++ -x c++ ../include/cpp.h" },
        { directory: ".", file: path.join(dir, "include/build-only.h"), arguments: ["clang++", "-x", "c++", "include/build-only.h"] },
      ])),
    ];
    const evidence = buildHeaderLanguageEvidence(files);
    expect(evidence).toEqual({
      "include/build-only.h": { buildLanguage: "cpp" },
      "include/cpp.h": { buildLanguage: "cpp" },
    });
    const ctx = { ...context(dir), structuralHeaderEvidenceByFile: evidence };
    const parsed = await new ParseStage().run(ctx, files);
    expect(ctx.structuralHeaderEvidenceByFile).toEqual({
      "include/build-only.h": { buildLanguage: "cpp" },
      "include/conflict.h": { cImporters: ["src/main.c"], cppImporters: ["src/main.cpp"] },
      "include/cpp.h": { cppImporters: ["src/main.cpp"], buildLanguage: "cpp" },
    });
    expect(ctx.structuralHeaderEvidenceByFile?.["include/default.h"]).toBeUndefined();
    expect(parsed.find((item) => item.file.relativePath === "include/cpp.h")?.symbols.map((item) => item.name)).toContain("Child");
    expect(parsed.find((item) => item.file.relativePath === "include/build-only.h")?.symbols.map((item) => item.name)).toContain("BuildOnly");
    expect(parsed.find((item) => item.file.relativePath === "include/conflict.h")?.symbols.map((item) => item.name)).not.toContain("Child");
    expect(parsed.find((item) => item.file.relativePath === "src/main.cpp")).toMatchObject({ symbols: [], rawEdges: [] });
  });
  test("freezes smartChunk output while native structure replaces regex (AD-001 through AD-006)", async () => {
    const content = "import { helper as run } from \"./helper.js\";\n\nexport class Service {\n  execute(value: string) {\n    return run(value);\n  }\n}\n";
    const { dir, file } = await fixture("src/service.ts", content);
    const [parsed] = await new ParseStage().run(context(dir), [file]);
    expect(parsed.chunks).toEqual([
      {
        content: "// File: src/service.ts\n// Section: imports\nimport { helper as run } from \"./helper.js\";\n",
        lineStart: 1, lineEnd: 2, type: "code_block", label: "imports",
        fileImports: "import { helper as run } from \"./helper.js\";", parentSymbol: "imports",
      },
      {
        content: "// File: src/service.ts\n// Section: Service\nexport class Service {",
        lineStart: 3, lineEnd: 3, type: "code_block", label: "Service",
        fileImports: "import { helper as run } from \"./helper.js\";", parentSymbol: "Service",
      },
      {
        content: "// File: src/service.ts\n// Section: Service.execute\n// Service.execute\n// Service.execute\n  execute(value: string) {\n    return run(value);\n  }\n}\n",
        lineStart: 4, lineEnd: 8, type: "code_block", label: "Service.execute",
        fileImports: "import { helper as run } from \"./helper.js\";", parentSymbol: "Service.execute",
      },
    ]);
    expect(createHash("sha256").update(JSON.stringify(parsed.chunks)).digest("hex"))
      .toBe("90898b2230197fdae76e20d30e3899a21ede4ee7b1f0223b66f0776f87fe8d33");
    expect(parsed.structure).toBeDefined();
    expect(parsed.rawImports[0]?.bindings).toEqual([{ imported: "helper", local: "run", typeOnly: false }]);
    expect(parsed.rawEdges.filter((edge) => edge.kind === "import")).toHaveLength(0);
    expect(parsed.rawEdges.find((edge) => edge.symbolName === "run")?.callerSymbol).toBe("execute");
  });

  test("rejects hard structural failure before downstream stages and retains recovered results (AD-007)", async () => {
    const { dir, file } = await fixture("broken.ts", "export const ok = 1;\n");
    const failedRuntime = { parse: async () => ({
      status: "failed" as const, failureKind: "abi" as const, diagnosticCount: 1,
      diagnostics: [{ code: "native_parse_failed", severity: "error" as const, message: "ABI mismatch" }],
    }) };
    let resolveCalls = 0;
    let loadCalls = 0;
    await expect((async () => {
      const parsed = await new ParseStage(failedRuntime).run(context(dir), [file]);
      resolveCalls++;
      void parsed;
      loadCalls++;
    })()).rejects.toThrow("Structural parse failed (abi)");
    expect({ resolveCalls, loadCalls }).toEqual({ resolveCalls: 0, loadCalls: 0 });
    await expect(new ParseStage({ parse: async () => { throw new Error("native exploded"); } }).run(context(dir), [file]))
      .rejects.toThrow("Structural runtime threw: native exploded");

    const recoveredRuntime = { parse: async () => ({
      status: "recovered" as const, structure: EMPTY, diagnosticCount: 1,
      diagnostics: [{ code: "recovered_syntax_error", severity: "recovered" as const, message: "recovered" }],
    }) };
    const [recovered] = await new ParseStage(recoveredRuntime).run(context(dir), [file]);
    expect(recovered.structuralRecovered).toBe(true);
    expect(recovered.structuralDiagnostics?.[0]?.code).toBe("recovered_syntax_error");
    expect(recovered.chunks.length).toBeGreaterThan(0);
    expect(recovered.structure).toBe(EMPTY);
  });

  test("never invokes native parsing for fingerprint-skipped files (AD-008)", async () => {
    const { dir, file } = await fixture("skipped.ts", "export const untouched = 1;\n", false);
    let parseCalls = 0;
    const [parsed] = await new ParseStage({ parse: async () => { parseCalls++; throw new Error("must not parse"); } }).run(context(dir), [file]);
    expect(parseCalls).toBe(0);
    expect(parsed).toEqual({ file, chunks: [], symbols: [], rawImports: [], rawEdges: [] });
  });

  test("retains ambiguity from validated skipped repository definitions instead of first-definition loss (AD-008/AD-009)", async () => {
    const { dir, file } = await fixture("src/caller.ts", "helper();\n");
    const structure: NormalizedStructure = {
      symbols: [], imports: [], edges: [{ kind: "call", span: SPAN, target: { status: "unresolved", name: "helper" } }],
    };
    const parsed: ParsedFile = { file, chunks: [], symbols: [], rawImports: [], rawEdges: [], structure };
    const skippedA = (await fixture("src/a.ts", "", false)).file;
    const skippedB = (await fixture("src/b.ts", "", false)).file;
    // Keep all paths under the same project root used by resolution.
    skippedA.absolutePath = path.join(dir, skippedA.relativePath);
    skippedB.absolutePath = path.join(dir, skippedB.relativePath);
    const repository = { listAllDefinitions: async () => [
      { id: "src/a.ts#helper", project_id: "structural-etl", file_path: "src/a.ts", name: "helper", kind: "function" as const, line_start: 1, line_end: 1, exported: true, indexed_at: 1 },
      { id: "src/b.ts#helper", project_id: "structural-etl", file_path: "src/b.ts", name: "helper", kind: "function" as const, line_start: 1, line_end: 1, exported: true, indexed_at: 1 },
    ] };
    const result = await new ResolveStage(repository as never).run(context(dir), [parsed, {
      file: skippedA, chunks: [], symbols: [], rawImports: [], rawEdges: [],
    }, {
      file: skippedB, chunks: [], symbols: [], rawImports: [], rawEdges: [],
    }]);
    expect(result[0]!.resolvedEdges[0]?.targetFqn).toBeUndefined();
    expect(result[0]!.resolvedEdges[0]?.meta).toMatchObject({
      resolution: "ambiguous", candidates: ["src/a.ts#helper", "src/b.ts#helper"],
    });
  });

  test("keeps the approved-difference ledger executable and complete", async () => {
    const ledger = await fs.readFile(path.join(REPO_ROOT, ".specs/features/multi-language-tree-sitter-breadth/ts-js-approved-differences.md"), "utf8");
    for (let index = 1; index <= 9; index++) {
      expect(ledger).toContain(`AD-${String(index).padStart(3, "0")}`);
    }
  });

  test("routes JS, TSX, and JSX natively without changing frozen chunk hashes", async () => {
    const fixtures = [
      ["x.js", "export function f(x) { return x; }\n", "3c7b567cadb520bdb78d1ff970845515feedc878a2ab0ed508d5dbbc8c82b2c8"],
      ["x.tsx", "export const View = () => <div />;\n", "c0806f1e8539b072b076bd08347b82c1198f4b58809ec6c0dc3bad5d1cd86831"],
      ["x.jsx", "export const View = () => <div />;\n", "92962657eeb595de28e15f5d03d7978da13cf2a70f0ad23767f42ff1d43eef5b"],
    ] as const;
    for (const [relativePath, content, hash] of fixtures) {
      const { dir, file } = await fixture(relativePath, content);
      const [parsed] = await new ParseStage().run(context(dir), [file]);
      expect(parsed.structure).toBeDefined();
      expect(createHash("sha256").update(JSON.stringify(parsed.chunks)).digest("hex")).toBe(hash);
    }
  });

  test("matches frozen smartChunk output for all four parity fixtures", async () => {
    const expected = {
      "typescript-flow.ts": [14, "710763d0d5d7aff847da9314f6f7e2eb5decdc889ec3b246fe6955f301eb0f0c"],
      "typescript-native.ts": [2, "db4d4f4cf43bd69c8466e0cdaa769e51337d6f54a5fcdb492cc5882afb557878"],
      "javascript-flow.jsx": [6, "c6b2cb222c28c975b70ff019597060e9eaa99eccf17dda4f874d4b3b4ef0cdc6"],
      "javascript-native.js": [1, "ef00f2cabd6214ea06f8158401202de0437c45070330e617a27a7b068aa2f119"],
    } as const;
    for (const [name, [count, hash]] of Object.entries(expected)) {
      const source = await fs.readFile(path.join(REPO_ROOT, "packages/core/src/__tests__/fixtures/structural", name), "utf8");
      const chunks = smartChunk(source, name);
      expect(chunks).toHaveLength(count);
      expect(createHash("sha256").update(JSON.stringify(chunks)).digest("hex")).toBe(hash);
    }
  });

  test("classifies every exact pre-T9 fixture delta through the approved ledger", async () => {
    const baselinePath = path.join(REPO_ROOT, "packages/core/src/__tests__/fixtures/structural/pre-t9-baseline.json");
    const baselineBytes = await fs.readFile(baselinePath);
    expect(createHash("sha256").update(baselineBytes).digest("hex"))
      .toBe("fea48ca2470f5163130fb0181d0fb5ce984561ff45464844f56d58678ca16134");
    const baseline = JSON.parse(baselineBytes.toString("utf8"));
    const expected = {
      "typescript-flow.ts": [11, 5, 22, 23, 7, 40, "c83e786f933ef17e3731ce6b9cc330db56fafeb03b93526ba3a77af8ce851386"],
      "typescript-native.ts": [2, 0, 2, 3, 0, 3, "c15b19f8b613ecd9b1c4c694f80a713efb1f542dc87c5a27286c092a17a5b47c"],
      "javascript-flow.jsx": [4, 3, 7, 7, 3, 11, "cc4430186a9ee30520dfa2cf9f62a8457ad895d82b76279aac88c087c7b8370a"],
      "javascript-native.js": [1, 1, 0, 2, 1, 2, "7f7979e59856a297c8ef41ecb76a353af60b21e311683a2b6b3ae336248d8bef"],
    } as const;
    const runtime = new StructuralRuntime();
    for (const [name, [oldSymbols, oldImports, oldEdges, symbols, imports, edges, projectionHash]] of Object.entries(expected)) {
      expect(baseline[name].symbols).toHaveLength(oldSymbols);
      expect(baseline[name].imports).toHaveLength(oldImports);
      expect(baseline[name].edges).toHaveLength(oldEdges);
      const source = Buffer.from(await fs.readFile(path.join(REPO_ROOT, "packages/core/src/__tests__/fixtures/structural", name)));
      const outcome = await runtime.parse({ extension: path.extname(name), source });
      expect(outcome.status === "ok" || outcome.status === "recovered").toBe(true);
      if (outcome.status !== "ok" && outcome.status !== "recovered") throw new Error("native parity parse failed");
      const projection = {
        symbols: outcome.structure.symbols.map((item) => `${item.kind}:${item.name}`),
        imports: outcome.structure.imports.map((item) => `${item.form}:${item.specifier}:${item.names.join(",")}`),
        edges: outcome.structure.edges.map((item) => `${item.kind}:${item.target.status === "unresolved" ? `${item.target.qualifier ?? ""}#${item.target.name}` : item.target.fqn}`),
      };
      expect([projection.symbols.length, projection.imports.length, projection.edges.length]).toEqual([symbols, imports, edges]);
      expect(createHash("sha256").update(JSON.stringify(projection)).digest("hex")).toBe(projectionHash);
    }
    const ledger = await fs.readFile(path.join(REPO_ROOT, ".specs/features/multi-language-tree-sitter-breadth/ts-js-approved-differences.md"), "utf8");
    expect(ledger).toContain("Classifier:");
    for (const classifier of ["AD-003", "AD-004", "AD-005", "AD-006"]) expect(ledger).toContain(classifier);
    for (const fixtureName of Object.keys(expected)) expect(ledger).toContain(fixtureName);
  });

  test("scopes monorepo aliases by caller file and matches alias boundaries exactly", () => {
    const build = {
      knownFiles: ["packages/a/src/tool.ts", "packages/b/src/tool.ts"],
      pathAliasesByFile: {
        "packages/a/src/use.ts": [{ pattern: "@app/*", targets: ["packages/a/src/*"] }],
        "packages/b/src/use.ts": [{ pattern: "@app/*", targets: ["packages/b/src/*"] }],
      },
    };
    expect(resolveStructuralSpecifier("@app/tool", "packages/a/src/use.ts", build)).toBe("packages/a/src/tool.ts");
    expect(resolveStructuralSpecifier("@app/tool", "packages/b/src/use.ts", build)).toBe("packages/b/src/tool.ts");
    expect(resolveStructuralSpecifier("@app/tool", "packages/c/src/use.ts", build)).toBeUndefined();
    expect(matchesStructuralPathAlias("@app/tool", [{ pattern: "@app/*", targets: [] }])).toBe(true);
    expect(matchesStructuralPathAlias("@application/tool", [{ pattern: "@app/*", targets: [] }])).toBe(false);
    expect(matchesStructuralPathAlias("@app", [{ pattern: "@app", targets: [] }])).toBe(true);
    expect(matchesStructuralPathAlias("@application", [{ pattern: "@app", targets: [] }])).toBe(false);
  });

  test("has no TS/JS regex or typed-edge production fallback", async () => {
    const source = await fs.readFile(path.join(REPO_ROOT, "packages/core/src/services/etl/stages/parse.ts"), "utf8");
    expect(source).not.toContain("extractJsSymbols");
    expect(source).not.toContain("extractJsImports");
    expect(source).not.toContain("extractTypedEdges");
    await expect(fs.stat(path.join(REPO_ROOT, "packages/core/src/services/etl/typed-edges.ts"))).rejects.toThrow();
    const repositoryQueries = await fs.readFile(path.join(REPO_ROOT, "packages/core/src/data/symbol/symbol-repo-queries.ts"), "utf8");
    expect(repositoryQueries).toContain("LIMIT ${SAFETY_CAP + 1}");
    expect(repositoryQueries).toContain("symbol_definition_safety_cap_exceeded");
  });

  test("fails closed on repository seed errors and malformed persisted identities", async () => {
    const skipped = (await fixture("skipped.ts", "", false)).file;
    await expect(new ResolveStage({ listAllDefinitions: async () => { throw new Error("repo down"); } } as never)
      .run(context(path.dirname(skipped.absolutePath)), [{ file: skipped, chunks: [], symbols: [], rawImports: [], rawEdges: [] }]))
      .rejects.toThrow("structural_repository_seed_failed");

    const { dir, file } = await fixture("caller.ts", "helper();\n");
    const parsed: ParsedFile = { file, chunks: [], symbols: [], rawImports: [], rawEdges: [], structure: {
      symbols: [], imports: [], edges: [{ kind: "call", span: SPAN, target: { status: "unresolved", name: "helper" } }],
    } };
    const known = (await fixture("known.ts", "", false)).file;
    known.absolutePath = path.join(dir, "known.ts");
    const badRepo = { listAllDefinitions: async () => [{
      id: "other.ts#helper", project_id: "structural-etl", file_path: "known.ts", name: "helper", kind: "function" as const,
      line_start: 1, line_end: 1, exported: true, indexed_at: 1,
    }] };
    await expect(new ResolveStage(badRepo as never).run(context(dir), [parsed, {
      file: known, chunks: [], symbols: [], rawImports: [], rawEdges: [],
    }])).rejects.toThrow("structural_repository_seed_file_mismatch");

    const duplicate = { listAllDefinitions: async () => Array(2).fill({
      id: "known.ts#helper", project_id: "structural-etl", file_path: "known.ts", name: "helper", kind: "function" as const,
      line_start: 1, line_end: 1, exported: true, indexed_at: 1,
    }) };
    await expect(new ResolveStage(duplicate as never).run(context(dir), [parsed, {
      file: known, chunks: [], symbols: [], rawImports: [], rawEdges: [],
    }])).rejects.toThrow("structural_repository_seed_duplicate:known.ts#helper");
  });

  test("persists modern identities, spans, unresolved specialized edges, and non-duplicated imports", () => {
    const batch = buildSymbolPersistenceBatch("p", {
      file: { absolutePath: "/tmp/a.ts", relativePath: "a.ts", mtime: 0, size: 0, contentHash: "x", needsReparse: true },
      chunks: [], structure: EMPTY, structuralDiagnostics: [], structuralRecovered: false,
      symbols: [{ kind: "method", name: "run", fqn: "a.ts#C.run~method~" + "a".repeat(64), lineStart: 3, lineEnd: 5, exported: true, span: SPAN }],
      rawImports: [], rawEdges: [],
      resolvedImports: [
        { raw: { specifier: "./b", names: ["local"], isTypeOnly: false, form: "esm_import", span: SPAN, bindings: [{ imported: "remote", local: "local", typeOnly: false }] }, resolvedPath: "b.ts", external: false },
        { raw: { specifier: "./c", names: ["forwarded"], isTypeOnly: false, form: "esm_re_export", span: SPAN, bindings: [{ imported: "remote", local: "forwarded", typeOnly: false }] }, resolvedPath: "c.ts", external: false },
      ],
      resolvedEdges: [
        { kind: "http_call", line: 4, symbolName: "fetch", span: SPAN, meta: { route: "/api" } },
        { kind: "data_flow", line: 4, symbolName: "remote", span: SPAN, meta: { paramIndex: 0 } },
      ],
    });
    expect(batch.definitions[0]?.id).toContain("~method~");
    expect(batch.references.filter((item) => item.ref_kind === "import")).toHaveLength(1);
    expect(batch.references.find((item) => item.ref_kind === "import")?.target_fqn).toBeUndefined();
    expect(batch.references.map((item) => item.ref_kind)).toEqual(["import", "http_call", "data_flow"]);
    expect(batch.references[1]?.meta).toMatchObject({ sourceSpan: SPAN, route: "/api" });
    expect(batch.imports).toHaveLength(2);
  });
});

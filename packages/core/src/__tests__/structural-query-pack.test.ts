import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  loadNativeGrammarSet,
  type GrammarArtifact,
} from "../services/structural/grammar-loaders.js";
import {
  STRUCTURAL_QUERY_MATCH_LIMIT,
  StructuralRuntime,
  executeBoundedNativeQuery,
} from "../services/structural/structural-runtime.js";
import {
  executeQueryPack,
  normalizeQueryCaptures,
  structuralQueryPackForDialect,
} from "../services/structural/query-pack.js";
import type { QueryCapabilityContract } from "../services/structural/query-pack.js";

const fixture = (name: string): Buffer => readFileSync(
  fileURLToPath(new URL(`./fixtures/structural/${name}`, import.meta.url)),
);

async function parse(extension: string, source: Buffer, artifact: GrammarArtifact) {
  const grammarSet = await loadNativeGrammarSet([artifact]);
  return new StructuralRuntime({ grammarSet: () => grammarSet }).parse({ extension, source });
}

async function parseTypeScriptWithCapabilities(
  source: string,
  capabilities: QueryCapabilityContract,
) {
  const grammarSet = await loadNativeGrammarSet([{
    packageName: "tree-sitter-typescript", version: "0.23.2", exportName: "typescript",
  }]);
  const pack = structuralQueryPackForDialect("typescript")!;
  return new StructuralRuntime({ grammarSet: () => grammarSet }).parse({
    extension: ".ts",
    source: Buffer.from(source),
    queryExecutor: (tree, bytes, _language, context) => executeQueryPack(pack, tree, bytes, context, capabilities),
  });
}

describe("declarative structural query packs", () => {
  test("registers one immutable versioned pack across TS/JS/TSX/JSX", () => {
    const ts = structuralQueryPackForDialect("typescript");
    expect(ts?.version).toBe("1.0.0");
    expect(structuralQueryPackForDialect("tsx")).toBe(ts);
    const js = structuralQueryPackForDialect("javascript");
    expect(structuralQueryPackForDialect("jsx")).toBe(js);
    expect(Object.isFrozen(ts)).toBe(true);
    expect(Object.isFrozen(ts?.querySources)).toBe(true);
    expect(structuralQueryPackForDialect("python")).toBeUndefined();
  });

  test("normalizes capture order and removes only exact duplicate captures", () => {
    const node = (startIndex: number, endIndex: number) => ({ type: "identifier", startIndex, endIndex });
    const result = normalizeQueryCaptures([
      { name: "symbol.function", node: node(10, 20) },
      { name: "symbol.class", node: node(1, 9) },
      { name: "symbol.function", node: node(10, 20) },
      { name: "edge.call", node: node(10, 20) },
    ]);
    expect(result.map((capture) => capture.name)).toEqual([
      "symbol.class", "edge.call", "symbol.function",
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("extracts TSX declarations, docs, nesting, overloads, imports and exact edge families", async () => {
    const source = fixture("typescript-flow.ts");
    const outcome = await parse(".tsx", source, {
      packageName: "tree-sitter-typescript",
      version: "0.23.2",
      exportName: "tsx",
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok" && outcome.status !== "recovered") return;

    const symbols = outcome.structure.symbols;
    expect(symbols.some((symbol) => symbol.kind === "class" && symbol.qualifiedName === "Outer" && symbol.exported)).toBe(true);
    expect(symbols.find((symbol) => symbol.kind === "class")?.documentation).toContain("Public service documentation");
    expect(symbols.filter((symbol) => symbol.kind === "method" && symbol.qualifiedName === "Outer.run")).toHaveLength(3);
    expect(symbols.some((symbol) => symbol.kind === "field" && symbol.qualifiedName === "Outer.label")).toBe(true);
    expect(symbols.some((symbol) => symbol.kind === "constructor" && symbol.qualifiedName === "Outer.constructor")).toBe(true);
    expect(symbols.some((symbol) => symbol.kind === "interface" && symbol.qualifiedName === "LocalFace")).toBe(true);
    expect(symbols.some((symbol) => symbol.kind === "enum" && symbol.qualifiedName === "State")).toBe(true);
    expect(symbols.some((symbol) => symbol.kind === "type" && symbol.qualifiedName === "Identifier")).toBe(true);
    expect(symbols.some((symbol) => symbol.kind === "module" && symbol.qualifiedName === "LegacyModule")).toBe(true);
    expect(symbols.some((symbol) => symbol.kind === "type_parameter" && symbol.name === "T")).toBe(true);
    expect(symbols.some((symbol) => symbol.kind === "export" && symbol.name === "publicShared")).toBe(true);
    expect(symbols.some((symbol) => symbol.kind === "constant" && symbol.name === "exportedValue" && symbol.exported)).toBe(true);
    const shape = symbols.find((symbol) => symbol.kind === "method" && symbol.qualifiedName === "Outer.shape");
    expect(shape?.signature).toBe("shape(): { value: string }");
    expect(shape?.signatureMaterial).toEqual({ arity: 0, typeTokens: ["{ value: string }"], modifiers: [] });
    expect(symbols.find((symbol) => symbol.kind === "constructor")?.signatureMaterial).toMatchObject({ arity: 1, typeTokens: ["Service"] });
    expect(symbols.some((symbol) => symbol.kind === "namespace" && symbol.qualifiedName === "Tools")).toBe(true);
    expect(symbols.some((symbol) => symbol.kind === "function" && symbol.qualifiedName === "Tools.nested")).toBe(true);

    expect(outcome.structure.imports.map((item) => [item.specifier, item.typeOnly])).toEqual([
      ["./face.js", true], ["./helper.js", false], ["./default.js", false], ["./space.js", false],
      ["./mixed.js", false], ["./shared.js", false], ["./lazy.js", false],
    ]);
    expect(outcome.structure.imports.slice(0, 4).map((item) => item.bindings)).toEqual([
      [{ imported: "Face", local: "Face", typeOnly: true }],
      [{ imported: "helper", local: "assist", typeOnly: false }],
      [{ imported: "default", local: "DefaultThing", typeOnly: false }],
      [{ imported: "*", local: "Space", typeOnly: false }],
    ]);
    expect(outcome.structure.imports[4]?.bindings).toEqual([
      { imported: "MixedType", local: "MixedType", typeOnly: true },
      { imported: "value", local: "localValue", typeOnly: false },
    ]);
    const kinds = outcome.structure.edges.map((edge) => edge.kind);
    expect(kinds.filter((kind) => kind === "import")).toHaveLength(7);
    expect(kinds).toContain("extend");
    expect(kinds).toContain("implement");
    expect(kinds).toContain("type_ref");
    expect(kinds).toContain("http_call");
    expect(kinds).toContain("emit");
    expect(kinds).toContain("listen");
    expect(kinds).toContain("data_flow");
    const targets = outcome.structure.edges.flatMap((edge) => edge.target.status === "unresolved" ? [edge.target.name] : []);
    expect(targets).toEqual(expect.arrayContaining(["Face", "Parent", "Generic", "Box", "Item", "ParentArg", "Id", "Service"]));
    expect(outcome.structure.edges.some((edge) => edge.kind === "implement" && edge.target.status === "unresolved" && edge.target.name === "Generic" && edge.target.qualifier === "Domain")).toBe(true);

    const calls = outcome.structure.edges.filter((edge) => edge.kind === "call");
    expect(calls.map((edge) => edge.target.status === "unresolved" ? edge.target.name : "")).toEqual([
      "Service", "assist", "render", "label",
    ]);
    expect(calls.some((edge) => edge.target.status === "unresolved" && edge.target.name === "assist")).toBe(true);
    expect(calls.some((edge) => edge.target.status === "unresolved" && ["fetch", "post", "emit", "once"].includes(edge.target.name))).toBe(false);
    expect(calls.some((edge) => edge.target.status === "unresolved" && edge.target.name === "run")).toBe(false);
    expect(calls.some((edge) => edge.target.status === "unresolved" && edge.target.name === "label")).toBe(true);

    const flow = outcome.structure.edges.find((edge) => edge.kind === "data_flow" && edge.metadata?.argument === "input");
    expect(flow?.paramIndex).toBe(0);
    expect(source.subarray(flow!.span.startByte, flow!.span.endByte).toString()).toBe("input");
    expect(outcome.structure.edges
      .filter((edge) => edge.kind === "data_flow")
      .map((edge) => [edge.metadata?.argument, edge.paramIndex])).toEqual([
        ["input", 0], ["input", 0], ["input", 1], ["input", 1], ["handle", 1], ["input", 1], ["handle", 1],
      ]);
    const events = outcome.structure.edges.filter((edge) => edge.kind === "emit" || edge.kind === "listen");
    expect(events.map((edge) => edge.target.status === "unresolved" ? edge.target.name : "")).toEqual(["completed", "completed", "bare", "bare"]);
    expect(events).toHaveLength(4);
    const http = outcome.structure.edges.filter((edge) => edge.kind === "http_call");
    expect(http).toHaveLength(3);
    expect(http.some((edge) => edge.target.status === "unresolved" && edge.target.name === "gql")).toBe(true);
    expect(outcome.structure.edges.filter((edge) => edge.kind === "data_flow").every((edge) => edge.metadata?.argument !== "shape")).toBe(true);
    expect(Object.isFrozen(outcome.structure)).toBe(true);
    expect(Object.isFrozen(outcome.structure.symbols[0]?.span)).toBe(true);
    expect(Object.isFrozen(outcome.structure.symbols[0]?.span.start)).toBe(true);
    expect(Object.isFrozen(outcome.structure.edges[0]?.target)).toBe(true);
    for (const symbol of symbols) {
      expect(source.subarray(symbol.span.startByte, symbol.span.endByte).toString("utf8").length).toBeGreaterThan(0);
    }
  });

  test("extracts JSX structure and template-literal HTTP calls without JSX false declarations", async () => {
    const source = fixture("javascript-flow.jsx");
    const outcome = await parse(".jsx", source, {
      packageName: "tree-sitter-javascript",
      version: "0.25.0",
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok" && outcome.status !== "recovered") return;
    expect(outcome.structure.symbols.some((symbol) => symbol.kind === "class" && symbol.name === "Card")).toBe(true);
    expect(outcome.structure.symbols.some((symbol) => symbol.kind === "method" && symbol.qualifiedName === "Card.render")).toBe(true);
    expect(outcome.structure.symbols.some((symbol) => symbol.kind === "field" && symbol.qualifiedName === "Card.title")).toBe(true);
    expect(outcome.structure.symbols.some((symbol) => symbol.kind === "field" && symbol.qualifiedName === "Card.%23secret")).toBe(true);
    expect(outcome.structure.symbols.some((symbol) => symbol.kind === "function" && symbol.name === "arrow")).toBe(true);
    expect(outcome.structure.symbols.some((symbol) => symbol.name === "article")).toBe(false);
    expect(outcome.structure.edges.some((edge) => edge.kind === "listen")).toBe(true);
    expect(outcome.structure.edges.some((edge) => edge.kind === "http_call")).toBe(true);
    expect(outcome.structure.edges.some((edge) => edge.kind === "extend" && edge.target.status === "unresolved" && edge.target.name === "Component")).toBe(true);
    expect(outcome.structure.imports.map((item) => item.specifier)).toEqual(["react", "./render-card.js", "./legacy.js"]);
    expect(outcome.structure.edges.some((edge) => edge.kind === "call" && edge.target.status === "unresolved" && edge.target.name === "require")).toBe(false);
    expect(outcome.structure.edges.filter((edge) => edge.kind === "call").some((edge) => edge.target.status === "unresolved" && edge.target.name === "renderCard")).toBe(true);
  });

  test("executes the native TypeScript dialect without TSX-only assumptions", async () => {
    const source = fixture("typescript-native.ts");
    const outcome = await parse(".ts", source, {
      packageName: "tree-sitter-typescript", version: "0.23.2", exportName: "typescript",
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.structure.symbols.map((symbol) => [symbol.kind, symbol.name, symbol.exported])).toEqual([
      ["export", "default", true], ["function", "format", true], ["constant", "enabled", true],
    ]);
    expect(outcome.structure.symbols[1]?.signature).toBe("function format(value: Model): { text: string }");
    expect(outcome.structure.symbols[1]?.signatureMaterial).toEqual({
      arity: 1, typeTokens: ["Model", "{ text: string }"], modifiers: ["default", "export"],
    });
  });

  test("executes the native JavaScript dialect with fields, extends and require bindings", async () => {
    const source = fixture("javascript-native.js");
    const outcome = await parse(".js", source, {
      packageName: "tree-sitter-javascript", version: "0.25.0",
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.structure.symbols.some((symbol) => symbol.kind === "field" && symbol.qualifiedName === "NativeJs.field")).toBe(true);
    expect(outcome.structure.edges.some((edge) => edge.kind === "extend" && edge.target.status === "unresolved" && edge.target.name === "Base" && edge.target.qualifier === "NS")).toBe(true);
    expect(outcome.structure.imports[0]).toMatchObject({ specifier: "./dependency.js", bindings: [] });
  });

  test("filters fabricated captures through forbidden capability declarations", async () => {
    const source = Buffer.from("export class Hidden extends Base { run(value: Type) { fetch('/api/x'); } }");
    const grammarSet = await loadNativeGrammarSet([{
      packageName: "tree-sitter-typescript", version: "0.23.2", exportName: "typescript",
    }]);
    const forbidden = {
      declarations: "forbidden", documentation: "forbidden", imports: "forbidden",
      type_relations: "forbidden", calls: "forbidden", data_flow: "forbidden",
      specialized_edges: "forbidden",
    } as const;
    const pack = structuralQueryPackForDialect("typescript")!;
    const outcome = await new StructuralRuntime({ grammarSet: () => grammarSet }).parse({
      extension: ".ts",
      source,
      queryExecutor: (tree, bytes, _language, context) => executeQueryPack(pack, tree, bytes, context, forbidden),
    });
    expect(outcome).toMatchObject({
      status: "ok", structure: { symbols: [], imports: [], edges: [] },
    });
  });

  test("suppresses specialized calls instead of downgrading them when specialized edges are forbidden", async () => {
    const outcome = await parseTypeScriptWithCapabilities("fetch('/api/x', bare);", {
      declarations: "forbidden", documentation: "forbidden", imports: "forbidden",
      type_relations: "forbidden", calls: "required", data_flow: "forbidden",
      specialized_edges: "forbidden",
    });
    expect(outcome).toMatchObject({ status: "ok", structure: { edges: [] } });
  });

  test("emits bare-argument flow independently when call and specialized edges are forbidden", async () => {
    const outcome = await parseTypeScriptWithCapabilities("fetch('/api/x', bare);", {
      declarations: "forbidden", documentation: "forbidden", imports: "forbidden",
      type_relations: "forbidden", calls: "forbidden", data_flow: "required",
      specialized_edges: "forbidden",
    });
    expect(outcome).toMatchObject({
      status: "ok",
      structure: { edges: [{ kind: "data_flow", paramIndex: 1, target: { name: "fetch" } }] },
    });
  });

  test("normalizes anonymous default class and function exports", async () => {
    for (const source of ["export default function () {}", "export default class {}"] as const) {
      const outcome = await parseTypeScriptWithCapabilities(source, {
        declarations: "required", documentation: "required", imports: "required",
        type_relations: "required", calls: "required", data_flow: "required",
        specialized_edges: "required",
      });
      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") continue;
      expect(outcome.structure.symbols.map((symbol) => [symbol.kind, symbol.name])).toEqual([["export", "default"]]);
    }
  });

  test("preserves type-literal signature material and ignores literals/comments for modifiers and arity", async () => {
    const outcome = await parseTypeScriptWithCapabilities(
      'type ShapeAlias = { label: "public"; value: string }; function count(a: string, /* gap */ b: number): void {}',
      {
        declarations: "required", documentation: "required", imports: "required",
        type_relations: "required", calls: "required", data_flow: "required",
        specialized_edges: "required",
      },
    );
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    const alias = outcome.structure.symbols.find((symbol) => symbol.name === "ShapeAlias");
    expect(alias?.signature).toBe('type ShapeAlias = { label: "public"; value: string }');
    expect(alias?.signatureMaterial).toEqual({
      arity: 0, typeTokens: ['{ label: "public"; value: string }'], modifiers: [],
    });
    expect(outcome.structure.symbols.find((symbol) => symbol.name === "count")?.signatureMaterial).toEqual({
      arity: 2, typeTokens: ["string", "number", "void"], modifiers: [],
    });
  });

  test("derives modifiers only from direct syntax tokens, not decorator arguments", async () => {
    const outcome = await parseTypeScriptWithCapabilities(
      'const af = async (value: string): Promise<string> => value; @sealed("public") class Decorated {}',
      {
        declarations: "required", documentation: "required", imports: "required",
        type_relations: "required", calls: "required", data_flow: "required",
        specialized_edges: "required",
      },
    );
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.structure.symbols.find((symbol) => symbol.name === "af")?.signatureMaterial.modifiers).toEqual(["async"]);
    expect(outcome.structure.symbols.find((symbol) => symbol.name === "Decorated")?.signatureMaterial.modifiers).toEqual([]);
  });

  test("keeps unsupported language packs a hard query failure instead of empty success", async () => {
    const source = Buffer.from("def example():\n    pass\n");
    const outcome = await parse(".py", source, {
      packageName: "tree-sitter-python",
      version: "0.25.0",
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.failureKind).toBe("query");
    expect(outcome.diagnostics[0]?.code).toBe("structural_query_failed");
  });

  test("turns query compilation errors into hard query outcomes", async () => {
    const source = Buffer.from("function valid() {}\n");
    const grammarSet = await loadNativeGrammarSet([{
      packageName: "tree-sitter-typescript",
      version: "0.23.2",
      exportName: "typescript",
    }]);
    const outcome = await new StructuralRuntime({ grammarSet: () => grammarSet }).parse({
      extension: ".ts",
      source,
      queryExecutor(tree, _source, _language, context) {
        context.query("(definitely_not_a_typescript_node) @broken", tree.rootNode);
        return { symbols: [], edges: [], imports: [] };
      },
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.failureKind).toBe("query");
    expect(outcome.diagnostics[0]?.code).toBe("structural_query_failed");
  });

  test("rejects match-limit exhaustion before returning partial captures", () => {
    let receivedLimit = 0;
    const fakeQuery = {
      matches(_node: never, options?: { matchLimit?: number }) {
        receivedLimit = options?.matchLimit ?? 0;
        return [{ captures: [{ name: "symbol.function", node: { type: "function_declaration", startIndex: 0, endIndex: 1 } }] }];
      },
      didExceedMatchLimit: () => true,
    };
    expect(() => executeBoundedNativeQuery(fakeQuery, {} as never)).toThrow("structural_query_match_limit_exceeded");
    expect(receivedLimit).toBe(STRUCTURAL_QUERY_MATCH_LIMIT);
  });

  test("compiles each immutable query source once per grammar", async () => {
    let compilations = 0;
    class FakeQuery {
      constructor(_grammar: unknown, _source: string | Buffer) { compilations += 1; }
      matches() { return []; }
      didExceedMatchLimit() { return false; }
    }
    class FakeParser {
      static Query = FakeQuery;
      setLanguage() {}
      parse() {
        return {
          rootNode: {
            type: "program",
            hasError: false,
            startIndex: 0,
            endIndex: 0,
            namedChildren: [],
            childForFieldName: () => null,
          },
          delete() {},
        };
      }
    }
    const grammar = {};
    const runtime = new StructuralRuntime({
      grammarSet: () => ({
        Parser: FakeParser,
        grammars: new Map([["tree-sitter-typescript#typescript", grammar]]),
      }),
    });
    const first = await runtime.parse({ extension: ".ts", source: Buffer.from("") });
    const second = await runtime.parse({ extension: ".ts", source: Buffer.from("") });
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    expect(compilations).toBe(structuralQueryPackForDialect("typescript")?.querySources.length);

    class OtherFakeQuery extends FakeQuery {}
    class OtherFakeParser extends FakeParser { static Query = OtherFakeQuery; }
    const otherRuntime = new StructuralRuntime({
      grammarSet: () => ({
        Parser: OtherFakeParser,
        grammars: new Map([["tree-sitter-typescript#typescript", grammar]]),
      }),
    });
    expect((await otherRuntime.parse({ extension: ".ts", source: Buffer.from("") })).status).toBe("ok");
    expect(compilations).toBe((structuralQueryPackForDialect("typescript")?.querySources.length ?? 0) * 2);
  });

  test("retains valid declarations from a recovered syntax tree", async () => {
    const source = Buffer.from("class Kept {}\nfunction broken( {\n");
    const outcome = await parse(".ts", source, {
      packageName: "tree-sitter-typescript",
      version: "0.23.2",
      exportName: "typescript",
    });
    expect(outcome.status).toBe("recovered");
    if (outcome.status !== "recovered") return;
    expect(outcome.structure.symbols.some((symbol) => symbol.kind === "class" && symbol.name === "Kept")).toBe(true);
    expect(outcome.diagnostics[0]?.code).toBe("recovered_syntax_error");
  });
});

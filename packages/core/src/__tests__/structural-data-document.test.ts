import { expect, test } from "bun:test";
import { describeNative } from "./_helpers/native-skip.js";
import { loadNativeGrammarSet } from "../services/structural/grammar-loaders.js";
import { StructuralRuntime } from "../services/structural/structural-runtime.js";
import { SourceIndex } from "../services/structural/source-span.js";
import { LANGUAGE_MANIFEST } from "../services/structural/language-manifest.js";

const artifacts = [".vue", ".md", ".json", ".yaml", ".js", ".ts"]
  .map((extension) => LANGUAGE_MANIFEST.find((entry) => entry.extension === extension)!.grammarArtifact);

async function runtime(capacity = 4) {
  const loaded = await loadNativeGrammarSet(artifacts);
  return new StructuralRuntime({ grammarSet: () => loaded, pool: { capacity } });
}

describeNative("embedded and data structural packs", () => {
  test("runs five independent native fixtures for every document/data extension", async () => {
    const engine = await runtime(1);
    const cases: Readonly<Record<string, readonly string[]>> = {
      ".vue": [
        "<script>const a=1</script>", "<script lang='ts'>const b:number=2</script>",
        "<template><Card/></template>", "<script>function d(){}</script>", "<script lang=\"js\">class E {}</script>",
      ],
      ".md": ["# A\n", "A\n=\n", "## B\n", "```js\nconst d=1\n```\n", "# E\n### F\n"],
      ".json": ['{"a":1}', '{"a":{"b":2}}', '{"a":[{"b":2}]}', '{"é":true}', '{"a":null,"b":false}'],
      ".yaml": ["a: 1\n", "a:\n  b: 2\n", "a: [1, 2]\n", "é: true\n", "{a: {b: 2}}\n"],
      ".yml": ["a: 1\n", "a:\n  b: 2\n", "a: [1, 2]\n", "é: true\n", "{a: {b: 2}}\n"],
    };
    for (const [extension, sources] of Object.entries(cases)) for (const source of sources) {
      const outcome = await engine.parse({ extension, source: Buffer.from(source) });
      expect(outcome.status === "ok" || outcome.status === "recovered").toBe(true);
      if (outcome.status === "ok" || outcome.status === "recovered") expect(outcome.structure.symbols.length + outcome.structure.edges.length).toBeGreaterThan(0);
    }
  });

  test("extracts hierarchical Markdown headings and remapped declared fences", async () => {
    const source = Buffer.from("\uFEFF# API\r\n## Child\r\n```ts\r\n\tconst café = () => 1;\r\n```\r\n");
    const outcome = await (await runtime(1)).parse({ extension: ".md", source });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.structure.symbols.map((symbol) => symbol.qualifiedName)).toEqual([
      "API", "API.Child", "markdown.fence[0].café",
    ]);
    const child = outcome.structure.symbols.at(-1)!;
    expect(new SourceIndex(source).snippet(child.span)).toBe("café = () => 1");
    expect(child.span.start.column).toBe(7);
  });

  test("parses Vue default and declared scripts after releasing a capacity-one host lease", async () => {
    const source = Buffer.from("<template><UserCard/><div/></template>\r\n<script>const first = 1;</script>\r\n<script lang=\"ts\">function second(): number { return 2 }</script>");
    const outcome = await (await runtime(1)).parse({ extension: ".vue", source });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.structure.symbols.map((symbol) => symbol.qualifiedName)).toContain("vue.script[0].first");
    expect(outcome.structure.symbols.map((symbol) => symbol.qualifiedName)).toContain("vue.script[1].second");
    expect(outcome.structure.edges.some((edge) => edge.kind === "type_ref" && edge.target.status === "unresolved" && edge.target.name === "UserCard")).toBe(true);
    expect(outcome.structure.edges.some((edge) => edge.target.status === "unresolved" && edge.target.name === "div")).toBe(false);
  });

  test("keeps unknown fences semantic-only with an explicit fallback diagnostic", async () => {
    const outcome = await (await runtime()).parse({ extension: ".md", source: Buffer.from("```wat\nnot code\n```\n") });
    expect(outcome.status).toBe("recovered");
    expect(outcome.diagnostics.map((item) => item.code)).toContain("unsupported_structural_language");
  });

  test("extracts JSON and YAML qualified keys without array indices or edges", async () => {
    const engine = await runtime();
    const json = await engine.parse({ extension: ".json", source: Buffer.from('{"root":{"leaf":1},"arr":[{"item":2}]}') });
    const yaml = await engine.parse({ extension: ".yaml", source: Buffer.from("root:\n  leaf: 1\narr:\n  - item: 2\n") });
    for (const outcome of [json, yaml]) {
      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") continue;
      expect(outcome.structure.symbols.map((symbol) => symbol.qualifiedName)).toEqual(["root", "root.leaf", "arr", "arr.item"]);
      expect(outcome.structure.edges).toEqual([]);
      expect(outcome.structure.imports).toEqual([]);
    }
  });

  test("preserves exact UTF-8 bytes from wrapped native offsets", async () => {
    const source = Buffer.from("const before = '😀';\r\n\tfunction café() {}\r\n");
    const outcome = await (await runtime()).parse({ extension: ".ts", source });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    const symbol = outcome.structure.symbols.find((item) => item.name === "café")!;
    expect(new SourceIndex(source).snippet(symbol.selectionSpan!)).toBe("café");
    expect(symbol.selectionSpan!.start.column).toBe(10);
  });

  test("uses ordinal scopes for repeated fences and reports the two-level recursion limit", async () => {
    const repeated = await (await runtime(1)).parse({
      extension: ".md",
      source: Buffer.from("```js\nconst same = 1\n```\n```js\nconst same = 2\n```\n"),
    });
    expect(repeated.status).toBe("ok");
    if (repeated.status === "ok") expect(repeated.structure.symbols.map((item) => item.qualifiedName)).toEqual([
      "markdown.fence[0].same", "markdown.fence[1].same",
    ]);

    const nested = await (await runtime(1)).parse({
      extension: ".md",
      source: Buffer.from("````md\n~~~md\n```ts\nconst deep = 1\n```\n~~~\n````\n"),
    });
    expect(nested.status).toBe("recovered");
    expect(nested.diagnostics.map((item) => item.code)).toContain("embedded_recursion_limit");
  });

  test("reads Vue lang structurally across setup, attribute order, quoting, and unquoted values", async () => {
    const source = Buffer.from("<script setup defer lang=ts>const typed: number = 1</script><script lang='js' async>const plain = 2</script>");
    const outcome = await (await runtime(1)).parse({ extension: ".vue", source });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.structure.symbols.map((item) => item.qualifiedName)).toEqual([
      "vue.script[0].typed", "vue.script[1].plain",
    ]);
  });

  test("retains declarations and diagnostics from malformed Vue and Markdown children", async () => {
    const engine = await runtime(1);
    for (const [extension, source] of [
      [".vue", "<script lang='ts'>const kept = 1; function broken( {</script>"],
      [".md", "```js\nconst kept = 1; function broken( {\n```\n"],
    ] as const) {
      const outcome = await engine.parse({ extension, source: Buffer.from(source) });
      expect(outcome.status).toBe("recovered");
      if (outcome.status === "recovered") {
        expect(outcome.structure.symbols.some((item) => item.name === "kept")).toBe(true);
        expect(outcome.diagnostics.map((item) => item.code)).toContain("recovered_syntax_error");
      }
    }
  });

  test("propagates child hard failure kind with exact diagnostic totals", async () => {
    const markdown = LANGUAGE_MANIFEST.find((entry) => entry.extension === ".md")!.grammarArtifact;
    const loaded = await loadNativeGrammarSet([markdown]);
    const outcome = await new StructuralRuntime({ grammarSet: () => loaded, pool: { capacity: 1 } }).parse({
      extension: ".md", source: Buffer.from("```ts\nconst value = 1\n```\n"),
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.failureKind).toBe("grammar");
      expect(outcome.diagnosticCount).toBe(2);
      expect(outcome.diagnostics.map((item) => item.code)).toEqual(["native_parse_failed", "embedded_parse_failed"]);
    }
  });

  test("canonically deduplicates the same collected child slice", async () => {
    const loaded = await loadNativeGrammarSet(artifacts);
    const source = Buffer.from("const once = 1");
    const outcome = await new StructuralRuntime({ grammarSet: () => loaded, pool: { capacity: 1 } }).parse({
      extension: ".vue", source,
      queryExecutor(_tree, bytes, _language, context) {
        const slice = { extension: ".js", startByte: 0, endByte: bytes.length, scope: "vue.script[0]" };
        context.collectEmbeddedSlice(slice);
        context.collectEmbeddedSlice(slice);
        return { symbols: [], edges: [], imports: [] };
      },
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.structure.symbols.map((item) => item.qualifiedName)).toEqual(["vue.script[0].once"]);
  });
});

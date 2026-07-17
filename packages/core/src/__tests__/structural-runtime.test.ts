import { describe, expect, test } from "bun:test";
import { describeNative } from "./_helpers/native-skip.js";
import {
  grammarArtifactKey,
  type LoadedNativeGrammarSet,
  type NativeParserInstance,
  type NativeTree,
  type NativeTreeCursor,
} from "../services/structural/grammar-loaders.js";
import { LANGUAGE_MANIFEST } from "../services/structural/language-manifest.js";
import {
  getValidatedNativeGrammarSet,
  getParserReadiness,
  resetParserReadinessForTests,
  validateAllGrammars,
} from "../services/structural/parser-readiness.js";
import {
  DEFAULT_STRUCTURAL_ACQUIRE_TIMEOUT_MS,
  DEFAULT_STRUCTURAL_PARSER_CAPACITY,
  MAX_STRUCTURAL_ACQUIRE_TIMEOUT_MS,
  MAX_STRUCTURAL_PARSER_CAPACITY,
  ParserAcquireTimeoutError,
  StructuralParserPool,
} from "../services/structural/parser-pool.js";
import {
  StructuralRuntime,
  type StructuralQueryExecutor,
} from "../services/structural/structural-runtime.js";
import type { NormalizedStructure } from "../services/structural/types.js";
import { loadNativeGrammarSet } from "../services/structural/grammar-loaders.js";

const EMPTY: NormalizedStructure = Object.freeze({
  symbols: Object.freeze([]),
  edges: Object.freeze([]),
  imports: Object.freeze([]),
});

const TS_ENTRY = LANGUAGE_MANIFEST.find((entry) => entry.extension === ".ts")!;
const TS_GRAMMAR_KEY = grammarArtifactKey(TS_ENTRY.grammarArtifact);

function fakeTree(options: {
  hasError?: boolean;
  events?: string[];
  treeDeleteThrows?: boolean;
} = {}): NativeTree {
  const events = options.events ?? [];
  return {
    rootNode: {
      type: "program",
      hasError: options.hasError ?? false,
      endIndex: 1,
      walk() {
        const id = events.filter((event) => event.startsWith("cursor-created")).length + 1;
        events.push(`cursor-created-${id}`);
        return {
          delete() {
            events.push(`cursor-deleted-${id}`);
          },
        };
      },
    },
    delete() {
      events.push("tree-deleted");
      if (options.treeDeleteThrows) throw new Error("tree cleanup fault");
    },
  };
}

function fakeGrammarSet(
  parserFactory: () => NativeParserInstance,
): LoadedNativeGrammarSet {
  return {
    Parser: class {
      readonly #parser = parserFactory();
      setLanguage(language: unknown) { this.#parser.setLanguage(language); }
      parse(source: string | ((index: number) => string | null)) { return this.#parser.parse(source); }
    },
    grammars: new Map([[TS_GRAMMAR_KEY, { name: "typescript" }]]),
  };
}

describe("bounded structural parser pool", () => {
  test("freezes capacity and acquisition-timeout defaults/maxima", () => {
    expect(DEFAULT_STRUCTURAL_PARSER_CAPACITY).toBe(4);
    expect(MAX_STRUCTURAL_PARSER_CAPACITY).toBe(32);
    expect(DEFAULT_STRUCTURAL_ACQUIRE_TIMEOUT_MS).toBe(5_000);
    expect(MAX_STRUCTURAL_ACQUIRE_TIMEOUT_MS).toBe(60_000);
    const createParser = () => ({ setLanguage() {}, parse: () => fakeTree() });
    expect(() => new StructuralParserPool({ capacity: 33, createParser })).toThrow();
    expect(() => new StructuralParserPool({ acquireTimeoutMs: 60_001, createParser })).toThrow();
  });

  test("serializes overlap globally in FIFO order and release is idempotent", async () => {
    const pool = new StructuralParserPool({
      capacity: 1,
      createParser: () => ({ setLanguage() {}, parse: () => fakeTree() }),
    });
    const first = await pool.acquire("a", {});
    const order: string[] = [];
    const secondPromise = pool.acquire("b", {}).then((lease) => { order.push("b"); return lease; });
    const thirdPromise = pool.acquire("a", {}).then((lease) => { order.push("a"); return lease; });
    expect(pool.waiting).toBe(2);
    first.release();
    first.release();
    const second = await secondPromise;
    expect(order).toEqual(["b"]);
    second.release();
    const third = await thirdPromise;
    expect(order).toEqual(["b", "a"]);
    third.release();
    expect(pool.size).toBe(1);
  });

  test("reuses matching idle parsers and retargets wrong-key idle parsers at capacity", async () => {
    let created = 0;
    const languages: unknown[] = [];
    const pool = new StructuralParserPool({
      capacity: 1,
      createParser: () => {
        created += 1;
        return { setLanguage(language) { languages.push(language); }, parse: () => fakeTree() };
      },
    });
    const languageA = {};
    const languageB = {};
    const a1 = await pool.acquire("a", languageA); a1.release();
    const a2 = await pool.acquire("a", languageA); a2.release();
    const b = await pool.acquire("b", languageB); b.release();
    expect(created).toBe(1);
    expect(languages).toEqual([languageA, languageB]);
  });

  test("evicts failed factory and retarget slots before recovering capacity", async () => {
    let factoryAttempts = 0;
    let retargetFails = true;
    const pool = new StructuralParserPool({
      capacity: 1,
      createParser: () => {
        factoryAttempts += 1;
        if (factoryAttempts === 1) throw new Error("factory fault");
        return {
          setLanguage(language) {
            if (language === "b" && retargetFails) throw new Error("retarget fault");
          },
          parse: () => fakeTree(),
        };
      },
    });

    await expect(pool.acquire("a", "a")).rejects.toThrow("factory fault");
    const first = await pool.acquire("a", "a");
    first.release();
    await expect(pool.acquire("b", "b")).rejects.toThrow("retarget fault");
    expect(pool.size).toBe(0);
    retargetFails = false;
    const recovered = await pool.acquire("b", "b");
    expect(factoryAttempts).toBe(3);
    recovered.release();
  });

  test("times out deterministically through the injected timer seam", async () => {
    let fire!: () => void;
    const pool = new StructuralParserPool({
      capacity: 1,
      acquireTimeoutMs: 123,
      createParser: () => ({ setLanguage() {}, parse: () => fakeTree() }),
      scheduleTimeout(callback) { fire = callback; return 1; },
      cancelTimeout() {},
    });
    const held = await pool.acquire("a", {});
    const waiting = pool.acquire("b", {});
    fire();
    await expect(waiting).rejects.toEqual(expect.objectContaining({
      name: "ParserAcquireTimeoutError",
      timeoutMs: 123,
    }));
    expect(await waiting.catch((error) => error)).toBeInstanceOf(ParserAcquireTimeoutError);
    held.release();
  });
});

describeNative("structural runtime outcomes and lifetime", () => {
  test("keeps semantic-only extensions outside readiness and native acquisition", async () => {
    let grammarCalls = 0;
    const runtime = new StructuralRuntime({ grammarSet() { grammarCalls += 1; throw new Error("must not load"); } });
    const result = await runtime.parse({ extension: ".toml", source: Buffer.from("answer=42") });
    expect(result).toMatchObject({ status: "unsupported", diagnosticCount: 1 });
    expect(grammarCalls).toBe(0);
  });

  test("deletes all tracked cursors in reverse order before tree on forced query failure", async () => {
    const events: string[] = [];
    const loaded = fakeGrammarSet(() => ({ setLanguage() {}, parse: () => fakeTree({ events }) }));
    const runtime = new StructuralRuntime({ grammarSet: () => loaded });
    const result = await runtime.parse({
      extension: ".ts",
      source: Buffer.from("x"),
      queryExecutor(_tree, _source, _language, context) {
        context.createCursor();
        context.createCursor();
        throw new Error("forced query failure");
      },
    });
    expect(result).toMatchObject({ status: "failed", failureKind: "query" });
    expect(events).toEqual([
      "cursor-created-1",
      "cursor-created-2",
      "cursor-deleted-2",
      "cursor-deleted-1",
      "tree-deleted",
    ]);
  });

  test("reports recovered syntax with structure and hard parse failures without empty success", async () => {
    const recoveredRuntime = new StructuralRuntime({
      grammarSet: () => fakeGrammarSet(() => ({ setLanguage() {}, parse: () => fakeTree({ hasError: true }) })),
      queryExecutor: () => EMPTY,
    });
    expect(await recoveredRuntime.parse({ extension: ".ts", source: Buffer.from("?") })).toMatchObject({
      status: "recovered",
      diagnosticCount: 1,
      diagnostics: [{ code: "recovered_syntax_error" }],
    });

    const failedRuntime = new StructuralRuntime({
      grammarSet: () => fakeGrammarSet(() => ({ setLanguage() {}, parse() { throw new Error("grammar parse fault"); } })),
      queryExecutor: () => EMPTY,
    });
    expect(await failedRuntime.parse({ extension: ".ts", source: Buffer.from("x") })).toMatchObject({
      status: "failed",
      failureKind: "grammar",
      diagnostics: [{ code: "native_parse_failed" }],
    });
  });

  test("missing query executor is a hard failure and cleanup failure cannot become success", async () => {
    const noExecutor = new StructuralRuntime({
      grammarSet: () => fakeGrammarSet(() => ({ setLanguage() {}, parse: () => fakeTree() })),
    });
    expect(await noExecutor.parse({ extension: ".ts", source: Buffer.from("x") })).toMatchObject({
      status: "failed",
      failureKind: "query",
      diagnostics: [{ code: "structural_query_executor_unavailable" }],
    });

    const cleanupFailure = new StructuralRuntime({
      grammarSet: () => fakeGrammarSet(() => ({ setLanguage() {}, parse: () => fakeTree({ treeDeleteThrows: true }) })),
      queryExecutor: () => EMPTY,
    });
    expect(await cleanupFailure.parse({ extension: ".ts", source: Buffer.from("x") })).toMatchObject({
      status: "failed",
      failureKind: "infrastructure",
      diagnostics: [{ code: "tree_cleanup_failed" }],
    });
  });

  test("classifies ABI readiness and missing validated artifacts as hard native failures", async () => {
    const abiRuntime = new StructuralRuntime({
      grammarSet() { throw new Error("Module version ABI mismatch"); },
      queryExecutor: () => EMPTY,
    });
    expect(await abiRuntime.parse({ extension: ".ts", source: Buffer.from("x") })).toMatchObject({
      status: "failed",
      failureKind: "abi",
      diagnostics: [{ code: "parser_not_ready" }],
    });

    const missingRuntime = new StructuralRuntime({
      grammarSet: () => ({
        Parser: class { setLanguage() {} parse() { return fakeTree(); } },
        grammars: new Map(),
      }),
      queryExecutor: () => EMPTY,
    });
    expect(await missingRuntime.parse({ extension: ".ts", source: Buffer.from("x") })).toMatchObject({
      status: "failed",
      failureKind: "grammar",
      diagnostics: [{ code: "native_parse_failed" }],
    });
  });

  test("bounds detailed diagnostics at ten while preserving total count", async () => {
    const loaded = fakeGrammarSet(() => ({
      setLanguage() {},
      parse: () => {
        const tree = fakeTree();
        tree.rootNode.walk = () => ({ delete() { throw new Error("cursor cleanup fault"); } });
        return tree;
      },
    }));
    const runtime = new StructuralRuntime({ grammarSet: () => loaded });
    const result = await runtime.parse({
      extension: ".ts",
      source: Buffer.from("x"),
      queryExecutor(_tree, _source, _language, context) {
        for (let index = 0; index < 12; index += 1) context.createCursor();
        throw new Error("primary query fault");
      },
    });
    expect(result).toMatchObject({ status: "failed", failureKind: "query", diagnosticCount: 13 });
    expect(result.diagnostics).toHaveLength(10);
    expect(result.diagnostics[0]?.code).toBe("structural_query_failed");
  });

  test("test reset prevents an obsolete validation flight from publishing grammars", async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    resetParserReadinessForTests(async (artifacts) => {
      entered();
      await waiting;
      return {
        Parser: class {
          setLanguage() {}
          parse(source: string | ((index: number) => string | null)) {
            const text = typeof source === "string" ? source : "";
            return {
              rootNode: { type: "fixture", hasError: false, endIndex: Buffer.byteLength(text) },
              delete() {},
            };
          }
        },
        grammars: new Map(artifacts.map((artifact) => [grammarArtifactKey(artifact), {}])),
      };
    });
    const obsolete = validateAllGrammars();
    await started;
    resetParserReadinessForTests(async () => { throw new Error("new flight not started"); });
    release();
    await expect(obsolete).rejects.toThrow("superseded");
    expect(getParserReadiness().status).toBe("pending");
    expect(() => getValidatedNativeGrammarSet()).toThrow("not ready");
  });

  test("shares the production capacity across default runtime instances", async () => {
    resetParserReadinessForTests(loadNativeGrammarSet);
    await validateAllGrammars();
    let entered = 0;
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const executor: StructuralQueryExecutor = async () => {
      entered += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return EMPTY;
    };
    const parses = Array.from({ length: 5 }, () =>
      new StructuralRuntime({ queryExecutor: executor }).parse({
        extension: ".ts",
        source: Buffer.from("const answer = 42;\n"),
      })
    );

    for (let attempt = 0; attempt < 100 && entered < 4; attempt += 1) {
      await Bun.sleep(1);
    }
    expect(entered).toBe(4);
    expect(maximumActive).toBe(DEFAULT_STRUCTURAL_PARSER_CAPACITY);
    releases.shift()!();
    for (let attempt = 0; attempt < 100 && entered < 5; attempt += 1) {
      await Bun.sleep(1);
    }
    expect(entered).toBe(5);
    for (const release of releases.splice(0)) release();
    expect((await Promise.all(parses)).every((result) => result.status === "ok")).toBe(true);
  });

  test("real native runtime invalidates cached nodes/cursors and double deletion stays safe", async () => {
    resetParserReadinessForTests(loadNativeGrammarSet);
    await validateAllGrammars();
    expect(getValidatedNativeGrammarSet()).toBeTruthy();
    let cachedNode: { type: string } | undefined;
    let cachedCursor: NativeTreeCursor | undefined;
    const runtime = new StructuralRuntime({
      queryExecutor(tree, _source, _language, context) {
        cachedNode = tree.rootNode;
        cachedCursor = context.createCursor(tree.rootNode);
        return EMPTY;
      },
    });
    expect(await runtime.parse({ extension: ".ts", source: Buffer.from("const answer = 42;\n") })).toMatchObject({ status: "ok" });
    expect(() => cachedNode!.type).toThrow();
    expect(() => cachedCursor!.delete()).not.toThrow();
    expect(() => (cachedCursor as unknown as { nodeType: string }).nodeType).toThrow();
  });

  test("100 real runtime forced-GC cycles keep warm RSS median within 16 MiB", async () => {
    resetParserReadinessForTests(loadNativeGrammarSet);
    await validateAllGrammars();
    const runtime = new StructuralRuntime({ queryExecutor: () => EMPTY });
    const unit = "const answer = 42;\n";
    const source = Buffer.from(unit.repeat(Math.ceil((32 * 1024) / unit.length)));
    const rss: number[] = [];
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const result = await runtime.parse({ extension: ".ts", source });
      expect(result.status === "ok" || result.status === "recovered").toBe(true);
      Bun.gc(true);
      rss.push(process.memoryUsage.rss());
    }
    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return (sorted[9]! + sorted[10]!) / 2;
    };
    const early = median(rss.slice(20, 40));
    const late = median(rss.slice(80, 100));
    expect(late).toBeLessThanOrEqual(early + 16 * 1024 * 1024);
  });
});

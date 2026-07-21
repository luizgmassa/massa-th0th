import { describe, expect, test } from "bun:test";
import { describeNative } from "./_helpers/native-skip.js";
import {
  LANGUAGE_MANIFEST,
  resolveStructuralLanguage,
} from "../services/structural/language-manifest.js";
import {
  grammarArtifactKey,
  loadNativeGrammarSet,
  withMaskedBunVersion,
  type LoadedNativeGrammarSet,
  type NativeTree,
} from "../services/structural/grammar-loaders.js";
import {
  assertParserReadyForIndexing,
  getParserReadiness,
  resetParserReadinessForTests,
  validateAllGrammars,
} from "../services/structural/parser-readiness.js";

function descriptorEquals(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  return (
    left?.configurable === right?.configurable &&
    left?.enumerable === right?.enumerable &&
    left?.writable === right?.writable &&
    left?.value === right?.value &&
    left?.get === right?.get &&
    left?.set === right?.set
  );
}

describe("serialized Bun marker masking", () => {
  test("serializes callbacks and restores the exact descriptor after success and throw", async () => {
    const target = {};
    const original = {
      value: "1.3.0",
      writable: false,
      enumerable: true,
      configurable: true,
    } satisfies PropertyDescriptor;
    Object.defineProperty(target, "bun", original);
    let releaseFirst!: () => void;
    let enteredFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { enteredFirst = resolve; });
    const firstMayExit = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let secondEntered = false;

    const first = withMaskedBunVersion(async () => {
      expect(Object.hasOwn(target, "bun")).toBe(false);
      enteredFirst();
      await firstMayExit;
    }, { target });
    await firstEntered;
    const second = withMaskedBunVersion(() => {
      secondEntered = true;
      expect(Object.hasOwn(target, "bun")).toBe(false);
    }, { target });
    await Promise.resolve();
    expect(secondEntered).toBe(false);
    releaseFirst();
    await Promise.all([first, second]);
    expect(descriptorEquals(Object.getOwnPropertyDescriptor(target, "bun"), original)).toBe(true);

    const sentinel = new Error("callback failed");
    await expect(withMaskedBunVersion(() => { throw sentinel; }, { target })).rejects.toBe(sentinel);
    expect(descriptorEquals(Object.getOwnPropertyDescriptor(target, "bun"), original)).toBe(true);

    const asyncSentinel = new Error("async callback failed");
    await expect(withMaskedBunVersion(async () => {
      await Promise.resolve();
      throw asyncSentinel;
    }, { target })).rejects.toBe(asyncSentinel);
    expect(descriptorEquals(Object.getOwnPropertyDescriptor(target, "bun"), original)).toBe(true);
  });

  test("restores after setup/restoration faults and leaves the queue reusable", async () => {
    const target = { bun: "1.3.0" };
    const original = Object.getOwnPropertyDescriptor(target, "bun");
    await expect(withMaskedBunVersion(() => undefined, {
      target,
      deleteProperty(object, property) {
        Reflect.deleteProperty(object, property);
        throw new Error("delete setup fault");
      },
    })).rejects.toThrow("delete setup fault");
    expect(descriptorEquals(Object.getOwnPropertyDescriptor(target, "bun"), original)).toBe(true);

    await expect(withMaskedBunVersion(() => undefined, {
      target,
      restoreProperty() {
        throw new Error("restore fault");
      },
    })).rejects.toThrow("restore fault");
    expect(descriptorEquals(Object.getOwnPropertyDescriptor(target, "bun"), original)).toBe(true);

    await expect(withMaskedBunVersion(() => "reused", { target })).resolves.toBe("reused");
  });
});

describeNative("parser readiness", () => {
  test("loads and parses every real manifest entry on exact macOS arm64 or Linux glibc x64", async () => {
    resetParserReadinessForTests(loadNativeGrammarSet);
    const result = await validateAllGrammars();
    expect(result.status).toBe("ready");
    expect(result.validatedExtensions).toBe(33);
    expect(result.requiredExtensions).toBe(LANGUAGE_MANIFEST.length);
  });

  test("deduplicates loading, shares concurrent validation, deletes every tree, and caches ready", async () => {
    let loadCalls = 0;
    let parseCalls = 0;
    let deleteCalls = 0;
    let release!: () => void;
    const mayLoad = new Promise<void>((resolve) => { release = resolve; });
    const loader = async (artifacts: Parameters<typeof loadNativeGrammarSet>[0]): Promise<LoadedNativeGrammarSet> => {
      loadCalls += 1;
      expect(artifacts.length).toBe(27);
      await mayLoad;
      const grammars = new Map(artifacts.map((artifact) => [grammarArtifactKey(artifact), {}]));
      class Parser {
        setLanguage(language: unknown) { expect(language).toBeTruthy(); }
        parse(source: string): NativeTree {
          parseCalls += 1;
          return {
            rootNode: { type: "fixture", hasError: false, endIndex: Buffer.byteLength(source) },
            delete() { deleteCalls += 1; },
          };
        }
      }
      return { Parser, grammars };
    };
    resetParserReadinessForTests(loader);
    const first = validateAllGrammars();
    const second = validateAllGrammars();
    expect(getParserReadiness().status).toBe("validating");
    release();
    expect(await first).toBe(await second);
    expect(loadCalls).toBe(1);
    expect(parseCalls).toBe(33);
    expect(deleteCalls).toBe(33);
    await assertParserReadyForIndexing();
    expect(loadCalls).toBe(1);
    expect(parseCalls).toBe(33);
  });

  test("keeps bounded missing and ABI failures stable", async () => {
    resetParserReadinessForTests(async () => {
      throw new Error(`Cannot find native grammar ${"x".repeat(400)}`);
    });
    await expect(validateAllGrammars()).rejects.toThrow("not ready");
    const missing = getParserReadiness();
    expect(missing.status).toBe("failed");
    expect(missing.errors[0]?.code).toBe("missing_native_grammar");
    expect(missing.errors[0]?.message.length).toBeLessThanOrEqual(240);
    await expect(validateAllGrammars()).rejects.toThrow("not ready");
    expect(getParserReadiness()).toBe(missing);

    resetParserReadinessForTests(async () => {
      throw new Error("Module version ABI mismatch while calling setLanguage");
    });
    await expect(validateAllGrammars()).rejects.toThrow("not ready");
    expect(getParserReadiness().errors[0]?.code).toBe("incompatible_native_abi");
  });

  test("keeps configured unknown extensions semantic-only and outside readiness", () => {
    let loadCalls = 0;
    resetParserReadinessForTests(async () => {
      loadCalls += 1;
      throw new Error("semantic-only resolution must not load grammars");
    });

    expect(resolveStructuralLanguage(".TOML")).toMatchObject({
      status: "semantic_only",
      extension: ".toml",
      requiredForReadiness: false,
      diagnostic: { code: "unsupported_structural_language" },
    });
    expect(loadCalls).toBe(0);
    expect(getParserReadiness()).toMatchObject({
      status: "pending",
      requiredExtensions: 33,
      validatedExtensions: 0,
    });
  });
});

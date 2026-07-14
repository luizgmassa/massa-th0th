import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { GrammarArtifact } from "./types.js";
import {
  STRUCTURAL_BUN_VERSION,
  TREE_SITTER_NATIVE_MODULE_ABI,
} from "./language-manifest.js";

export interface NativeTree {
  readonly rootNode: {
    readonly type: string;
    readonly hasError: boolean;
    readonly endIndex: number;
    readonly startIndex?: number;
    walk?(): NativeTreeCursor;
  };
  delete(): void;
}

export interface NativeTreeCursor {
  delete(): void;
}

export interface NativeQueryNode {
  readonly type: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly namedChildren?: readonly NativeQueryNode[];
  readonly children?: readonly NativeQueryNode[];
  readonly parent?: NativeQueryNode | null;
  childForFieldName?(fieldName: string): NativeQueryNode | null;
}

export interface NativeQueryCapture {
  readonly name: string;
  readonly node: NativeQueryNode;
}

export interface NativeQueryInstance {
  matches(
    node: NativeQueryNode,
    options?: { matchLimit?: number },
  ): readonly { readonly captures: readonly NativeQueryCapture[] }[];
  didExceedMatchLimit(): boolean;
}

export interface NativeQueryConstructor {
  new (language: unknown, source: string | Buffer): NativeQueryInstance;
}

export interface NativeParserInstance {
  setLanguage(language: unknown): void;
  parse(source: string | ((index: number) => string | null)): NativeTree;
}

export interface NativeParserConstructor {
  new (): NativeParserInstance;
  Query?: NativeQueryConstructor;
}

export interface LoadedNativeGrammarSet {
  Parser: NativeParserConstructor;
  grammars: ReadonlyMap<string, unknown>;
}

export interface BunMaskAdapter {
  target: object;
  property?: PropertyKey;
  getDescriptor?: (
    target: object,
    property: PropertyKey,
  ) => PropertyDescriptor | undefined;
  deleteProperty?: (target: object, property: PropertyKey) => boolean;
  restoreProperty?: (
    target: object,
    property: PropertyKey,
    descriptor: PropertyDescriptor,
  ) => void;
}

type RuntimeRequire = ReturnType<typeof createRequire>;

const PROCESS_BUN_MASK_ADAPTER: BunMaskAdapter = {
  target: process.versions,
};

let bunMaskTail: Promise<void> = Promise.resolve();

function descriptorEquals(
  left: PropertyDescriptor,
  right: PropertyDescriptor,
): boolean {
  return (
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable &&
    left.value === right.value &&
    left.get === right.get &&
    left.set === right.set
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Serialize the process-global Bun compatibility mutation and restore the
 * complete property descriptor before the caller can use a loaded grammar.
 */
export async function withMaskedBunVersion<T>(
  callback: () => T | Promise<T>,
  adapter: BunMaskAdapter = PROCESS_BUN_MASK_ADAPTER,
): Promise<T> {
  const waitForTurn = bunMaskTail;
  let releaseTurn!: () => void;
  bunMaskTail = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  await waitForTurn;

  const property = adapter.property ?? "bun";
  const getDescriptor = adapter.getDescriptor ?? Object.getOwnPropertyDescriptor;
  const deleteProperty = adapter.deleteProperty ?? Reflect.deleteProperty;
  const restoreProperty =
    adapter.restoreProperty ??
    ((target: object, key: PropertyKey, descriptor: PropertyDescriptor) => {
      Object.defineProperty(target, key, descriptor);
    });
  let descriptor: PropertyDescriptor | undefined;
  let restoreRequired = false;
  let result!: T;
  let operationError: Error | undefined;
  let restorationError: Error | undefined;

  try {
    descriptor = getDescriptor(adapter.target, property);
    if (!descriptor) {
      throw new Error("process.versions.bun descriptor is missing before masking");
    }
    if (!descriptor.configurable) {
      throw new Error(
        "process.versions.bun must be configurable for native loading",
      );
    }

    // Arm restoration before invoking the potentially-throwing delete seam.
    restoreRequired = true;
    if (!deleteProperty(adapter.target, property)) {
      throw new Error("failed to mask process.versions.bun");
    }
    result = await callback();
  } catch (error) {
    operationError = asError(error);
  }

  try {
    if (restoreRequired && descriptor) {
      let restored: PropertyDescriptor | undefined;
      try {
        restoreProperty(adapter.target, property, descriptor);
        restored = getDescriptor(adapter.target, property);
      } catch (error) {
        restorationError = asError(error);
      }
      if (!restored || !descriptorEquals(restored, descriptor)) {
        try {
          // A failing injected/custom restoration hook must not leave the
          // process marker absent. This fallback is also used after a partial
          // restoration that produced the wrong descriptor.
          Object.defineProperty(adapter.target, property, descriptor);
          restored = getDescriptor(adapter.target, property);
        } catch (error) {
          restorationError = restorationError
            ? new AggregateError(
                [restorationError, asError(error)],
                "Bun descriptor restoration failed",
              )
            : asError(error);
        }
      }
      if (!restored || !descriptorEquals(restored, descriptor)) {
        restorationError ??= new Error("Bun descriptor restoration failed");
      }
    }
  } finally {
    // No adapter fault may poison the process-global serialization queue.
    releaseTurn();
  }

  if (operationError && restorationError) {
    throw new AggregateError(
      [operationError, restorationError],
      "Native loading and Bun descriptor restoration both failed",
    );
  }
  if (operationError) throw operationError;
  if (restorationError) throw restorationError;
  return result;
}

export function grammarArtifactKey(artifact: GrammarArtifact): string {
  return `${artifact.packageName}#${artifact.exportName ?? "module"}`;
}

function assertRuntimeTarget(): void {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(
      `Structural native parsing requires macOS arm64, got ${process.platform} ${process.arch}`,
    );
  }
  if (process.versions.bun !== STRUCTURAL_BUN_VERSION) {
    throw new Error(
      `Structural native parsing requires Bun ${STRUCTURAL_BUN_VERSION}, got ${process.versions.bun ?? "none"}`,
    );
  }
  if (Number(process.versions.modules) !== TREE_SITTER_NATIVE_MODULE_ABI) {
    throw new Error(
      `Structural native parsing requires ABI ${TREE_SITTER_NATIVE_MODULE_ABI}, got ${process.versions.modules ?? "none"}`,
    );
  }
}

async function importDefaultFrom(
  requireFromCore: RuntimeRequire,
  packageName: string,
): Promise<unknown> {
  const imported = await import(
    pathToFileURL(requireFromCore.resolve(packageName)).href
  );
  return (imported as { default?: unknown }).default ?? imported;
}

async function loadArtifact(
  requireFromCore: RuntimeRequire,
  artifact: GrammarArtifact,
): Promise<unknown> {
  let loaded: unknown;
  switch (artifact.packageName) {
    case "tree-sitter-javascript": loaded = requireFromCore("tree-sitter-javascript"); break;
    case "tree-sitter-typescript": loaded = requireFromCore("tree-sitter-typescript"); break;
    case "tree-sitter-html": loaded = requireFromCore("tree-sitter-html"); break;
    case "tree-sitter-dart": loaded = requireFromCore("tree-sitter-dart"); break;
    case "tree-sitter-python": loaded = requireFromCore("tree-sitter-python"); break;
    case "tree-sitter-php": loaded = requireFromCore("tree-sitter-php"); break;
    case "tree-sitter-java": loaded = requireFromCore("tree-sitter-java"); break;
    case "tree-sitter-go": loaded = requireFromCore("tree-sitter-go"); break;
    case "tree-sitter-rust": loaded = requireFromCore("tree-sitter-rust"); break;
    case "tree-sitter-cpp": loaded = requireFromCore("tree-sitter-cpp"); break;
    case "tree-sitter-c": loaded = requireFromCore("tree-sitter-c"); break;
    case "@tree-sitter-grammars/tree-sitter-markdown": loaded = requireFromCore("@tree-sitter-grammars/tree-sitter-markdown"); break;
    case "tree-sitter-json": loaded = requireFromCore("tree-sitter-json"); break;
    case "@tree-sitter-grammars/tree-sitter-yaml": loaded = requireFromCore("@tree-sitter-grammars/tree-sitter-yaml"); break;
    case "tree-sitter-c-sharp": loaded = await importDefaultFrom(requireFromCore, "tree-sitter-c-sharp"); break;
    case "tree-sitter-ruby": loaded = requireFromCore("tree-sitter-ruby"); break;
    case "tree-sitter-swift": loaded = requireFromCore("tree-sitter-swift"); break;
    case "@tree-sitter-grammars/tree-sitter-kotlin": loaded = requireFromCore("@tree-sitter-grammars/tree-sitter-kotlin"); break;
    case "tree-sitter-scala": loaded = requireFromCore("tree-sitter-scala"); break;
    case "@tree-sitter-grammars/tree-sitter-lua": loaded = await importDefaultFrom(requireFromCore, "@tree-sitter-grammars/tree-sitter-lua"); break;
    case "@tree-sitter-grammars/tree-sitter-zig": loaded = requireFromCore("@tree-sitter-grammars/tree-sitter-zig"); break;
    case "tree-sitter-elixir": loaded = requireFromCore("tree-sitter-elixir"); break;
    case "tree-sitter-erlang": loaded = requireFromCore("tree-sitter-erlang"); break;
    case "tree-sitter-clojure-orchard": loaded = requireFromCore("tree-sitter-clojure-orchard"); break;
    case "tree-sitter-ocaml": loaded = requireFromCore("tree-sitter-ocaml"); break;
    case "tree-sitter-haskell": loaded = requireFromCore("tree-sitter-haskell"); break;
    default: throw new Error(`Unsupported native grammar package: ${artifact.packageName}`);
  }
  if (artifact.exportName === "default") return loaded;
  const module = loaded as Record<string, unknown>;
  return artifact.exportName ? module[artifact.exportName] : module;
}

/** Load a deduplicated package+selector grammar set without parsing while masked. */
export async function loadNativeGrammarSet(
  artifacts: readonly GrammarArtifact[],
  requireFromCore: RuntimeRequire = createRequire(import.meta.url),
): Promise<LoadedNativeGrammarSet> {
  assertRuntimeTarget();
  return withMaskedBunVersion(async () => {
    const Parser = requireFromCore("tree-sitter") as NativeParserConstructor;
    const grammars = new Map<string, unknown>();
    for (const artifact of artifacts) {
      const key = grammarArtifactKey(artifact);
      if (!grammars.has(key)) {
        const language = await loadArtifact(requireFromCore, artifact);
        if (!language) {
          throw new Error(`${key} did not expose a Tree-sitter language`);
        }
        grammars.set(key, language);
      }
    }
    return { Parser, grammars };
  });
}

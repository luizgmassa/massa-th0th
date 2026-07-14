import { describe, expect, test } from "bun:test";
import {
  StructuralResolverRegistry,
  StructuralResolverSession,
  TYPESCRIPT_LANGUAGE_RESOLVER,
  buildStructuralResolverDefinitions,
  type NormalizedStructuralImport,
  type NormalizedStructuralSymbol,
  type StructuralIdentityInput,
  type StructuralResolverDefinition,
  type StructuralResolverFile,
  type StructuralReference,
} from "../services/index.js";

const SPAN = Object.freeze({
  startByte: 0,
  endByte: 1,
  start: Object.freeze({ row: 0, column: 0 }),
  end: Object.freeze({ row: 0, column: 1 }),
});

function identity(
  file: string,
  name: string,
  overrides: Partial<StructuralIdentityInput> = {},
): StructuralIdentityInput {
  return {
    file,
    name,
    language: "typescript",
    dialect: "typescript",
    qualifiedName: name,
    kind: "function",
    arity: 0,
    typeTokens: [],
    modifiers: [],
    scope: "top_level",
    overload: "unique",
    ...overrides,
  };
}

function definition(
  file: string,
  name: string,
  options: Partial<StructuralResolverDefinition> & { identity?: Partial<StructuralIdentityInput> } = {},
): StructuralResolverDefinition {
  return {
    identity: identity(file, name, options.identity),
    exported: options.exported ?? true,
    ...(options.defaultExport === undefined ? {} : { defaultExport: options.defaultExport }),
  };
}

function imported(
  specifier: string,
  bindings: readonly { imported: string; local: string; typeOnly?: boolean }[],
  options: { form?: NormalizedStructuralImport["form"]; typeOnly?: boolean } = {},
): NormalizedStructuralImport {
  const normalized = bindings.map((binding) => Object.freeze({
    imported: binding.imported,
    local: binding.local,
    typeOnly: binding.typeOnly ?? false,
  }));
  return Object.freeze({
    form: options.form ?? "esm_import",
    specifier,
    span: SPAN,
    bindings: Object.freeze(normalized),
    names: Object.freeze(normalized.map((binding) => binding.local)),
    typeOnly: options.typeOnly ?? false,
  });
}

function file(imports: readonly NormalizedStructuralImport[] = []): StructuralResolverFile {
  return Object.freeze({
    file: "src/main.ts",
    dialect: "typescript",
    resolverVersion: "1.0.0",
    imports: Object.freeze(imports),
  });
}

function reference(
  name: string,
  options: { qualifier?: string; kind?: StructuralReference["kind"]; lexicalScope?: string } = {},
): StructuralReference {
  return Object.freeze({
    kind: options.kind ?? "call",
    span: SPAN,
    target: Object.freeze({
      status: "unresolved",
      name,
      ...(options.qualifier ? { qualifier: options.qualifier } : {}),
    }),
    ...(options.lexicalScope ? { lexicalScope: options.lexicalScope } : {}),
  });
}

function symbol(
  name: string,
  qualifiedName = name,
  overrides: Partial<NormalizedStructuralSymbol> = {},
): NormalizedStructuralSymbol {
  return Object.freeze({
    kind: "function",
    name,
    qualifiedName,
    span: SPAN,
    exported: true,
    defaultExport: false,
    signatureMaterial: Object.freeze({ arity: 0, typeTokens: Object.freeze([]), modifiers: Object.freeze([]) }),
    ...overrides,
  });
}

const BUILD = Object.freeze({
  knownFiles: Object.freeze(["src/main.ts", "src/lib.ts", "src/pkg/index.ts", "shared/util.ts"]),
  pathAliases: Object.freeze([{ pattern: "@shared/*", targets: Object.freeze(["shared/*"]) }]),
});

describe("structural resolver registry", () => {
  test("registers all TS/JS family dialects and rejects duplicate ownership", () => {
    const registry = new StructuralResolverRegistry([TYPESCRIPT_LANGUAGE_RESOLVER]);
    for (const dialect of ["typescript", "tsx", "javascript", "jsx"]) {
      expect(registry.requireDialect(dialect, "1.0.0")).toBe(TYPESCRIPT_LANGUAGE_RESOLVER);
    }
    expect(() => registry.register(TYPESCRIPT_LANGUAGE_RESOLVER)).toThrow("duplicate");
    expect(() => registry.requireDialect("typescript", "2.0.0")).toThrow("missing");
    const nextVersion = { ...TYPESCRIPT_LANGUAGE_RESOLVER, version: "2.0.0" };
    registry.register(nextVersion);
    expect(registry.requireDialect("typescript", "2.0.0")).toBe(nextVersion);
  });

  test("rejects conflicting multi-dialect registration atomically", () => {
    const registry = new StructuralResolverRegistry([TYPESCRIPT_LANGUAGE_RESOLVER]);
    const conflicting = {
      ...TYPESCRIPT_LANGUAGE_RESOLVER,
      dialects: ["python", "typescript"],
    };
    expect(() => registry.register(conflicting)).toThrow("duplicate");
    expect(registry.forDialect("python", "1.0.0")).toBeUndefined();
  });
});

describe("TS/JS structural resolver", () => {
  test("resolves a same-file definition before imports and globals", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./lib", [{ imported: "run", local: "run" }])]),
      reference("run"),
      [definition("src/main.ts", "run"), definition("src/lib.ts", "run")],
      BUILD,
    );
    expect(result).toMatchObject({ status: "resolved", fqn: "src/main.ts#run", source: "same_file" });
  });

  test("resolves named import aliases through extension probing", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./lib", [{ imported: "execute", local: "run" }])]),
      reference("run"),
      [definition("src/lib.ts", "execute")],
      BUILD,
    );
    expect(result).toMatchObject({ status: "resolved", fqn: "src/lib.ts#execute", source: "import" });
  });

  test("forwards a default reexport alias past its barrel export marker", () => {
    const barrelReexport = imported(
      "./lib",
      [{ imported: "default", local: "Service" }],
      { form: "esm_re_export" },
    );
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./barrel", [{ imported: "Service", local: "Service" }])]),
      reference("Service"),
      [
        definition("src/barrel.ts", "Service", { identity: { kind: "export" } }),
        definition("src/lib.ts", "ActualService", { defaultExport: true, identity: { kind: "class" } }),
        definition("src/lib.ts", "default", { defaultExport: true, identity: { kind: "export" } }),
      ],
      {
        knownFiles: ["src/main.ts", "src/barrel.ts", "src/lib.ts"],
        importsByFile: { "src/barrel.ts": [barrelReexport] },
      },
    );
    expect(result).toMatchObject({ status: "resolved", fqn: "src/lib.ts#ActualService", source: "import" });
  });

  test("maps emitted JavaScript specifiers back to known TypeScript sources", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./lib.js", [{ imported: "execute", local: "run" }])]),
      reference("run"),
      [
        definition("src/barrel.ts", "run", { identity: { kind: "export" } }),
        definition("src/lib.ts", "execute"),
      ],
      BUILD,
    );
    expect(result).toMatchObject({ status: "resolved", fqn: "src/lib.ts#execute", source: "import" });
  });

  test("prefers a TypeScript source over a competing JavaScript artifact", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./lib.js", [{ imported: "execute", local: "run" }])]),
      reference("run"),
      [definition("src/lib.js", "execute"), definition("src/lib.ts", "execute")],
      { knownFiles: ["src/main.ts", "src/lib.js", "src/lib.ts"] },
    );
    expect(result).toMatchObject({ status: "resolved", fqn: "src/lib.ts#execute" });
  });

  test("resolves namespace members and index modules", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./pkg", [{ imported: "*", local: "pkg" }])]),
      reference("load", { qualifier: "pkg" }),
      [definition("src/pkg/index.ts", "load")],
      BUILD,
    );
    expect(result).toMatchObject({ status: "resolved", fqn: "src/pkg/index.ts#load", source: "import" });
  });

  test("resolves nested namespace members without basename leakage", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./pkg", [{ imported: "*", local: "pkg" }])]),
      reference("fetch", { qualifier: "pkg.Api" }),
      [definition("src/pkg/index.ts", "fetch", { identity: { qualifiedName: "Api.fetch", scope: "nested" } })],
      BUILD,
    );
    expect(result).toMatchObject({ status: "resolved", source: "import" });
  });

  test("does not resolve a named import to a nested symbol with the same basename", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./lib", [{ imported: "run", local: "run" }])]),
      reference("run"),
      [definition("src/lib.ts", "run", { identity: { qualifiedName: "Service.run", scope: "nested" } })],
      BUILD,
    );
    expect(result).toEqual({ status: "unresolved", name: "run" });
  });

  test("resolves a bound dynamic import as a namespace", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./lib", [{ imported: "*", local: "mod" }], { form: "dynamic_import" })]),
      reference("run", { qualifier: "mod" }),
      [definition("src/lib.ts", "run")],
      BUILD,
    );
    expect(result).toMatchObject({ status: "resolved", fqn: "src/lib.ts#run", source: "import" });
  });

  test("resolves default imports only to explicit default-export metadata", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./lib", [{ imported: "default", local: "Service" }])]),
      reference("Service"),
      [definition("src/lib.ts", "create", { defaultExport: true })],
      BUILD,
    );
    expect(result).toMatchObject({ status: "resolved", fqn: "src/lib.ts#create", source: "import" });
  });

  test("qualifies ESM default members through the actual default owner and retains ambiguity", () => {
    const imports = file([imported("./lib", [{ imported: "default", local: "Service" }])]);
    const resolved = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      imports,
      reference("run", { qualifier: "Service" }),
      [
        definition("src/lib.ts", "ActualService", { defaultExport: true, identity: { kind: "class" } }),
        definition("src/lib.ts", "run", { identity: { qualifiedName: "ActualService.run", scope: "nested", kind: "method" } }),
        definition("src/lib.ts", "run", { identity: { qualifiedName: "Other.run", scope: "nested", kind: "method" } }),
      ],
      BUILD,
    );
    expect(resolved).toMatchObject({
      status: "resolved",
      identity: { qualifiedName: "ActualService.run" },
      source: "import",
    });

    const ambiguous = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      imports,
      reference("run", { qualifier: "Service" }),
      [
        definition("src/lib.ts", "First", { defaultExport: true, identity: { kind: "class" } }),
        definition("src/lib.ts", "Second", { defaultExport: true, identity: { kind: "class" } }),
        definition("src/lib.ts", "run", { identity: { qualifiedName: "First.run", scope: "nested", kind: "method" } }),
        definition("src/lib.ts", "run", { identity: { qualifiedName: "Second.run", scope: "nested", kind: "method" } }),
      ],
      BUILD,
    );
    expect(ambiguous.status).toBe("ambiguous");
    if (ambiguous.status !== "ambiguous") throw new Error("expected default-owner ambiguity");
    expect(ambiguous.candidates.map((candidate) => candidate.qualifiedName)).toEqual(["First.run", "Second.run"]);
  });

  test("resolves CommonJS-style destructured bindings from normalized imports", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./lib", [{ imported: "execute", local: "run" }])]),
      reference("run"),
      [definition("src/lib.ts", "execute")],
      BUILD,
    );
    expect(result.status).toBe("resolved");
  });

  test("resolves path aliases from deterministic build metadata", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("@shared/util", [{ imported: "format", local: "format" }])]),
      reference("format"),
      [definition("shared/util.ts", "format")],
      BUILD,
    );
    expect(result).toMatchObject({ status: "resolved", fqn: "shared/util.ts#format", source: "import" });
  });

  test("does not treat reexports as local bindings", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./lib", [{ imported: "execute", local: "run" }], { form: "esm_re_export" })]),
      reference("run"),
      [definition("src/lib.ts", "execute")],
      BUILD,
    );
    expect(result).toEqual({ status: "unresolved", name: "run" });
  });

  test("gates type-only bindings away from value edges", () => {
    const typeImport = imported(
      "./lib",
      [{ imported: "Shape", local: "Shape", typeOnly: true }],
      { typeOnly: true },
    );
    const definitions = [definition("src/lib.ts", "Shape", { identity: { kind: "type" } })];
    expect(TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([typeImport]), reference("Shape", { kind: "call" }), definitions, BUILD,
    )).toEqual({ status: "unresolved", name: "Shape" });
    expect(TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([typeImport]), reference("Shape", { kind: "type_ref" }), definitions, BUILD,
    )).toMatchObject({ status: "resolved", source: "import" });
  });

  test("uses only an exact unique global match", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file(),
      reference("fetch", { qualifier: "Api" }),
      [definition("src/lib.ts", "fetch", { identity: { qualifiedName: "Api.fetch", scope: "nested" } })],
      BUILD,
    );
    expect(result).toMatchObject({ status: "resolved", source: "global" });
  });

  test("does not expose non-exported definitions through global resolution", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file(),
      reference("privateHelper"),
      [definition("src/lib.ts", "privateHelper", { exported: false })],
      BUILD,
    );
    expect(result).toEqual({ status: "unresolved", name: "privateHelper" });
  });

  test("does not leak nested definitions into unqualified global lookup", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file(),
      reference("fetch"),
      [definition("src/lib.ts", "fetch", { identity: { qualifiedName: "Api.fetch", scope: "nested" } })],
      BUILD,
    );
    expect(result).toEqual({ status: "unresolved", name: "fetch" });
  });

  test("chooses the tightest same-file lexical scope including this and private names", () => {
    const definitions = [
      definition("src/main.ts", "run", { identity: { qualifiedName: "Outer.run", scope: "nested" } }),
      definition("src/main.ts", "run", { identity: { qualifiedName: "Outer.Inner.run", scope: "nested" } }),
      definition("src/main.ts", "#secret", { identity: { qualifiedName: "Outer.Inner.#secret", scope: "nested" } }),
    ];
    expect(TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file(), reference("run", { lexicalScope: "Outer.Inner.method" }), definitions, BUILD,
    )).toMatchObject({ status: "resolved", identity: { qualifiedName: "Outer.Inner.run" } });
    expect(TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file(), reference("#secret", { qualifier: "this", lexicalScope: "Outer.Inner.method" }), definitions, BUILD,
    )).toMatchObject({ status: "resolved", identity: { qualifiedName: "Outer.Inner.%23secret" } });
  });

  test("preserves an already-resolved exact target", () => {
    const exact = definition("src/lib.ts", "run");
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(file(), {
      kind: "call",
      span: SPAN,
      target: { status: "resolved", fqn: "src/lib.ts#run" },
    }, [exact], BUILD);
    expect(result).toMatchObject({ status: "resolved", fqn: "src/lib.ts#run", source: "exact" });
  });

  test("rejects an unknown existing FQN instead of trusting it", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(file(), {
      kind: "call",
      span: SPAN,
      target: { status: "resolved", fqn: "src/missing.ts#run" },
    }, [], BUILD);
    expect(result).toEqual({ status: "unresolved", name: "src/missing.ts#run" });
  });

  test("filters homonymous candidates by edge family", () => {
    const definitions = [
      definition("src/a.ts", "Shape", { identity: { kind: "type" } }),
      definition("src/b.ts", "Shape", { identity: { kind: "function" } }),
    ];
    expect(TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file(), reference("Shape", { kind: "call" }), definitions,
      { knownFiles: ["src/main.ts", "src/a.ts", "src/b.ts"] },
    )).toMatchObject({ status: "resolved", fqn: "src/b.ts#Shape" });
    expect(TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file(), reference("Shape", { kind: "type_ref" }), definitions,
      { knownFiles: ["src/main.ts", "src/a.ts", "src/b.ts"] },
    )).toMatchObject({ status: "resolved", fqn: "src/a.ts#Shape" });
  });

  test("prefers a named default declaration over its anonymous export marker", () => {
    const definitions = [
      definition("src/lib.ts", "Service", { defaultExport: true, identity: { kind: "class" } }),
      definition("src/lib.ts", "default", { defaultExport: true, identity: { kind: "export" } }),
    ];
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./lib", [{ imported: "default", local: "Service" }])]),
      reference("Service"),
      definitions,
      BUILD,
    );
    expect(result).toMatchObject({ status: "resolved", fqn: "src/lib.ts#Service" });
  });

  test("forwards named reexports through a barrel without binding them locally", () => {
    const barrelReexport = imported(
      "./lib",
      [{ imported: "execute", local: "run" }],
      { form: "esm_re_export" },
    );
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("./barrel", [{ imported: "run", local: "run" }])]),
      reference("run"),
      [
        definition("src/barrel.ts", "run", { identity: { kind: "export" } }),
        definition("src/lib.ts", "execute"),
      ],
      {
        knownFiles: ["src/main.ts", "src/barrel.ts", "src/lib.ts"],
        importsByFile: { "src/barrel.ts": [barrelReexport] },
      },
    );
    expect(result).toMatchObject({ status: "resolved", fqn: "src/lib.ts#execute", source: "import" });
  });

  test("uses the target file alias scope while recursively forwarding a barrel", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("@pkg/barrel", [{ imported: "run", local: "run" }])]),
      reference("run"),
      [definition("packages/a/barrel.ts", "run", { identity: { kind: "export" } }), definition("packages/a/lib.ts", "execute")],
      {
        knownFiles: ["src/main.ts", "packages/a/barrel.ts", "packages/a/lib.ts", "packages/b/lib.ts"],
        pathAliasesByFile: {
          "src/main.ts": [{ pattern: "@pkg/*", targets: ["packages/a/*"] }],
          "packages/a/barrel.ts": [{ pattern: "@lib", targets: ["packages/a/lib"] }],
          "packages/b/barrel.ts": [{ pattern: "@lib", targets: ["packages/b/lib"] }],
        },
        importsByFile: {
          "packages/a/barrel.ts": [imported("@lib", [{ imported: "execute", local: "run" }], { form: "esm_re_export" })],
        },
      },
    );
    expect(result).toMatchObject({ status: "resolved", fqn: "packages/a/lib.ts#execute", source: "import" });
  });

  test("retains deterministic ambiguity instead of choosing the first definition", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file(),
      reference("run"),
      [definition("src/z.ts", "run"), definition("src/a.ts", "run")],
      { knownFiles: ["src/main.ts", "src/z.ts", "src/a.ts"] },
    );
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") throw new Error("expected ambiguity");
    expect(result.candidates.map((candidate) => candidate.fqn)).toEqual(["src/a.ts#run", "src/z.ts#run"]);
  });

  test("returns stable unresolved output for unknown imports and names", () => {
    const result = TYPESCRIPT_LANGUAGE_RESOLVER.resolve(
      file([imported("external-package", [{ imported: "run", local: "run" }])]),
      reference("run"),
      [],
      BUILD,
    );
    expect(result).toEqual({ status: "unresolved", name: "run" });
  });

  test("resolves unique legacy aliases and reports overloaded legacy ambiguity", () => {
    const unique = TYPESCRIPT_LANGUAGE_RESOLVER.resolveLegacy(
      "src/lib.ts#run",
      [definition("src/lib.ts", "run")],
    );
    expect(unique).toMatchObject({ status: "resolved", fqn: "src/lib.ts#run", source: "legacy" });

    const overloaded = [
      definition("src/lib.ts", "run", { identity: { overload: "overloaded", arity: 0 } }),
      definition("src/lib.ts", "run", { identity: { overload: "overloaded", arity: 1 } }),
    ];
    const ambiguous = TYPESCRIPT_LANGUAGE_RESOLVER.resolveLegacy("src/lib.ts#run", overloaded);
    expect(ambiguous).toMatchObject({ status: "ambiguous", name: "src/lib.ts#run" });
    if (ambiguous.status !== "ambiguous") throw new Error("expected ambiguity");
    expect(ambiguous.candidates).toHaveLength(2);
  });

  test("adapts normalized documents, infers overload identities, and resolves through a versioned session", () => {
    const document = Object.freeze({
      file: "src/main.ts",
      language: "TypeScript",
      dialect: "typescript",
      resolverVersion: "1.0.0",
      structure: Object.freeze({
        symbols: Object.freeze([
          symbol("run", "Service.run", { signatureMaterial: { arity: 0, typeTokens: [], modifiers: [] } }),
          symbol("run", "Service.run", { signatureMaterial: { arity: 1, typeTokens: ["string"], modifiers: [] } }),
        ]),
        imports: Object.freeze([]),
        edges: Object.freeze([]),
      }),
    });
    const definitions = buildStructuralResolverDefinitions([document]);
    expect(definitions.map((item) => item.identity.overload)).toEqual(["overloaded", "overloaded"]);
    expect(definitions.every((item) => item.identity.scope === "nested")).toBe(true);

    const session = new StructuralResolverSession(
      [document],
      { knownFiles: ["src/main.ts"] },
      new StructuralResolverRegistry([TYPESCRIPT_LANGUAGE_RESOLVER]),
    );
    const result = session.resolve("src/main.ts", reference("run"));
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") throw new Error("expected overload ambiguity");
    expect(result.candidates).toHaveLength(2);
    expect(session.identitiesFor("src/main.ts")).toHaveLength(2);
    expect(session.resolveFqn(result.candidates[0]!.fqn)).toMatchObject({ found: true });
  });

  test("fails session construction on a generation identity collision", () => {
    const document = {
      file: "src/main.ts",
      language: "TypeScript",
      dialect: "typescript",
      resolverVersion: "1.0.0",
      structure: {
        symbols: [symbol("Same", "Same", { kind: "class" }), symbol("Same", "Same", { kind: "interface" })],
        imports: [],
        edges: [],
      },
    };
    expect(() => new StructuralResolverSession(
      [document],
      { knownFiles: ["src/main.ts"] },
      new StructuralResolverRegistry([TYPESCRIPT_LANGUAGE_RESOLVER]),
    )).toThrow("fqn_identity_collision");
  });

  test("does not propagate exported-class visibility to a percent-encoded private member", () => {
    const definitions = buildStructuralResolverDefinitions([{
      file: "src/lib.ts",
      language: "TypeScript",
      dialect: "typescript",
      resolverVersion: "1.0.0",
      structure: {
        symbols: [
          symbol("Service", "Service", { kind: "class", exported: true }),
          symbol("%23secret", "Service.%23secret", { kind: "method", exported: false }),
        ],
        imports: [],
        edges: [],
      },
    }]);
    expect(definitions.find((item) => item.identity.name === "%23secret")?.exported).toBe(false);
  });
});

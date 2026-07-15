import path from "node:path";
import {
  StructuralFqnRegistry,
  normalizeStructuralFile,
  type StructuralFqnCandidate,
  type StructuralIdentity,
} from "../fqn-codec.js";
import type {
  ResolvableDefinition,
  StructuralBuildMetadata,
  StructuralLanguageResolver,
  StructuralPathAlias,
  StructuralReference,
  StructuralResolverDefinition,
  StructuralResolverFile,
  StructuralResolverOutcome,
  StructuralResolutionSource,
} from "../resolver.js";

export const TYPESCRIPT_RESOLVER_VERSION = "1.0.0";
const DIALECT_PROBES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  typescript: ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"],
  tsx: ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"],
  javascript: ["", ".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.jsx", "/index.ts", "/index.tsx"],
  jsx: ["", ".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.jsx", "/index.ts", "/index.tsx"],
  python: ["", ".py", "/__init__.py"], ruby: ["", ".rb"], php: ["", ".php"],
  "lua-luajit": ["", ".lua"],
  c: ["", ".c", ".h"], "header-default-c": ["", ".c", ".h"],
  cpp: ["", ".cpp", ".hpp", ".h"], header: ["", ".cpp", ".hpp", ".h"], "header-cpp": ["", ".cpp", ".hpp", ".h"],
  go: ["", ".go"], rust: ["", ".rs"], zig: ["", ".zig"],
  java: ["", ".java"], kotlin: ["", ".kt", ".kts"], "kotlin-script": ["", ".kt", ".kts"],
  scala: ["", ".scala"], csharp: ["", ".cs"], swift: ["", ".swift"], dart: ["", ".dart"],
  elixir: ["", ".ex", ".exs"], "elixir-script": ["", ".ex", ".exs"], erlang: ["", ".erl"],
  clojure: ["", ".clj"], ocaml: ["", ".ml"], haskell: ["", ".hs"],
});

function candidates(identities: readonly StructuralIdentity[]): readonly StructuralFqnCandidate[] {
  return Object.freeze(identities.map((identity) => Object.freeze({
    fqn: identity.fqn,
    file: identity.file,
    name: identity.name,
    displayName: identity.displayName,
    qualifiedName: identity.qualifiedName,
    kind: identity.kind,
    signatureHash: identity.signatureHash,
  })).sort((left, right) => {
    for (const [a, b] of [
      [left.file, right.file],
      [left.qualifiedName, right.qualifiedName],
      [left.kind, right.kind],
      [left.signatureHash, right.signatureHash],
      [left.fqn, right.fqn],
    ] as const) {
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  }));
}

interface NormalizedReference {
  kind: StructuralReference["kind"];
  span: StructuralReference["span"];
  name: string;
  qualifier?: string;
  lexicalScope?: string;
  existingFqn?: string;
}

function outcome(
  reference: NormalizedReference,
  matches: readonly ResolvableDefinition[],
  source: StructuralResolutionSource,
): StructuralResolverOutcome | undefined {
  const unique = [...new Map(matches.map((match) => [match.identity.fqn, match])).values()];
  if (unique.length === 0) return undefined;
  if (unique.length === 1) {
    const identity = unique[0]!.identity;
    return Object.freeze({ status: "resolved", fqn: identity.fqn, identity, source });
  }
  return Object.freeze({
    status: "ambiguous",
    name: reference.name,
    ...(reference.qualifier ? { qualifier: reference.qualifier } : {}),
    candidates: candidates(unique.map((match) => match.identity)),
  });
}

function normalizedReference(reference: StructuralReference): NormalizedReference {
  if (reference.target.status === "resolved") {
    return Object.freeze({
      kind: reference.kind,
      span: reference.span,
      existingFqn: reference.target.fqn,
      name: reference.target.fqn,
      ...(reference.lexicalScope ? { lexicalScope: reference.lexicalScope.normalize("NFC").trim() } : {}),
    });
  }
  const rawName = reference.target.name.normalize("NFC").trim();
  const name = rawName.startsWith("#") ? `%23${rawName.slice(1)}` : rawName;
  const qualifier = reference.target.qualifier?.normalize("NFC").trim();
  if (!name) throw new TypeError("reference name must not be empty");
  if (reference.target.qualifier !== undefined && !qualifier) throw new TypeError("reference qualifier must not be empty");
  const lexicalScope = reference.lexicalScope?.normalize("NFC").trim();
  return Object.freeze({
    kind: reference.kind,
    span: reference.span,
    name,
    ...(qualifier ? { qualifier } : {}),
    ...(lexicalScope ? { lexicalScope } : {}),
  });
}

function indexDefinitions(
  definitions: readonly StructuralResolverDefinition[],
): { registry: StructuralFqnRegistry; definitions: readonly ResolvableDefinition[] } {
  const registry = new StructuralFqnRegistry();
  const indexed = definitions.map((definition) => {
    const name = definition.identity.name.startsWith("#") ? `%23${definition.identity.name.slice(1)}` : definition.identity.name;
    const qualifiedName = definition.identity.qualifiedName.split(".").map((part) =>
      part.startsWith("#") ? `%23${part.slice(1)}` : part
    ).join(".");
    const identity = definition.resolvedIdentity ?? registry.register({ ...definition.identity, name, qualifiedName });
    return Object.freeze({
      identity,
      arity: definition.identity.arity,
      exported: definition.exported,
      defaultExport: definition.defaultExport === true,
    });
  });
  return { registry, definitions: Object.freeze(indexed) };
}

function candidateKind(reference: NormalizedReference, definition: ResolvableDefinition): boolean {
  if (reference.kind === "type_ref" || reference.kind === "extend" || reference.kind === "implement") {
    return ["class", "interface", "trait", "enum", "type", "type_parameter"].includes(definition.identity.kind);
  }
  if (reference.kind === "call" || reference.kind === "data_flow" || reference.kind === "http_call") {
    return ["function", "method", "constructor", "class", "field", "variable", "constant", "export"].includes(definition.identity.kind);
  }
  return false;
}

function probe(base: string, known: ReadonlySet<string>, dialect = "typescript"): string | undefined {
  const bases = /\.[cm]?jsx?$/u.test(base)
    ? [base.replace(/\.[cm]?jsx?$/u, ".ts"), base.replace(/\.[cm]?jsx?$/u, ".tsx"), base]
    : [base];
  for (const candidateBase of bases) for (const suffix of DIALECT_PROBES[dialect] ?? [""]) {
    const value = path.posix.normalize(`${candidateBase}${suffix}`);
    if (!value.startsWith("../") && value !== ".." && known.has(value)) return value;
  }
  return undefined;
}

export function resolveStructuralSpecifier(
  specifier: string,
  fromFile: string,
  build: StructuralBuildMetadata,
  dialect = "typescript",
): string | undefined {
  const known = new Set(build.knownFiles.map(normalizeStructuralFile));
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return probe(path.posix.join(path.posix.dirname(fromFile), specifier), known, dialect);
  }
  const aliases = build.pathAliasesByFile?.[normalizeStructuralFile(fromFile)] ?? build.pathAliases ?? [];
  for (const alias of aliases) {
    const star = alias.pattern.indexOf("*");
    let capture: string | undefined;
    if (star < 0) {
      if (specifier !== alias.pattern) continue;
      capture = "";
    } else {
      const prefix = alias.pattern.slice(0, star);
      const suffix = alias.pattern.slice(star + 1);
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
      capture = specifier.slice(prefix.length, specifier.length - suffix.length);
    }
    for (const target of alias.targets) {
      const resolved = probe(target.replace("*", capture), known, dialect);
      if (resolved) return resolved;
    }
  }
  return undefined;
}

export function matchesStructuralPathAlias(
  specifier: string,
  aliases: readonly StructuralPathAlias[],
): boolean {
  return aliases.some((alias) => {
    const star = alias.pattern.indexOf("*");
    if (star < 0) return specifier === alias.pattern;
    const prefix = alias.pattern.slice(0, star);
    const suffix = alias.pattern.slice(star + 1);
    return specifier.startsWith(prefix) && specifier.endsWith(suffix) &&
      specifier.length >= prefix.length + suffix.length;
  });
}

function exportedMatches(
  file: string,
  sought: string,
  defaultOnly: boolean,
  definitions: readonly ResolvableDefinition[],
  build: StructuralBuildMetadata,
  visited = new Set<string>(),
): ResolvableDefinition[] {
  const key = `${file}\0${sought}\0${defaultOnly}`;
  if (visited.has(key)) return [];
  visited.add(key);
  const direct = definitions.filter((definition) =>
    definition.identity.file === file && definition.exported && (defaultOnly
      ? definition.defaultExport
      : definition.identity.qualifiedName === sought)
  );
  const concrete = direct.filter((definition) => definition.identity.kind !== "export");
  if (concrete.length > 0) {
    if (!defaultOnly) return concrete;
    const namedDefault = concrete.filter((definition) => definition.identity.name !== "default");
    return namedDefault.length > 0 ? namedDefault : concrete;
  }
  const forwarded: ResolvableDefinition[] = [];
  for (const reexport of build.importsByFile?.[file] ?? []) {
    if (reexport.form !== "esm_re_export") continue;
    const targetFile = resolveStructuralSpecifier(reexport.specifier, file, build);
    if (!targetFile) continue;
    for (const binding of reexport.bindings) {
      if (binding.local !== sought && binding.imported !== "*") continue;
      forwarded.push(...exportedMatches(
        targetFile,
        binding.imported === "*" ? sought : binding.imported,
        defaultOnly || binding.imported === "default",
        definitions,
        build,
        visited,
      ));
    }
  }
  if (forwarded.length > 0) return forwarded;
  if (!defaultOnly) return direct;
  const namedDefault = direct.filter((definition) => definition.identity.name !== "default");
  return namedDefault.length > 0 ? namedDefault : direct;
}

function importedMatches(
  file: StructuralResolverFile,
  reference: NormalizedReference,
  definitions: readonly ResolvableDefinition[],
  build: StructuralBuildMetadata,
): { matches: ResolvableDefinition[]; claimed: boolean } {
  const matches: ResolvableDefinition[] = [];
  let claimed = false;
  for (const imported of file.imports) {
    if (!["esm_import", "commonjs_require", "dynamic_import", "python_import", "ruby_require", "php_use", "lua_require", "c_include", "cpp_include", "go_import", "rust_use", "zig_import", "java_import", "java_static_import", "kotlin_import", "scala_import", "dart_import", "elixir_alias", "elixir_import", "elixir_require", "elixir_use", "erlang_import", "clojure_require", "clojure_import", "ocaml_open", "ocaml_include", "ocaml_module_alias", "haskell_import"].includes(imported.form)) continue;
    const typeEdge = reference.kind === "type_ref" || reference.kind === "extend" || reference.kind === "implement";
    for (const binding of imported.bindings) {
      let sought: string | undefined;
      let defaultOnly = false;
      const qualifier = reference.qualifier?.split(".") ?? [];
      if (binding.imported === "*" && qualifier[0] === binding.local) {
        const member = [...qualifier.slice(1), reference.name].join(".");
        sought = ["elixir_alias", "clojure_require", "haskell_import"].includes(imported.form)
          ? `${imported.specifier.replaceAll("/", ".")}.${member}`
          : member;
      } else if (binding.imported === "default") {
        if (qualifier[0] === binding.local) sought = [...qualifier.slice(1), reference.name].join(".");
        else if (!reference.qualifier && reference.name === binding.local) defaultOnly = true;
        else continue;
      } else if (!reference.qualifier && reference.name === binding.local) {
        sought = binding.imported;
      } else {
        continue;
      }
      claimed = true;
      if ((imported.typeOnly || binding.typeOnly) && !typeEdge) continue;
      const importedFile = resolveStructuralSpecifier(imported.specifier, file.file, build, file.dialect) ??
        (["python_import", "ruby_require", "php_use", "lua_require", "c_include", "cpp_include", "go_import", "rust_use", "zig_import", "java_import", "java_static_import", "kotlin_import", "scala_import", "dart_import", "elixir_alias", "elixir_import", "elixir_require", "elixir_use", "erlang_import", "clojure_require", "clojure_import", "ocaml_open", "ocaml_include", "ocaml_module_alias", "haskell_import"].includes(imported.form)
          ? probe(imported.specifier.replace(/^\.\//u, ""), new Set(build.knownFiles.map(normalizeStructuralFile)), file.dialect)
          : undefined);
      if (!importedFile) continue;
      const esmDefaultMember = imported.form === "esm_import" &&
        binding.imported === "default" && qualifier[0] === binding.local;
      if (esmDefaultMember && sought !== undefined) {
        const owners = exportedMatches(importedFile, "default", true, definitions, build);
        for (const owner of owners) {
          const ownerMember = `${owner.identity.qualifiedName}.${sought}`;
          matches.push(...definitions.filter((definition) =>
            definition.identity.file === owner.identity.file &&
            definition.exported &&
            definition.identity.qualifiedName === ownerMember
          ));
        }
        continue;
      }
      if (defaultOnly) matches.push(...exportedMatches(importedFile, "default", true, definitions, build));
      else if (sought !== undefined) matches.push(...exportedMatches(importedFile, sought, false, definitions, build).filter((definition) =>
        binding.arity === undefined || definition.arity === binding.arity
      ));
    }
  }
  return { matches, claimed };
}

function sameFileMatches(
  file: string,
  reference: NormalizedReference,
  definitions: readonly ResolvableDefinition[],
): readonly ResolvableDefinition[] {
  const local = definitions.filter((definition) => definition.identity.file === file);
  if (reference.qualifier && reference.qualifier !== "this") {
    const exact = `${reference.qualifier}.${reference.name}`;
    return local.filter((definition) => definition.identity.qualifiedName === exact);
  }
  const lexical = reference.lexicalScope?.split(".").filter(Boolean) ?? [];
  if (lexical.length > 0) lexical.pop();
  for (let length = lexical.length; length >= 0; length -= 1) {
    const prefix = lexical.slice(0, length).join(".");
    const exact = prefix ? `${prefix}.${reference.name}` : reference.name;
    const matches = local.filter((definition) => definition.identity.qualifiedName === exact);
    if (matches.length > 0) return matches;
    if (reference.qualifier === "this") break;
  }
  return [];
}

export const TYPESCRIPT_LANGUAGE_RESOLVER: StructuralLanguageResolver = Object.freeze({
  version: TYPESCRIPT_RESOLVER_VERSION,
  dialects: Object.freeze(["typescript", "tsx", "javascript", "jsx"]),
  resolve(
    file: StructuralResolverFile,
    rawReference: StructuralReference,
    rawDefinitions: readonly StructuralResolverDefinition[],
    build: StructuralBuildMetadata,
  ) {
    const normalizedFile = normalizeStructuralFile(file.file);
    const reference = normalizedReference(rawReference);
    const familyDialects = ["typescript", "tsx", "javascript", "jsx"];
    const scopedDefinitions = familyDialects.includes(file.dialect)
      ? rawDefinitions.filter((definition) => familyDialects.includes(definition.identity.dialect))
      : rawDefinitions;
    const { registry, definitions: allDefinitions } = indexDefinitions(scopedDefinitions);
    const definitions = allDefinitions.filter((definition) => candidateKind(reference, definition));
    if (reference.existingFqn) {
      const prepared = definitions.find((definition) => definition.identity.fqn === reference.existingFqn)?.identity;
      const exact = prepared ? { found: true as const, identity: prepared } : registry.resolveModern(reference.existingFqn);
      return exact.found
        ? Object.freeze({ status: "resolved", fqn: exact.identity.fqn, identity: exact.identity, source: "exact" })
        : Object.freeze({ status: "unresolved", name: reference.existingFqn });
    }
    const soughtQualified = reference.qualifier ? `${reference.qualifier}.${reference.name}` : reference.name;

    const local = sameFileMatches(normalizedFile, reference, definitions);
    const localOutcome = outcome(reference, local, "same_file");
    if (localOutcome) return localOutcome;

    const imported = importedMatches({ ...file, file: normalizedFile }, reference, definitions, build);
    const importOutcome = outcome(reference, imported.matches, "import");
    if (importOutcome) return importOutcome;
    if (imported.claimed) return Object.freeze({
      status: "unresolved",
      name: reference.name,
      ...(reference.qualifier ? { qualifier: reference.qualifier } : {}),
    });

    const global = definitions.filter((definition) =>
      definition.exported && (reference.qualifier
        ? definition.identity.qualifiedName === soughtQualified
        : definition.identity.name === reference.name &&
          definition.identity.qualifiedName === definition.identity.name)
    );
    return outcome(reference, global, "global") ?? Object.freeze({
      status: "unresolved",
      name: reference.name,
      ...(reference.qualifier ? { qualifier: reference.qualifier } : {}),
    });
  },
  resolveLegacy(legacyFqn: string, rawDefinitions: readonly StructuralResolverDefinition[]) {
    const { registry, definitions } = indexDefinitions(rawDefinitions);
    const materialized = definitions.filter((definition) => definition.identity.legacyFqn === legacyFqn);
    const materializedOutcome = outcome(
      { kind: "call", span: { startByte: 0, endByte: 0, start: { row: 0, column: 0 }, end: { row: 0, column: 0 } }, name: legacyFqn },
      materialized,
      "legacy",
    );
    if (materializedOutcome) return materializedOutcome;
    const result = registry.resolve(legacyFqn);
    if (result.found) {
      return Object.freeze({
        status: "resolved",
        fqn: result.identity.fqn,
        identity: result.identity,
        source: "legacy",
      });
    }
    if (result.ambiguous) {
      return Object.freeze({
        status: "ambiguous",
        name: legacyFqn,
        candidates: result.candidates,
      });
    }
    return Object.freeze({ status: "unresolved", name: legacyFqn });
  },
});

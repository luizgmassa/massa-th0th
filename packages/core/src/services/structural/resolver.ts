import type {
  NormalizedStructuralImport,
  NormalizedStructure,
  SourceSpan,
  StructuralEdgeKind,
  StructuralTarget,
} from "./types.js";
import { StructuralFqnRegistry } from "./fqn-codec.js";
import type {
  StructuralFqnResolution,
  StructuralFqnCandidate,
  StructuralIdentity,
  StructuralIdentityInput,
} from "./fqn-codec.js";

export interface StructuralResolverDefinition {
  identity: StructuralIdentityInput;
  /** Generation-owned identity; sessions populate this once during construction. */
  resolvedIdentity?: StructuralIdentity;
  exported: boolean;
  defaultExport?: boolean;
}

export interface StructuralPathAlias {
  pattern: string;
  targets: readonly string[];
}

export interface StructuralBuildMetadata {
  knownFiles: readonly string[];
  pathAliases?: readonly StructuralPathAlias[];
  /** Exact caller-file aliases; prevents monorepo package aliases leaking across packages. */
  pathAliasesByFile?: Readonly<Record<string, readonly StructuralPathAlias[]>>;
  importsByFile?: Readonly<Record<string, readonly NormalizedStructuralImport[]>>;
}

export interface StructuralResolverFile {
  file: string;
  dialect: string;
  resolverVersion: string;
  imports: readonly NormalizedStructuralImport[];
}

export interface StructuralReference {
  kind: StructuralEdgeKind;
  span: SourceSpan;
  target: StructuralTarget;
  /** Qualified name of the declaration containing the reference. */
  lexicalScope?: string;
}

export type StructuralResolutionSource =
  | "same_file"
  | "import"
  | "global"
  | "legacy"
  | "exact";

export type StructuralResolverOutcome =
  | {
      status: "resolved";
      fqn: string;
      identity?: StructuralIdentity;
      source: StructuralResolutionSource;
    }
  | {
      status: "ambiguous";
      name: string;
      qualifier?: string;
      candidates: readonly StructuralFqnCandidate[];
    }
  | {
      status: "unresolved";
      name: string;
      qualifier?: string;
    };

export interface StructuralLanguageResolver {
  readonly version: string;
  readonly dialects: readonly string[];
  resolve(
    file: StructuralResolverFile,
    reference: StructuralReference,
    definitions: readonly StructuralResolverDefinition[],
    build: StructuralBuildMetadata,
  ): StructuralResolverOutcome;
  resolveLegacy(
    legacyFqn: string,
    definitions: readonly StructuralResolverDefinition[],
  ): StructuralResolverOutcome;
}

export class StructuralResolverRegistry {
  readonly #byDialectVersion = new Map<string, StructuralLanguageResolver>();

  constructor(resolvers: readonly StructuralLanguageResolver[] = []) {
    for (const resolver of resolvers) this.register(resolver);
  }

  register(resolver: StructuralLanguageResolver): void {
    if (!resolver.version.trim() || resolver.version !== resolver.version.trim()) {
      throw new TypeError("resolver version must be non-empty canonical text");
    }
    if (resolver.dialects.length === 0) throw new TypeError("resolver must own at least one dialect");
    const dialects = resolver.dialects.map((rawDialect) =>
      rawDialect.trim().toLocaleLowerCase("en-US")
    );
    if (dialects.some((dialect) => !dialect)) {
      throw new TypeError("resolver dialect must not be empty");
    }
    if (new Set(dialects).size !== dialects.length) {
      throw new Error("structural_resolver_duplicate: resolver repeats a dialect");
    }
    for (const dialect of dialects) {
      const key = `${dialect}\0${resolver.version}`;
      if (this.#byDialectVersion.has(key)) {
        throw new Error(`structural_resolver_duplicate: ${dialect}@${resolver.version}`);
      }
    }
    for (const dialect of dialects) {
      this.#byDialectVersion.set(`${dialect}\0${resolver.version}`, resolver);
    }
  }

  forDialect(dialect: string, version: string): StructuralLanguageResolver | undefined {
    const normalized = dialect.trim().toLocaleLowerCase("en-US");
    return this.#byDialectVersion.get(`${normalized}\0${version}`);
  }

  requireDialect(dialect: string, version: string): StructuralLanguageResolver {
    const resolver = this.forDialect(dialect, version);
    if (!resolver) throw new Error(`structural_resolver_missing: ${dialect}@${version}`);
    return resolver;
  }
}

export interface ResolvableDefinition {
  identity: StructuralIdentity;
  exported: boolean;
  defaultExport: boolean;
}

export interface StructuralResolverDocument {
  file: string;
  language: string;
  dialect: string;
  resolverVersion: string;
  structure: NormalizedStructure;
}

/** Converts one immutable parse generation into FQN-ready resolver definitions. */
export function buildStructuralResolverDefinitions(
  documents: readonly StructuralResolverDocument[],
): readonly StructuralResolverDefinition[] {
  const groups = new Map<string, number>();
  const exportedRoots = new Set<string>();
  for (const document of documents) for (const symbol of document.structure.symbols) {
    const key = `${document.file}\0${symbol.qualifiedName}\0${symbol.kind}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
    if (symbol.exported && symbol.qualifiedName === symbol.name) {
      exportedRoots.add(`${document.file}\0${symbol.name}`);
    }
  }
  return Object.freeze(documents.flatMap((document) => document.structure.symbols.map((symbol) => {
    const key = `${document.file}\0${symbol.qualifiedName}\0${symbol.kind}`;
    return Object.freeze({
      identity: Object.freeze({
        file: document.file,
        name: symbol.name.startsWith("#") ? `%23${symbol.name.slice(1)}` : symbol.name,
        language: document.language,
        dialect: document.dialect,
        qualifiedName: symbol.qualifiedName.split(".").map((part) =>
          part.startsWith("#") ? `%23${part.slice(1)}` : part
        ).join("."),
        kind: symbol.kind,
        arity: symbol.signatureMaterial.arity,
        typeTokens: symbol.signatureMaterial.typeTokens,
        modifiers: symbol.signatureMaterial.modifiers,
        scope: symbol.qualifiedName === symbol.name ? "top_level" : "nested",
        overload: (groups.get(key) ?? 0) > 1 ? "overloaded" : "unique",
      } satisfies StructuralIdentityInput),
      exported: symbol.exported || (
        !symbol.name.startsWith("#") &&
        !symbol.name.startsWith("%23") &&
        !symbol.signatureMaterial.modifiers.includes("private") &&
        exportedRoots.has(`${document.file}\0${symbol.qualifiedName.split(".")[0]}`)
      ),
      defaultExport: symbol.defaultExport,
    } satisfies StructuralResolverDefinition);
  })));
}

/** Generation-scoped adapter over normalized syntax documents and build metadata. */
export class StructuralResolverSession {
  readonly #documents: ReadonlyMap<string, StructuralResolverDocument>;
  readonly #definitions: readonly StructuralResolverDefinition[];
  readonly #build: StructuralBuildMetadata;
  readonly #registry: StructuralResolverRegistry;
  readonly #fqnRegistry: StructuralFqnRegistry;
  readonly #identitiesByFile: ReadonlyMap<string, readonly StructuralIdentity[]>;
  readonly #seedIdentities: readonly StructuralIdentity[];

  constructor(
    documents: readonly StructuralResolverDocument[],
    build: StructuralBuildMetadata,
    registry: StructuralResolverRegistry,
    seedDefinitions: readonly StructuralResolverDefinition[] = [],
  ) {
    this.#documents = new Map(documents.map((document) => [document.file, document]));
    const definitions = buildStructuralResolverDefinitions(documents);
    this.#fqnRegistry = new StructuralFqnRegistry();
    const localDefinitions = definitions.map((definition) => Object.freeze({
      ...definition,
      resolvedIdentity: this.#fqnRegistry.register(definition.identity),
    }));
    const seen = new Map<string, StructuralResolverDefinition>(
      localDefinitions.map((definition) => [definition.resolvedIdentity.fqn, definition]),
    );
    const seeds: StructuralResolverDefinition[] = [];
    for (const definition of seedDefinitions) {
      if (!definition.resolvedIdentity) throw new TypeError("structural seed requires a materialized identity");
      const prior = seen.get(definition.resolvedIdentity.fqn);
      if (prior && (prior.resolvedIdentity!.canonicalSignature !== definition.resolvedIdentity.canonicalSignature ||
          prior.exported !== definition.exported || prior.defaultExport !== definition.defaultExport)) {
        throw new Error(`fqn_identity_collision: ${definition.resolvedIdentity.fqn}`);
      }
      if (prior) continue;
      seen.set(definition.resolvedIdentity.fqn, definition);
      seeds.push(Object.freeze(definition));
    }
    this.#definitions = Object.freeze([...localDefinitions, ...seeds]);
    this.#seedIdentities = Object.freeze(seeds.map((definition) => definition.resolvedIdentity!));
    const identities = new Map<string, StructuralIdentity[]>();
    for (const definition of this.#definitions) {
      const identity = definition.resolvedIdentity!;
      const existing = identities.get(identity.file) ?? [];
      existing.push(identity);
      identities.set(identity.file, existing);
    }
    this.#identitiesByFile = new Map([...identities].map(([file, items]) => [file, Object.freeze(items)]));
    this.#build = Object.freeze({
      ...build,
      importsByFile: Object.freeze({
        ...(build.importsByFile ?? {}),
        ...Object.fromEntries(documents.map((document) => [document.file, document.structure.imports])),
      }),
    });
    this.#registry = registry;
  }

  identitiesFor(file: string): readonly StructuralIdentity[] {
    return this.#identitiesByFile.get(file) ?? Object.freeze([]);
  }

  resolveFqn(fqn: string): StructuralFqnResolution {
    const exact = this.#seedIdentities.find((identity) => identity.fqn === fqn);
    if (exact) return { found: true, ambiguous: false, identity: exact };
    const local = this.#fqnRegistry.resolve(fqn);
    if (local.found || local.ambiguous) return local;
    const aliases = this.#seedIdentities.filter((identity) => identity.legacyFqn === fqn);
    if (aliases.length === 1) return { found: true, ambiguous: false, identity: aliases[0]! };
    if (aliases.length > 1) return {
      found: false,
      ambiguous: true,
      legacyFqn: fqn,
      candidates: Object.freeze(aliases.map((identity) => ({
        fqn: identity.fqn,
        file: identity.file,
        name: identity.name,
        displayName: identity.displayName,
        qualifiedName: identity.qualifiedName,
        kind: identity.kind,
        signatureHash: identity.signatureHash,
      })).sort((left, right) =>
        left.file.localeCompare(right.file) ||
        left.qualifiedName.localeCompare(right.qualifiedName) ||
        left.kind.localeCompare(right.kind) ||
        left.signatureHash.localeCompare(right.signatureHash)
      )),
    };
    return local;
  }

  resolve(file: string, reference: StructuralReference): StructuralResolverOutcome {
    const document = this.#documents.get(file);
    if (!document) throw new Error(`structural_resolver_document_missing: ${file}`);
    const resolver = this.#registry.requireDialect(document.dialect, document.resolverVersion);
    let scopedReference = reference;
    if (!reference.lexicalScope) {
      const containing = document.structure.symbols.filter((symbol) =>
        symbol.span.startByte <= reference.span.startByte &&
        symbol.span.endByte >= reference.span.endByte
      ).sort((left, right) =>
        (left.span.endByte - left.span.startByte) - (right.span.endByte - right.span.startByte)
      )[0];
      if (containing) scopedReference = Object.freeze({
        ...reference,
        lexicalScope: containing.qualifiedName,
      });
    }
    return resolver.resolve({
      file: document.file,
      dialect: document.dialect,
      resolverVersion: document.resolverVersion,
      imports: document.structure.imports,
    }, scopedReference, this.#definitions, this.#build);
  }
}

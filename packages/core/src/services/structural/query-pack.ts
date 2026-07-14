import type { NativeQueryCapture, NativeQueryNode } from "./grammar-loaders.js";
import { SourceIndex } from "./source-span.js";
import type {
  LanguageManifestEntry,
  NormalizedStructuralEdge,
  NormalizedStructuralImport,
  NormalizedStructuralSymbol,
  NormalizedStructure,
  StructuralEdgeKind,
  StructuralCapability,
  StructuralCapabilityRequirement,
  StructuralSymbolKind,
  StructuralTarget,
} from "./types.js";
import type {
  StructuralQueryContext,
  StructuralQueryExecutor,
  StructuralQueryTree,
} from "./structural-runtime.js";
import {
  JAVASCRIPT_QUERY_PACK,
  TYPESCRIPT_QUERY_PACK,
} from "./query-packs/typescript.js";

export interface StructuralQueryPack {
  readonly version: string;
  readonly dialects: readonly string[];
  readonly querySources: readonly string[];
}

const QUERY_PACKS = new Map<string, StructuralQueryPack>(
  [...TYPESCRIPT_QUERY_PACK.dialects.map((dialect) => [dialect, TYPESCRIPT_QUERY_PACK] as const),
   ...JAVASCRIPT_QUERY_PACK.dialects.map((dialect) => [dialect, JAVASCRIPT_QUERY_PACK] as const)],
);

const SYMBOL_KINDS = new Set<StructuralSymbolKind>([
  "class", "function", "method", "variable", "interface",
  "enum", "type", "namespace", "module", "property", "field", "type_parameter",
]);
const LISTEN_TERMINALS = new Set([
  "on", "once", "addListener", "addEventListener", "off", "removeListener",
]);
const HTTP_CLIENTS = new Set([
  "axios", "http", "https", "got", "superagent", "request",
]);
const HTTP_METHODS = new Set([
  "get", "post", "put", "patch", "delete", "request", "head", "options",
]);

interface SymbolDraft {
  kind: StructuralSymbolKind;
  name: string;
  node: NativeQueryNode;
  qualifiedName: string;
}

export type QueryCapabilityContract = Readonly<
  Record<StructuralCapability, StructuralCapabilityRequirement>
>;

const ALL_REQUIRED_CAPABILITIES = Object.freeze({
  declarations: "required",
  documentation: "required",
  imports: "required",
  type_relations: "required",
  calls: "required",
  data_flow: "required",
  specialized_edges: "required",
} satisfies Record<StructuralCapability, StructuralCapabilityRequirement>);

function enabled(capabilities: QueryCapabilityContract, capability: StructuralCapability): boolean {
  return capabilities[capability] === "required";
}

function queryPackFor(language: LanguageManifestEntry): StructuralQueryPack {
  const pack = QUERY_PACKS.get(language.dialect);
  if (!pack || pack.version !== language.queryPackVersion) {
    throw new Error(`structural_query_pack_unavailable:${language.dialect}@${language.queryPackVersion}`);
  }
  return pack;
}

/** Stable capture ordering and exact duplicate removal across overlapping queries. */
export function normalizeQueryCaptures(
  captures: readonly NativeQueryCapture[],
): readonly NativeQueryCapture[] {
  const sorted = [...captures].sort((left, right) =>
    left.node.startIndex - right.node.startIndex ||
    left.node.endIndex - right.node.endIndex ||
    left.name.localeCompare(right.name),
  );
  const seen = new Set<string>();
  return Object.freeze(sorted.filter((capture) => {
    const key = `${capture.name}\0${capture.node.startIndex}\0${capture.node.endIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function text(source: Buffer, node: NativeQueryNode): string {
  return source.subarray(node.startIndex, node.endIndex).toString("utf8");
}

function frozenSpan(index: SourceIndex, startByte: number, endByte: number) {
  const span = index.span(startByte, endByte);
  return Object.freeze({
    ...span,
    start: Object.freeze(span.start),
    end: Object.freeze(span.end),
  });
}

function field(node: NativeQueryNode, name: string): NativeQueryNode | null {
  return node.childForFieldName?.(name) ?? null;
}

function descendants(node: NativeQueryNode): readonly NativeQueryNode[] {
  const result: NativeQueryNode[] = [];
  const visit = (current: NativeQueryNode): void => {
    for (const child of current.namedChildren ?? []) {
      result.push(child);
      visit(child);
    }
  };
  visit(node);
  return result;
}

function symbolName(source: Buffer, node: NativeQueryNode): string | null {
  const nameNode = field(node, "name") ?? field(node, "property");
  if (nameNode) {
    const raw = text(source, nameNode);
    return (raw.startsWith("#") ? `%23${raw.slice(1)}` : raw).normalize("NFC");
  }
  if (node.type === "type_parameter") {
    const identifier = node.namedChildren?.find((child) => child.type === "type_identifier" || child.type === "identifier");
    return identifier ? text(source, identifier).normalize("NFC") : null;
  }
  if (node.type === "export_statement") {
    const declaration = field(node, "declaration") ?? node.namedChildren?.find((child) =>
      child.type.endsWith("_declaration") || child.type === "lexical_declaration",
    );
    const nestedName = declaration ? field(declaration, "name") : null;
    if (nestedName) return text(source, nestedName).normalize("NFC");
    const value = text(source, node);
    return value.startsWith("export default") ? "default" : null;
  }
  return null;
}

function symbolKind(captureName: string, source: Buffer, node: NativeQueryNode): StructuralSymbolKind | null {
  const requested = captureName.slice("symbol.".length) as StructuralSymbolKind;
  if (!SYMBOL_KINDS.has(requested)) return null;
  if (requested === "method" && symbolName(source, node) === "constructor") return "constructor";
  if (requested === "namespace" && text(source, node).trimStart().startsWith("module ")) return "module";
  if (requested === "variable") {
    const value = field(node, "value");
    if (value?.type === "arrow_function" || value?.type === "function_expression") return "function";
    const parentText = node.parent ? text(source, node.parent).trimStart() : "";
    return parentText.startsWith("const ") ? "constant" : "variable";
  }
  return requested;
}

function leadingDocumentation(source: Buffer, startByte: number): string | undefined {
  const prefix = source.subarray(0, startByte).toString("utf8");
  const match = prefix.match(/(?:\/\*\*[\s\S]*?\*\/|(?:\/\/[^\n]*(?:\n|$))+)[\t ]*\r?\n?[\t ]*$/u);
  return match?.[0].trim();
}

function ancestor(node: NativeQueryNode | null | undefined, type: string): NativeQueryNode | undefined {
  let current = node?.parent ?? undefined;
  while (current) {
    if (current.type === type) return current;
    current = current.parent ?? undefined;
  }
  return undefined;
}

function declarationExportWrapper(node: NativeQueryNode): NativeQueryNode | undefined {
  const wrapper = ancestor(node, "export_statement");
  if (!wrapper) return undefined;
  const declaration = field(wrapper, "declaration") ?? field(wrapper, "value");
  if (declaration === node) return wrapper;
  if (declaration?.type === "lexical_declaration" && ancestor(node, "lexical_declaration") === declaration) return wrapper;
  return undefined;
}

function normalizedTypeToken(source: Buffer, node: NativeQueryNode): string {
  return text(source, node).replace(/^\s*:\s*/u, "").trim();
}

function signatureOwner(node: NativeQueryNode): NativeQueryNode {
  const value = field(node, "value");
  return value?.type === "arrow_function" || value?.type === "function_expression" ? value : node;
}

function structuralSignature(source: Buffer, draft: SymbolDraft): string {
  const owner = signatureOwner(draft.node);
  const body = field(owner, "body");
  const value = field(draft.node, "value");
  let endByte = body?.startIndex ?? draft.node.endIndex;
  if (
    !body && value && owner === draft.node &&
    ["variable_declarator", "public_field_definition", "field_definition"].includes(draft.node.type)
  ) endByte = value.startIndex;
  let valuePrefix = "";
  if (owner !== draft.node) {
    valuePrefix = text(source, draft.node).slice(0, owner.startIndex - draft.node.startIndex);
  }
  const raw = `${valuePrefix}${source.subarray(owner.startIndex, endByte).toString("utf8")}`.trim();
  return raw.replace(/(?:=>|=|\{)\s*$/u, "").replace(/;\s*$/u, "").trim();
}

function signatureMaterial(source: Buffer, draft: SymbolDraft) {
  const owner = signatureOwner(draft.node);
  const parameters = field(owner, "parameters");
  const parameterNodes = (parameters?.namedChildren ?? []).filter((node) => node.type !== "comment");
  const typeTokens: string[] = [];
  for (const parameter of parameterNodes) {
    const typeNode = field(parameter, "type");
    if (typeNode) typeTokens.push(normalizedTypeToken(source, typeNode));
  }
  const returnType = field(owner, "return_type") ?? field(draft.node, "type");
  if (returnType) typeTokens.push(normalizedTypeToken(source, returnType));
  if (draft.node.type === "type_alias_declaration") {
    const value = field(draft.node, "value");
    if (value) typeTokens.push(normalizedTypeToken(source, value));
  }
  const knownModifiers = new Set([
    "abstract", "async", "declare", "default", "export", "get", "override",
    "private", "protected", "public", "readonly", "set", "static",
  ]);
  const modifiers: string[] = [];
  const directChildren = owner === draft.node
    ? (draft.node.children ?? [])
    : [...(draft.node.children ?? []), ...(owner.children ?? [])];
  for (const child of directChildren) {
    if (knownModifiers.has(child.type)) modifiers.push(child.type);
    else if (child.type === "accessibility_modifier") {
      const value = text(source, child).trim();
      if (knownModifiers.has(value)) modifiers.push(value);
    }
  }
  const exportWrapper = declarationExportWrapper(draft.node);
  if (exportWrapper && !modifiers.includes("export")) modifiers.push("export");
  if (exportWrapper && text(source, exportWrapper).trimStart().startsWith("export default") && !modifiers.includes("default")) {
    modifiers.push("default");
  }
  if (draft.kind === "export") {
    if (!modifiers.includes("export")) modifiers.push("export");
    if (text(source, draft.node).trimStart().startsWith("export default") && !modifiers.includes("default")) modifiers.push("default");
  }
  return Object.freeze({
    arity: parameterNodes.length,
    typeTokens: Object.freeze(typeTokens),
    modifiers: Object.freeze(modifiers.sort()),
  });
}

function buildSymbols(
  captures: readonly NativeQueryCapture[],
  source: Buffer,
  index: SourceIndex,
  includeDocumentation: boolean,
): readonly NormalizedStructuralSymbol[] {
  const drafts: SymbolDraft[] = [];
  for (const capture of captures) {
    if (!capture.name.startsWith("symbol.")) continue;
    if (capture.node.type === "property_signature" && capture.node.parent?.type !== "interface_body") continue;
    const kind = symbolKind(capture.name, source, capture.node);
    const name = symbolName(source, capture.node);
    if (!kind || !name) continue;
    drafts.push({ kind, name, node: capture.node, qualifiedName: name });
  }
  for (const capture of captures.filter((item) => item.name === "export.statement")) {
    const defaultExport = text(source, capture.node).trimStart().startsWith("export default");
    if (defaultExport) {
      drafts.push({ kind: "export", name: "default", node: capture.node, qualifiedName: "default" });
    }
    if (field(capture.node, "declaration") || field(capture.node, "value")) continue;
    const specifiers = descendants(capture.node).filter((node) => node.type === "export_specifier");
    const names = specifiers.map((specifier) => field(specifier, "alias") ?? field(specifier, "name")).filter((node): node is NativeQueryNode => Boolean(node));
    for (const nameNode of names) {
      const name = text(source, nameNode).normalize("NFC");
      drafts.push({ kind: "export", name, node: nameNode, qualifiedName: name });
    }
  }
  drafts.sort((left, right) =>
    left.node.startIndex - right.node.startIndex || right.node.endIndex - left.node.endIndex,
  );
  for (const draft of drafts) {
    let parent: SymbolDraft | undefined;
    for (const candidate of drafts) {
      if (candidate === draft) continue;
      if (candidate.kind !== "export" && candidate.node.startIndex <= draft.node.startIndex && candidate.node.endIndex >= draft.node.endIndex) {
        if (!parent || candidate.node.endIndex - candidate.node.startIndex < parent.node.endIndex - parent.node.startIndex) {
          parent = candidate;
        }
      }
    }
    draft.qualifiedName = parent ? `${parent.qualifiedName}.${draft.name}` : draft.name;
  }
  const symbols = drafts.map((draft) => {
    const nameNode = field(draft.node, "name") ?? field(draft.node, "property");
    const documentationStart = draft.node.parent?.type === "export_statement"
      ? draft.node.parent.startIndex
      : draft.node.startIndex;
    const documentation = includeDocumentation ? leadingDocumentation(source, documentationStart) : undefined;
    return Object.freeze({
      kind: draft.kind,
      name: draft.name,
      qualifiedName: draft.qualifiedName,
      span: frozenSpan(index, draft.node.startIndex, draft.node.endIndex),
      ...(nameNode ? { selectionSpan: frozenSpan(index, nameNode.startIndex, nameNode.endIndex) } : {}),
      exported: draft.kind === "export" || Boolean(declarationExportWrapper(draft.node)) || text(source, draft.node).trimStart().startsWith("export "),
      ...(documentation ? { documentation } : {}),
      signature: structuralSignature(source, draft),
      signatureMaterial: signatureMaterial(source, draft),
    } satisfies NormalizedStructuralSymbol);
  });
  const seen = new Set<string>();
  return Object.freeze(symbols.filter((symbol) => {
    const key = `${symbol.kind}\0${symbol.qualifiedName}\0${symbol.span.startByte}\0${symbol.span.endByte}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && "'\"`".includes(trimmed[0]!) && trimmed.at(-1) === trimmed[0]) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function frozenBindings(bindings: readonly { imported: string; local: string; typeOnly: boolean }[]) {
  const seen = new Set<string>();
  return Object.freeze(bindings.filter((binding) => {
    const key = `${binding.imported}\0${binding.local}\0${binding.typeOnly}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((binding) => Object.freeze(binding)));
}

function importBindings(node: NativeQueryNode, source: Buffer) {
  const bindings: { imported: string; local: string; typeOnly: boolean }[] = [];
  const statementTypeOnly = /^(?:import|export)\s+type\b/u.test(text(source, node).trimStart());
  const clause = node.namedChildren?.find((child) => child.type === "import_clause" || child.type === "export_clause");
  for (const child of clause?.namedChildren ?? []) {
    if (child.type === "identifier") {
      bindings.push({ imported: "default", local: text(source, child), typeOnly: statementTypeOnly });
      continue;
    }
    if (child.type === "namespace_import") {
      const local = descendants(child).find((item) => item.type === "identifier");
      if (local) bindings.push({ imported: "*", local: text(source, local), typeOnly: statementTypeOnly });
      continue;
    }
    const specifiers = child.type === "import_specifier" || child.type === "export_specifier"
      ? [child]
      : descendants(child).filter((item) => item.type === "import_specifier" || item.type === "export_specifier");
    for (const specifier of specifiers) {
      const importedNode = field(specifier, "name");
      const localNode = field(specifier, "alias") ?? importedNode;
      if (importedNode && localNode) bindings.push({
        imported: text(source, importedNode),
        local: text(source, localNode),
        typeOnly: statementTypeOnly || /^type\b/u.test(text(source, specifier).trimStart()),
      });
    }
  }
  return frozenBindings(bindings);
}

function buildImports(
  captures: readonly NativeQueryCapture[],
  source: Buffer,
  index: SourceIndex,
): readonly NormalizedStructuralImport[] {
  const statements = captures
    .filter((capture) => capture.name === "import.statement" || (capture.name === "export.statement" && field(capture.node, "source")))
    .flatMap((capture) => {
      const sourceNode = field(capture.node, "source");
      if (!sourceNode) return [];
      const statement = text(source, capture.node).trimStart();
      const bindings = importBindings(capture.node, source);
      return [Object.freeze({
        specifier: unquote(text(source, sourceNode)),
        span: frozenSpan(index, capture.node.startIndex, capture.node.endIndex),
        bindings,
        names: Object.freeze(bindings.map((binding) => binding.local)),
        typeOnly: /^(?:import|export)\s+type\b/u.test(statement),
      } satisfies NormalizedStructuralImport)];
    });
  const requires = captures
    .filter((capture) => capture.name === "edge.call")
    .flatMap((capture) => {
      const targetNode = field(capture.node, "function");
      const argumentsNode = field(capture.node, "arguments");
      const argument = argumentsNode?.namedChildren?.[0];
      const target = targetNode ? text(source, targetNode) : "";
      if (!targetNode || !["require", "import"].includes(target) || !argument || argument.type !== "string") return [];
      const declarator = ancestor(capture.node, "variable_declarator");
      const localNode = declarator ? field(declarator, "name") : null;
      const bindings = localNode
        ? frozenBindings([{ imported: "default", local: text(source, localNode), typeOnly: false }])
        : frozenBindings([]);
      return [Object.freeze({
        specifier: unquote(text(source, argument)),
        span: frozenSpan(index, capture.node.startIndex, capture.node.endIndex),
        bindings,
        names: Object.freeze(bindings.map((binding) => binding.local)),
        typeOnly: false,
      } satisfies NormalizedStructuralImport)];
    });
  return Object.freeze([...statements, ...requires].sort((left, right) => left.span.startByte - right.span.startByte));
}

function unresolved(name: string, qualifier?: string): StructuralTarget {
  return Object.freeze({ status: "unresolved", name, ...(qualifier ? { qualifier } : {}) });
}

function targetParts(raw: string): { name: string; qualifier?: string } {
  const normalized = raw.replace(/\s+/gu, "").replace(/\?\./gu, ".");
  const parts = normalized.split(".").filter(Boolean);
  return { name: parts.at(-1) ?? normalized, ...(parts.length > 1 ? { qualifier: parts.slice(0, -1).join(".") } : {}) };
}

function callKind(rawTarget: string, firstArgument?: string): StructuralEdgeKind {
  const { name, qualifier } = targetParts(rawTarget);
  if (name === "emit") return "emit";
  if (LISTEN_TERMINALS.has(name)) return "listen";
  if (name === "fetch" || name === "graphql" || name === "gql") return "http_call";
  const root = qualifier?.split(".")[0];
  if ((root && HTTP_CLIENTS.has(root) && HTTP_METHODS.has(name)) || (root === "trpc" && ["query", "mutate", "subscribe"].includes(name))) {
    return "http_call";
  }
  const literal = firstArgument ? unquote(firstArgument) : "";
  if (/^(?:https?:\/\/|\/api(?:\/|$))/u.test(literal)) return "http_call";
  return "call";
}

function buildCallEdges(
  captures: readonly NativeQueryCapture[],
  source: Buffer,
  index: SourceIndex,
  capabilities: QueryCapabilityContract,
): NormalizedStructuralEdge[] {
  const edges: NormalizedStructuralEdge[] = [];
  for (const capture of captures) {
    if (capture.name !== "edge.call") continue;
    const targetNode = field(capture.node, "function") ?? field(capture.node, "constructor");
    const argumentsNode = field(capture.node, "arguments");
    if (!targetNode || !argumentsNode) continue;
    const argumentNodes = argumentsNode.namedChildren ?? [];
    const rawTarget = text(source, targetNode);
    if (rawTarget === "require" || rawTarget === "import") continue;
    const firstArgument = argumentNodes[0] ? text(source, argumentNodes[0]) : undefined;
    const kind = callKind(rawTarget, firstArgument);
    const parts = targetParts(rawTarget);
    let targetName = parts.name;
    let metadata: Record<string, unknown> | undefined;
    if (kind === "emit" || kind === "listen") {
      targetName = firstArgument ? unquote(firstArgument) : parts.name;
      metadata = { event: targetName };
    } else if (kind === "http_call") {
      const route = firstArgument ? unquote(firstArgument) : undefined;
      metadata = { client: parts.qualifier?.split(".")[0] ?? parts.name, ...(route ? { route } : {}) };
    }
    const emitMainEdge = kind === "call"
      ? enabled(capabilities, "calls")
      : enabled(capabilities, "specialized_edges");
    if (emitMainEdge) {
      edges.push({
        kind,
        span: frozenSpan(index, capture.node.startIndex, capture.node.endIndex),
        target: unresolved(targetName, kind === "call" ? parts.qualifier : undefined),
        ...(kind !== "call" && metadata ? { metadata: Object.freeze(metadata) } : {}),
      });
    }
    if (!enabled(capabilities, "data_flow")) continue;
    for (let paramIndex = 0; paramIndex < argumentNodes.length; paramIndex += 1) {
      const argument = argumentNodes[paramIndex]!;
      if (argument.type !== "identifier") continue;
      edges.push({
        kind: "data_flow",
        span: frozenSpan(index, argument.startIndex, argument.endIndex),
        target: unresolved(parts.name, parts.qualifier),
        paramIndex,
        metadata: Object.freeze({ argument: text(source, argument) }),
      });
    }
  }
  return edges;
}

function buildSyntaxEdges(
  captures: readonly NativeQueryCapture[],
  source: Buffer,
  index: SourceIndex,
): NormalizedStructuralEdge[] {
  const result: NormalizedStructuralEdge[] = [];
  for (const capture of captures) {
    if (!capture.name.startsWith("edge.") || capture.name === "edge.call") continue;
    if (capture.name === "edge.type_ref_container") {
      for (const targetNode of descendants(capture.node).filter((node) => node.type === "type_identifier")) {
        const parts = targetParts(text(source, targetNode));
        result.push({
          kind: "type_ref",
          span: frozenSpan(index, targetNode.startIndex, targetNode.endIndex),
          target: unresolved(parts.name, parts.qualifier),
        });
      }
      continue;
    }
    if (capture.name === "edge.type_ref_value") {
      const nodes = capture.node.type === "type_identifier" || capture.node.type === "nested_type_identifier"
        ? [capture.node]
        : descendants(capture.node).filter((node) => node.type === "type_identifier" || node.type === "nested_type_identifier");
      for (const targetNode of nodes) {
        const parts = targetParts(text(source, targetNode));
        result.push({
          kind: "type_ref",
          span: frozenSpan(index, targetNode.startIndex, targetNode.endIndex),
          target: unresolved(parts.name, parts.qualifier),
        });
      }
      continue;
    }
    if (capture.name === "edge.type_argument_container") {
      for (const expression of capture.node.namedChildren ?? []) {
        const targetNode = expression.type === "generic_type" ? field(expression, "name") : expression;
        if (!targetNode || !["type_identifier", "nested_type_identifier"].includes(targetNode.type)) continue;
        const parts = targetParts(text(source, targetNode));
        result.push({
          kind: "type_ref",
          span: frozenSpan(index, targetNode.startIndex, targetNode.endIndex),
          target: unresolved(parts.name, parts.qualifier),
        });
      }
      continue;
    }
    if (capture.name === "edge.implement_container") {
      for (const expression of capture.node.namedChildren ?? []) {
        const targetNode = expression.type === "generic_type" ? field(expression, "name") : expression;
        if (!targetNode) continue;
        const parts = targetParts(text(source, targetNode));
        result.push({
          kind: "implement",
          span: frozenSpan(index, targetNode.startIndex, targetNode.endIndex),
          target: unresolved(parts.name, parts.qualifier),
        });
      }
      continue;
    }
    if (capture.name === "edge.extend_container") {
      const expression = capture.node.namedChildren?.[0];
      if (expression) {
        const parts = targetParts(text(source, expression));
        result.push({
          kind: "extend",
          span: frozenSpan(index, expression.startIndex, expression.endIndex),
          target: unresolved(parts.name, parts.qualifier),
        });
      }
      continue;
    }
    const kind = capture.name.slice("edge.".length) as StructuralEdgeKind;
    if (!(["type_ref", "extend", "implement"] as const).includes(kind as "type_ref" | "extend" | "implement")) continue;
    const relationNode = capture.node.type === "generic_type"
      ? field(capture.node, "name") ?? capture.node
      : capture.node;
    const parts = targetParts(text(source, relationNode));
    result.push({
      kind,
      span: frozenSpan(index, relationNode.startIndex, relationNode.endIndex),
      target: unresolved(parts.name, parts.qualifier),
    });
  }
  return result;
}

function dedupeEdges(edges: readonly NormalizedStructuralEdge[]): readonly NormalizedStructuralEdge[] {
  const seen = new Set<string>();
  return Object.freeze(edges.filter((edge) => {
    const target = edge.target.status === "resolved" ? edge.target.fqn : `${edge.target.qualifier ?? ""}#${edge.target.name}`;
    const key = `${edge.kind}\0${edge.span.startByte}\0${edge.span.endByte}\0${target}\0${edge.paramIndex ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((edge) => Object.freeze(edge)));
}

export function executeQueryPack(
  pack: StructuralQueryPack,
  tree: StructuralQueryTree,
  source: Buffer,
  context: StructuralQueryContext,
  capabilities: QueryCapabilityContract = ALL_REQUIRED_CAPABILITIES,
): NormalizedStructure {
  const captures = normalizeQueryCaptures(pack.querySources.flatMap((querySource) =>
    context.query(querySource, tree.rootNode),
  ));
  const index = new SourceIndex(source);
  const imports = enabled(capabilities, "imports") ? buildImports(captures, source, index) : Object.freeze([]);
  const importEdges: NormalizedStructuralEdge[] = imports.map((item) => ({
    kind: "import",
    span: item.span,
    target: unresolved(item.specifier),
    metadata: Object.freeze({ bindings: item.bindings, names: item.names, typeOnly: item.typeOnly }),
  }));
  return Object.freeze({
    symbols: enabled(capabilities, "declarations")
      ? buildSymbols(captures, source, index, enabled(capabilities, "documentation"))
      : Object.freeze([]),
    edges: dedupeEdges([
      ...buildCallEdges(captures, source, index, capabilities),
      ...(enabled(capabilities, "type_relations") ? buildSyntaxEdges(captures, source, index) : []),
      ...importEdges,
    ]),
    imports,
  });
}

export const executeStructuralQueryPack: StructuralQueryExecutor = (
  tree,
  source,
  language,
  context,
) => executeQueryPack(queryPackFor(language), tree, source, context, language.capabilities);

export function structuralQueryPackForDialect(dialect: string): StructuralQueryPack | undefined {
  return QUERY_PACKS.get(dialect);
}

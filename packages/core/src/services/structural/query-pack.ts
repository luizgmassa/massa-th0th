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
import { SCRIPTING_QUERY_PACKS } from "./query-packs/scripting.js";
import { SYSTEMS_QUERY_PACKS } from "./query-packs/systems.js";
import { MANAGED_QUERY_PACKS } from "./query-packs/managed.js";
import { FUNCTIONAL_QUERY_PACKS } from "./query-packs/functional.js";
import { DATA_DOCUMENT_QUERY_PACKS } from "./query-packs/data-document.js";

export interface StructuralQueryPack {
  readonly version: string;
  readonly dialects: readonly string[];
  readonly querySources: readonly string[];
  readonly family?: "typescript" | "python" | "ruby" | "php" | "lua" | "c" | "cpp" | "go" | "rust" | "zig" |
    "java" | "kotlin" | "scala" | "csharp" | "swift" | "dart" |
    "elixir" | "erlang" | "clojure" | "ocaml" | "haskell" |
    "vue" | "markdown" | "json" | "yaml";
}

const QUERY_PACKS = new Map<string, StructuralQueryPack>(
  [...TYPESCRIPT_QUERY_PACK.dialects.map((dialect) => [dialect, TYPESCRIPT_QUERY_PACK] as const),
   ...JAVASCRIPT_QUERY_PACK.dialects.map((dialect) => [dialect, JAVASCRIPT_QUERY_PACK] as const),
   ...SCRIPTING_QUERY_PACKS.flatMap((pack) => pack.dialects.map((dialect) => [dialect, pack] as const)),
   ...SYSTEMS_QUERY_PACKS.flatMap((pack) => pack.dialects.map((dialect) => [dialect, pack] as const)),
   ...MANAGED_QUERY_PACKS.flatMap((pack) => pack.dialects.map((dialect) => [dialect, pack] as const)),
   ...FUNCTIONAL_QUERY_PACKS.flatMap((pack) => pack.dialects.map((dialect) => [dialect, pack] as const)),
   ...DATA_DOCUMENT_QUERY_PACKS.flatMap((pack) => pack.dialects.map((dialect) => [dialect, pack] as const))],
);

const SYMBOL_KINDS = new Set<StructuralSymbolKind>([
  "class", "function", "method", "variable", "interface",
  "enum", "type", "namespace", "module", "property", "field", "type_parameter",
  "trait", "constructor", "constant", "export", "heading", "key",
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
  if (["pair", "block_mapping_pair", "flow_pair"].includes(node.type)) {
    const key = field(node, "key");
    return key ? unquote(text(source, key)).normalize("NFC") : null;
  }
  if (["atx_heading", "setext_heading"].includes(node.type)) {
    const content = field(node, "heading_content") ?? node.namedChildren?.find((child) => !child.type.includes("marker") && !child.type.includes("underline"));
    return content ? text(source, content).trim().normalize("NFC") : null;
  }
  const nameNode = field(node, "name") ?? field(node, "property") ?? field(node, "left");
  if (nameNode) {
    const raw = text(source, nameNode);
    return (raw.startsWith("#") ? `%23${raw.slice(1)}` : raw).normalize("NFC");
  }
  if (node.type === "call") {
    const target = field(node, "target");
    const targetText = target ? text(source, target) : "";
    if (["defmodule", "defprotocol", "def", "defp", "defmacro", "defmacrop"].includes(targetText)) {
      const argumentsNode = node.namedChildren?.find((child) => child.type === "arguments");
      const candidate = argumentsNode?.namedChildren?.[0];
      if (candidate) {
        const head = candidate.type === "call" ? field(candidate, "target") : candidate;
        if (head) return text(source, head).normalize("NFC");
      }
    }
  }
  if (node.type === "list_lit") {
    const values = (node.namedChildren ?? []).filter((child) => child.type !== "comment");
    return values[1] ? text(source, values[1]).normalize("NFC") : null;
  }
  if (["module_definition", "value_definition", "type_definition", "class_definition"].includes(node.type)) {
    const candidate = descendants(node).find((child) => [
      "module_name", "value_name", "type_constructor", "class_name",
    ].includes(child.type));
    if (candidate) return text(source, candidate).normalize("NFC");
  }
  if (node.type === "fun_decl") {
    const clause = descendants(node).find((child) => child.type === "function_clause");
    const nestedName = clause ? field(clause, "name") : null;
    if (nestedName) return text(source, nestedName).normalize("NFC");
  }
  if (node.type === "module" || node.type === "header") {
    const moduleNode = node.type === "module" ? node : descendants(node).find((child) => child.type === "module");
    if (moduleNode) return text(source, moduleNode).normalize("NFC");
  }
  if (["function_definition", "type_definition"].includes(node.type)) {
    let declarator = field(node, "declarator");
    while (declarator) {
      if (["identifier", "field_identifier", "type_identifier"].includes(declarator.type)) {
        return text(source, declarator).normalize("NFC");
      }
      declarator = field(declarator, "declarator");
    }
  }
  if (node.type === "variable_declaration") {
    const identifier = node.namedChildren?.find((child) => child.type === "identifier");
    return identifier ? text(source, identifier).normalize("NFC") : null;
  }
  if (node.type === "class_declaration" && text(source, node).trimStart().startsWith("enum ")) return "enum";
  if (node.type === "init_declaration") return "init";
  if (node.type === "secondary_constructor") return "constructor";
  if (["primary_constructor", "class_parameters"].includes(node.type)) {
    const owner = ancestor(node, "class_declaration") ?? ancestor(node, "class_definition");
    const ownerName = owner ? field(owner, "name") : null;
    return ownerName ? text(source, ownerName).normalize("NFC") : "constructor";
  }
  if (node.type === "function_definition" && symbolName(source, node) === "this") return "constructor";
  if (["property_declaration", "field_declaration", "val_definition", "var_definition", "initialized_identifier", "initialized_variable_definition", "class_parameter"].includes(node.type)) {
    const identifier = descendants(node).find((child) => ["variable_declarator", "initialized_identifier", "initialized_variable_definition"].includes(child.type)) ??
      descendants(node).find((child) => ["simple_identifier", "identifier"].includes(child.type));
    if (identifier) {
      const nested = field(identifier, "name") ?? identifier.namedChildren?.find((child) => ["identifier", "simple_identifier"].includes(child.type));
      return text(source, nested ?? identifier).normalize("NFC");
    }
  }
  if (["function_signature", "method_signature"].includes(node.type)) {
    const nestedName = descendants(node).map((child) => field(child, "name")).find((child): child is NativeQueryNode => Boolean(child));
    if (nestedName) return text(source, nestedName).normalize("NFC");
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
  if (requested === "function" && node.type === "function_definition" &&
    ancestor(node, "class_specifier")) return "method";
  if (requested === "namespace" && text(source, node).trimStart().startsWith("module ")) return "module";
  if (requested === "variable") {
    const value = field(node, "value");
    if (value?.type === "arrow_function" || value?.type === "function_expression") return "function";
    const parentText = node.parent ? text(source, node.parent).trimStart() : "";
    return parentText.startsWith("const ") ? "constant" : "variable";
  }
  if (node.type === "type_spec") {
    const value = field(node, "type");
    if (value?.type === "struct_type") return "class";
    if (value?.type === "interface_type") return "interface";
  }
  if (node.type === "variable_declaration") {
    const value = node.namedChildren?.[1];
    if (value?.type === "struct_declaration") return "class";
    if (value?.type === "enum_declaration") return "enum";
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
  const callable = ["function", "method", "constructor"].includes(draft.kind);
  const elixirHead = owner.type === "call" && field(owner, "target") && ["def", "defp", "defmacro", "defmacrop"].includes(text(source, field(owner, "target")!))
    ? owner.namedChildren?.find((node) => node.type === "arguments")?.namedChildren?.find((node) => node.type === "call")
    : undefined;
  const parameters = callable ? field(elixirHead ?? owner, "parameters") ?? field(elixirHead ?? owner, "args") ?? field(elixirHead ?? owner, "patterns") ??
    (elixirHead ? elixirHead.namedChildren?.find((node) => node.type === "arguments") : undefined) ??
    (owner.type === "class_parameters" ? owner : undefined) ?? descendants(owner).find((node) =>
    ["formal_parameters", "formal_parameter_list", "function_value_parameters", "class_parameters", "parameter_clause", "expr_args", "patterns"].includes(node.type)
  ) : undefined;
  const parameterTypes = new Set(["parameter", "formal_parameter", "class_parameter", "required_parameter", "optional_formal_parameter"]);
  const parameterNodes = parameters
    ? ["expr_args", "arguments", "patterns"].includes(parameters.type)
      ? (parameters.namedChildren ?? [])
      : (parameters.namedChildren ?? []).filter((node) => parameterTypes.has(node.type))
    : callable ? (owner.namedChildren ?? []).filter((node) => parameterTypes.has(node.type)) : [];
  const typeTokens: string[] = [];
  for (const parameter of parameterNodes) {
    const typeNode = field(parameter, "type") ?? ["user_type", "type_identifier", "predefined_type", "nullable_type", "identifier"]
      .map((type) => parameter.namedChildren?.find((node) => node.type === type)).find((node): node is NativeQueryNode => Boolean(node));
    if (typeNode) typeTokens.push(normalizedTypeToken(source, typeNode));
  }
  const returnType = field(owner, "return_type") ?? field(owner, "returns") ?? field(draft.node, "type");
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
  let modifierOwner = draft.node;
  if (draft.node.type === "variable_declarator") {
    let current = draft.node.parent ?? undefined;
    while (current) {
      if (["field_declaration", "constant_declaration", "event_field_declaration"].includes(current.type)) {
        modifierOwner = current;
        break;
      }
      if (!["variable_declaration"].includes(current.type)) break;
      current = current.parent ?? undefined;
    }
  }
  const directChildren = owner === modifierOwner
    ? (modifierOwner.children ?? [])
    : [...(modifierOwner.children ?? []), ...(owner.children ?? [])];
  for (const child of directChildren) {
    if (knownModifiers.has(child.type)) modifiers.push(child.type);
    else if (child.type === "modifiers") {
      for (const modifier of child.children ?? []) {
        const value = knownModifiers.has(modifier.type) ? modifier.type : text(source, modifier).trim();
        if (knownModifiers.has(value)) modifiers.push(value);
      }
    }
    else if (child.type === "accessibility_modifier") {
      const value = text(source, child).trim();
      if (knownModifiers.has(value)) modifiers.push(value);
    } else {
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
  family: StructuralQueryPack["family"] = "typescript",
): readonly NormalizedStructuralSymbol[] {
  const drafts: SymbolDraft[] = [];
  for (const capture of captures) {
    if (!capture.name.startsWith("symbol.")) continue;
    if (capture.node.type === "property_signature" && capture.node.parent?.type !== "interface_body") continue;
    const kind = symbolKind(capture.name, source, capture.node);
    if (capture.node.type === "function_signature" && ancestor(capture.node, "method_signature")) continue;
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
  // Precompute each draft's byte range once. The wrapped capture node's
  // startIndex/endIndex are getter-backed byte-offset computations; resolving
  // them inside the O(drafts^2) parent scan re-runs that work on every
  // comparison. Containment is monotonic, so the precomputed byte ranges
  // identify the same smallest-enclosing parent.
  const draftRanges = drafts.map((draft) => ({ start: draft.node.startIndex, end: draft.node.endIndex }));
  for (let i = 0; i < drafts.length; i += 1) {
    const draft = drafts[i]!;
    const draftRange = draftRanges[i]!;
    let parentIndex = -1;
    for (let j = 0; j < drafts.length; j += 1) {
      if (j === i) continue;
      const candidate = drafts[j]!;
      if (candidate.kind === "export" || candidate.kind === "constructor") continue;
      const candidateRange = draftRanges[j]!;
      if (candidateRange.start <= draftRange.start && candidateRange.end >= draftRange.end) {
        if (parentIndex === -1 || candidateRange.end - candidateRange.start < draftRanges[parentIndex]!.end - draftRanges[parentIndex]!.start) {
          parentIndex = j;
        }
      }
    }
    draft.qualifiedName = parentIndex >= 0 ? `${drafts[parentIndex]!.qualifiedName}.${draft.name}` : draft.name;
  }
  // Precompute the documentation captures once; the per-draft filter below
  // would otherwise allocate + scan every capture for every symbol.
  const documentationCaptures = captures.filter((capture) => capture.name === "documentation");
  let symbols = drafts.map((draft) => {
    const nameNode = field(draft.node, "name") ?? field(draft.node, "property") ??
      (["pair", "block_mapping_pair", "flow_pair"].includes(draft.node.type) ? field(draft.node, "key") : undefined) ??
      (["atx_heading", "setext_heading"].includes(draft.node.type) ? field(draft.node, "heading_content") : undefined);
    const documentationStart = draft.node.parent?.type === "export_statement"
      ? draft.node.parent.startIndex
      : draft.node.type === "type_spec" && draft.node.parent?.type === "type_declaration"
        ? draft.node.parent.startIndex
      : draft.node.startIndex;
    const capturedDocumentation = documentationCaptures
      .find((capture) => {
        if (capture.node.startIndex >= draft.node.startIndex && capture.node.endIndex <= draft.node.endIndex) {
          return family === "python" && !captures.some((item) =>
            item.name.startsWith("symbol.") && item.node !== draft.node &&
            item.node.startIndex <= capture.node.startIndex && item.node.endIndex >= capture.node.endIndex
          );
        }
        if (capture.node.endIndex > documentationStart) return false;
        for (let offset = capture.node.endIndex; offset < documentationStart; offset += 1) {
          if (family === "elixir") {
            const chained = captures.find((item) => item.name === "documentation" && item.node.startIndex <= offset && item.node.endIndex > offset);
            if (chained) {
              offset = chained.node.endIndex - 1;
              continue;
            }
          }
          const byte = source[offset];
          if (byte !== 9 && byte !== 10 && byte !== 13 && byte !== 32) return false;
        }
        return true;
      });
    const documentation = includeDocumentation
      ? capturedDocumentation ? family === "elixir"
        ? documentationCaptures.filter((item) => item.node.startIndex >= capturedDocumentation.node.startIndex && item.node.endIndex <= documentationStart)
          .map((item) => text(source, item.node).trim()).join("\n")
        : text(source, capturedDocumentation.node).trim() : family === "typescript"
        ? leadingDocumentation(source, documentationStart)
        : undefined
      : undefined;
    const material = signatureMaterial(source, draft);
    const scriptingExport = family !== "typescript" && !draft.qualifiedName.includes(".") &&
      (family !== "java" || material.modifiers.includes("public"));
    return Object.freeze({
      kind: draft.kind,
      name: draft.name,
      qualifiedName: draft.qualifiedName,
      span: frozenSpan(index, draft.node.startIndex, draft.node.endIndex),
      ...(nameNode ? { selectionSpan: frozenSpan(index, nameNode.startIndex, nameNode.endIndex) } : {}),
      exported: scriptingExport || draft.kind === "export" || Boolean(declarationExportWrapper(draft.node)) || text(source, draft.node).trimStart().startsWith("export "),
      defaultExport: draft.name === "default" ||
        text(source, declarationExportWrapper(draft.node) ?? draft.node).trimStart().startsWith("export default"),
      ...(documentation ? { documentation } : {}),
      signature: structuralSignature(source, draft),
      signatureMaterial: material,
    } satisfies NormalizedStructuralSymbol);
  });
  if (["erlang", "clojure", "haskell"].includes(family ?? "")) {
    const module = symbols.find((symbol) => symbol.kind === "module");
    if (module) symbols = symbols.map((symbol) => symbol === module || symbol.qualifiedName.includes(".")
      ? symbol
      : Object.freeze({ ...symbol, qualifiedName: `${module.name}.${symbol.qualifiedName}` }));
  }
  if (family === "markdown") {
    const stack: { level: number; qualifiedName: string }[] = [];
    symbols = symbols.map((symbol, position) => {
      const draft = drafts[position]!;
      const marker = draft.node.children?.find((child) => /^(?:atx_h[1-6]_marker|setext_h[12]_underline)$/u.test(child.type));
      const match = marker?.type.match(/h([1-6])/u);
      const level = Number(match?.[1] ?? (marker?.type.includes("h2") ? 2 : 1));
      while (stack.length && stack.at(-1)!.level >= level) stack.pop();
      const qualifiedName = stack.length ? `${stack.at(-1)!.qualifiedName}.${symbol.name}` : symbol.name;
      stack.push({ level, qualifiedName });
      return Object.freeze({ ...symbol, qualifiedName });
    });
  }
  const seen = new Set<string>();
  return Object.freeze(symbols.filter((symbol) => {
    const key = family === "haskell"
      ? `${symbol.kind}\0${symbol.qualifiedName}`
      : `${symbol.kind}\0${symbol.qualifiedName}\0${symbol.span.startByte}\0${symbol.span.endByte}`;
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

function frozenBindings(bindings: readonly { imported: string; local: string; typeOnly: boolean; arity?: number }[]) {
  const seen = new Set<string>();
  return Object.freeze(bindings.filter((binding) => {
    const key = `${binding.imported}\0${binding.local}\0${binding.typeOnly}\0${binding.arity ?? ""}`;
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

interface RustUseLeaf { readonly path: readonly string[]; readonly alias?: string; readonly glob?: boolean }

function rustPathSegments(node: NativeQueryNode, source: Buffer): readonly string[] {
  if (node.type === "scoped_identifier") {
    const pathNode = field(node, "path");
    const nameNode = field(node, "name");
    return [...(pathNode ? rustPathSegments(pathNode, source) : []), ...(nameNode ? rustPathSegments(nameNode, source) : [])];
  }
  if (["identifier", "crate", "self", "super", "metavariable"].includes(node.type)) return [text(source, node)];
  return (node.namedChildren ?? []).flatMap((child) => rustPathSegments(child, source));
}

function rustUseLeaves(node: NativeQueryNode, source: Buffer, prefix: readonly string[] = []): readonly RustUseLeaf[] {
  if (node.type === "use_declaration") {
    const argument = field(node, "argument") ?? node.namedChildren?.[0];
    return argument ? rustUseLeaves(argument, source, prefix) : [];
  }
  if (node.type === "scoped_use_list") {
    const pathNode = field(node, "path");
    const list = field(node, "list") ?? node.namedChildren?.find((child) => child.type === "use_list");
    const nextPrefix = [...prefix, ...(pathNode ? rustPathSegments(pathNode, source) : [])];
    return list ? rustUseLeaves(list, source, nextPrefix) : [];
  }
  if (node.type === "use_list") return (node.namedChildren ?? []).flatMap((child) => rustUseLeaves(child, source, prefix));
  if (node.type === "use_as_clause") {
    const pathNode = field(node, "path") ?? node.namedChildren?.[0];
    const alias = field(node, "alias");
    return pathNode ? [{ path: [...prefix, ...rustPathSegments(pathNode, source)], ...(alias ? { alias: text(source, alias) } : {}) }] : [];
  }
  if (node.type === "use_wildcard") return [{ path: [...prefix, "*"], glob: true }];
  const path = rustPathSegments(node, source);
  return path.length ? [{ path: [...prefix, ...path] }] : [];
}

function buildImports(
  captures: readonly NativeQueryCapture[],
  source: Buffer,
  index: SourceIndex,
  family: StructuralQueryPack["family"] = "typescript",
): readonly NormalizedStructuralImport[] {
  const scripting = captures.filter((capture) => capture.name.startsWith("import.")).flatMap((capture) => {
    const normalized = (
      form: NormalizedStructuralImport["form"],
      specifier: string,
      bindings: readonly { imported: string; local: string; typeOnly: boolean }[],
    ): NormalizedStructuralImport => {
      const frozen = frozenBindings(bindings);
      return Object.freeze({
        form, specifier, span: frozenSpan(index, capture.node.startIndex, capture.node.endIndex),
        bindings: frozen, names: Object.freeze(frozen.map((item) => item.local)), typeOnly: false,
      });
    };
    if (capture.name === "import.python") {
      const moduleNode = field(capture.node, "module_name") ?? field(capture.node, "name");
      if (!moduleNode) return [];
      if (capture.node.type === "import_statement") {
        return (capture.node.namedChildren ?? []).map((imported) => {
          const nameNode = field(imported, "name") ?? imported;
          const aliasNode = field(imported, "alias");
          const importedName = text(source, nameNode).replaceAll(".", "/");
          return normalized("python_import", importedName, [{
            imported: "*", local: aliasNode ? text(source, aliasNode) : importedName.split("/")[0]!, typeOnly: false,
          }]);
        });
      }
      const moduleName = text(source, moduleNode);
      let relativeDots = 0;
      while (moduleName[relativeDots] === ".") relativeDots += 1;
      const modulePath = moduleName.slice(relativeDots).replaceAll(".", "/");
      const specifier = relativeDots > 0
        ? `${relativeDots === 1 ? "./" : "../".repeat(relativeDots - 1)}${modulePath}`
        : modulePath;
      const bindings: { imported: string; local: string; typeOnly: boolean }[] = [];
      for (const imported of (capture.node.namedChildren ?? []).filter((node) => node !== moduleNode && node.type !== "import_prefix")) {
        const nameNode = field(imported, "name") ?? imported;
        if (!["aliased_import", "dotted_name", "identifier", "wildcard_import"].includes(imported.type)) continue;
        const importedName = text(source, nameNode);
        bindings.push({ imported: importedName, local: field(imported, "alias") ? text(source, field(imported, "alias")!) : importedName, typeOnly: false });
      }
      return [normalized("python_import", specifier, bindings)];
    } else if (capture.name === "import.php") {
      const group = descendants(capture.node).find((node) => node.type === "namespace_use_group");
      const prefixNode = group
        ? capture.node.namedChildren?.find((node) => node.type === "namespace_name")
        : undefined;
      return descendants(capture.node).filter((node) => node.type === "namespace_use_clause").flatMap((clause) => {
        const nameNode = clause.namedChildren?.find((node) => node.type === "qualified_name" || node.type === "name");
        if (!nameNode) return [];
        const rawName = `${prefixNode ? `${text(source, prefixNode)}\\` : ""}${text(source, nameNode)}`;
        const imported = text(source, nameNode).split("\\").at(-1)!;
        const alias = field(clause, "alias");
        return [normalized("php_use", rawName.replaceAll("\\", "/"), [{
          imported, local: alias ? text(source, alias) : imported, typeOnly: false,
        }])];
      });
    } else if (capture.name === "import.c" || capture.name === "import.cpp") {
      const pathNode = field(capture.node, "path");
      if (!pathNode) return [];
      const raw = text(source, pathNode).trim();
      const specifier = raw.startsWith("<") && raw.endsWith(">") ? raw : unquote(raw);
      return [normalized(capture.name === "import.c" ? "c_include" : "cpp_include", specifier, [])];
    } else if (capture.name === "import.go") {
      const pathNode = field(capture.node, "path");
      if (!pathNode) return [];
      const specifier = unquote(text(source, pathNode));
      const alias = field(capture.node, "name");
      const local = alias ? text(source, alias) : specifier.split("/").at(-1)!;
      return [normalized("go_import", specifier, [{ imported: "*", local, typeOnly: false }])];
    } else if (capture.name === "import.rust") {
      const grouped = new Map<string, { imported: string; local: string; typeOnly: boolean }[]>();
      for (const leaf of rustUseLeaves(capture.node, source)) {
        if (leaf.path.length === 0) continue;
        const terminal = leaf.path.at(-1)!;
        const importsModuleSelf = terminal === "self";
        const moduleParts = importsModuleSelf ? leaf.path.slice(0, -1)
          : leaf.path.length === 1 ? leaf.path : leaf.path.slice(0, -1);
        const specifier = moduleParts.join("/");
        const imported = leaf.glob || importsModuleSelf ? "*" : leaf.path.length === 1 ? "*" : terminal;
        const local = leaf.alias ?? (leaf.glob ? "*" : importsModuleSelf ? moduleParts.at(-1)! : terminal);
        const bindings = grouped.get(specifier) ?? [];
        bindings.push({ imported, local, typeOnly: false });
        grouped.set(specifier, bindings);
      }
      return [...grouped.entries()].map(([specifier, bindings]) => normalized("rust_use", specifier, bindings));
    } else if (capture.name === "import.zig") {
      const builtin = capture.node.namedChildren?.find((node) => node.type === "builtin_identifier");
      if (!builtin || text(source, builtin) !== "@import") return [];
      const argument = descendants(capture.node).find((node) => node.type === "string");
      if (!argument) return [];
      const assignment = ancestor(capture.node, "variable_declaration");
      const local = assignment?.namedChildren?.find((node) => node.type === "identifier");
      return [normalized("zig_import", unquote(text(source, argument)), local ? [{ imported: "*", local: text(source, local), typeOnly: false }] : [])];
    } else if (capture.name === "import.scala") {
      const direct = capture.node.namedChildren ?? [];
      const selectorList = direct.find((node) => node.type === "namespace_selectors");
      const directPaths = direct.filter((node) => ["identifier", "stable_identifier"].includes(node.type)).map((node) => text(source, node));
      if (selectorList) return (selectorList.namedChildren ?? []).flatMap((selector) => {
        const importedNode = field(selector, "name") ?? (selector.type === "identifier" ? selector : selector.namedChildren?.[0]);
        if (!importedNode) return [];
        const alias = field(selector, "alias");
        const imported = text(source, importedNode);
        return [normalized("scala_import", [...directPaths, imported].join("/"), [{ imported, local: alias ? text(source, alias) : imported, typeOnly: false }])];
      });
      if (directPaths.length === 0) return [];
      const imported = directPaths.at(-1)!;
      return [normalized("scala_import", directPaths.join("/"), [{ imported, local: imported, typeOnly: false }])];
    } else if (["import.java", "import.kotlin"].includes(capture.name)) {
      const pathNode = descendants(capture.node).find((node) =>
        ["scoped_identifier", "qualified_identifier", "stable_identifier"].includes(node.type)
      );
      if (!pathNode) return [];
      const segments = descendants(pathNode).filter((node) =>
        ["identifier", "type_identifier"].includes(node.type) &&
        !(node.namedChildren?.length)
      ).map((node) => text(source, node));
      if (segments.length === 0) return [];
      const wildcard = descendants(capture.node).some((node) => ["asterisk", "wildcard"].includes(node.type));
      const staticMember = capture.name === "import.java" && (capture.node.children ?? []).some((node) => node.type === "static");
      const aliasNode = field(capture.node, "alias") ?? capture.node.namedChildren?.find((node) => node.type === "import_alias")?.namedChildren?.at(-1) ??
        (capture.name === "import.kotlin" ? capture.node.namedChildren?.find((node) => node.type === "identifier" && node.startIndex > pathNode.endIndex) : undefined);
      const imported = wildcard ? "*" : segments.at(-1)!;
      const moduleSegments = staticMember && !wildcard ? segments.slice(0, -1) : segments;
      return [normalized(
        capture.name === "import.java" ? staticMember ? "java_static_import" : "java_import" : "kotlin_import",
        moduleSegments.join("/"), [{ imported, local: aliasNode ? text(source, aliasNode) : imported, typeOnly: false }],
      )];
    } else if (capture.name === "import.dart") {
      const uri = descendants(capture.node).find((node) => ["string_literal", "uri"].includes(node.type));
      if (!uri) return [];
      const alias = descendants(capture.node).find((node) => node.type === "identifier" && node.parent?.type === "import_specification");
      const combinators = descendants(capture.node).filter((node) => node.type === "combinator");
      const shown = combinators.filter((node) => (node.children ?? []).some((child) => child.type === "show")).flatMap((node) =>
        (node.namedChildren ?? []).filter((child) => child.type === "identifier").map((child) => text(source, child))
      );
      const hidden = combinators.filter((node) => (node.children ?? []).some((child) => child.type === "hide")).flatMap((node) =>
        (node.namedChildren ?? []).filter((child) => child.type === "identifier").map((child) => text(source, child))
      );
      const bindings = alias ? [{ imported: "*", local: text(source, alias), typeOnly: false }]
        : shown.length ? shown.map((name) => ({ imported: name, local: name, typeOnly: false }))
        : [{ imported: "*", local: "*", typeOnly: false }, ...hidden.map((name) => ({ imported: `!${name}`, local: `!${name}`, typeOnly: false }))];
      const rawSpecifier = unquote(text(source, uri));
      const specifier = /^(?:[a-z]+:|\/|\.\.?\/)/u.test(rawSpecifier) ? rawSpecifier : `./${rawSpecifier}`;
      return [normalized("dart_import", specifier, bindings)];
    } else if (capture.name === "import.csharp" || capture.name === "import.swift") {
      // Namespace/module syntax does not identify a source path without build metadata.
      const name = field(capture.node, "name") ?? descendants(capture.node).find((node) =>
        ["qualified_name", "identifier", "simple_identifier"].includes(node.type)
      );
      return name ? [normalized(capture.name === "import.csharp" ? "csharp_using" : "swift_import", text(source, name), [])] : [];
    } else if (capture.name === "import.elixir") {
      const target = field(capture.node, "target");
      const form = target ? text(source, target) : "";
      const args = capture.node.namedChildren?.find((node) => node.type === "arguments");
      const moduleNode = args?.namedChildren?.[0];
      if (!moduleNode || !["alias", "import", "require", "use"].includes(form)) return [];
      const moduleName = text(source, moduleNode);
      const pairs = descendants(args!).filter((node) => node.type === "pair");
      const pairNamed = (key: string) => pairs.find((pair) => {
        const keyNode = field(pair, "key");
        return keyNode && text(source, keyNode).replace(/:\s*$/u, "") === key;
      });
      const asPair = pairNamed("as");
      const asValue = asPair ? field(asPair, "value") : null;
      const onlyPair = pairNamed("only");
      const onlyValue = onlyPair ? field(onlyPair, "value") : null;
      const named = onlyValue ? descendants(onlyValue).filter((node) => node.type === "pair").flatMap((pair) => {
        const keyNode = field(pair, "key");
        const valueNode = field(pair, "value");
        return keyNode ? [{ name: text(source, keyNode).replace(/:\s*$/u, ""), arity: valueNode ? Number(text(source, valueNode)) : undefined }] : [];
      }) : [];
      const local = asValue ? text(source, asValue) : moduleName.split(".").at(-1)!;
      const bindings = named.length ? named.map(({ name, arity }) => ({ imported: name, local: name, typeOnly: false, ...(Number.isSafeInteger(arity) ? { arity } : {}) }))
        : [{ imported: "*", local, typeOnly: false }];
      return [normalized(`elixir_${form}` as NormalizedStructuralImport["form"], moduleName.replaceAll(".", "/"), bindings)];
    } else if (capture.name === "import.erlang") {
      const moduleNode = field(capture.node, "module");
      if (!moduleNode) return [];
      const bindings = (field(capture.node, "funs") ? descendants(capture.node) : capture.node.namedChildren ?? [])
        .filter((node) => node.type === "fa").map((node) => {
          const name = field(node, "name") ?? node.namedChildren?.[0];
          const imported = name ? text(source, name) : text(source, node).split("/")[0]!;
          const arityNode = field(node, "arity");
          const integer = arityNode ? descendants(arityNode).find((child) => child.type === "integer") : undefined;
          const arity = integer ? Number(text(source, integer)) : undefined;
          return { imported, local: imported, typeOnly: false, ...(Number.isSafeInteger(arity) ? { arity } : {}) };
        });
      return [normalized("erlang_import", text(source, moduleNode), bindings)];
    } else if (capture.name === "import.clojure") {
      const forms = descendants(capture.node).filter((node) => node.type === "list_lit" || node.type === "vec_lit");
      return forms.flatMap((formNode) => {
        const values = (formNode.namedChildren ?? []).filter((node) => node.type !== "comment");
        const directive = values[0] ? text(source, values[0]) : "";
        if (![":require", ":import"].includes(directive)) return [];
        return values.slice(1).flatMap((entry) => {
          const parts = (entry.namedChildren ?? []).filter((node) => node.type !== "comment");
          const moduleNode = entry.type === "vec_lit" ? parts[0] : entry;
          if (!moduleNode) return [];
          const moduleName = text(source, moduleNode);
          const asIndex = parts.findIndex((node) => text(source, node) === ":as");
          const alias = asIndex >= 0 ? parts[asIndex + 1] : undefined;
          const local = alias ? text(source, alias) : moduleName.split(".").at(-1)!;
          const referIndex = parts.findIndex((node) => text(source, node) === ":refer");
          const refer = referIndex >= 0 ? parts[referIndex + 1] : undefined;
          const referred = refer?.type === "vec_lit" ? (refer.namedChildren ?? []).filter((node) => node.type === "sym_lit").map((node) => text(source, node)) : [];
          const bindings = referred.length ? referred.map((name) => ({ imported: name, local: name, typeOnly: false }))
            : [{ imported: "*", local, typeOnly: false }];
          return [normalized(directive === ":require" ? "clojure_require" : "clojure_import", moduleName.replaceAll(".", "/"), bindings)];
        });
      });
    } else if (capture.name === "import.ocaml") {
      const moduleNode = field(capture.node, "module");
      return moduleNode ? [normalized(capture.node.type === "open_module" ? "ocaml_open" : "ocaml_include", text(source, moduleNode).replaceAll(".", "/"), [])] : [];
    } else if (capture.name === "import.ocaml.module") {
      const binding = descendants(capture.node).find((node) => node.type === "module_binding");
      const body = binding ? field(binding, "body") : null;
      const local = binding?.namedChildren?.find((node) => node.type === "module_name");
      if (!body || body.type !== "module_path" || !local) return [];
      return [normalized("ocaml_module_alias", text(source, body).replaceAll(".", "/"), [{ imported: "*", local: text(source, local), typeOnly: false }])];
    } else if (capture.name === "import.haskell") {
      const moduleNode = field(capture.node, "module");
      if (!moduleNode) return [];
      const alias = field(capture.node, "alias");
      const names = field(capture.node, "names");
      const importedNames = names ? descendants(names).filter((node) => node.type === "import_name").map((node) => text(source, node)) : [];
      const qualified = (capture.node.children ?? []).some((node) => node.type === "qualified");
      const hiding = (capture.node.children ?? []).some((node) => node.type === "hiding");
      const moduleLocal = alias ? text(source, alias) : text(source, moduleNode).split(".").at(-1)!;
      const bindings = qualified ? [{ imported: "*", local: moduleLocal, typeOnly: false }]
        : hiding ? [{ imported: "*", local: "*", typeOnly: false }, ...importedNames.map((name) => ({ imported: `!${name}`, local: `!${name}`, typeOnly: false }))]
        : importedNames.length ? importedNames.map((name) => ({ imported: name, local: name, typeOnly: false }))
        : [{ imported: "*", local: "*", typeOnly: false }];
      return [normalized("haskell_import", text(source, moduleNode).replaceAll(".", "/"), bindings)];
    } else return [];
  });
  const statements = captures
    .filter((capture) => capture.name === "import.statement" || (capture.name === "export.statement" && field(capture.node, "source")))
    .flatMap((capture) => {
      const sourceNode = field(capture.node, "source");
      if (!sourceNode) return [];
      const statement = text(source, capture.node).trimStart();
      const parsedBindings = importBindings(capture.node, source);
      const bindings = capture.name === "export.statement" && parsedBindings.length === 0 && /^export\s*\*/u.test(statement)
        ? frozenBindings([{ imported: "*", local: "*", typeOnly: false }])
        : parsedBindings;
      return [Object.freeze({
        form: capture.name === "export.statement" ? "esm_re_export" : "esm_import",
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
      const targetNode = field(capture.node, "function") ?? field(capture.node, "method") ?? field(capture.node, "name");
      const argumentsNode = field(capture.node, "arguments");
      const argument = argumentsNode?.namedChildren?.[0];
      const target = targetNode ? text(source, targetNode) : "";
      const requireTargets = family === "ruby" ? ["require", "require_relative"] : ["require", "import"];
      if (!targetNode || !requireTargets.includes(target) || !argument || !["string", "encapsed_string"].includes(argument.type)) return [];
      const declarator = ancestor(capture.node, "variable_declarator");
      const luaAssignment = family === "lua" ? ancestor(capture.node, "assignment_statement") : undefined;
      const localNode = declarator
        ? field(declarator, "name")
        : luaAssignment?.namedChildren?.[0]?.namedChildren?.[0] ?? null;
      const rawBindings: { imported: string; local: string; typeOnly: boolean }[] = [];
      if (target === "require" && localNode?.type === "identifier") {
        rawBindings.push({ imported: "default", local: text(source, localNode), typeOnly: false });
      } else if (target === "import" && localNode?.type === "identifier") {
        rawBindings.push({ imported: "*", local: text(source, localNode), typeOnly: false });
      } else if (target === "require" && localNode) {
        for (const child of localNode.namedChildren ?? []) {
          const importedNode = field(child, "key") ?? field(child, "name") ?? child;
          const localBinding = field(child, "value") ?? field(child, "alias") ?? importedNode;
          const importedName = text(source, importedNode).trim();
          const localName = text(source, localBinding).trim();
          if (importedName && localName) rawBindings.push({
            imported: importedName,
            local: localName,
            typeOnly: false,
          });
        }
      }
      const bindings = frozenBindings(rawBindings);
      return [Object.freeze({
        form: family === "ruby" ? "ruby_require" : family === "lua" ? "lua_require" : target === "require" ? "commonjs_require" : "dynamic_import",
        specifier: unquote(text(source, argument)),
        span: frozenSpan(index, capture.node.startIndex, capture.node.endIndex),
        bindings,
        names: Object.freeze(bindings.map((binding) => binding.local)),
        typeOnly: false,
      } satisfies NormalizedStructuralImport)];
    });
  return Object.freeze([...statements, ...scripting, ...requires].sort((left, right) => left.span.startByte - right.span.startByte));
}

function unresolved(name: string, qualifier?: string): StructuralTarget {
  return Object.freeze({ status: "unresolved", name, ...(qualifier ? { qualifier } : {}) });
}

function targetParts(raw: string): { name: string; qualifier?: string } {
  const normalized = raw.replace(/\s+/gu, "").replace(/\?\./gu, ".");
  const parts = normalized.split(/[.:/]/u).filter(Boolean);
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
    const targetNode = field(capture.node, "function") ?? field(capture.node, "constructor") ?? field(capture.node, "method") ?? field(capture.node, "name") ?? field(capture.node, "target") ?? field(capture.node, "expr") ??
      (capture.node.type === "selector" ? capture.node.parent?.namedChildren?.find((node) => node.endIndex <= capture.node.startIndex) : undefined) ??
      capture.node.namedChildren?.find((node) => !["value_arguments", "argument_list", "call_suffix", "arguments"].includes(node.type));
    const argumentsNode = field(capture.node, "arguments") ?? capture.node.namedChildren?.find((node) =>
      ["value_arguments", "argument_list", "call_suffix", "arguments", "expr_args"].includes(node.type)
    ) ?? descendants(capture.node).find((node) => ["value_arguments", "argument_list", "arguments", "expr_args"].includes(node.type));
    if (!targetNode) continue;
    const argumentContainer = argumentsNode?.type === "call_suffix"
      ? descendants(argumentsNode).find((node) => ["value_arguments", "argument_list", "arguments"].includes(node.type))
      : argumentsNode;
    const argumentNodes = argumentContainer?.namedChildren ?? (capture.node.namedChildren ?? []).filter((node) => node !== targetNode);
    const rawTarget = text(source, targetNode);
    if (["require", "require_relative", "import"].includes(rawTarget)) continue;
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
      const flowNode = ["argument", "value_argument", "simple_parameter"].includes(argument.type)
        ? argument.namedChildren?.[0] ?? argument
        : argument;
      if (!["identifier", "simple_identifier", "variable_name", "var", "value_path", "value_name", "variable", "sym_lit"].includes(flowNode.type)) continue;
      edges.push({
        kind: "data_flow",
        span: frozenSpan(index, flowNode.startIndex, flowNode.endIndex),
        target: unresolved(parts.name, parts.qualifier),
        paramIndex,
        metadata: Object.freeze({ argument: text(source, flowNode) }),
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

function functionalCaptures(
  captures: readonly NativeQueryCapture[],
  source: Buffer,
  family: StructuralQueryPack["family"],
): readonly NativeQueryCapture[] {
  if (family !== "clojure") return captures;
  const result: NativeQueryCapture[] = [];
  for (const capture of captures) {
    if (capture.name !== "form.clojure") {
      result.push(capture);
      continue;
    }
    const values = (capture.node.namedChildren ?? []).filter((child) => child.type !== "comment");
    const head = values[0] ? text(source, values[0]) : "";
    const declaration = head === "ns" ? "symbol.module"
      : ["defn", "defn-", "defmacro"].includes(head) ? "symbol.function"
      : head === "defprotocol" ? "symbol.interface"
      : ["defrecord", "deftype"].includes(head) ? "symbol.class"
      : head === "def" ? "symbol.variable" : undefined;
    if (declaration) result.push({ ...capture, name: declaration });
    if (head === "ns") result.push({ ...capture, name: "import.clojure" });
    if (!declaration && head && !head.startsWith(":")) result.push({ ...capture, name: "edge.call" });
  }
  return normalizeQueryCaptures(result);
}

export function executeQueryPack(
  pack: StructuralQueryPack,
  tree: StructuralQueryTree,
  source: Buffer,
  context: StructuralQueryContext,
  capabilities: QueryCapabilityContract = ALL_REQUIRED_CAPABILITIES,
): NormalizedStructure {
  collectEmbeddedChildren(pack, tree, source, context);
  const captures = functionalCaptures(normalizeQueryCaptures(pack.querySources.flatMap((querySource) =>
    context.query(querySource, tree.rootNode),
  )), source, pack.family);
  const index = new SourceIndex(source);
  const imports = enabled(capabilities, "imports") ? buildImports(captures, source, index, pack.family) : Object.freeze([]);
  const importEdges: NormalizedStructuralEdge[] = imports.map((item) => ({
    kind: "import",
    span: item.span,
    target: unresolved(item.specifier),
    metadata: Object.freeze({ bindings: item.bindings, names: item.names, typeOnly: item.typeOnly }),
  }));
  return Object.freeze({
    symbols: enabled(capabilities, "declarations")
      ? buildSymbols(captures, source, index, enabled(capabilities, "documentation"), pack.family)
      : Object.freeze([]),
    edges: dedupeEdges([
      ...buildCallEdges(captures, source, index, capabilities),
      ...(enabled(capabilities, "type_relations") ? buildSyntaxEdges(captures, source, index) : []),
      ...importEdges,
    ]),
    imports,
  });
}

const EMBEDDED_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  js: ".js", javascript: ".js", jsx: ".jsx",
  ts: ".ts", typescript: ".ts", tsx: ".tsx",
  markdown: ".md", md: ".md", json: ".json", yaml: ".yaml", yml: ".yml",
  python: ".py", py: ".py", ruby: ".rb", rb: ".rb", go: ".go", rust: ".rs", rs: ".rs",
  java: ".java", kotlin: ".kt", scala: ".scala", c: ".c", cpp: ".cpp", csharp: ".cs",
});

function collectEmbeddedChildren(
  pack: StructuralQueryPack,
  tree: StructuralQueryTree,
  source: Buffer,
  context: StructuralQueryContext,
): void {
  // Only Vue and Markdown host embedded child languages. Walking the full AST
  // (via the byte-wrapping adapter, which materializes a wrapper per node) for
  // every other family is pure waste on the hot parse path, so skip it entirely
  // unless this pack actually declares embedded children.
  if (pack.family !== "vue" && pack.family !== "markdown") {
    return;
  }
  const root = tree.rootNode as NativeQueryNode;
  const nodes = [root, ...descendants(root)];
  if (pack.family === "vue") {
    let ordinal = 0;
    for (const node of nodes.filter((candidate) => candidate.type === "script_element")) {
      const content = node.namedChildren?.find((child) => child.type === "raw_text");
      if (!content) continue;
      const startTag = node.namedChildren?.find((child) => child.type === "start_tag");
      const langAttribute = startTag?.namedChildren?.find((child) =>
        child.type === "attribute" && child.namedChildren?.some((part) =>
          part.type === "attribute_name" && text(source, part).toLowerCase() === "lang"
        )
      );
      const langValue = langAttribute?.namedChildren?.find((part) =>
        part.type === "quoted_attribute_value" || part.type === "attribute_value"
      );
      const nestedValue = langValue?.type === "quoted_attribute_value"
        ? langValue.namedChildren?.find((part) => part.type === "attribute_value")
        : langValue;
      const lang = nestedValue ? text(source, nestedValue).trim().toLowerCase() : "js";
      context.collectEmbeddedSlice({
        extension: EMBEDDED_EXTENSIONS[lang] ?? `.${lang}`,
        startByte: content.startIndex,
        endByte: content.endIndex,
        scope: `vue.script[${ordinal}]`,
      });
      ordinal += 1;
    }
  }
  if (pack.family === "markdown") {
    let ordinal = 0;
    for (const node of nodes.filter((candidate) => candidate.type === "fenced_code_block")) {
      const info = node.namedChildren?.find((child) => child.type === "info_string");
      const content = node.namedChildren?.find((child) => child.type === "code_fence_content");
      if (!content) continue;
      const declared = info ? text(source, info).trim().split(/\s+/u)[0]!.toLowerCase() : "plain";
      context.collectEmbeddedSlice({
        extension: EMBEDDED_EXTENSIONS[declared] ?? `.${declared}`,
        startByte: content.startIndex,
        endByte: content.endIndex,
        scope: `markdown.fence[${ordinal}]`,
      });
      ordinal += 1;
    }
  }
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

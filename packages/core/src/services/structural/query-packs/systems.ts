import type { StructuralQueryPack } from "../query-pack.js";

export const C_QUERY_PACK: StructuralQueryPack = Object.freeze({
  version: "1.0.0", dialects: Object.freeze(["c", "header-default-c"]), family: "c", querySources: Object.freeze([`
    (function_definition) @symbol.function
    (type_definition) @symbol.type
    (struct_specifier name: (type_identifier)) @symbol.class
    (enum_specifier name: (type_identifier)) @symbol.enum
    (preproc_include) @import.c
    (call_expression) @edge.call
    (parameter_declaration type: (type_identifier) @edge.type_ref)
    (field_declaration type: (type_identifier) @edge.type_ref)
    (comment) @documentation
  `]),
});

export const CPP_QUERY_PACK: StructuralQueryPack = Object.freeze({
  version: "1.0.0", dialects: Object.freeze(["cpp", "header", "header-cpp"]), family: "cpp", querySources: Object.freeze([`
    (function_definition) @symbol.function
    (class_specifier) @symbol.class
    (struct_specifier name: (type_identifier)) @symbol.class
    (enum_specifier name: (type_identifier)) @symbol.enum
    (namespace_definition) @symbol.namespace
    (preproc_include) @import.cpp
    (call_expression) @edge.call
    (base_class_clause (type_identifier) @edge.extend)
    (parameter_declaration type: (type_identifier) @edge.type_ref)
    (field_declaration type: (type_identifier) @edge.type_ref)
    (comment) @documentation
  `]),
});

export const GO_QUERY_PACK: StructuralQueryPack = Object.freeze({
  version: "1.0.0", dialects: Object.freeze(["go"]), family: "go", querySources: Object.freeze([`
    (type_spec) @symbol.type
    (function_declaration) @symbol.function
    (method_declaration) @symbol.method
    (import_spec) @import.go
    (call_expression) @edge.call
    (parameter_declaration type: (type_identifier) @edge.type_ref)
    (field_declaration type: (type_identifier) @edge.type_ref)
    (comment) @documentation
  `]),
});

export const RUST_QUERY_PACK: StructuralQueryPack = Object.freeze({
  version: "1.0.0", dialects: Object.freeze(["rust"]), family: "rust", querySources: Object.freeze([`
    (struct_item) @symbol.class
    (enum_item) @symbol.enum
    (trait_item) @symbol.trait
    (type_item) @symbol.type
    (function_item) @symbol.function
    (use_declaration) @import.rust
    (call_expression) @edge.call
    (impl_item trait: (type_identifier) @edge.implement)
    (parameter type: (type_identifier) @edge.type_ref)
    (field_declaration type: (type_identifier) @edge.type_ref)
    (line_comment) @documentation
    (block_comment) @documentation
  `]),
});

export const ZIG_QUERY_PACK: StructuralQueryPack = Object.freeze({
  version: "1.0.0", dialects: Object.freeze(["zig"]), family: "zig", querySources: Object.freeze([`
    (variable_declaration (struct_declaration)) @symbol.type
    (variable_declaration (enum_declaration)) @symbol.type
    (function_declaration) @symbol.function
    (builtin_function (builtin_identifier) @zig.import.name) @import.zig
    (call_expression) @edge.call
    (parameter type: (identifier) @edge.type_ref)
    (container_field type: (identifier) @edge.type_ref)
    (comment) @documentation
  `]),
});

export const SYSTEMS_QUERY_PACKS = Object.freeze([C_QUERY_PACK, CPP_QUERY_PACK, GO_QUERY_PACK, RUST_QUERY_PACK, ZIG_QUERY_PACK]);

import type { StructuralQueryPack } from "../query-pack.js";

const COMMON_DECLARATIONS = `
(class_declaration) @symbol.class
(function_declaration) @symbol.function
(generator_function_declaration) @symbol.function
(method_definition) @symbol.method
(variable_declarator name: (identifier)) @symbol.variable
(import_statement) @import.statement
(export_statement) @export.statement
(call_expression) @edge.call
(new_expression) @edge.call
`;

const TYPESCRIPT_DECLARATIONS = `
(interface_declaration) @symbol.interface
(enum_declaration) @symbol.enum
(type_alias_declaration) @symbol.type
(internal_module) @symbol.namespace
(module) @symbol.module
(function_signature) @symbol.function
(method_signature) @symbol.method
(public_field_definition) @symbol.field
(property_signature) @symbol.property
(abstract_method_signature) @symbol.method
(type_parameter) @symbol.type_parameter
`;

const TYPESCRIPT_RELATIONS = `
(type_annotation) @edge.type_ref_container
(type_alias_declaration value: (_) @edge.type_ref_value)
(type_arguments) @edge.type_argument_container
(extends_clause value: (_) @edge.extend)
(extends_type_clause type: (_) @edge.extend)
(implements_clause) @edge.implement_container
`;

export const TYPESCRIPT_QUERY_PACK: StructuralQueryPack = Object.freeze({
  version: "1.0.0",
  dialects: Object.freeze(["typescript", "tsx"]),
  querySources: Object.freeze([
    COMMON_DECLARATIONS,
    TYPESCRIPT_DECLARATIONS,
    TYPESCRIPT_RELATIONS,
  ]),
});

export const JAVASCRIPT_QUERY_PACK: StructuralQueryPack = Object.freeze({
  version: "1.0.0",
  dialects: Object.freeze(["javascript", "jsx"]),
  querySources: Object.freeze([
    COMMON_DECLARATIONS,
    `(class_heritage) @edge.extend_container
     (field_definition) @symbol.field`,
  ]),
});

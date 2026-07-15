import type { StructuralQueryPack } from "../query-pack.js";

export const ELIXIR_QUERY_PACK: StructuralQueryPack = Object.freeze({
  version: "1.0.0", dialects: Object.freeze(["elixir", "elixir-script"]), family: "elixir", querySources: Object.freeze([`
    ((call target: (identifier) @_name) @symbol.module (#eq? @_name "defmodule"))
    ((call target: (identifier) @_name) @symbol.interface (#eq? @_name "defprotocol"))
    ((call target: (identifier) @_name) @symbol.function (#match? @_name "^def(p|macro|macrop)?$"))
    ((call target: (identifier) @_name) @import.elixir (#match? @_name "^(alias|import|require|use)$"))
    ((unary_operator (call target: (identifier) @_meta)) @documentation (#match? @_meta "^(moduledoc|doc|spec)$"))
    ((call target: [(identifier) (dot)] @_target) @edge.call (#not-match? @_target "^(defmodule|defprotocol|def|defp|defmacro|defmacrop|alias|import|require|use|doc|moduledoc|spec)$"))
    (comment) @documentation
  `]),
});

export const ERLANG_QUERY_PACK: StructuralQueryPack = Object.freeze({
  version: "1.0.0", dialects: Object.freeze(["erlang"]), family: "erlang", querySources: Object.freeze([`
    (module_attribute) @symbol.module
    (fun_decl) @symbol.function
    (type_alias) @symbol.type
    (import_attribute) @import.erlang
    (behaviour_attribute name: (_) @edge.implement)
    (call) @edge.call
    (comment) @documentation
  `]),
});

export const CLOJURE_QUERY_PACK: StructuralQueryPack = Object.freeze({
  version: "1.0.0", dialects: Object.freeze(["clojure"]), family: "clojure", querySources: Object.freeze([`
    (list_lit) @form.clojure
    (comment) @documentation
  `]),
});

export const OCAML_QUERY_PACK: StructuralQueryPack = Object.freeze({
  version: "1.0.0", dialects: Object.freeze(["ocaml"]), family: "ocaml", querySources: Object.freeze([`
    (module_definition) @symbol.module
    (value_definition) @symbol.function
    (type_definition) @symbol.type
    (class_definition) @symbol.class
    (method_definition) @symbol.method
    [(open_module) (include_module)] @import.ocaml
    (module_definition) @import.ocaml.module
    (application_expression) @edge.call
    (inheritance_definition) @edge.extend
    (comment) @documentation
  `]),
});

export const HASKELL_QUERY_PACK: StructuralQueryPack = Object.freeze({
  version: "1.0.0", dialects: Object.freeze(["haskell"]), family: "haskell", querySources: Object.freeze([`
    (header) @symbol.module
    (function) @symbol.function
    [(data_type) (newtype) (type_synomym)] @symbol.type
    (class) @symbol.interface
    (instance name: (_) @edge.implement)
    (import) @import.haskell
    (apply) @edge.call
    [(comment) (haddock)] @documentation
  `]),
});

export const FUNCTIONAL_QUERY_PACKS = Object.freeze([
  ELIXIR_QUERY_PACK, ERLANG_QUERY_PACK, CLOJURE_QUERY_PACK, OCAML_QUERY_PACK, HASKELL_QUERY_PACK,
]);

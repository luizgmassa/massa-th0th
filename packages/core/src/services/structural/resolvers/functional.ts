import type { StructuralBuildMetadata, StructuralLanguageResolver, StructuralReference, StructuralResolverDefinition, StructuralResolverFile } from "../resolver.js";
import { TYPESCRIPT_LANGUAGE_RESOLVER } from "./typescript.js";

export const FUNCTIONAL_LANGUAGE_RESOLVER: StructuralLanguageResolver = Object.freeze({
  ...TYPESCRIPT_LANGUAGE_RESOLVER,
  dialects: Object.freeze(["elixir", "elixir-script", "erlang", "clojure", "ocaml", "haskell"]),
  resolve(file: StructuralResolverFile, reference: StructuralReference, definitions: readonly StructuralResolverDefinition[], build: StructuralBuildMetadata) {
    const unresolved = reference.target.status === "unresolved" ? reference.target : undefined;
    const resolverFile = unresolved && !unresolved.qualifier ? { ...file, imports: file.imports.map((imported) => {
      if (!["elixir_import", "erlang_import", "clojure_require", "ocaml_open", "ocaml_include", "haskell_import"].includes(imported.form)) return imported;
      if (imported.bindings.some((binding) => binding.imported === `!${unresolved.name}`)) return imported;
      const owner = imported.specifier.replaceAll("/", ".");
      const injectsWildcard = imported.bindings.some((binding) => binding.imported === "*" && binding.local === "*");
      const hasNamed = imported.bindings.some((binding) => !binding.imported.startsWith("!") && binding.imported !== "*");
      if (imported.form === "clojure_require" && !hasNamed) return imported;
      if (imported.form === "haskell_import" && !injectsWildcard && !hasNamed) return imported;
      return { ...imported, bindings: imported.bindings.length === 0
        ? [{ imported: `${owner}.${unresolved.name}`, local: unresolved.name, typeOnly: false }]
        : imported.bindings.map((binding) => binding.imported === "*" && (binding.local === "*" || imported.form === "elixir_import")
          ? { ...binding, imported: `${owner}.${unresolved.name}`, local: unresolved.name }
          : binding.imported.startsWith("!") ? binding : { ...binding, imported: `${owner}.${binding.imported}` }) };
    }) } : file;
    return TYPESCRIPT_LANGUAGE_RESOLVER.resolve(resolverFile, reference, definitions.filter((item) =>
      file.dialect === "elixir" || file.dialect === "elixir-script"
        ? item.identity.dialect === "elixir" || item.identity.dialect === "elixir-script"
        : item.identity.dialect === file.dialect
    ), build);
  },
});

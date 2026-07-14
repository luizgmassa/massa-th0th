import type {
  StructuralBuildMetadata, StructuralLanguageResolver, StructuralReference,
  StructuralResolverDefinition, StructuralResolverFile,
} from "../resolver.js";
import { TYPESCRIPT_LANGUAGE_RESOLVER } from "./typescript.js";
import path from "node:path";

const DIALECTS = Object.freeze(["c", "header-default-c", "cpp", "header", "header-cpp", "go", "rust", "zig"]);

export const SYSTEMS_LANGUAGE_RESOLVER: StructuralLanguageResolver = Object.freeze({
  ...TYPESCRIPT_LANGUAGE_RESOLVER,
  dialects: DIALECTS,
  resolve(file: StructuralResolverFile, reference: StructuralReference, definitions: readonly StructuralResolverDefinition[], build: StructuralBuildMetadata) {
    const compatible = file.dialect === "header-default-c" ? ["c", "header-default-c"]
      : file.dialect === "header-cpp" || file.dialect === "header" ? ["cpp", "header", "header-cpp"] : [file.dialect];
    const unresolvedTarget = reference.target.status === "unresolved" ? reference.target : undefined;
    const resolverFile = file.dialect === "rust" ? {
      ...file,
      imports: file.imports.map((item) => {
        if (item.form !== "rust_use") return item;
        const bindings = item.bindings.map((binding) =>
          binding.imported === "*" && binding.local === "*" && unresolvedTarget && !unresolvedTarget.qualifier
            ? { ...binding, imported: unresolvedTarget.name, local: unresolvedTarget.name }
            : binding
        );
        if (item.specifier === "crate" || item.specifier.startsWith("crate/")) {
          const crateRoot = file.file.startsWith("src/") ? "src" : "";
          return { ...item, bindings, specifier: `./${path.posix.relative(path.posix.dirname(file.file), path.posix.join(crateRoot, item.specifier.replace(/^crate\/?/u, "")))}` };
        }
        if (item.specifier === "self" || item.specifier.startsWith("self/")) return { ...item, bindings, specifier: `./${item.specifier.replace(/^self\/?/u, "")}` };
        if (item.specifier === "super" || item.specifier.startsWith("super/")) return { ...item, bindings, specifier: `../${item.specifier.replace(/^super\/?/u, "")}` };
        return { ...item, bindings };
      }),
    } : file;
    return TYPESCRIPT_LANGUAGE_RESOLVER.resolve(resolverFile, reference, definitions.filter((item) => compatible.includes(item.identity.dialect)), build);
  },
});

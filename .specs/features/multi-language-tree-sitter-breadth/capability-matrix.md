# Multi-Language Tree-sitter Capability and Native Feasibility Matrix

> **Native Runtime Re-baseline (2026-07-16):** the active native runtime is Bun `1.3.11` with Node `25.9.0` (npm `11.14.1`) as the build-only `node-gyp` helper, and the `tree-sitter` patch SHA is `e79aec7b96eb8114e85ebcb90f0a8b12076bcd8aa08c09bb88929621e1c1446d` (adds a C++20 `binding.gyp` and an install-guard). These supersede earlier Bun `1.3.0`/Node `22.22.2`/npm `10.9.7`/patch `b0f73d00…` mentions below, which remain as historical measurement evidence. See `gate-manifest.md` → "Native Runtime Re-baseline" for re-validated gates.

**Status:** TASK-001 and TASK-002 PASS on macOS arm64; re-baselined to Bun `1.3.11`/Node `25.9.0` on 2026-07-16 (originally exact Bun `1.3.0`)
**Canonical source:** `packages/shared/src/config/index.ts` (`DEFAULT_ALLOWED_EXTENSIONS`)  
**Legend:** `R` required and tested; `F` forbidden false positive; `U` unsupported/no output; `E` embedded-child capability.

## Capability Contract

| Extension | Language/dialect | Tier | Symbols/docs | Imports/modules | Type/extend/implement | Calls | Data flow | HTTP | Emit/listen | Embedded | Grammar artifact candidate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `.ts` | TypeScript | Flow | R | R | R | R | R | R | R | U | `tree-sitter-typescript@0.23.2` (`typescript`) |
| `.js` | JavaScript | Flow | R | R | R | R | R | R | R | U | `tree-sitter-javascript@0.25.0` |
| `.tsx` | TSX | Flow | R | R | R | R | R | R | R | U | `tree-sitter-typescript@0.23.2` (`tsx`) |
| `.jsx` | JSX | Flow | R | R | R | R | R | R | R | U | `tree-sitter-javascript@0.25.0` |
| `.vue` | Vue SFC; script dialect from `lang`, default JS | Flow | R | R | R | R | R | R | R | E | `tree-sitter-html@0.23.2` SFC host plus TS/JS child grammars; legacy `tree-sitter-vue@0.2.1` rejected |
| `.dart` | Dart | Flow | R | R | R | R | R | R | R | U | `github:UserNobody14/tree-sitter-dart#be07cf7118d3ba06236a3f19541685a68209934` |
| `.py` | Python | Flow | R | R | R | R | R | R | R | U | `tree-sitter-python@0.25.0` |
| `.php` | PHP | Flow | R | R | R | R | R | R | R | U | `tree-sitter-php@0.24.2` |
| `.java` | Java | Flow | R | R | R | R | R | R | R | U | `tree-sitter-java@0.23.5` |
| `.go` | Go | Flow | R | R | R | R | R | R | R | U | `tree-sitter-go@0.25.0` |
| `.rs` | Rust | Flow | R | R | R | R | R | R | R | U | `tree-sitter-rust@0.24.0` |
| `.cpp` | C++ | Flow | R | R | R | R | R | R | R | U | `tree-sitter-cpp@0.23.4` |
| `.c` | C | Flow | R | R | R | R | R | R | R | U | `tree-sitter-c@0.24.1` |
| `.h` | C by default; C++ when importer/build evidence proves it | Flow | R | R | R | R | R | R | R | U | `tree-sitter-c@0.24.1` or `tree-sitter-cpp@0.23.4` |
| `.md` | Markdown/CommonMark+GFM | Structure | R headings | U | U | U | U | U | U | E fenced languages | `@tree-sitter-grammars/tree-sitter-markdown@0.3.2` |
| `.json` | JSON | Structure | R qualified keys | U | U | U | U | U | U | U | `tree-sitter-json@0.24.8` |
| `.yaml` | YAML | Structure | R qualified keys | U | U | U | U | U | U | U | `@tree-sitter-grammars/tree-sitter-yaml@0.7.1` |
| `.yml` | YAML | Structure | R qualified keys | U | U | U | U | U | U | U | `@tree-sitter-grammars/tree-sitter-yaml@0.7.1` |
| `.hpp` | C++ header | Flow | R | R | R | R | R | R | R | U | `tree-sitter-cpp@0.23.4` |
| `.cs` | C# | Flow | R | R | R | R | R | R | R | U | `tree-sitter-c-sharp@0.23.5` |
| `.rb` | Ruby | Flow | R | R | R | R | R | R | R | U | `tree-sitter-ruby@0.23.1` |
| `.swift` | Swift | Flow | R | R | R | R | R | R | R | U | `tree-sitter-swift@0.7.1` |
| `.kt` | Kotlin | Flow | R | R | R | R | R | R | R | U | `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` |
| `.kts` | Kotlin Script | Flow | R | R | R | R | R | R | R | U | `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` |
| `.scala` | Scala | Flow | R | R | R | R | R | R | R | U | `tree-sitter-scala@0.24.0` |
| `.lua` | Lua/LuaJIT | Flow | R | R | R | R | R | R | R | U | `@tree-sitter-grammars/tree-sitter-lua@0.4.1` |
| `.zig` | Zig | Flow | R | R | R | R | R | R | R | U | `@tree-sitter-grammars/tree-sitter-zig@1.1.2` |
| `.ex` | Elixir | Flow | R | R | R | R | R | R | R | U | `tree-sitter-elixir@0.3.5` |
| `.exs` | Elixir Script | Flow | R | R | R | R | R | R | R | U | `tree-sitter-elixir@0.3.5` |
| `.erl` | Erlang | Flow | R | R | R | R | R | R | R | U | `github:WhatsApp/tree-sitter-erlang#836aa2b6c3af2c7cef3f84049b0ed6d44485a870` |
| `.clj` | Clojure | Flow | R | R | R | R | R | R | R | U | `tree-sitter-clojure-orchard@0.2.5` |
| `.ml` | OCaml implementation | Flow | R | R | R | R | R | R | R | U | `tree-sitter-ocaml@0.24.2` (`ocaml`) |
| `.hs` | Haskell | Flow | R | R | R | R | R | R | R | U | `tree-sitter-haskell@0.23.1` |

**Manifest check:** 33 rows, 33 unique extensions, no extra structural extension. This is a planned contract; Execute must compare it mechanically with the source constant.

## Required Symbol Kinds

Every programming-language query pack maps applicable declarations into the additive normalized set:

`module`, `namespace`, `class`, `interface`, `trait`, `enum`, `function`, `method`, `constructor`, `property`, `field`, `variable`, `constant`, `type`, `type_parameter`, `export`, `heading`, `key`.

Applicability is grammar-defined. A pack must not synthesize an inapplicable kind merely to fill the taxonomy. Markdown requires `heading`; JSON/YAML require `key`.

## Edge Rules

- `call`: invocation nodes only; declarations and specialized-edge duplicates are excluded.
- `data_flow`: bare identifier arguments with zero-based parameter position.
- `type_ref`, `extend`, `implement`, `import`: corresponding syntax constructs only.
- `http_call`: URL-literal calls or the current normalized HTTP-client vocabulary.
- `emit`: terminal call name `emit`.
- `listen`: terminal call name `on`, `once`, `addListener`, `addEventListener`, `off`, or `removeListener`.
- Unsupported capabilities produce no placeholder/unresolved edge. Required but unresolved targets retain a stable unresolved payload.

## Correctness Floors

For every `R` capability:

- Golden fixture recall: 100% of explicitly listed expected declarations/edges.
- Forbidden false positives: zero for every fixture's declared negatives.
- Duplicate normalized nodes: zero after `(kind, qualifiedName, host span, target)` suppression.
- Transport-visible names, kinds, spans, targets, and ambiguity candidates must match exact expected values.

Broad-language benchmark measurements are informative; TS/JS performance thresholds remain gating.

## Native Feasibility Evidence

TASK-001 audited and exercised the exact selected native set on macOS arm64. Every direct native package uses `install: node-gyp-build`; only these direct packages were trusted for lifecycle execution. The runtime accepts language ABI 13 through 15. The peer ranges below are the package-declared ranges; measured ABI compatibility and a successful parse are authoritative where an older range emitted a warning.

| Artifact pin | Source / license | Peer / measured ABI | Integrity identity | macOS arm64 result |
| --- | --- | --- | --- | --- |
| `tree-sitter@0.25.0` | `tree-sitter/node-tree-sitter` / MIT | runtime ABI 13-15 | npm SRI ledger | PASS: clean install, load, link |
| `tree-sitter-javascript@0.25.0` | `tree-sitter/tree-sitter-javascript` / MIT | `^0.25.0` / 15 | npm SRI ledger | PASS |
| `tree-sitter-typescript@0.23.2` | `tree-sitter/tree-sitter-typescript` / MIT | `^0.21.0` / 14 | npm SRI ledger | PASS: TypeScript and TSX exports |
| `tree-sitter-python@0.25.0` | `tree-sitter/tree-sitter-python` / MIT | `^0.25.0` / 15 | npm SRI ledger | PASS |
| `tree-sitter-ruby@0.23.1` | `tree-sitter/tree-sitter-ruby` / MIT | `^0.21.1` / 14 | npm SRI ledger | PASS |
| `tree-sitter-php@0.24.2` | `tree-sitter/tree-sitter-php` / MIT | `^0.22.4` / 15 | npm SRI ledger | PASS: PHP and PHP-only exports |
| `@tree-sitter-grammars/tree-sitter-lua@0.4.1` | `tree-sitter-grammars/tree-sitter-lua` / MIT | `^0.22.4` / 15 | npm SRI ledger | PASS |
| `tree-sitter-c@0.24.1` | `tree-sitter/tree-sitter-c` / MIT | `^0.22.4` / 15 | npm SRI ledger | PASS |
| `tree-sitter-cpp@0.23.4` | `tree-sitter/tree-sitter-cpp` / MIT | `^0.21.1` / 14 | npm SRI ledger | PASS |
| `tree-sitter-go@0.25.0` | `tree-sitter/tree-sitter-go` / MIT | `^0.25.0` / 15 | npm SRI ledger | PASS |
| `tree-sitter-rust@0.24.0` | `tree-sitter/tree-sitter-rust` / MIT | `^0.22.1` / 15 | npm SRI ledger | PASS |
| `@tree-sitter-grammars/tree-sitter-zig@1.1.2` | `tree-sitter-grammars/tree-sitter-zig` / MIT | `^0.22.1` / 14 | npm SRI ledger | PASS |
| `tree-sitter-java@0.23.5` | `tree-sitter/tree-sitter-java` / MIT | `^0.21.1` / 14 | npm SRI ledger | PASS |
| `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` | `tree-sitter-grammars/tree-sitter-kotlin` / MIT | `^0.22.4` / 14 | npm SRI ledger | PASS |
| `tree-sitter-scala@0.24.0` | `tree-sitter/tree-sitter-scala` / MIT | `^0.21.1` / 14 | npm SRI ledger | PASS |
| `tree-sitter-c-sharp@0.23.5` | `tree-sitter/tree-sitter-c-sharp` / MIT | `^0.25.0` / 15 | npm SRI ledger | PASS |
| `tree-sitter-swift@0.7.1` | `alex-pinkus/tree-sitter-swift` / MIT | `^0.22.1` / 14 | npm SRI ledger | PASS |
| `UserNobody14/tree-sitter-dart#be07cf7118d3dba06236a3f19541685a68209934` | `UserNobody14/tree-sitter-dart` / ISC | `^0.25.0` / 15 | exact Git commit | PASS |
| `tree-sitter-elixir@0.3.5` | `elixir-lang/tree-sitter-elixir` / Apache-2.0 | `^0.21.0` / 14 | npm SRI ledger | PASS |
| `WhatsApp/tree-sitter-erlang#836aa2b6c3af2c7cef3f84049b0ed6d44485a870` | `WhatsApp/tree-sitter-erlang` / Apache-2.0 | `^0.22.4` / 14 | exact Git commit | PASS |
| `tree-sitter-clojure-orchard@0.2.5` | `codeberg.org/grammar-orchard/tree-sitter-clojure-orchard` / CC0 | `^0.25.0` / 14 | npm SRI ledger | PASS |
| `tree-sitter-ocaml@0.24.2` | `tree-sitter/tree-sitter-ocaml` / MIT | `^0.22.4` / 14 | npm SRI ledger | PASS: OCaml and interface dialect exports |
| `tree-sitter-haskell@0.23.1` | `tree-sitter/tree-sitter-haskell` / MIT | `^0.21.1` / 14 | npm SRI ledger | PASS |
| `tree-sitter-html@0.23.2` | `tree-sitter/tree-sitter-html` / MIT | `^0.21.1` / 14 | npm SRI ledger | PASS: Vue SFC host |
| `@tree-sitter-grammars/tree-sitter-markdown@0.3.2` | `tree-sitter-grammars/tree-sitter-markdown` / MIT | `^0.21.1` / 14 | npm SRI ledger | PASS: block and inline exports |
| `tree-sitter-json@0.24.8` | `tree-sitter/tree-sitter-json` / MIT | `^0.21.1` / 14 | npm SRI ledger | PASS |
| `@tree-sitter-grammars/tree-sitter-yaml@0.7.1` | `tree-sitter-grammars/tree-sitter-yaml` / MIT | `^0.22.4` / 14 | npm SRI ledger | PASS |

### npm Integrity Ledger

The exact Git commits above are their integrity identities. All npm artifacts were resolved into the frozen `bun.lock`; their registry SHA-512 identities are:

| Artifact | SHA-512 SRI |
| --- | --- |
| `tree-sitter@0.25.0` | `sha512-PGZZzFW63eElZJDe/b/R/LbsjDDYJa5UEjLZJB59RQsMX+fo0j54fqBPn1MGKav/QNa0JR0zBiVaikYDWCj5KQ==` |
| `tree-sitter-javascript@0.25.0` | `sha512-1fCbmzAskZkxcZzN41sFZ2br2iqTYP3tKls1b/HKGNPQUVOpsUxpmGxdN/wMqAk3jYZnYBR1dd/y/0avMeU7dw==` |
| `tree-sitter-typescript@0.23.2` | `sha512-e04JUUKxTT53/x3Uq1zIL45DoYKVfHH4CZqwgZhPg5qYROl5nQjV+85ruFzFGZxu+QeFVbRTPDRnqL9UbU4VeA==` |
| `tree-sitter-python@0.25.0` | `sha512-eCmJx6zQa35GxaCtQD+wXHOhYqBxEL+bp71W/s3fcDMu06MrtzkVXR437dRrCrbrDbyLuUDJpAgycs7ncngLXw==` |
| `tree-sitter-ruby@0.23.1` | `sha512-d9/RXgWjR6HanN7wTYhS5bpBQLz1VkH048Vm3CodPGyJVnamXMGb8oEhDypVCBq4QnHui9sTXuJBBP3WtCw5RA==` |
| `tree-sitter-php@0.24.2` | `sha512-zwgAePc/HozNaWOOfwRAA+3p8yhuehRw8Fb7vn5qd2XjiIc93uJPryDTMYTSjBRjVIUg/KY6pM3rRzs8dSwKfw==` |
| `@tree-sitter-grammars/tree-sitter-lua@0.4.1` | `sha512-EwagFaU6ZveVk18/Y8qUhZkkiBKnQ7dSCHbm//TUroLVKy3i1rOYGy/cNHtSkAb1eDvS1HhCLybH2S541Cya/g==` |
| `tree-sitter-c@0.24.1` | `sha512-lkYwWN3SRecpvaeqmFKkuPNR3ZbtnvHU+4XAEEkJdrp3JfSp2pBrhXOtvfsENUneye76g889Y0ddF2DM0gEDpA==` |
| `tree-sitter-cpp@0.23.4` | `sha512-qR5qUDyhZ5jJ6V8/umiBxokRbe89bCGmcq/dk94wI4kN86qfdV8k0GHIUEKaqWgcu42wKal5E97LKpLeVW8sKw==` |
| `tree-sitter-go@0.25.0` | `sha512-APBc/Dq3xz/e35Xpkhb1blu5UgW+2E3RyGWawZSCNcbGwa7jhSQPS8KsUupuzBla8PCo8+lz9W/JDJjmfRa2tw==` |
| `tree-sitter-rust@0.24.0` | `sha512-NWemUDf629Tfc90Y0Z55zuwPCAHkLxWnMf2RznYu4iBkkrQl2o/CHGB7Cr52TyN5F1DAx8FmUnDtCy9iUkXZEQ==` |
| `@tree-sitter-grammars/tree-sitter-zig@1.1.2` | `sha512-J0L31HZ2isy3F5zb2g5QWQOv2r/pbruQNL9ADhuQv2pn5BQOzxt80WcEJaYXBeuJ8GHxVT42slpCna8k1c8LOw==` |
| `tree-sitter-java@0.23.5` | `sha512-Yju7oQ0Xx7GcUT01mUglPP+bYfvqjNCGdxqigTnew9nLGoII42PNVP3bHrYeMxswiCRM0yubWmN5qk+zsg0zMA==` |
| `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` | `sha512-vlVXaxEE8t2kpJgfZpa8XVvxcnKw9AYtRTgy7KWjsDmAsadk06RxAT80IXOgGQnmM9i/orQn1nD84gPNUHu6DQ==` |
| `tree-sitter-scala@0.24.0` | `sha512-vkMuAUrBZ1zZz2XcGDQk18Kz73JkpgaeXzbNVobPke0G35sd9jH32aUxG6OLRKM7et0TbsfqkWf4DeJoGk4K1g==` |
| `tree-sitter-c-sharp@0.23.5` | `sha512-xJGOeXPMmld0nES5+080N/06yY6LQi+KWGWV4LfZaZe6srJPtUtfhIbRSN7EZN6IaauzW28v6W4QHFwmeUW6HQ==` |
| `tree-sitter-swift@0.7.1` | `sha512-pneKVTuGamaBsqqqfB9BvNQjktzh/0IVPR54jLB5Fq/JTDQwYHd0Wo6pVyZ5jAYpbztzq+rJ/rpL9ruxTmSoKw==` |
| `tree-sitter-elixir@0.3.5` | `sha512-xozQMvYK0aSolcQZAx2d84Xe/YMWFuRPYFlLVxO01bM2GITh5jyiIp0TqPCQa8754UzRAI7A83hZmfiYub5TZQ==` |
| `tree-sitter-clojure-orchard@0.2.5` | `sha512-X+JaSnqY9hNYDA/hsQ40My47qoG+J26y11VAZ4YUzH3u8ggs+b9sFRQuxE6pNnlgwqWtJUycxnB0cOomtOIvAw==` |
| `tree-sitter-ocaml@0.24.2` | `sha512-H0RAeCepIyXyTPCQra6yMd7Bn5ZBYkIaddzdLNwVZpM9mCe2e8av+3O6Ojl7Z8YHrV/kYsfHvI2y+Hh7qzcYQQ==` |
| `tree-sitter-haskell@0.23.1` | `sha512-qG4CYhejveu9DLMLEGBz/n9/TTeGSFLC6wniwOgG6m8/v7Dng8qR0ob0EVG7+XH+9WiOxohpGA23EhceWuxY4w==` |
| `tree-sitter-html@0.23.2` | `sha512-TN+l+7cCeLx9db/1RhRSqMAZO/266Oh2BHb8J8hMSSFLuzYvFTYP/UnD3S0mny5awzw05KzFNgu2vnwzN9wVJg==` |
| `@tree-sitter-grammars/tree-sitter-markdown@0.3.2` | `sha512-hQXCcDVvg2t4E8cn7zz6jjIBerzk9E9ZlHxJp5IrUOpY4s1YVpXJbMeWZks2/V7lmkPRnnkM8IrTbQ5ltwEOnA==` |
| `tree-sitter-json@0.24.8` | `sha512-Tc9ZZYwHyWZ3Tt1VEw7Pa2scu1YO7/d2BCBbKTx5hXwig3UfdQjsOPkPyLpDJOn/m1UBEWYAtSdGAwCSyagBqQ==` |
| `@tree-sitter-grammars/tree-sitter-yaml@0.7.1` | `sha512-AynBwkIoQCTgjDR33bDUp9Mqq+YTco0is3n5hRApMqG9of/6A4eQsfC1/uSEeHSUyMQSYawcAWamsexnVpIP4Q==` |

### TASK-001 Gate Evidence (2026-07-13)

| Sensor | Result |
| --- | --- |
| Runtime ladder | Exact Bun 1.2.0 failed the native gate; exact Bun 1.3.0 is the lowest tested 1.3.x candidate and passed. Both official `bun-darwin-aarch64.zip` SHA-256 values matched their release `SHASUMS256.txt`. |
| Selected target | Darwin arm64; macOS `26.5.2` (`25F84`); exact Bun `1.3.0`, Mach-O arm64. Exact Node `22.22.2` arm64 was the pinned native build helper. |
| Frozen install | Fresh project and cache; `bun install --frozen-lockfile` installed 37 packages in 8.58 seconds. The only blocked transitive lifecycle was unused `tree-sitter-cli@0.23.2`; every direct native lifecycle ran. |
| Load and parse | 27 native modules loaded; 33/33 manifest extensions parsed twice, every root consumed the complete UTF-8 input and had `hasError=false`. |
| Native linkage | Every loaded `.node` was a Mach-O 64-bit arm64 bundle. The 29-file inventory, including two nested duplicate artifacts, linked only to `/usr/lib/libc++.1.dylib` and `/usr/lib/libSystem.B.dylib`. |
| Negative sensors | Missing package detected; rejected legacy Vue binding ABI 127 detected against Bun 1.3.0 ABI 137. Both sensors passed. |
| Fallback prohibition | No WASM grammar, runtime download, or post-install binary download was used. |

Exact Bun 1.3.0 needs a serialized startup compatibility loader: save `process.versions.bun`, temporarily remove that configurable marker while loading unmodified `node-gyp-build` fallbacks, and restore the exact descriptor before parsing. The gate proved exact restoration to `1.3.0`; TASK-004 owns this shim and its invariant tests.

Stock `tree-sitter@0.25.0` exposes no public disposal API. Repeated 32 KiB parses retained approximately 1 MiB RSS per parse under both exact Bun 1.3.0 and Node even after references left scope and forced GC; a 500-parse control grew by roughly 484 MiB. The repository-owned source-and-packaging patch (SHA-256 `b0f73d0031e70f3585fca701076e1c6a05c30968b62f2d939de32af6df39a06a`) adds idempotent cursor/tree deletion, cache-safe destructor sharing, stale-object guards, immutable SyntaxNode/TreeCursor owner identity, same-tree reset marshalling, cross-tree reset/resetTo rejection, and inclusion of the generated arm64 addon in bundled package artifacts. Its exact Node 22.22.2 arm64 prototype made Tree, SyntaxNode, Query, incremental old-tree, and TreeCursor post-delete operations throw deterministically; neither public owner assignment nor cursor transfer can substitute another tree. A 500 explicit-delete-cycle run grew by less than 2 MiB after warm-up. The frozen runtime identity is the upstream npm SRI plus this patch checksum. The core package bundles that patched dependency for packed consumers.

The acceptance stress uses 100 explicit-delete cycles with `Bun.gc(true)` after each. Median RSS for cycles 81-100 may exceed cycles 21-40 by at most 16 MiB, and a separate no-delete child process must exceed that bound so the sensor discriminates a missing/no-op patch.

The production macOS arm64 parser pool freezes a default capacity of 4 and a hard maximum of 32 parser instances. Its FIFO acquisition timeout defaults to 5,000 ms with a 60,000 ms hard maximum. Constructor overrides inside those bounds are test/benchmark seams; timeout is an infrastructure failure and never an empty successful structure.

Packaging feasibility was proven from a clean exact-runtime build. Exact Node `22.22.2`/npm `10.9.7` packed shared and core; the core tarball contained `node_modules/tree-sitter/build/Release/tree_sitter_runtime_binding.node`. A normal non-workspace Bun `1.3.0` consumer installed the local shared/core tarballs, imported built core `dist`, resolved `tree-sitter` strictly from the core's nested bundled path, parsed JavaScript, and double-deleted the patched tree. The nested addon was a Mach-O 64-bit arm64 bundle linked only to system `libc++` and `libSystem`. Bun `1.3.0` packing was rejected for this artifact because its tarball omitted both `bundledDependencies` and `bundleDependencies` payloads.

Rejected candidates are recorded rather than silently substituted: legacy `tree-sitter-clojure@0.4.0` failed against current V8/NAN APIs; npm `tree-sitter-dart@1.0.0` and `tree-sitter-vue@0.2.1` carry native ABI 127 while Bun 1.3.0 requires ABI 137. The selected replacements are Clojure Orchard, the exact canonical Dart Git commit, and HTML as the Vue SFC host.

## Out-of-Manifest Extensions

An extension allowed by `security.allowedExtensions` but absent above remains eligible for semantic chunking/search. Structural status is `unsupported_structural_language`; symbols/imports/references are empty by contract; parser readiness remains healthy; regex extraction is forbidden.

## Artifact Store Evidence

- Active key: `.specs/features/multi-language-tree-sitter-breadth/capability-matrix.md`
- Version: 4 (TASK-001 macOS arm64 native gate PASS)
- Checksum: recorded in `gate-manifest.md` after artifact freeze.

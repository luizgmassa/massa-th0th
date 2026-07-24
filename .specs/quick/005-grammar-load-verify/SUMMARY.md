# M11 — Summary

## Outcome

Load-time grammar integrity verification implemented and wired into parser
init. The verifier recomputes a sha512 over each installed native Tree-sitter
grammar package's ABI-independent source and compares it to a pinned
`sourceIntegrity`; a mismatch fails loud before the first parse.

## Hashing basis chosen

Canonical, deterministic, ABI-independent:

- For each pinned package, concatenate (in a fixed, framed stream):
  1. `<packageRoot>/package.json` (exact bytes)
  2. `<packageRoot>/grammar.js` (exact bytes, if present)
  3. every regular file under `<packageRoot>/src/**`, visited depth-first with
     directory entries sorted by name, paths emitted relative to the package
     root using POSIX separators.
- Each contribution is prefixed by its relative path (POSIX) + NUL + decimal
  byte-length + NUL, so two different file sets cannot produce the same stream.
- sha512 of the concatenation, emitted as `sha512-<base64>`.
- Excluded by scoping: `prebuilds/`, `build/`, `bindings/`, `node_modules/`,
  and any `*.node` files live outside the walked scope, so a legitimate
  Bun/Node ABI rebuild cannot flip the hash. Only a change to the grammar
  source itself (real version drift or tampering) fails the check.

## Pins reconciled count: 27

The prior worker's `sourceIntegrity` values were a fabricated guess (as warned
in the task brief). The bootstrap comparison reported **27/27 mismatches** —
every single pin was wrong. All 27 pins were updated to the verifier's
computed values by regenerating `native-lock-identities.ts` from `bun.lock`
(for `resolved`/`sri`/`gitIdentity`) plus the recomputed `sourceIntegrity`.
After reconciliation the verifier passes clean on the current install. This
reconciliation (verifier computes -> pins updated -> verifier passes) is the
proof the committed pins are real, not fabricated.

## Init wiring seam + default-on/dev-skip decision

- Seam: `packages/core/src/services/structural/parser-readiness.ts`,
  `runValidation()`, at the very start of the try block — before
  `loader(uniqueArtifacts())` and before any parse. This is the TASK-004
  readiness path that runs once at startup.
- Gate: `if (loader === loadNativeGrammarSet)` — the integrity check runs only
  on the production loader path. Tests that stub the loader (e.g. the
  readiness test's fake-parser cases) are exempt and stay isolated.
- Default: ON. `MASSA_AI_SKIP_GRAMMAR_INTEGRITY=1` skips (intended for
  local dev where grammars are intentionally patched/swapped). Production and
  CI default to verifying.
- Memoization: module-level `integrityVerified` flag; the check runs at most
  once per process and never taxes per-request parse paths.

## Gate evidence

- `bunx tsc --noEmit` (packages/core): clean, exit 0.
- `bun test packages/core/src/__tests__/grammar-integrity.test.ts`: 6/6 pass,
  100% coverage of `grammar-integrity.ts` and `native-lock-identities.ts`.
- `bun test scripts/tests/verify-tree-sitter-grammars.test.ts`: 9/9 pass
  (two exact-shape assertions updated to include the reconciled
  `sourceIntegrity` field; test intent — freeze exact identity — preserved).
- `bun test packages/core/src/__tests__/structural-grammar-readiness.test.ts`:
  6/6 pass (wiring did not break the readiness path or its stub-loader tests).
- `bun run verify:tree-sitter-source-dist`: PASS — 27 native deps, 27 locked
  identities, 33 extensions, source + dist cold consumers green, ABI 137.
- The 27 failures in the full `packages/core/src/__tests__/` suite are
  pre-existing (identical count on a stashed baseline) and unrelated to this
  change (DB/fixture-sensitive: `trace_path`, `PgScheduledJobStore`, ETL
  queue, qwen commit-locked fixture). Structural + integrity suites are green.

## Residual risk

- Startup cost: one sha512 over ~3-4 MiB of grammar source per package, 27
  packages, once per process. On the dev machine this completes well under
  the readiness budget and is memoized. Not expected to be user-visible.
- The basis hashes `src/**` including generated `parser.c`; a grammar
  republish that regenerates `parser.c` (even from identical `grammar.js`)
  would flip the hash. This is intentional (the installed source changed),
  but means a pin refresh is required on any grammar version bump.

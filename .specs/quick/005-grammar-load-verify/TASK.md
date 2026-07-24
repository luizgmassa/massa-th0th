# M11 — Load-Time Grammar Integrity Verification

Intent: detect a tampered, patched, or wrong-version native Tree-sitter grammar
installed into `node_modules` AFTER the lockfile verifier has run, by
recomputing a hash over each installed package's ABI-independent source at
parser init and comparing it to a pinned `sourceIntegrity`. A mismatch fails
loud before the first parse, so a corrupted grammar can never silently produce
wrong structural output.

## Acceptance

- New module
  `packages/core/src/services/structural/grammar-integrity.ts` exporting:
  - `class GrammarIntegrityError extends Error` carrying
    `{ pkg, expected, actual }` and `code = "GRAMMAR_INTEGRITY_MISMATCH"`.
  - `verifyNativeGrammarIntegrity()` that recomputes the source hash for each
    entry in `NATIVE_LOCK_IDENTITIES`, compares to the pinned value, and
    throws `GrammarIntegrityError` on mismatch.
- Canonical ABI-independent hashing basis defined and documented in the module:
  concat of `package.json` + root `grammar.js` + `src/**` (sorted, deterministic,
  length-prefixed framing), sha512, emitted as `sha512-<base64>`. Compiled
  artifacts (`prebuilds/`, `build/`, `bindings/`, `*.node`) excluded so a
  legitimate Bun/Node ABI rebuild never flips the hash.
- Pins reconciled to computed values: the verifier MUST pass clean on the
  current install.
- Verify once per process (module-level memoization flag); never per-parse.
- Wired into parser init (`parser-readiness.ts` `runValidation`), before the
  first parse, on the production loader path only (test stub loaders exempt).
- Default ON. Dev-skip gated behind
  `MASSA_AI_SKIP_GRAMMAR_INTEGRITY=1` (defaults to verifying).
- Prior worker's uncommitted data extraction (`native-lock-identities.ts` +
  `verify-tree-sitter-grammars.ts` refactor) included in the same commit,
  with the extraction's compile bug fixed and its pins reconciled.

## Tests (deterministic, no network, no grammar download)

- `grammar-integrity.test.ts`:
  - verifier PASSES on the real current install (pins reconciled).
  - tampered pin (one byte flipped) -> throws `GrammarIntegrityError` with the
    right `pkg`/`expected`/`actual`.
  - `NATIVE_LOCK_IDENTITY_COUNT === Object.keys(NATIVE_DEPENDENCIES).length === 27`.
  - every registry pkg has `sri`, every git pkg has `gitIdentity`, all have
    `sourceIntegrity`.
- `scripts/tests/verify-tree-sitter-grammars.test.ts` still green.

## Gate

- `bunx tsc --noEmit` clean (core).
- `bun test scripts/tests/verify-tree-sitter-grammars.test.ts` green.
- `bun run verify:tree-sitter-source-dist` PASS (or env-blocked if no local
  grammars).

## Constraints

- Do NOT weaken or delete existing tests. Do NOT change the offline script's
  observable behavior.
- One atomic commit including the prior worker's extraction + this addition.

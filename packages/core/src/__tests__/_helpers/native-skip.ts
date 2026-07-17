import { describe } from "bun:test";

/**
 * Native Tree-sitter structural artifacts are built and loadable only on the
 * macOS arm64 target (see services/structural/grammar-loaders.ts
 * `assertRuntimeTarget`). Tests that exercise the real native grammars would
 * throw on any other platform, so they are skipped (not hidden) here.
 *
 * On the darwin-arm64 CI job these suites run normally; everywhere else they
 * report as skipped, keeping the default `bun run test` green on Linux.
 */
export const isNativeTarget =
  process.platform === "darwin" && process.arch === "arm64";

/** `describe` that runs only where native Tree-sitter artifacts load. */
export const describeNative = describe.skipIf(!isNativeTarget);

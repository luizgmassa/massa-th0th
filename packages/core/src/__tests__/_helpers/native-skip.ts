import { describe } from "bun:test";

/**
 * Native Tree-sitter structural artifacts are built and loadable on the
 * macOS arm64 and Linux glibc x64 targets (see services/structural/grammar-loaders.ts
 * `assertRuntimeTarget`). Tests that exercise the real native grammars would
 * throw on any other platform, so they are skipped (not hidden) here.
 *
 * On a darwin-arm64 or linux-x64 CI job these suites run normally; everywhere
 * else they report as skipped, keeping the default `bun run test` green on
 * unsupported platforms.
 */
export const isNativeTarget =
  (process.platform === "darwin" && process.arch === "arm64") ||
  (process.platform === "linux" && process.arch === "x64");

/** `describe` that runs only where native Tree-sitter artifacts load. */
export const describeNative = describe.skipIf(!isNativeTarget);

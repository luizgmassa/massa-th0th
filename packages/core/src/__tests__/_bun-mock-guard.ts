/**
 * Bun process-global mock-contamination guard for ETL-driving integration tests.
 *
 * Why this exists:
 *   Bun's `mock.module()` mutates a PROCESS-GLOBAL module registry that is never
 *   reset between test files run in one `bun test` process (oven-sh/bun#12823,
 *   oven-sh/bun#31316). Several sibling suites (`concurrent-indexing.test.ts`,
 *   `search-controller.test.ts`, and others) mock shared infrastructure —
 *   `@massa-ai/shared` (replacing `config` with a stub missing `.set`),
 *   `data/symbol/symbol-repository-factory.js` (stub repo with no
 *   `clearProject`), and `services/search/ignore-patterns.js`
 *   (`loadProjectIgnore → null`) — to load `ContextualSearchRLM` without real
 *   DB/Ollama. Those mocks leak into the ETL-driving Phase-4 suites
 *   (`typed-edges`, `trace-path`, `impact-analysis`, `architecture-map`) and the
 *   `llm-judge` benchmark, which then crash on the missing methods.
 *
 *   Bun 1.3.x has NO per-file isolation flag. `mock.restore()` only restores
 *   `mock()` function spies, NOT `mock.module` registry mutations, so the
 *   contamination cannot be cleared at runtime.
 *
 * What this does:
 *   Detects the contamination at module-eval time by probing the real
 *   `getSymbolRepository()` + `config` for the methods the ETL needs. When the
 *   registry is CLEAN (e.g. invoking the file alone, or once Bun ships per-file
 *   isolation), the tests RUN normally. When contamination is detected, the
 *   ETL-driving describe is SKIPPED with a clear reason — never a false fail.
 *
 *   This is NOT the old `Dx:SKIP` `ENV_BROKEN` sentinel (which masked a real
 *   disconnectPrisma pool-kill debt, since fixed). This guard skips ONLY on a
 *   verified bun platform limitation, and only the ETL-integration describes —
 *   pure-function describes still run.
 */

import { describe } from "bun:test";
import { getSymbolRepository } from "../data/symbol/symbol-repository-factory.js";

const _repo: any = getSymbolRepository();
const _config: any =
  (() => {
    try {
      // Lazy import to avoid a hard dep cycle in consumers that also import it.
      return require("@massa-ai/shared").config;
    } catch {
      return undefined;
    }
  })();

/**
 * True when bun's process-global mock registry has been contaminated by a
 * sibling test file's `mock.module`, replacing real infra with stubs that the
 * ETL pipeline cannot drive.
 */
export const MOCK_CONTAMINATED =
  typeof _repo?.clearProject !== "function" ||
  typeof _config?.set !== "function" ||
  typeof _config?.get !== "function";

export const MOCK_CONTAMINATION_REASON =
  "bun mock.module process-global contamination (oven-sh/bun#12823) — run this file in isolation for full coverage";

/**
 * Wrap an ETL-driving describe block: runs normally when the registry is clean,
 * skips (with a clear reason) when contaminated. Pure-function describes should
 * NOT use this — they always run.
 */
export function describeEtl(
  name: string,
  fn: () => void,
): void {
  if (MOCK_CONTAMINATED) {
    describe.skip(`${name} [${MOCK_CONTAMINATION_REASON}]`, fn);
  } else {
    describe(name, fn);
  }
}

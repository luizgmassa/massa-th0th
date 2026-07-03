/**
 * Synapse — cognitive modulation layer over retrieval.
 *
 * Public API. Every export here is safe to consume from anywhere in core
 * or from the tools-api. Submodules should be imported from this barrel.
 */

import { config as runtimeConfig } from "@massa-th0th/shared";
import { SynapseManager } from "./synapse-manager.js";

export { SynapseManager } from "./synapse-manager.js";
export * from "./types.js";
export * from "./inhibition/index.js";
export * from "./metacognition/index.js";
export * from "./scoring/index.js";
export * from "./session/index.js";
export * from "./buffer/index.js";
export * from "./plasticity/index.js";
export * from "./prefetch/index.js";

let cachedManager: SynapseManager | null = null;

/**
 * Lazy singleton — reads from the global runtime config.
 * If `synapse.enabled` is false, callers still get a valid manager whose
 * `process()` returns inputs unchanged (no extra allocations).
 */
export function getSynapseManager(): SynapseManager {
  if (!cachedManager) {
    cachedManager = new SynapseManager(runtimeConfig.get("synapse"));
  }
  return cachedManager;
}

/** Test hook — drop the cached instance so the next getter rebuilds from config. */
export function resetSynapseManager(): void {
  cachedManager = null;
}

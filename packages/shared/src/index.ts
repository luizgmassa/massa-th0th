/**
 * @massa-th0th/shared - Tipos, utilitários e configuração compartilhados
 */

// Environment loader
export { ENV_LOADED } from "./env.js";

// Types
export * from "./types/index.js";
export * from "./types/interfaces.js";

// Utils
export * from "./utils/index.js";

// Config
export {
  Config,
  config,
  defaultConfig,
  type ServerConfig,
  type SynapseRuntimeConfig,
  type DecayParams,
  DEFAULT_ALLOWED_EXTENSIONS,
} from "./config/index.js";

/**
 * Environment Configuration Loader
 *
 * MUST be imported first before any other modules
 * to ensure .env variables are loaded before config initialization.
 *
 * Walks up from cwd to find the nearest .env file,
 * supporting monorepo layouts where packages run from subdirectories.
 */

import { config as dotenvConfig } from "dotenv";
import { existsSync } from "fs";
import { resolve, dirname } from "path";

function findEnvFile(): string | undefined {
  let dir = process.cwd();

  while (true) {
    const envPath = resolve(dir, ".env");
    if (existsSync(envPath)) {
      return envPath;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return undefined;
}

// Load .env file - walk up directories to find it (monorepo support)
const envPath = findEnvFile();
dotenvConfig({ path: envPath });

/**
 * Seed process.env from config.json (best-effort, never throws).
 *
 * Precedence at runtime: explicit env var (set above by dotenv or the caller)
 * WINS over config.json. config.json only fills values the env does NOT set.
 * This makes config.json the source of truth for secrets (DATABASE_URL, LLM
 * API keys, embedding key) while keeping `.env` overrides authoritative.
 *
 * Deferred via require() to avoid a circular static import: config-loader ->
 * massa-ai-config -> (this module's consumers). The require happens at
 * module-eval time (still before any config/index.ts consumer reads env),
 * which is what matters for Prisma/LLM clients that read process.env lazily.
 */
try {
  // require() avoids the TS import-elision and keeps this side-effecting path
  // out of the static dependency graph.
  const { loadConfigSafe, migrateDataDirOnce } =
    require("./config/config-loader") as typeof import("./config/config-loader");

  // One-time legacy data-dir migration BEFORE any consumer resolves dataDir.
  migrateDataDirOnce();

  const cfg = loadConfigSafe();

  if (cfg.database?.url && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = cfg.database.url;
  }
  if (cfg.llm?.apiKey && !process.env.RLM_LLM_API_KEY) {
    process.env.RLM_LLM_API_KEY = cfg.llm.apiKey;
  }
  if (cfg.embedding?.apiKey && !process.env.OLLAMA_API_KEY) {
    // Embedding provider key — OLLAMA_API_KEY is the ollama-agnostic home for
    // an embedding auth token; only seed when the env var is unset.
    process.env.OLLAMA_API_KEY = cfg.embedding.apiKey;
  }
} catch {
  // Defensive: config.json is a best-effort layer; missing/invalid file or
  // any loader error must never abort startup.
}

// Export a dummy value to ensure this module is imported
export const ENV_LOADED = true;

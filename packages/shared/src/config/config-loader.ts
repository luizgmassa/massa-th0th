import fs from "fs";
import path from "path";
import os from "os";
import { MassaAiConfig, defaultMassaAiConfig } from "./massa-ai-config";
import { configDir } from "./xdg";

const CONFIG_DIR = configDir("massa-ai");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function loadConfig(): MassaAiConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return defaultMassaAiConfig;
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8");
    const userConfig = JSON.parse(content);

    return {
      ...defaultMassaAiConfig,
      ...userConfig,
      database: { ...defaultMassaAiConfig.database, ...userConfig.database },
      embedding: { ...defaultMassaAiConfig.embedding, ...userConfig.embedding },
      compression: { ...defaultMassaAiConfig.compression, ...userConfig.compression },
      cache: { ...defaultMassaAiConfig.cache, ...userConfig.cache },
      logging: { ...defaultMassaAiConfig.logging, ...userConfig.logging },
      search: { ...defaultMassaAiConfig.search, ...userConfig.search },
      llm: { ...defaultMassaAiConfig.llm, ...userConfig.llm },
      memory: { ...defaultMassaAiConfig.memory, ...userConfig.memory },
      hooks: { ...defaultMassaAiConfig.hooks, ...userConfig.hooks },
      handoffs: { ...defaultMassaAiConfig.handoffs, ...userConfig.handoffs },
    };
  } catch (error) {
    console.error(`Error loading config from ${CONFIG_FILE}:`, error);
    return defaultMassaAiConfig;
  }
}

/**
 * Never-throwing wrapper around {@link loadConfig}. Returns the defaults on any
 * error (missing/invalid file, JSON parse failure, FS error). Used by env.ts
 * and config/index.ts where config.json is a best-effort middle-precedence
 * layer and must never abort startup.
 */
export function loadConfigSafe(): MassaAiConfig {
  try {
    return loadConfig();
  } catch {
    return defaultMassaAiConfig;
  }
}

/**
 * One-time, idempotent data-directory migration from the legacy location
 * (`~/.massa-ai-data/`) to the unified XDG config home
 * (`~/.config/massa-ai/data/`). Atomic `rename` on the same volume; a
 * cross-volume move fails rename and surfaces a clear manual-move error.
 *
 * GUARDS (never runs twice, never overwrites, never throws):
 *  - skip if target already exists (already migrated, or user created it)
 *  - skip if source does not exist (nothing to migrate)
 *  - any throw is caught and logged; startup continues
 *
 * Run once at module load. Safe to call repeatedly.
 */
let migrationAttempted = false;
export function migrateDataDirOnce(): void {
  if (migrationAttempted) return;
  migrationAttempted = true;

  try {
    const oldDir = path.join(os.homedir(), ".massa-ai-data");
    const newDir = path.join(getConfigDir(), "data");

    if (fs.existsSync(newDir)) return; // already migrated / present
    if (!fs.existsSync(oldDir)) return; // nothing to migrate

    // Ensure parent of new dir exists, then atomic rename (same volume).
    fs.mkdirSync(path.dirname(newDir), { recursive: true });
    try {
      fs.renameSync(oldDir, newDir);
      console.warn(
        `[massa-ai] Migrated data directory: ${oldDir} -> ${newDir}`,
      );
    } catch (renameErr: any) {
      // Cross-volume (EXDEV) or permission failure: do NOT silently copy —
      // surface a clear manual instruction so the user controls the move.
      console.error(
        `[massa-ai] Could not move data directory ${oldDir} -> ${newDir} ` +
          `(rename failed: ${renameErr?.code || renameErr?.message}). ` +
          `Move it manually, e.g.:\n` +
          `  mv "${oldDir}" "${newDir}"`,
      );
    }
  } catch (err) {
    // Defensive: migration must never abort startup.
    console.error(`[massa-ai] Data directory migration skipped:`, err);
  }
}

export function saveConfig(config: MassaAiConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function initConfig(): void {
  if (!fs.existsSync(CONFIG_FILE)) {
    saveConfig(defaultMassaAiConfig);
    console.log(`Created default config at ${CONFIG_FILE}`);
  }
}

export function getConfigForEnv(): Record<string, string> {
  const config = loadConfig();
  const env: Record<string, string> = {};

  if (config.embedding.provider === "ollama") {
    env.OLLAMA_EMBEDDING_MODEL = config.embedding.model;
    env.OLLAMA_BASE_URL = config.embedding.baseURL || "http://localhost:11434";
    if (config.embedding.dimensions) {
      env.OLLAMA_EMBEDDING_DIMENSIONS = String(config.embedding.dimensions);
    }
  } else if (config.embedding.provider === "mistral") {
    env.MISTRAL_API_KEY = config.embedding.apiKey || "";
    env.MISTRAL_TEXT_EMBEDDING_MODEL = config.embedding.model;
  } else if (config.embedding.provider === "openai") {
    env.OPENAI_API_KEY = config.embedding.apiKey || "";
    env.OPENAI_EMBEDDING_MODEL = config.embedding.model;
  }

  env.LOG_LEVEL = config.logging.level;
  env.ENABLE_METRICS = String(config.logging.enableMetrics);

  return env;
}

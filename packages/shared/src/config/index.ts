/**
 * Configuration Management
 *
 * Centralized configuration for massa-ai Server
 *
 * Architecture:
 * - Global cache with projectId namespace (multi-tenant)
 * - All data isolated by project_id in the same PostgreSQL database
 * - Optimized for multiple projects with embedding reuse
 */

// Load environment variables FIRST before any config
import "../env.js";

import path from "path";
import { loadConfigSafe, getConfigDir } from "./config-loader";

/**
 * Default LLM model for NL/instruction-shaped sites. Pure-instruct (non-thinking)
 * so structured/free-text calls finish fast and never stall on a reasoning
 * channel (the qwen3 thinking-model 90s-timeout degrade). Single source of
 * truth — `llm-client.ts` falls back to this constant instead of a bare literal.
 * Override via RLM_LLM_MODEL.
 */
export const DEFAULT_LLM_MODEL = "qwen2.5:7b-instruct";

/**
 * Default LLM model for code-oriented sites (bootstrap summarization, reranker
 * verdict, code compression). Coder-tuned instruct model. Override via
 * RLM_LLM_CODE_MODEL.
 */
export const DEFAULT_LLM_CODE_MODEL = "qwen2.5-coder:7b";

export interface ServerConfig {
  // Server Info
  name: string;
  version: string;

  // Data Directory (global cache location)
  dataDir: string;

  // Cache Configuration (multi-tenant with projectId namespace)
  cache: {
    l1: {
      maxSize: number; // bytes
      defaultTTL: number; // seconds
    };
    l2: {
      maxSize: number;
      defaultTTL: number;
    };
    embedding: {
      maxAgeHours: number;
    };
  };

  // Search / Auto-Reindex Configuration
  search: {
    autoReindexMaxFiles: number;
    // Phase 2: query understanding (LLM rewrite + HyDE). Default-off,
    // silent-degrades. Consumers MUST treat the absence of this block as
    // "feature off" (original single-stream search path).
    queryUnderstanding: {
      enabled: boolean;
      hydeEnabled: boolean;
      cacheTtlMs: number;
      cacheMaxSize: number;
    };
    // Phase 7a: LLM-judge reranking on top of RRF + centrality. Default-off,
    // silent-degrades to RRF order. rerankWindow is the top-K re-scored.
    rerank: {
      enabled: boolean;
      rerankWindow: number;
    };
  };

  // Shared local-first LLM configuration (cross-cutting §1).
  // Consumed by consolidation (Phase 1), query rewrite (Phase 2),
  // compression (Phase 7), bootstrap (Phase 4), auto-improve (Phase 5).
  // Default-off; env RLM_LLM_ENABLED=true opts in. Ollama-local defaults.
  llm: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    /**
     * Default model for NL/instruction-shaped LLM sites (consolidation,
     * salience, query rewrite, handoff polish, etc.). Pure-instruct by default
     * so structured/free-text calls finish fast and never stall on a reasoning
     * channel. Override via RLM_LLM_MODEL.
     */
    model: string;
    /**
     * Model for code-oriented LLM sites (bootstrap summarization, reranker
     * verdict, code compression). Defaults to a coder-tuned instruct model.
     * Override via RLM_LLM_CODE_MODEL.
     */
    codeModel: string;
    temperature: number;
    maxOutputTokens: number;
    timeoutMs: number;
    disableThink: boolean;
  };

  // Memory-quality configuration (Phase 1).
  memory: {
    decay: DecayParams;
    // Bootstrap from repo (Phase 4). The service is default-on for scan +
    // rule-based seeding; the LLM-driven summarization inherits the top-level
    // `llm.enabled` gate and silent-degrades to rule-based seeds when off.
    bootstrap: {
      enabled: boolean;
      maxSeedMemories: number;
      centralityLimit: number;
      gitLogLimit: number;
      refreshEnabled: boolean;
    };
    // Auto-improvement loop (Phase 5, G7). Pattern detection is rule-based
    // (no LLM dep); LLM enrichment is optional and inherits the top-level
    // `llm.enabled` gate. Default auto-approve (reviewGate=false) with
    // logging; flip reviewGate=true for human-in-the-loop surfacing.
    autoImprove: {
      enabled: boolean;
      reviewGate: boolean;
      minObservations: number;
      minIntervalMs: number;
      maxWindow: number;
      minQueryHits: number;
      minFileHits: number;
      minFixHits: number;
    };
    // Phase 7b: auto importance/salience scoring on remember. When the caller
    // omits `importance` AND this is enabled AND the LLM is on, score 0..1 via
    // llmObject. Default-off; silent-degrades to 0.5 (the pre-7b default).
    autoImportance: {
      enabled: boolean;
    };
  };

  // Passive lifecycle capture (Phase 3). Ingestion is default-on (no LLM dep);
  // the LLM-driven consolidation bridge inherits the top-level `llm.enabled`
  // gate and silent-degrades to a no-op when the LLM is off.
  hooks: {
    enabled: boolean;
    maxPayloadBytes: number;
    queue: {
      maxPending: number;
    };
    bridge: {
      enabled: boolean;
      minObservations: number;
      minIntervalMs: number;
      maxWindow: number;
    };
  };

  // Cross-session handoffs (Phase 6, G2). The begin/accept/cancel primitive
  // has no LLM dependency; the optional summary-polish inherits the top-level
  // `llm.enabled` gate and silent-degrades to the caller-provided summary.
  handoffs: {
    enabled: boolean;
  };

  // Compression Configuration
  // The LLM connection fields live in the top-level `llm` block; only
  // compression-specific knobs (strategy/thresholds) live here.
  compression: {
    defaultStrategy: string;
    minTokensForCompression: number;
    targetCompressionRatio: number; // 0-1
    prompt?: string;
  };

  // Wave 5 FR-05 / N3: impact-analysis graph traversal options.
  impact: {
    /** When true, impact_analysis uses the recursive CTE (runBfsCteImpact)
     * instead of the TS reverse-import BFS. Default false (additive behind
     * flag; parity gated by impact-bfs-parity.test.ts per AD-W5-018). */
    bfsCteEnabled: boolean;
  };

  // Wave 5 FR-11 / N13: capture policy (bounded pure module). Optional —
  // when absent, the core pure module's DEFAULT_POLICY is used. Loaded +
  // validated at config load (denyUnknownFields, maxIgnorePatterns,
  // maxMatchWork).
  capturePolicy?: {
    rules: Array<{ pattern: string; disposition: "Keep" | "Drop" | "MetadataOnly" }>;
    maxMatchWork?: number;
    maxIgnorePatterns?: number;
  };

  // Wave 5 FR-12 / N9-ext: read_file path containment. Absolute paths must
  // resolve under the project root (projectPath arg), cwd, or an explicit
  // colon-separated allowlist. Outside → teaching error listing valid roots
  // (no host path enumeration). Project root + cwd are ALWAYS allowed.
  readFile: {
    /** Colon-separated absolute paths; empty string → no extra roots. */
    extraRoots: string[];
  };

  // Wave 5 FR-18 / N16: server-side revalidation of client filter hints.
  // search-controller.filterByPatterns caps include+exclude patterns,
  // validates glob syntax, and emits filter_downgrades on contradiction.
  filterValidation: {
    /** Max include.length + exclude.length. Default 32. */
    maxFilterPatterns: number;
  };

  // Rate Limiting
  rateLimit: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };

  // Security
  security: {
    maxInputLength: number;
    sanitizeInputs: boolean;
    maxFileSize: number;
    maxIndexSize: number;
    allowedExtensions: string[];
    excludePatterns: string[];
  };

  // Logging
  logging: {
    level: "debug" | "info" | "warn" | "error";
    enableMetrics: boolean;
  };

  // Synapse — cognitive modulation layer (focus, retention, prioritization, speed).
  // Mirrored from MassaAiConfig so runtime services have a uniform access point.
  synapse: SynapseRuntimeConfig;
}

export interface SynapseRuntimeConfig {
  enabled: boolean;
  inhibition: {
    diversityPenalty: {
      enabled: boolean;
      threshold: number;
      lambda: number;
      samePathPenalty?: number;
    };
    temporalInhibition: {
      enabled: boolean;
      penaltyAgeMs: number;
      penalty: number;
    };
    confidenceGate: {
      enabled: boolean;
      thresholds: { specific: number; focused: number; broad: number };
    };
    chainInhibition: {
      enabled: boolean;
      boosts?: Record<string, Record<string, number>>;
    };
  };
  scoring: {
    attention: {
      enabled: boolean;
      rerankWindow: number;
      recencyHalfLifeMs: number;
      semanticScale: number;
      weights: {
        semantic: number;
        recency: number;
        accessHeat: number;
        taskAlign: number;
        agentAffinity: number;
        confidence: number;
      };
    };
  };
  metacognition: {
    enabled: boolean;
    lowConfidenceThreshold: number;
    definitiveTopScore: number;
    definitiveGap: number;
  };
  buffer: {
    enabled: boolean;
    maxSize: number;
    ttlMs: number;
    hitBoost: number;
    matchThreshold: number;
  };
}

/** Read an env var as a number; falls back to `fallback` when unset, empty, or non-finite. */
function envNum(key: string, fallback: number): number {
  const s = process.env[key];
  if (s === undefined || s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/** Read an env var as a boolean; "true"/"1" (case-insensitive) are truthy. */
function envBool(key: string, fallback: boolean): boolean {
  const s = process.env[key];
  if (s === undefined || s === "") return fallback;
  const lower = s.toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  return fallback;
}

/** Read an env var as a string; falls back to `fallback` when unset or empty. */
function envString(key: string, fallback: string): string {
  const s = process.env[key];
  return s === undefined || s === "" ? fallback : s;
}

// ── Wave 5 FR-11 / AD-W5-005: capture-policy config validation ──────────────

/** Maximum files to scan before refusing (FR-11 `MAX_MATCH_WORK`). */
export const MAX_MATCH_WORK = 100_000;
/** Maximum number of Drop patterns allowed (FR-11 `MAX_IGNORE_PATTERNS`). */
export const MAX_IGNORE_PATTERNS = 1_024;

/**
 * Validate a `capturePolicy` config block at load time. Throws TypeError on:
 *  - unknown fields (denyUnknownFields=true — the schema is closed)
 *  - `maxIgnorePatterns` exceeded by the number of `Drop` rules
 *  - `maxMatchWork` missing or negative
 *  - any rule with an invalid disposition
 *
 * This mirrors `validatePolicy` in the core pure module but is duplicated here
 * so the shared config loader does not depend on `@massa-ai/core`. The
 * pure module's `validatePolicy` remains the authoritative validator for
 * direct callers; this is the config-load-time gate.
 */
function validateCapturePolicyConfig(
  raw: unknown,
): {
  rules: Array<{ pattern: string; disposition: "Keep" | "Drop" | "MetadataOnly" }>;
  maxMatchWork?: number;
  maxIgnorePatterns?: number;
} {
  if (!raw || typeof raw !== "object") throw new TypeError("capturePolicy must be an object");
  const p = raw as Record<string, unknown>;
  const allowedKeys = new Set(["rules", "maxMatchWork", "maxIgnorePatterns"]);
  for (const key of Object.keys(p)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`capturePolicy: unknown field "${key}" (denyUnknownFields=true)`);
    }
  }
  if (!Array.isArray(p.rules)) throw new TypeError("capturePolicy.rules must be an array");
  const validDispositions = new Set(["Keep", "Drop", "MetadataOnly"]);
  let dropCount = 0;
  for (const rule of p.rules as Array<Record<string, unknown>>) {
    if (!rule || typeof rule !== "object") throw new TypeError("capturePolicy.rules[] must be objects");
    if (typeof rule.pattern !== "string" || !rule.pattern) {
      throw new TypeError("capturePolicy.rules[].pattern must be a non-empty string");
    }
    if (typeof rule.disposition !== "string" || !validDispositions.has(rule.disposition)) {
      throw new TypeError(
        `capturePolicy.rules[].disposition must be Keep|Drop|MetadataOnly (got ${String(rule.disposition)})`,
      );
    }
    if (rule.disposition === "Drop") dropCount++;
  }
  const maxIgnore = typeof p.maxIgnorePatterns === "number" ? p.maxIgnorePatterns : MAX_IGNORE_PATTERNS;
  if (dropCount > maxIgnore) {
    throw new TypeError(
      `capturePolicy: ${dropCount} Drop rules exceed maxIgnorePatterns=${maxIgnore}`,
    );
  }
  if (p.maxMatchWork !== undefined) {
    if (typeof p.maxMatchWork !== "number" || p.maxMatchWork < 0) {
      throw new TypeError("capturePolicy.maxMatchWork must be a non-negative number");
    }
  }
  return {
    rules: p.rules as Array<{ pattern: string; disposition: "Keep" | "Drop" | "MetadataOnly" }>,
    ...(p.maxMatchWork !== undefined && { maxMatchWork: p.maxMatchWork as number }),
    ...(p.maxIgnorePatterns !== undefined && { maxIgnorePatterns: p.maxIgnorePatterns as number }),
  };
}

/**
 * Decay parameters for memory salience scoring (Phase 1, borrowed from
 * ai-memory decay.rs). Used by `decayScore`:
 *   score = salience·exp(-λ·Δt_days) + σ·log(1+access)·exp(-μ·Δt_access_days)
 * Memories scoring below `coldThreshold` are prune candidates.
 */
export interface DecayParams {
  /** Per-day exponential decay rate of the salience term. */
  lambda: number;
  /** Weight of the access-reinforcement term. */
  sigma: number;
  /** Per-day exponential decay rate of the access term (since last access). */
  mu: number;
  /** Score below which a memory is a candidate for pruning. */
  coldThreshold: number;
}

/**
 * Resolve the global data directory.
 *
 * Precedence (final, per the config-unification contract):
 *   1. `MASSA_AI_DATA_DIR` env var (explicit override)
 *   2. `dataDir` from config.json (the runtime middle layer)
 *   3. `~/.config/massa-ai/data` (literal default)
 *
 * The legacy `~/.massa-ai-data/` location is migrated to (3) once at module
 * load by env.ts -> migrateDataDirOnce(), so a stale config.json pointing at
 * the old path is corrected by the move; if the old dir still exists (e.g.
 * cross-volume rename failed), precedence (2) keeps us reading from wherever
 * config.json says, but the default is the unified XDG location.
 */
export function getGlobalDataDir(): string {
  const envOverride = process.env.MASSA_AI_DATA_DIR;
  if (envOverride && envOverride.trim()) return envOverride;

  const fileConfig = loadConfigSafe();
  if (fileConfig.dataDir) return fileConfig.dataDir;

  return path.join(getConfigDir(), "data");
}

/**
 * Canonical default allow-list of file extensions massa-ai indexes/searches.
 * Single source of truth — consumed by the indexing pipeline, the search
 * index scanner, and the MCP upload collector so the three never drift.
 * User config (`security.allowedExtensions`) overrides this at runtime.
 */
export const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = [
  ".ts",
  ".js",
  ".tsx",
  ".jsx",
  ".vue",
  ".dart",
  ".py",
  ".php",
  ".java",
  ".go",
  ".rs",
  ".cpp",
  ".c",
  ".h",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".hpp",
  ".cs",
  ".rb",
  ".swift",
  ".kt",
  ".kts",
  ".scala",
  ".lua",
  ".zig",
  ".ex",
  ".exs",
  ".erl",
  ".clj",
  ".ml",
  ".hs",
];

/**
 * Default Configuration
 *
 * Precedence for every tunable: explicit env var > config.json value > literal
 * default. `fileConfig` (loaded once via loadConfigSafe) supplies the config.json
 * middle layer; envX() already returns the env value when set, so the env
 * override remains authoritative. config.json is the source of truth for
 * secrets (DATABASE_URL via env.ts seeding, LLM/embedding keys) and fills
 * everything else the env does not set.
 */
const fileConfig = loadConfigSafe();

// config.json cache block is in MB; ServerConfig expects bytes for l1/l2 maxSize.
const fileCacheL1Bytes = fileConfig.cache?.l1MaxSizeMB
  ? fileConfig.cache.l1MaxSizeMB * 1024 * 1024
  : undefined;
const fileCacheL2Bytes = fileConfig.cache?.l2MaxSizeMB
  ? fileConfig.cache.l2MaxSizeMB * 1024 * 1024
  : undefined;

export const defaultConfig: ServerConfig = {
  name: "massa-ai-server",
  version: "1.0.0",

  dataDir: getGlobalDataDir(),

  cache: {
    l1: {
      maxSize: envNum("L1_CACHE_MAX_SIZE", fileCacheL1Bytes ?? 100 * 1024 * 1024),
      defaultTTL: envNum(
        "L1_CACHE_TTL",
        fileConfig.cache?.defaultTTLSeconds ?? 300,
      ),
    },
    l2: {
      maxSize: envNum("L2_CACHE_MAX_SIZE", fileCacheL2Bytes ?? 500 * 1024 * 1024),
      defaultTTL: envNum(
        "L2_CACHE_TTL",
        fileConfig.cache?.defaultTTLSeconds ?? 3600,
      ),
    },
    embedding: {
      maxAgeHours: 168, // 7 days
    },
  },

  search: {
    // Max files an auto-reindex (latency-sensitive) path will sync before
    // deferring. Overridable via AUTOREINDEX_MAX_FILES env var.
    autoReindexMaxFiles: envNum(
      "AUTOREINDEX_MAX_FILES",
      fileConfig.search?.autoReindexMaxFiles ?? 200,
    ),
    // Phase 2: query understanding (LLM rewrite + HyDE). Opt-in via
    // SEARCH_QUERY_UNDERSTANDING_ENABLED. hydeEnabled gates only the HyDE
    // extra-LLM-call (the rewrite still runs when enabled && hydeEnabled=false).
    // Cache is per-(query, projectId), TTL+size bounded.
    queryUnderstanding: {
      enabled: envBool(
        "SEARCH_QUERY_UNDERSTANDING_ENABLED",
        fileConfig.search?.queryUnderstanding?.enabled ?? false,
      ),
      hydeEnabled: envBool(
        "SEARCH_QUERY_UNDERSTANDING_HYDE_ENABLED",
        fileConfig.search?.queryUnderstanding?.hydeEnabled ?? true,
      ),
      cacheTtlMs: envNum(
        "SEARCH_QUERY_UNDERSTANDING_CACHE_TTL_MS",
        fileConfig.search?.queryUnderstanding?.cacheTtlMs ?? 300_000,
      ),
      cacheMaxSize: envNum(
        "SEARCH_QUERY_UNDERSTANDING_CACHE_MAX_SIZE",
        fileConfig.search?.queryUnderstanding?.cacheMaxSize ?? 256,
      ),
    },
    // Phase 7a: LLM-judge rerank. Opt-in via SEARCH_RERANK_ENABLED.
    // rerankWindow = top-K re-scored by the LLM judge after centrality boost.
    rerank: {
      enabled: envBool(
        "SEARCH_RERANK_ENABLED",
        fileConfig.search?.rerank?.enabled ?? false,
      ),
      rerankWindow: envNum(
        "SEARCH_RERANK_WINDOW",
        fileConfig.search?.rerank?.rerankWindow ?? 50,
      ),
    },
  },

  // Shared local-first LLM block (cross-cutting §1). Ollama defaults; the
  // OpenAI-compatible provider is created from these in services/memory/llm-client.ts.
  llm: {
    enabled: envBool("RLM_LLM_ENABLED", fileConfig.llm?.enabled ?? false),
    baseUrl: envString(
      "RLM_LLM_BASE_URL",
      fileConfig.llm?.baseUrl ?? "http://localhost:11434/v1",
    ),
    apiKey: envString("RLM_LLM_API_KEY", fileConfig.llm?.apiKey ?? "ollama"),
    model: envString("RLM_LLM_MODEL", fileConfig.llm?.model ?? DEFAULT_LLM_MODEL),
    codeModel: envString(
      "RLM_LLM_CODE_MODEL",
      fileConfig.llm?.codeModel ?? DEFAULT_LLM_CODE_MODEL,
    ),
    temperature: envNum(
      "RLM_LLM_TEMPERATURE",
      fileConfig.llm?.temperature ?? 0.2,
    ),
    maxOutputTokens: envNum(
      "RLM_LLM_MAX_OUTPUT_TOKENS",
      fileConfig.llm?.maxOutputTokens ?? 8000,
    ),
    timeoutMs: envNum("RLM_LLM_TIMEOUT_MS", fileConfig.llm?.timeoutMs ?? 90000),
    // qwen3 thinking models return their answer in the reasoning channel; the
    // content channel can come back empty when thinking consumes the token
    // budget. disableThink (a) asks Ollama to stop thinking (best-effort) and
    // (b) enables the reasoning-channel fallback in llm-client.ts. Default "1".
    // NB: with the pure-instruct default model there is no reasoning channel,
    // so this fallback is dormant — kept as a safety net for any Ollama shape
    // shift or an env override back to a thinking model.
    disableThink: envBool(
      "RLM_LLM_DISABLE_THINK",
      fileConfig.llm?.disableThink ?? true,
    ),
  },

  memory: {
    // Defaults borrowed from ai-memory decay.rs. Tunable via the `memory.decay`
    // config override or by constructing a Config with overrides.
    decay: {
      lambda: fileConfig.memory?.decay?.lambda ?? 0.02,
      sigma: fileConfig.memory?.decay?.sigma ?? 0.6,
      mu: fileConfig.memory?.decay?.mu ?? 0.04,
      coldThreshold: fileConfig.memory?.decay?.coldThreshold ?? 0.2,
    },
    bootstrap: {
      // Phase 4: repo bootstrap. Scan + rule-based seed have no LLM dep.
      enabled: envBool(
        "BOOTSTRAP_ENABLED",
        fileConfig.memory?.bootstrap?.enabled ?? true,
      ),
      maxSeedMemories: envNum(
        "BOOTSTRAP_MAX_SEED_MEMORIES",
        fileConfig.memory?.bootstrap?.maxSeedMemories ?? 8,
      ),
      centralityLimit: envNum(
        "BOOTSTRAP_CENTRALITY_LIMIT",
        fileConfig.memory?.bootstrap?.centralityLimit ?? 10,
      ),
      gitLogLimit: envNum(
        "BOOTSTRAP_GIT_LOG_LIMIT",
        fileConfig.memory?.bootstrap?.gitLogLimit ?? 20,
      ),
      refreshEnabled: envBool(
        "BOOTSTRAP_REFRESH_ENABLED",
        fileConfig.memory?.bootstrap?.refreshEnabled ?? true,
      ),
    },
    autoImprove: {
      // Phase 5: auto-improvement loop. Rule-based pattern detection has
      // no LLM dep; LLM enrichment inherits the top-level llm.enabled gate.
      // Default auto-approve + logging; reviewGate=true surfaces pending
      // proposals via list_proposals / approve_proposal.
      enabled: envBool(
        "AUTO_IMPROVE_ENABLED",
        fileConfig.memory?.autoImprove?.enabled ?? true,
      ),
      reviewGate: envBool(
        "AUTO_IMPROVE_REVIEW_GATE",
        fileConfig.memory?.autoImprove?.reviewGate ?? false,
      ),
      minObservations: envNum(
        "AUTO_IMPROVE_MIN_OBS",
        fileConfig.memory?.autoImprove?.minObservations ?? 8,
      ),
      minIntervalMs: envNum(
        "AUTO_IMPROVE_MIN_INTERVAL_MS",
        fileConfig.memory?.autoImprove?.minIntervalMs ?? 5 * 60 * 1000,
      ),
      maxWindow: envNum(
        "AUTO_IMPROVE_MAX_WINDOW",
        fileConfig.memory?.autoImprove?.maxWindow ?? 16,
      ),
      minQueryHits: envNum(
        "AUTO_IMPROVE_MIN_QUERY_HITS",
        fileConfig.memory?.autoImprove?.minQueryHits ?? 3,
      ),
      minFileHits: envNum(
        "AUTO_IMPROVE_MIN_FILE_HITS",
        fileConfig.memory?.autoImprove?.minFileHits ?? 3,
      ),
      minFixHits: envNum(
        "AUTO_IMPROVE_MIN_FIX_HITS",
        fileConfig.memory?.autoImprove?.minFixHits ?? 2,
      ),
    },
    // Phase 7b: auto salience scoring on remember (opt-in via
    // AUTO_IMPORTANCE_ENABLED). Scores only when the caller omits importance.
    autoImportance: {
      enabled: envBool(
        "AUTO_IMPORTANCE_ENABLED",
        fileConfig.memory?.autoImportance?.enabled ?? false,
      ),
    },
  },

  hooks: {
    // Phase 3: passive lifecycle capture. Ingestion has no LLM dependency.
    enabled: envBool("HOOKS_ENABLED", fileConfig.hooks?.enabled ?? true),
    maxPayloadBytes: envNum(
      "HOOKS_MAX_PAYLOAD_BYTES",
      fileConfig.hooks?.maxPayloadBytes ?? 65_536,
    ),
    queue: {
      // Saturation threshold — once exceeded, /api/v1/hook returns 429.
      maxPending: envNum(
        "HOOKS_QUEUE_MAX_PENDING",
        fileConfig.hooks?.queue?.maxPending ?? 256,
      ),
    },
    bridge: {
      // LLM-driven observation→memory summarization. No-ops when llm.enabled=false.
      enabled: envBool(
        "HOOKS_BRIDGE_ENABLED",
        fileConfig.hooks?.bridge?.enabled ?? true,
      ),
      minObservations: envNum(
        "HOOKS_BRIDGE_MIN_OBS",
        fileConfig.hooks?.bridge?.minObservations ?? 8,
      ),
      minIntervalMs: envNum(
        "HOOKS_BRIDGE_MIN_INTERVAL_MS",
        fileConfig.hooks?.bridge?.minIntervalMs ?? 5 * 60 * 1000,
      ),
      maxWindow: envNum(
        "HOOKS_BRIDGE_MAX_WINDOW",
        fileConfig.hooks?.bridge?.maxWindow ?? 8,
      ),
    },
  },

  handoffs: {
    // Phase 6: cross-session handoffs. begin/accept/cancel have no LLM dep.
    enabled: envBool("HANDOFFS_ENABLED", true),
  },

  compression: {
    defaultStrategy: fileConfig.compression?.defaultStrategy ?? "code_structure",
    minTokensForCompression: envNum(
      "MIN_TOKENS_FOR_COMPRESSION",
      fileConfig.compression?.minTokensForCompression ?? 100,
    ),
    targetCompressionRatio: envNum(
      "TARGET_COMPRESSION_RATIO",
      fileConfig.compression?.targetCompressionRatio ?? 0.7,
    ),
    // Compression-specific prompt override (env RLM_LLM_PROMPT). The LLM
    // connection fields (model/baseUrl/etc.) live in the top-level `llm` block.
    prompt: process.env.RLM_LLM_PROMPT || fileConfig.compression?.prompt || undefined,
  },

  // Wave 5 FR-05 / N3: impact-analysis graph traversal options.
  impact: {
    // Additive behind-flag: when true, impact_analysis uses the single
    // recursive CTE (runBfsCteImpact) instead of the TS reverse-import BFS.
    // Default false — the TS path has passing tests today; the CTE path is
    // observed in production before any flip. Parity gated by
    // impact-bfs-parity.test.ts (same FQN set; depths may differ ≤1 hop on
    // cyclic graphs per AD-W5-018).
    bfsCteEnabled: envBool(
      "MASSA_AI_IMPACT_BFS_CTE",
      fileConfig.impact?.bfsCteEnabled ?? false,
    ),
  },

  // Wave 5 FR-11 / FR-21 / AD-W5-005 / AD-W5-015: capture policy. The pure
  // module (packages/core/src/services/search/capture-policy.ts) owns
  // applyPolicy + DEFAULT_POLICY; the wrapper (ignore-patterns.ts) merges
  // .gitignore with DEFAULT_IGNORES via the Ignore library BEFORE delegating
  // to applyPolicy. Here we surface the config block + validate bounds +
  // denyUnknownFields at load time. When the block is absent, the pure
  // module's DEFAULT_POLICY is used (no validation needed).
  capturePolicy: fileConfig.capturePolicy
    ? validateCapturePolicyConfig(fileConfig.capturePolicy)
    : undefined,

  // Wave 5 FR-12 / AD-W5-006: read_file path containment allowlist. Env
  // MASSA_AI_READ_FILE_ROOTS is colon-separated (POSIX-style). Project
  // root (projectPath arg) and cwd are ALWAYS allowed; this list adds extra
  // roots. Empty/unset → no extra roots. Teaching errors list valid roots
  // only (no host path enumeration).
  readFile: {
    extraRoots: envString("MASSA_AI_READ_FILE_ROOTS", "")
      .split(":")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  },

  // Wave 5 FR-18 / AD-W5-012: server-side filter revalidation. Cap
  // include+exclude patterns (default 32, env MAX_FILTER_PATTERNS).
  filterValidation: {
    maxFilterPatterns: envNum("MAX_FILTER_PATTERNS", 32),
  },

  rateLimit: {
    requestsPerMinute: envNum("REQUESTS_PER_MINUTE", 60),
    tokensPerMinute: envNum("TOKENS_PER_MINUTE", 100000),
  },

  security: {
    maxInputLength: envNum("MAX_INPUT_LENGTH", 100000),
    sanitizeInputs: process.env.SANITIZE_INPUTS !== "false",
    maxIndexSize: 100000, // max files to index
    maxFileSize: 1024 * 1024, // 1MB per file
    allowedExtensions: [...DEFAULT_ALLOWED_EXTENSIONS],
    excludePatterns: [
      "node_modules/**",
      ".git/**",
      "dist/**",
      "build/**",
      ".next/**",
      "coverage/**",
      "**/generated/**",
      "*.min.js",
      "*.min.css",
    ],
  },

  logging: {
    level: (process.env.LOG_LEVEL as any) || fileConfig.logging?.level || "info",
    enableMetrics:
      process.env.ENABLE_METRICS === "true" ||
      (process.env.ENABLE_METRICS === undefined &&
        !!fileConfig.logging?.enableMetrics),
  },

  synapse: {
    enabled: process.env.SYNAPSE_ENABLED !== "false",
    inhibition: {
      diversityPenalty: {
        enabled: true,
        threshold: 0.85,
        lambda: 0.4,
        samePathPenalty: 0.15,
      },
      temporalInhibition: {
        enabled: true,
        penaltyAgeMs: 3_600_000,
        penalty: 0.15,
      },
      confidenceGate: {
        enabled: true,
        thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 },
      },
      chainInhibition: { enabled: true },
    },
    scoring: {
      attention: {
        enabled: process.env.SYNAPSE_ATTENTION_ENABLED === "true",
        rerankWindow: 50,
        recencyHalfLifeMs: 7 * 24 * 60 * 60 * 1000,
        semanticScale: 1.0,
        weights: {
          semantic: 0.25,
          recency: 0.15,
          accessHeat: 0.15,
          taskAlign: 0.2,
          agentAffinity: 0.1,
          confidence: 0.15,
        },
      },
    },
    metacognition: {
      enabled: true,
      // Recalibrated against real RRF score distributions (IMP-2):
      // production confidence values fall in 0.07-0.28 range; 0.15 catches
      // genuinely weak clusters without flooding the metric.
      lowConfidenceThreshold: 0.15,
      definitiveTopScore: 0.8,
      // RRF rarely produces 0.4+ gaps in top-2; 0.2 is the practical
      // boundary between "obvious winner" and "competitive set".
      definitiveGap: 0.2,
    },
    buffer: {
      enabled: true,
      maxSize: 20,
      ttlMs: 900_000,
      hitBoost: 1.3,
      matchThreshold: 0.4,
    },
  },
};

/**
 * Configuration Manager
 */
export class Config {
  private config: ServerConfig;

  constructor(overrides?: Partial<ServerConfig>) {
    this.config = this.mergeConfig(defaultConfig, overrides);
    this.validate();
  }

  /**
   * Merge default config with overrides
   */
  private mergeConfig(
    defaults: ServerConfig,
    overrides?: Partial<ServerConfig>,
  ): ServerConfig {
    if (!overrides) return defaults;

    return {
      ...defaults,
      ...overrides,
      cache: {
        l1: { ...defaults.cache.l1, ...overrides.cache?.l1 },
        l2: { ...defaults.cache.l2, ...overrides.cache?.l2 },
        embedding: {
          ...defaults.cache.embedding,
          ...overrides.cache?.embedding,
        },
      },
      search: {
        ...defaults.search,
        ...overrides.search,
        // Shallow-merge the nested queryUnderstanding block so partial
        // overrides (e.g. { enabled: true }) don't drop the cache defaults.
        queryUnderstanding: {
          ...defaults.search.queryUnderstanding,
          ...overrides.search?.queryUnderstanding,
        },
        // Phase 7a: shallow-merge rerank so partial overrides keep the window.
        rerank: {
          ...defaults.search.rerank,
          ...overrides.search?.rerank,
        },
      },
      llm: { ...defaults.llm, ...overrides.llm },
      memory: {
        ...defaults.memory,
        ...overrides.memory,
        decay: { ...defaults.memory.decay, ...overrides.memory?.decay },
        bootstrap: { ...defaults.memory.bootstrap, ...overrides.memory?.bootstrap },
        autoImprove: { ...defaults.memory.autoImprove, ...overrides.memory?.autoImprove },
        autoImportance: { ...defaults.memory.autoImportance, ...overrides.memory?.autoImportance },
      },
      hooks: {
        ...defaults.hooks,
        ...overrides.hooks,
        queue: { ...defaults.hooks.queue, ...overrides.hooks?.queue },
        bridge: { ...defaults.hooks.bridge, ...overrides.hooks?.bridge },
      },
      handoffs: {
        ...defaults.handoffs,
        ...overrides.handoffs,
      },
      compression: {
        ...defaults.compression,
        ...overrides.compression,
      },
      impact: {
        ...defaults.impact,
        ...overrides.impact,
      },
      rateLimit: { ...defaults.rateLimit, ...overrides.rateLimit },
      security: { ...defaults.security, ...overrides.security },
      logging: { ...defaults.logging, ...overrides.logging },
      synapse: {
        ...defaults.synapse,
        ...overrides.synapse,
        inhibition: {
          ...defaults.synapse.inhibition,
          ...overrides.synapse?.inhibition,
          diversityPenalty: {
            ...defaults.synapse.inhibition.diversityPenalty,
            ...overrides.synapse?.inhibition?.diversityPenalty,
          },
          temporalInhibition: {
            ...defaults.synapse.inhibition.temporalInhibition,
            ...overrides.synapse?.inhibition?.temporalInhibition,
          },
          confidenceGate: {
            ...defaults.synapse.inhibition.confidenceGate,
            ...overrides.synapse?.inhibition?.confidenceGate,
            thresholds: {
              ...defaults.synapse.inhibition.confidenceGate.thresholds,
              ...overrides.synapse?.inhibition?.confidenceGate?.thresholds,
            },
          },
          chainInhibition: {
            ...defaults.synapse.inhibition.chainInhibition,
            ...overrides.synapse?.inhibition?.chainInhibition,
          },
        },
        scoring: {
          ...defaults.synapse.scoring,
          ...overrides.synapse?.scoring,
          attention: {
            ...defaults.synapse.scoring.attention,
            ...overrides.synapse?.scoring?.attention,
            weights: {
              ...defaults.synapse.scoring.attention.weights,
              ...overrides.synapse?.scoring?.attention?.weights,
            },
          },
        },
        metacognition: {
          ...defaults.synapse.metacognition,
          ...overrides.synapse?.metacognition,
        },
        buffer: {
          ...defaults.synapse.buffer,
          ...overrides.synapse?.buffer,
        },
      },
    };
  }

  /**
   * Validate configuration
   */
  private validate(): void {
    if (
      this.config.compression.targetCompressionRatio < 0 ||
      this.config.compression.targetCompressionRatio > 1
    ) {
      throw new Error("targetCompressionRatio must be between 0 and 1");
    }
  }

  /**
   * Get configuration value
   */
  get<K extends keyof ServerConfig>(key: K): ServerConfig[K] {
    return this.config[key];
  }

  /**
   * Get nested configuration value
   */
  getNested(path: string): any {
    return path.split(".").reduce((obj: any, key) => obj?.[key], this.config);
  }

  /**
   * Get all configuration
   */
  getAll(): ServerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (runtime)
   */
  set<K extends keyof ServerConfig>(key: K, value: ServerConfig[K]): void {
    this.config[key] = value;
  }
}

/**
 * Global config instance
 */
export const config = new Config();

export type { MassaAiConfig } from "./massa-ai-config";
export { defaultMassaAiConfig } from "./massa-ai-config";

export {
  getConfigDir,
  getConfigPath,
  configExists,
  loadConfig,
  loadConfigSafe,
  saveConfig,
  initConfig,
  getConfigForEnv,
  migrateDataDirOnce,
} from "./config-loader";

// DEDICATED-stack DB guard — fails fast if a dedicated-flagged process would
// bind the shared production DB name (`massa_ai`). See db-guard.ts.
export {
  SHARED_DB_NAME,
  getDbName,
  isSharedDb,
  assertDedicatedDbAllowed,
  requirePostgresDatabaseUrl,
} from "./db-guard";

// Integer env-var parser — fixes the falsy-`0` footgun in `Number(env) || d`.
export { parsePositiveIntEnv } from "./int-env";
export type { ParseIntEnvOptions } from "./int-env";

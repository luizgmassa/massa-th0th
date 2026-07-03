export interface MassaTh0thConfig {
  embedding: {
    provider: "ollama" | "mistral" | "openai" | "google" | "cohere";
    model: string;
    baseURL?: string;
    apiKey?: string;
    dimensions?: number;
  };
  compression: {
    enabled: boolean;
    strategy: "code_structure" | "conversation_summary" | "semantic_dedup" | "hierarchical";
    targetRatio: number;
    llm?: {
      provider: "ollama" | "mistral" | "openai";
      model: string;
      baseURL?: string;
      apiKey?: string;
    };
  };
  cache: {
    enabled: boolean;
    l1MaxSizeMB: number;
    l2MaxSizeMB: number;
    defaultTTLSeconds: number;
  };
  dataDir: string;
  logging: {
    level: "debug" | "info" | "warn" | "error";
    enableMetrics: boolean;
  };
  synapse: SynapseConfig;
}

/**
 * Synapse — cognitive modulation layer over retrieval.
 * Every submodule has its own kill switch; the whole layer can be disabled at the top.
 */
export interface SynapseConfig {
  enabled: boolean;
  inhibition: {
    diversityPenalty: {
      enabled: boolean;
      threshold: number; // cosine threshold above which results are considered redundant
      lambda: number;    // penalty strength: score *= (1 - lambda * cosine)
    };
    temporalInhibition: {
      enabled: boolean;
      penaltyAgeMs: number; // memories younger than this get penalized when query is non-temporal
      penalty: number;      // absolute score reduction
    };
    confidenceGate: {
      enabled: boolean;
      thresholds: { specific: number; focused: number; broad: number };
    };
    chainInhibition?: {
      enabled: boolean;
      boosts?: Record<string, number>;
    };
  };
  metacognition: {
    enabled: boolean;
    lowConfidenceThreshold: number;
    definitiveTopScore: number;
    definitiveGap: number;
  };
}

export const defaultMassaTh0thConfig: MassaTh0thConfig = {
  embedding: {
    provider: "ollama",
    model: "nomic-embed-text:latest",
    baseURL: "http://localhost:11434",
    dimensions: 768,
  },
  compression: {
    enabled: true,
    strategy: "code_structure",
    targetRatio: 0.7,
  },
  cache: {
    enabled: true,
    l1MaxSizeMB: 100,
    l2MaxSizeMB: 500,
    defaultTTLSeconds: 3600,
  },
  dataDir: "~/.massa-th0th-data",
  logging: {
    level: "info",
    enableMetrics: false,
  },
  synapse: {
    enabled: true,
    inhibition: {
      diversityPenalty: { enabled: true, threshold: 0.85, lambda: 0.4 },
      temporalInhibition: { enabled: true, penaltyAgeMs: 3_600_000, penalty: 0.15 },
      confidenceGate: {
        enabled: true,
        thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 },
      },
    },
    metacognition: {
      enabled: true,
      lowConfidenceThreshold: 0.1,
      definitiveTopScore: 0.8,
      definitiveGap: 0.4,
    },
  },
};

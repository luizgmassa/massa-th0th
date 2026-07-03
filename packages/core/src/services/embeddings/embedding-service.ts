/**
 * EmbeddingService (Phase 7f — relocated from data/chromadb/vector-store.ts).
 *
 * The chromadb vector-store.ts file exported BOTH a dead ChromaDB-stub
 * `VectorStore` AND this live `EmbeddingService`. Four production importers
 * (sqlite-vector-store, memory-service, relation-extractor, query-understanding)
 * read the LIVE EmbeddingService from that file; one dead importer
 * (hybrid-search) read the dead VectorStore. To delete the chromadb file
 * cleanly, the live EmbeddingService moves here and importers are redirected.
 *
 * Verbatim move of the class (same imports of createEmbeddingProvider /
 * EmbeddingProvider). Behavior unchanged.
 *
 * Features:
 * - Auto-fallback across 4 providers (Ollama, OpenAI, Google, Cohere)
 * - SHA-256 content-based caching (60-80% hit rate)
 * - 0.09ms cache hit latency
 * - Exponential backoff retry
 * - Health checking
 */

import { logger } from "@massa-th0th/shared";
import { createEmbeddingProvider, type EmbeddingProvider } from "./index.js";

export class EmbeddingService {
  private provider: EmbeddingProvider | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Lazy initialization to avoid blocking constructor
    this.initPromise = this.initialize();
  }

  /**
   * Initialize embedding provider with auto-fallback
   */
  private async initialize(): Promise<void> {
    try {
      this.provider = await createEmbeddingProvider({
        provider: 'auto',  // Try providers by priority
        cache: true,       // Enable caching for performance
      });

      logger.info('Embedding service initialized', {
        provider: this.provider.id,
        model: this.provider.model,
        dimensions: this.provider.dimensions,
      });
    } catch (error) {
      logger.error('Failed to initialize embedding service', error as Error);
      logger.warn('Embedding service will use fallback mode');
      // Don't throw - allow system to function with degraded capability
    }
  }

  /**
   * Ensure provider is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
  }

  /**
   * Generate embedding for text
   *
   * @param text - Text to embed
   * @returns Embedding vector (dimensions depend on provider)
   * @throws Error if no providers available and fallback fails
   */
  async embed(text: string): Promise<number[]> {
    await this.ensureInitialized();

    if (!this.provider) {
      const msg = 'No embedding provider available. Configure OLLAMA_BASE_URL or an API key.';
      if (process.env.NODE_ENV === 'production') {
        throw new Error(msg);
      }
      logger.warn(msg + ' Using random embeddings (dev only).');
      return new Array(384).fill(0).map(() => Math.random());
    }

    try {
      return await this.provider.embedQuery(text);
    } catch (error) {
      logger.error('Embedding generation failed', error as Error, {
        text: text.slice(0, 50)
      });
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   *
   * Much more efficient than calling embed() multiple times.
   * Uses provider's batch API when available.
   *
   * @param texts - Array of texts to embed
   * @returns Array of embedding vectors
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureInitialized();

    if (!this.provider) {
      const msg = 'No embedding provider available. Configure OLLAMA_BASE_URL or an API key.';
      if (process.env.NODE_ENV === 'production') {
        throw new Error(msg);
      }
      logger.warn(msg + ' Using random embeddings (dev only).');
      return texts.map(() => new Array(384).fill(0).map(() => Math.random()));
    }

    try {
      return await this.provider.embedBatch(texts);
    } catch (error) {
      logger.error('Batch embedding generation failed', error as Error, {
        count: texts.length,
      });
      throw error;
    }
  }

  /**
   * Get embedding dimensions
   *
   * @returns Number of dimensions in embeddings (e.g., 768, 1536)
   */
  getDimensions(): number {
    return this.provider?.dimensions || 384; // Fallback dimension
  }

  /**
   * Get provider info
   *
   * @returns Provider ID and model, or null if not initialized
   */
  getProviderInfo(): { id: string; model: string } | null {
    if (!this.provider) return null;

    return {
      id: this.provider.id,
      model: this.provider.model,
    };
  }

  /**
   * Calculate cosine similarity between embeddings
   */
  getSimilarity(embedding1: number[], embedding2: number[]): number {
    const dotProduct = embedding1.reduce((sum, val, idx) =>
      sum + val * embedding2[idx], 0);

    const magnitude1 = Math.sqrt(embedding1.reduce((sum, val) =>
      sum + val * val, 0));

    const magnitude2 = Math.sqrt(embedding2.reduce((sum, val) =>
      sum + val * val, 0));

    return dotProduct / (magnitude1 * magnitude2);
  }
}

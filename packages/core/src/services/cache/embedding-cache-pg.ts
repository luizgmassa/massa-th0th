/**
 * Embedding Cache - PostgreSQL Implementation
 *
 * Caches embeddings using SHA-256 content hash to avoid redundant API calls.
 * Async implementation using Prisma ORM.
 */

import { createHash } from "crypto";
import { getPrismaClient } from "../query/prisma-client.js";
import { logger } from "@massa-ai/shared";
import type {
  EmbeddingCacheStats,
  EmbeddingCacheStore,
} from "./embedding-cache-contract.js";

export interface EmbeddingCacheEntry {
  provider?: string;
  model: string;
  contentHash: string;
  embedding: number[];
  dimensions: number;
  createdAt: number;
}

export type { EmbeddingCacheStats } from "./embedding-cache-contract.js";

/**
 * Embedding Cache using PostgreSQL
 *
 * Pattern:
 * - Use SHA-256 hash of content as cache key
 * - Namespace the primary key by provider + model + exact content hash
 * - Track dimensions for validation
 * - Automatic cleanup of old entries
 */
export class EmbeddingCachePg implements EmbeddingCacheStore {
  private readonly model: string;
  private readonly namespace: string;

  // Stats tracking
  private hits: number = 0;
  private misses: number = 0;

  constructor(provider: string, model: string) {
    this.model = model;
    this.namespace = createHash("sha256")
      .update(`${provider}\0${model}`, "utf8")
      .digest("hex");
    logger.info("EmbeddingCachePg initialized (PostgreSQL)", { provider, model });
  }

  private get prisma() {
    return getPrismaClient();
  }

  /**
   * Hash text content using SHA-256
   */
  private hashContent(text: string): string {
    const contentHash = createHash("sha256").update(text, "utf8").digest("hex");
    return `${this.namespace}:${contentHash}`;
  }

  /**
   * Serialize embedding to bytes (for PostgreSQL BYTEA)
   */
  private serializeEmbedding(embedding: number[]): Uint8Array {
    const buffer = new ArrayBuffer(embedding.length * 4);
    const view = new DataView(buffer);
    embedding.forEach((val, i) => {
      view.setFloat32(i * 4, val, true); // true = little endian
    });
    return new Uint8Array(buffer);
  }

  /**
   * Deserialize embedding from bytes
   */
  private deserializeEmbedding(bytes: Uint8Array): number[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const embedding: number[] = [];
    for (let i = 0; i < bytes.byteLength; i += 4) {
      embedding.push(view.getFloat32(i, true)); // true = little endian
    }
    return embedding;
  }

  /**
   * Get cached embedding for text
   */
  async get(text: string): Promise<number[] | null> {
    const contentHash = this.hashContent(text);

    const entry = await this.prisma.embeddingCache.findUnique({
      where: { textHash: contentHash },
    });

    if (entry) {
      this.hits++;

      // Update access stats for this (hash, model) pair only
      await this.prisma.embeddingCache.update({
        where: { textHash: contentHash },
        data: {
          accessedAt: new Date(),
          hitCount: { increment: 1 },
        },
      });

      return this.deserializeEmbedding(entry.embedding);
    }

    this.misses++;
    return null;
  }

  /**
   * Store embedding in cache
   */
  async set(text: string, embedding: number[]): Promise<void> {
    const contentHash = this.hashContent(text);
    const embeddingBytes = this.serializeEmbedding(embedding) as any;

    const now = new Date();
    await this.prisma.embeddingCache.upsert({
      where: { textHash: contentHash },
      update: { embedding: embeddingBytes, model: this.model, createdAt: now, accessedAt: now },
      create: {
        textHash: contentHash,
        embedding: embeddingBytes,
        model: this.model,
        createdAt: now,
        accessedAt: now,
        hitCount: 0,
      },
    });
  }

  /**
   * Batch get embeddings
   */
  async getBatch(texts: string[]): Promise<(number[] | null)[]> {
    const hashes = texts.map(text => this.hashContent(text));

    if (texts.length === 0) return [];
    const entries = await this.prisma.embeddingCache.findMany({
      where: {
        textHash: { in: hashes },
      },
    });

    const entryMap = new Map(
      entries.map(entry => [entry.textHash, this.deserializeEmbedding(entry.embedding)])
    );

    const now = new Date();
    const foundHashes = new Set(entries.map((entry) => entry.textHash));
    if (foundHashes.size > 0) {
      await this.prisma.embeddingCache.updateMany({
        where: { textHash: { in: [...foundHashes] } },
        data: { accessedAt: now, hitCount: { increment: 1 } },
      });
    }

    return hashes.map((hash) => {
      const embedding = entryMap.get(hash);
      if (embedding) {
        this.hits++;
        return embedding;
      }
      this.misses++;
      return null;
    });
  }

  /**
   * Batch store embeddings
   */
  async setBatch(texts: string[], embeddings: number[][]): Promise<void> {
    if (texts.length !== embeddings.length) {
      throw new Error("Texts and embeddings arrays must have same length");
    }
    const now = new Date();
    await this.prisma.$transaction(
      texts.map((text, index) => {
        const textHash = this.hashContent(text);
        const embedding = this.serializeEmbedding(embeddings[index]!) as any;
        return this.prisma.embeddingCache.upsert({
          where: { textHash },
          update: { embedding, model: this.model, createdAt: now, accessedAt: now },
          create: {
            textHash,
            embedding,
            model: this.model,
            createdAt: now,
            accessedAt: now,
            hitCount: 0,
          },
        });
      }),
    );
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<EmbeddingCacheStats> {
    const prefix = `${this.namespace}:%`;
    const [stats] = await this.prisma.$queryRaw<
      Array<{ total_entries: bigint; total_size: bigint }>
    >`
      SELECT
        COUNT(*)                                    AS total_entries,
        COALESCE(SUM(octet_length(embedding)), 0)   AS total_size
      FROM embedding_cache
      WHERE model = ${this.model} AND text_hash LIKE ${prefix}
    `;

    const totalEntries = Number(stats?.total_entries ?? 0);
    const totalSize = Number(stats?.total_size ?? 0);

    return {
      totalEntries,
      cacheSize: totalSize,
      hitRate: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0,
      avgDimensions: totalEntries > 0 ? totalSize / totalEntries / 4 : 0, // 4 bytes per float32
    };
  }

  /**
   * Clean up old entries
   */
  async cleanup(maxAgeMs: number): Promise<number> {
    const cutoffDate = new Date(Date.now() - maxAgeMs);

    const result = await this.prisma.embeddingCache.deleteMany({
      where: {
        model: this.model,
        textHash: { startsWith: `${this.namespace}:` },
        createdAt: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  /**
   * Clear all cache entries for this model
   */
  async clear(): Promise<number> {
    const result = await this.prisma.embeddingCache.deleteMany({
      where: {
        model: this.model,
        textHash: { startsWith: `${this.namespace}:` },
      },
    });

    this.hits = 0;
    this.misses = 0;

    return result.count;
  }

  /**
   * Get hit rate for monitoring
   */
  getHitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }
}

/**
 * Keyword Search - PostgreSQL Implementation
 *
 * Uses PostgreSQL full-text search with to_tsvector for FTS capabilities.
 */

import { SearchResult, SearchSource } from "@massa-ai/shared";
import { logger } from "@massa-ai/shared";
import { getPgPool } from "../db-connection.js";
import { installGuardOnTable } from "../../services/project-identity/identity-guard-installer.js";
import type { Pool } from "pg";
import {
  sanitizeTrigramQuery,
  levenshtein,
  maxEditDistance,
} from "../../services/search/lexical-search.js";

export class KeywordSearchPg {
  private pool: Pool | null = null;
  private poolPromise: Promise<Pool> | null = null;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private trigramAvailable = false;
  // Process-local LRU for fuzzyCorrect (parity with PostgreSQL store).
  private fuzzyCache = new Map<string, string | null>();
  private static readonly FUZZY_CACHE_SIZE = 512;

  constructor() {}

  private async getPool(): Promise<Pool> {
    let pool = this.pool;
    if (!pool) {
      if (!this.poolPromise) {
        this.poolPromise = getPgPool()
          .then((resolvedPool) => {
            this.pool = resolvedPool;
            return resolvedPool;
          })
          .finally(() => {
            this.poolPromise = null;
          });
      }
      pool = await this.poolPromise;
    }

    if (!this.initialized) {
      if (!this.initializationPromise) {
        this.initializationPromise = this.initTable(pool)
          .then(() => {
            this.initialized = true;
          })
          .finally(() => {
            this.initializationPromise = null;
          });
      }
      await this.initializationPromise;
    }

    return pool;
  }

  private async initTable(pool: Pool): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS keyword_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        content_tsvector TSVECTOR,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_keyword_project ON keyword_documents(project_id);
      CREATE INDEX IF NOT EXISTS idx_keyword_content_tsvector ON keyword_documents USING GIN(content_tsvector);

      CREATE OR REPLACE FUNCTION update_content_tsvector()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.content_tsvector := to_tsvector('english', COALESCE(NEW.content, ''));
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trigger_update_content_tsvector ON keyword_documents;
      CREATE TRIGGER trigger_update_content_tsvector
        BEFORE INSERT OR UPDATE ON keyword_documents
        FOR EACH ROW
        EXECUTE FUNCTION update_content_tsvector();

      -- Vocabulary table for Levenshtein fuzzy correction (PG parity with PostgreSQL).
      CREATE TABLE IF NOT EXISTS keyword_vocabulary (
        word TEXT PRIMARY KEY
      );
    `);

    // Project-identity guard (M16+M17 design: runtime-created tables install
    // guards during initialization). Best-effort: sanitized code on failure,
    // table init never aborts on a guard problem.
    const guardCode = await installGuardOnTable(pool, "public", "keyword_documents", "project_id");
    if (guardCode) {
      logger.warn("[project-identity] guard install failed (sanitized)", {
        table: "keyword_documents",
        code: guardCode,
      });
    }

    // pg_trgm extension for trigram similarity. Requires the extension to be
    // available; on managed PG (RDS, etc.) this is usually pre-installed. On
    // failure the trigram stream is disabled and RRF degrades to porter keyword.
    try {
      await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_keyword_content_trgm
        ON keyword_documents USING GIN (content gin_trgm_ops);
      `);
      this.trigramAvailable = true;
    } catch (error) {
      logger.warn(
        'pg_trgm unavailable — trigram RRF stream disabled on PG',
        { err: (error as Error).message },
      );
      this.trigramAvailable = false;
    }

    logger.info('PostgreSQL keyword search initialized', {
      trigram: this.trigramAvailable,
    });
  }

  async add(id: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    const pool = await this.getPool();
    const projectId = metadata?.projectId as string || 'default';

    await pool.query(
      `INSERT INTO keyword_documents (id, project_id, content, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         content = EXCLUDED.content,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [id, projectId, content, JSON.stringify(metadata || {})]
    );

    await this.populateVocabulary(pool, [content], id);
  }

  // Alias for compatibility
  async index(id: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.add(id, content, metadata);
  }

  async addBatch(documents: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>): Promise<void> {
    const pool = await this.getPool();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const doc of documents) {
        const projectId = doc.metadata?.projectId as string || 'default';
        await client.query(
          `INSERT INTO keyword_documents (id, project_id, content, metadata)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET
             content = EXCLUDED.content,
             metadata = EXCLUDED.metadata,
             updated_at = NOW()`,
          [doc.id, projectId, doc.content, JSON.stringify(doc.metadata || {})]
        );
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await this.populateVocabulary(
      pool,
      documents.map((document) => document.content),
      `batch:${documents.length}`,
    );
  }

  /** Populate fuzzy vocabulary in bounded inserts; lexical indexing remains successful on failure. */
  private async populateVocabulary(
    pool: Pool,
    contents: string[],
    source: string,
  ): Promise<void> {
    try {
      const vocabWords = new Set<string>();
      for (const content of contents) {
        for (const token of content.split(/[^a-zA-Z0-9]+/)) {
          if (token.length < 3) continue;
          vocabWords.add(token.toLowerCase());
          for (const part of token.split(/(?<=[a-z])(?=[A-Z])/)) {
            if (part.length >= 3) vocabWords.add(part.toLowerCase());
          }
        }
      }

      const words = [...vocabWords];
      const INSERT_BATCH_SIZE = 5_000;
      for (let offset = 0; offset < words.length; offset += INSERT_BATCH_SIZE) {
        const batch = words.slice(offset, offset + INSERT_BATCH_SIZE);
        const values = batch.map((_, index) => `($${index + 1})`).join(",");
        await pool.query(
          `INSERT INTO keyword_vocabulary (word)
           VALUES ${values}
           ON CONFLICT (word) DO NOTHING`,
          batch,
        );
      }
    } catch (err) {
      logger.debug('vocabulary population failed (non-fatal)', {
        source,
        err: (err as Error).message,
      });
    }
  }

  async search(
    query: string,
    projectIdOrLimit?: string | number,
    limit: number = 10
  ): Promise<SearchResult[]> {
    const pool = await this.getPool();
    const projectId = typeof projectIdOrLimit === 'string' ? projectIdOrLimit : undefined;
    const resultLimit = typeof projectIdOrLimit === 'number' ? projectIdOrLimit : limit;
    
    const searchTerms = query
      .toLowerCase()
      .split(/\s+/)
      .map(t => t.replace(/[^a-z0-9_]/g, ''))
      .filter(t => t.length > 2)
      .map(t => `${t}:*`)
      .join(' | ');

    if (!searchTerms) return [];

    const queryText = projectId
      ? `SELECT id, content, metadata,
           ts_rank_cd(content_tsvector, to_tsquery('english', $1)) as rank
         FROM keyword_documents
         WHERE project_id = $2
           AND content_tsvector @@ to_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $3`
      : `SELECT id, content, metadata,
           ts_rank_cd(content_tsvector, to_tsquery('english', $1)) as rank
         FROM keyword_documents
         WHERE content_tsvector @@ to_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $2`;
    
    const params = projectId
      ? [searchTerms, projectId, resultLimit]
      : [searchTerms, resultLimit];
    
    const { rows } = await pool.query(queryText, params);
    
    return rows.map(row => ({
      id: row.id,
      content: row.content,
      score: Math.min(1, parseFloat(row.rank) * 2),
      source: SearchSource.KEYWORD,
      metadata: row.metadata,
    }));
  }

  async searchWithFilter(
    query: string,
    filters: {
      userId?: string;
      projectId?: string;
      sessionId?: string;
      type?: string;
    },
    limit: number = 10
  ): Promise<SearchResult[]> {
    const pool = await this.getPool();
    
    const searchTerms = query
      .toLowerCase()
      .split(/\s+/)
      .map(t => t.replace(/[^a-z0-9_]/g, ''))
      .filter(t => t.length > 2)
      .map(t => `${t}:*`)
      .join(' | ');

    if (!searchTerms) return [];

    const whereClauses: string[] = ["content_tsvector @@ to_tsquery('english', $1)"];
    const params: any[] = [searchTerms];
    let paramIndex = 2;
    
    if (filters.projectId) {
      whereClauses.push(`project_id = $${paramIndex}`);
      params.push(filters.projectId);
      paramIndex++;
    }
    
    if (filters.userId) {
      whereClauses.push(`metadata->>'userId' = $${paramIndex}`);
      params.push(filters.userId);
      paramIndex++;
    }
    
    if (filters.sessionId) {
      whereClauses.push(`metadata->>'sessionId' = $${paramIndex}`);
      params.push(filters.sessionId);
      paramIndex++;
    }
    
    if (filters.type) {
      whereClauses.push(`metadata->>'type' = $${paramIndex}`);
      params.push(filters.type);
      paramIndex++;
    }
    
    params.push(limit);
    
    const queryText = `
      SELECT id, content, metadata,
        ts_rank_cd(content_tsvector, to_tsquery('english', $1)) as rank
      FROM keyword_documents
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY rank DESC
      LIMIT $${paramIndex}
    `;
    
    const { rows } = await pool.query(queryText, params);

    return rows.map(row => ({
      id: row.id,
      content: row.content,
      score: Math.min(1, parseFloat(row.rank) * 2),
      source: SearchSource.KEYWORD,
      metadata: row.metadata,
    }));
  }

  /**
   * Trigram similarity search using pg_trgm. Returns [] when pg_trgm is
   * unavailable or the sanitized query is empty.
   */
  async searchTrigram(
    query: string,
    filters: { projectId?: string },
    limit: number = 10,
  ): Promise<SearchResult[]> {
    if (!this.trigramAvailable) return [];
    const sanitized = sanitizeTrigramQuery(query, 'OR');
    if (!sanitized) return [];
    const pool = await this.getPool();
    // Match PostgreSQL's trigram OR semantics with exact case-insensitive
    // substrings. PostgreSQL's `content % wholeQuery` compares a short query
    // to the entire chunk and returned no rows for identifier substrings.
    const trgmTerms = sanitized
      .replace(/["']/g, "")
      .split(/\s+(?:OR|AND)\s+/)
      .map((term) => term.trim())
      .filter(Boolean);
    if (trgmTerms.length === 0) return [];

    try {
      const text = filters.projectId
        ? `SELECT id, content, metadata,
                  (SELECT COUNT(*)::float / cardinality($1::text[])
                   FROM unnest($1::text[]) AS term
                   WHERE content ILIKE '%' || term || '%') AS sim
           FROM keyword_documents
           WHERE project_id = $2
             AND EXISTS (
               SELECT 1 FROM unnest($1::text[]) AS term
               WHERE content ILIKE '%' || term || '%'
             )
           ORDER BY sim DESC
           LIMIT $3`
        : `SELECT id, content, metadata,
                  (SELECT COUNT(*)::float / cardinality($1::text[])
                   FROM unnest($1::text[]) AS term
                   WHERE content ILIKE '%' || term || '%') AS sim
           FROM keyword_documents
           WHERE EXISTS (
             SELECT 1 FROM unnest($1::text[]) AS term
             WHERE content ILIKE '%' || term || '%'
           )
           ORDER BY sim DESC
           LIMIT $2`;
      const params = filters.projectId
        ? [trgmTerms, filters.projectId, limit]
        : [trgmTerms, limit];
      const { rows } = await pool.query(text, params);
      return rows.map((row) => ({
        id: row.id,
        content: row.content,
        score: Math.min(1, parseFloat(row.sim) || 0),
        source: SearchSource.KEYWORD,
        metadata: row.metadata,
      }));
    } catch (error) {
      logger.debug('trigram search failed (non-fatal)', {
        err: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Levenshtein fuzzy correction against keyword_vocabulary. Mirrors the
   * PostgreSQL store's length-bounded, LRU-cached correction.
   */
  async fuzzyCorrect(word: string): Promise<string | null> {
    const w = word.toLowerCase().trim();
    if (w.length < 3) return null;

    if (this.fuzzyCache.has(w)) {
      const cached = this.fuzzyCache.get(w) ?? null;
      this.fuzzyCache.delete(w);
      this.fuzzyCache.set(w, cached);
      return cached;
    }

    const maxDist = maxEditDistance(w.length);
    const pool = await this.getPool();
    let rows: Array<{ word: string }> = [];
    try {
      const res = await pool.query(
        `SELECT word FROM keyword_vocabulary
         WHERE char_length(word) BETWEEN $1 AND $2`,
        [w.length - maxDist, w.length + maxDist],
      );
      rows = res.rows as Array<{ word: string }>;
    } catch (error) {
      logger.debug('fuzzy vocab lookup failed (non-fatal)', {
        err: (error as Error).message,
      });
      return null;
    }

    let bestWord: string | null = null;
    let bestDist = maxDist + 1;
    let exactMatch = false;

    for (const { word: candidate } of rows) {
      if (candidate === w) {
        exactMatch = true;
        break;
      }
      const dist = levenshtein(w, candidate);
      if (dist < bestDist) {
        bestDist = dist;
        bestWord = candidate;
      }
    }

    const result = exactMatch ? null : bestDist <= maxDist ? bestWord : null;

    if (this.fuzzyCache.size >= KeywordSearchPg.FUZZY_CACHE_SIZE) {
      const oldestKey = this.fuzzyCache.keys().next().value;
      if (oldestKey !== undefined) this.fuzzyCache.delete(oldestKey);
    }
    this.fuzzyCache.set(w, result);
    return result;
  }

  async delete(id: string): Promise<boolean> {
    const pool = await this.getPool();
    const result = await pool.query('DELETE FROM keyword_documents WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async update(id: string, content: string): Promise<void> {
    const pool = await this.getPool();
    await pool.query(
      `UPDATE keyword_documents
       SET content = $1, updated_at = NOW()
       WHERE id = $2`,
      [content, id],
    );
  }

  async deleteByProject(projectId: string): Promise<number> {
    const pool = await this.getPool();
    const result = await pool.query('DELETE FROM keyword_documents WHERE project_id = $1', [projectId]);
    return result.rowCount ?? 0;
  }

  async clear(): Promise<void> {
    const pool = await this.getPool();
    await pool.query('DELETE FROM keyword_documents');
    logger.info('Keyword search cleared');
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.poolPromise = null;
      this.initialized = false;
      this.initializationPromise = null;
    }
  }
}

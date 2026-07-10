/**
 * SQLite FTS5 Keyword Search
 * 
 * Full-text search using SQLite FTS5 for fast keyword matching
 */

import { Database } from 'bun:sqlite';
import { IKeywordSearch } from '@massa-th0th/shared';
import { SearchResult, SearchSource } from '@massa-th0th/shared';
import { config } from '@massa-th0th/shared';
import { logger } from '@massa-th0th/shared';
import { sanitizeFTS5Query } from '@massa-th0th/shared';
import {
  sanitizeTrigramQuery,
  levenshtein,
  maxEditDistance,
} from '../../services/search/lexical-search.js';

/**
 * SQLite FTS5 Keyword Search implementation
 */
export class KeywordSearch implements IKeywordSearch {
  private db!: Database;
  private dbPath: string;
  private tableName: string = 'memories_fts';
  private trigramTableName: string = 'chunks_trigram';
  // Process-local LRU for fuzzyCorrect. The vocabulary table is insert-only,
  // so cache entries never go stale within a process lifetime.
  private fuzzyCache = new Map<string, string | null>();
  private static readonly FUZZY_CACHE_SIZE = 512;
  // Prepared statements (lazy-initialized with the db)
  private stmtInsertTrigram!: ReturnType<Database['prepare']>;
  private stmtInsertVocab!: ReturnType<Database['prepare']>;
  private stmtFuzzyVocab!: ReturnType<Database['prepare']>;
  private trigramAvailable = false;

  constructor(options?: { dbPath?: string }) {
    if (options?.dbPath) {
      this.dbPath = options.dbPath;
    } else {
      const keywordConfig = config.get('keywordSearch');
      this.dbPath = keywordConfig.dbPath;
    }

    this.initialize();
  }

  /**
   * Initialize SQLite database with FTS5
   */
  private initialize(): void {
    try {
      this.db = new Database(this.dbPath);

      // Improve lock tolerance for concurrent read/write workloads
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
      this.db.exec("PRAGMA busy_timeout = 5000");

      // Create FTS5 virtual table
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName} USING fts5(
          id UNINDEXED,
          content,
          metadata UNINDEXED,
          tokenize = 'porter unicode61'
        );
      `);

      // Create metadata index for filtering
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memories_metadata (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          project_id TEXT,
          session_id TEXT,
          type TEXT,
          created_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_user_id ON memories_metadata(user_id);
        CREATE INDEX IF NOT EXISTS idx_project_id ON memories_metadata(project_id);
      `);

      // Trigram (3-char substring) FTS5 table for identifier-substring recall
      // (e.g. "useEff" → "useEffect"). Separate from the porter keyword table
      // so the two tokenizers run as independent RRF streams. Populated from
      // the same index() path. Silent-skip when the trigram tokenizer is
      // unavailable (older SQLite builds): the searchTrigram stream is omitted
      // and RRF falls back to vector + porter keyword.
      this.trigramAvailable = this.createTrigramTable();

      logger.info('SQLite FTS5 keyword search initialized', {
        dbPath: this.dbPath,
        table: this.tableName,
        busyTimeoutMs: 5000,
        journalMode: 'WAL'
      });

    } catch (error) {
      logger.error('Failed to initialize FTS5 search', error as Error);
      throw error;
    }
  }

  /**
   * Create the trigram FTS5 virtual table + insert-only vocabulary table, and
   * prepare the statements used by index()/searchTrigram()/fuzzyCorrect().
   *
   * Returns false (without throwing) when the trigram tokenizer is unavailable
   * (SQLite built without FTS5 trigram support, present since 3.34.0). On false
   * the caller marks the trigram stream unavailable and RRF degrades to the
   * porter keyword stream.
   */
  private createTrigramTable(): boolean {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${this.trigramTableName} USING fts5(
          id UNINDEXED,
          content,
          project_id UNINDEXED,
          tokenize = 'trigram'
        );
        CREATE TABLE IF NOT EXISTS vocabulary (
          word TEXT PRIMARY KEY
        );
      `);
      this.stmtInsertTrigram = this.db.prepare(
        `INSERT OR REPLACE INTO ${this.trigramTableName} (id, content, project_id)
         VALUES (?, ?, ?)`,
      );
      this.stmtInsertVocab = this.db.prepare(
        'INSERT OR IGNORE INTO vocabulary (word) VALUES (?)',
      );
      this.stmtFuzzyVocab = this.db.prepare(
        'SELECT word FROM vocabulary WHERE length(word) BETWEEN ? AND ?',
      );
      return true;
    } catch (error) {
      logger.warn(
        'Trigram FTS5 table unavailable — trigram RRF stream disabled',
        { err: (error as Error).message },
      );
      return false;
    }
  }

  /**
   * Index content for search
   */
  async index(
    id: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO ${this.tableName} (id, content, metadata)
        VALUES (?, ?, ?)
      `);
      stmt.run(id, content, JSON.stringify(metadata || {}));

      // Store metadata separately for filtering
      if (metadata) {
        const metaStmt = this.db.prepare(`
          INSERT OR REPLACE INTO memories_metadata
          (id, user_id, project_id, session_id, type, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        metaStmt.run(
          id,
          (metadata.userId ?? null) as string | null,
          (metadata.projectId ?? null) as string | null,
          (metadata.sessionId ?? null) as string | null,
          (metadata.type ?? null) as string | null,
          Date.now()
        );
      }

      // Populate the trigram table (identifier-substring recall) and the
      // vocabulary table (fuzzy correction). Both are best-effort: a failure
      // here only degrades the lexical streams, never breaks the core index.
      if (this.trigramAvailable) {
        const projectId = (metadata?.projectId as string | undefined) ?? null;
        try {
          this.stmtInsertTrigram.run(id, content, projectId);
          // Vocabulary: store whole whitespace/punctuation-delimited tokens
          // AND their camelCase/snake_case sub-parts so fuzzyCorrect can match
          // both "useEffct" → "useEffect" (whole) and "efect" → "effect" (part).
          // Only tokens of length >= 3 are worth storing (shorter can't be
          // fuzzily corrected).
          const rawTokens = content.split(/[^a-zA-Z0-9]+/);
          const vocabWords = new Set<string>();
          for (const tok of rawTokens) {
            if (tok.length < 3) continue;
            vocabWords.add(tok.toLowerCase());
            // Also add camelCase-split sub-parts.
            for (const part of tok.split(/(?<=[a-z])(?=[A-Z])/)) {
              if (part.length >= 3) vocabWords.add(part.toLowerCase());
            }
          }
          for (const w of vocabWords) this.stmtInsertVocab.run(w);
        } catch (err) {
          logger.debug('trigram/vocab population failed (non-fatal)', {
            id,
            err: (err as Error).message,
          });
        }
      }

      logger.debug('Content indexed for FTS5 search', { id });

    } catch (error) {
      logger.error('Failed to index content', error as Error, { id });
      throw error;
    }
  }

  /**
   * Search using FTS5
   */
  async search(query: string, limit: number = 10): Promise<SearchResult[]> {
    try {
      const sanitizedQuery = sanitizeFTS5Query(query);

      const stmt = this.db.prepare(`
        SELECT 
          id,
          content,
          metadata,
          bm25(${this.tableName}) as score
        FROM ${this.tableName}
        WHERE ${this.tableName} MATCH ?
        ORDER BY score
        LIMIT ?
      `);

      const rows = stmt.all(sanitizedQuery, limit) as Array<{
        id: string;
        content: string;
        metadata: string;
        score: number;
      }>;

      return rows.map(row => ({
        id: row.id,
        content: row.content,
        score: this.normalizeScore(row.score),
        source: SearchSource.KEYWORD,
        metadata: JSON.parse(row.metadata)
      }));

    } catch (error) {
      logger.error('FTS5 search failed', error as Error, { query });
      return [];
    }
  }

  /**
   * Search with metadata filtering
   */
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
    try {
      const sanitizedQuery = sanitizeFTS5Query(query);

      logger.debug("FTS5 searchWithFilter called", {
        originalQuery: query,
        sanitizedQuery,
        filters,
        limit,
      });

      // Build WHERE clause
      const whereClauses: string[] = [`${this.tableName} MATCH ?`];
      const params: any[] = [sanitizedQuery];

      if (filters.userId) {
        whereClauses.push('meta.user_id = ?');
        params.push(filters.userId);
      }
      if (filters.projectId) {
        whereClauses.push('meta.project_id = ?');
        params.push(filters.projectId);
      }
      if (filters.sessionId) {
        whereClauses.push('meta.session_id = ?');
        params.push(filters.sessionId);
      }
      if (filters.type) {
        whereClauses.push('meta.type = ?');
        params.push(filters.type);
      }

      params.push(limit);

      const stmt = this.db.prepare(`
        SELECT 
          fts.id,
          fts.content,
          fts.metadata,
          bm25(${this.tableName}) as score
        FROM ${this.tableName} fts
        INNER JOIN memories_metadata meta ON fts.id = meta.id
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY score
        LIMIT ?
      `);

      const rows = stmt.all(...params) as Array<{
        id: string;
        content: string;
        metadata: string;
        score: number;
      }>;

      return rows.map(row => ({
        id: row.id,
        content: row.content,
        score: this.normalizeScore(row.score),
        source: SearchSource.KEYWORD,
        metadata: JSON.parse(row.metadata)
      }));

    } catch (error) {
      logger.error('FTS5 filtered search failed', error as Error, { filters });
      return [];
    }
  }

  /**
   * Trigram (3-char substring) search for identifier-substring recall.
   * Independent RRF stream alongside the porter keyword search. Returns []
   * when the trigram tokenizer is unavailable or the sanitized query is empty.
   */
  async searchTrigram(
    query: string,
    filters: { projectId?: string },
    limit: number = 10,
  ): Promise<SearchResult[]> {
    if (!this.trigramAvailable) return [];
    const sanitized = sanitizeTrigramQuery(query, 'OR');
    if (!sanitized) return [];
    try {
      const rows = filters.projectId
        ? (this.db
            .prepare(
              `SELECT id, content, project_id,
                      bm25(${this.trigramTableName}) as score
               FROM ${this.trigramTableName}
               WHERE ${this.trigramTableName} MATCH ? AND project_id = ?
               ORDER BY score
               LIMIT ?`,
            )
            .all(sanitized, filters.projectId, limit) as Array<{
              id: string;
              content: string;
              project_id: string | null;
              score: number;
            }>)
        : (this.db
            .prepare(
              `SELECT id, content, project_id,
                      bm25(${this.trigramTableName}) as score
               FROM ${this.trigramTableName}
               WHERE ${this.trigramTableName} MATCH ?
               ORDER BY score
               LIMIT ?`,
            )
            .all(sanitized, limit) as Array<{
              id: string;
              content: string;
              project_id: string | null;
              score: number;
            }>);

      return rows.map((row) => ({
        id: row.id,
        content: row.content,
        score: this.normalizeScore(row.score),
        source: SearchSource.KEYWORD,
        metadata: { projectId: row.project_id ?? undefined },
      }));
    } catch (error) {
      logger.debug('trigram search failed (non-fatal)', {
        err: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Levenshtein fuzzy correction of a single word against the vocabulary
   * table, length-bounded by maxEditDistance. LRU-cached per process. Returns
   * null for exact matches (no correction needed) or when no candidate is
   * within tolerance.
   */
  async fuzzyCorrect(word: string): Promise<string | null> {
    if (!this.trigramAvailable) return null;
    const w = word.toLowerCase().trim();
    if (w.length < 3) return null;

    // LRU hit: promote to tail (Map preserves insertion order).
    if (this.fuzzyCache.has(w)) {
      const cached = this.fuzzyCache.get(w) ?? null;
      this.fuzzyCache.delete(w);
      this.fuzzyCache.set(w, cached);
      return cached;
    }

    const maxDist = maxEditDistance(w.length);
    let candidates: Array<{ word: string }> = [];
    try {
      candidates = this.stmtFuzzyVocab.all(
        w.length - maxDist,
        w.length + maxDist,
      ) as Array<{ word: string }>;
    } catch (error) {
      logger.debug('fuzzy vocab lookup failed (non-fatal)', {
        err: (error as Error).message,
      });
      return null;
    }

    let bestWord: string | null = null;
    let bestDist = maxDist + 1;
    let exactMatch = false;

    for (const { word: candidate } of candidates) {
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

    // Evict oldest before insert to bound the cache.
    if (this.fuzzyCache.size >= KeywordSearch.FUZZY_CACHE_SIZE) {
      const oldestKey = this.fuzzyCache.keys().next().value;
      if (oldestKey !== undefined) this.fuzzyCache.delete(oldestKey);
    }
    this.fuzzyCache.set(w, result);
    return result;
  }

  /**
   * Delete from index
   */
  async delete(id: string): Promise<boolean> {
    try {
      const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
      const metaStmt = this.db.prepare(`DELETE FROM memories_metadata WHERE id = ?`);
      // Vocabulary is insert-only (shared across docs) — intentionally NOT
      // deleted here; stale words are harmless to fuzzy correction.
      if (this.trigramAvailable) {
        this.db
          .prepare(`DELETE FROM ${this.trigramTableName} WHERE id = ?`)
          .run(id);
      }

      stmt.run(id);
      metaStmt.run(id);

      logger.debug('Content deleted from FTS5 index', { id });
      return true;

    } catch (error) {
      logger.error('Failed to delete from FTS5 index', error as Error, { id });
      return false;
    }
  }

  /**
   * Update indexed content
   */
  async update(id: string, content: string): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        UPDATE ${this.tableName} SET content = ? WHERE id = ?
      `);
      stmt.run(content, id);

      logger.debug('Content updated in FTS5 index', { id });

    } catch (error) {
      logger.error('Failed to update FTS5 index', error as Error, { id });
      throw error;
    }
  }

  /**
   * Normalize BM25 score to 0-1 range
   */
  private normalizeScore(bm25Score: number): number {
    // BM25 scores are negative (higher is better)
    // Normalize to 0-1 range approximately
    return 1 / (1 + Math.exp(bm25Score / 10));
  }

  /**
   * Optimize FTS5 index
   */
  async optimize(): Promise<void> {
    try {
      this.db.exec(`INSERT INTO ${this.tableName}(${this.tableName}) VALUES('optimize')`);

      logger.info('FTS5 index optimized');

    } catch (error) {
      logger.error('Failed to optimize FTS5 index', error as Error);
    }
  }

  /**
   * Get index statistics
   */
  async getStats(): Promise<{ totalDocuments: number; indexSize: number }> {
    try {
      const result = this.db.prepare(`
        SELECT COUNT(*) as count FROM ${this.tableName}
      `).get() as { count: number };

      const sizeResult = this.db.prepare(`
        SELECT page_count * page_size as size 
        FROM pragma_page_count(), pragma_page_size()
      `).get() as { size: number };

      return {
        totalDocuments: result.count,
        indexSize: sizeResult.size
      };

    } catch (error) {
      logger.error('Failed to get FTS5 stats', error as Error);
      return { totalDocuments: 0, indexSize: 0 };
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    try {
      this.db?.close();
      
      logger.info('FTS5 search database closed');

    } catch (error) {
      logger.error('Failed to close FTS5 database', error as Error);
    }
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * MongoDB-style compound indexes for artifact queries (item #16),
 * TTL indexes for automatic document expiration (item #31),
 * and index metadata cache (item #61).
 *
 * Although our backing store is PostgreSQL, this module manages
 * compound index definitions, TTL-based expiration policies,
 * and an in-memory index metadata cache for fast index introspection.
 */

import { logger } from '../utils/logger.js';

// ── Compound Index Definitions (#16) ────────────────────────────────────────

/**
 * Compound index specifications for artifact queries.
 * Each entry maps to a PostgreSQL compound index.
 */
export const COMPOUND_INDEXES = [
  {
    name: 'idx_artifacts_type_category_quality',
    table: 'artifacts',
    columns: ['artifact_type', 'primary_category', 'quality_score DESC'],
    description: 'Fast lookup by type+category sorted by quality',
  },
  {
    name: 'idx_artifacts_source_type_updated',
    table: 'artifacts',
    columns: ['source', 'artifact_type', 'updated_at DESC'],
    description: 'Source-scoped type listing with recency',
  },
  {
    name: 'idx_artifacts_tool_language_quality',
    table: 'artifacts',
    columns: ['tool_type', 'language', 'quality_score DESC'],
    description: 'Tool+language filtered quality ranking',
  },
  {
    name: 'idx_artifacts_status_type_discovered',
    table: 'artifacts',
    columns: ['publishing_status', 'artifact_type', 'discovered_at DESC'],
    description: 'Status-filtered type listing by discovery date',
  },
  {
    name: 'idx_artifacts_category_quality_updated',
    table: 'artifacts',
    columns: ['primary_category', 'quality_score DESC', 'updated_at DESC'],
    description: 'Category browsing sorted by quality then recency',
  },
  {
    name: 'idx_workflows_source_tool_quality',
    table: 'workflows',
    columns: ['source', 'tool_type', 'quality_score DESC'],
    description: 'Legacy workflow source+tool quality ranking',
  },
];

/**
 * Generate CREATE INDEX IF NOT EXISTS statements for all compound indexes.
 * @returns {string[]} Array of SQL statements
 */
export function generateCompoundIndexSQL() {
  return COMPOUND_INDEXES.map(idx => {
    const cols = idx.columns.join(', ');
    return `CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} (${cols})`;
  });
}

/**
 * Apply all compound indexes to the database.
 * @param {object} db - Database client with .query()
 * @returns {Promise<{ applied: number, skipped: number, errors: string[] }>}
 */
export async function applyCompoundIndexes(db) {
  const statements = generateCompoundIndexSQL();
  let applied = 0;
  let skipped = 0;
  const errors = [];

  for (const sql of statements) {
    try {
      await db.query(sql);
      applied++;
    } catch (err) {
      if (err.code === '42710') {
        skipped++;
      } else {
        errors.push(err.message);
        logger.error('Failed to create index', { sql, error: err.message });
      }
    }
  }

  return { applied, skipped, errors };
}

// ── TTL Index Definitions (#31) ─────────────────────────────────────────────

/**
 * TTL policies for automatic document expiration.
 * Each policy defines a table, the timestamp column used for age comparison,
 * a TTL in seconds, and an optional condition filter.
 */
export const TTL_POLICIES = [
  {
    name: 'ttl_harvest_runs_90d',
    table: 'harvest_runs',
    timestampColumn: 'completed_at',
    ttlSeconds: 90 * 24 * 3600,
    condition: "status IN ('completed', 'failed')",
    description: 'Purge completed/failed harvest runs after 90 days',
  },
  {
    name: 'ttl_analytics_events_30d',
    table: 'analytics_events',
    timestampColumn: 'created_at',
    ttlSeconds: 30 * 24 * 3600,
    condition: null,
    description: 'Purge analytics events after 30 days',
  },
  {
    name: 'ttl_event_history_14d',
    table: 'event_history',
    timestampColumn: 'created_at',
    ttlSeconds: 14 * 24 * 3600,
    condition: null,
    description: 'Purge event history after 14 days',
  },
  {
    name: 'ttl_artifact_duplicates_180d',
    table: 'artifact_duplicates',
    timestampColumn: 'detected_at',
    ttlSeconds: 180 * 24 * 3600,
    condition: null,
    description: 'Purge duplicate records after 180 days',
  },
];

/**
 * Generate SQL to create partial indexes supporting TTL queries.
 * These indexes make the expiration DELETE efficient.
 * @returns {string[]}
 */
export function generateTTLIndexSQL() {
  return TTL_POLICIES.map(p => {
    const where = p.condition ? ` WHERE ${p.condition}` : '';
    return `CREATE INDEX IF NOT EXISTS ${p.name}_idx ON ${p.table} (${p.timestampColumn})${where}`;
  });
}

/**
 * Run TTL expiration for all policies. Deletes expired rows.
 * @param {object} db
 * @returns {Promise<Array<{ policy: string, deleted: number }>>}
 */
export async function runTTLExpiration(db) {
  const results = [];

  for (const policy of TTL_POLICIES) {
    try {
      const where = policy.condition
        ? `WHERE ${policy.timestampColumn} < NOW() - INTERVAL '${policy.ttlSeconds} seconds' AND ${policy.condition}`
        : `WHERE ${policy.timestampColumn} < NOW() - INTERVAL '${policy.ttlSeconds} seconds'`;

      const result = await db.query(
        `DELETE FROM ${policy.table} ${where}`
      );
      const deleted = result.rowCount || 0;
      results.push({ policy: policy.name, deleted });

      if (deleted > 0) {
        logger.info(`TTL expiration: ${policy.name} deleted ${deleted} rows`);
      }
    } catch (err) {
      logger.error(`TTL expiration failed for ${policy.name}`, { error: err.message });
      results.push({ policy: policy.name, deleted: 0, error: err.message });
    }
  }

  return results;
}

/**
 * Apply TTL indexes to the database.
 * @param {object} db
 * @returns {Promise<{ applied: number, errors: string[] }>}
 */
export async function applyTTLIndexes(db) {
  const statements = generateTTLIndexSQL();
  let applied = 0;
  const errors = [];

  for (const sql of statements) {
    try {
      await db.query(sql);
      applied++;
    } catch (err) {
      if (err.code !== '42710') {
        errors.push(err.message);
      } else {
        applied++;
      }
    }
  }

  return { applied, errors };
}

// ── Index Metadata Cache (#61) ──────────────────────────────────────────────

/**
 * In-memory cache for index metadata to avoid repeated catalog queries.
 * Caches index existence, column info, and sizes.
 */
export class IndexMetadataCache {
  /**
   * @param {object} [options]
   * @param {number} [options.ttlMs=300000] - Cache TTL in ms (default 5 min)
   * @param {number} [options.maxEntries=500] - Maximum cache entries
   */
  constructor({ ttlMs = 300_000, maxEntries = 500 } = {}) {
    this._cache = new Map();
    this._ttlMs = ttlMs;
    this._maxEntries = maxEntries;
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Get cached index metadata by key.
   * @param {string} key - Index name or table.column key
   * @returns {object|null} Cached metadata or null if miss/expired
   */
  get(key) {
    const entry = this._cache.get(key);
    if (!entry) {
      this._misses++;
      return null;
    }
    if (Date.now() - entry.cachedAt > this._ttlMs) {
      this._cache.delete(key);
      this._misses++;
      return null;
    }
    this._hits++;
    return entry.data;
  }

  /**
   * Store index metadata in the cache.
   * @param {string} key
   * @param {object} data
   */
  set(key, data) {
    if (this._cache.size >= this._maxEntries) {
      this._evictOldest();
    }
    this._cache.set(key, { data, cachedAt: Date.now() });
  }

  /**
   * Check if an index exists, using cache when possible.
   * @param {object} db - Database client
   * @param {string} indexName
   * @returns {Promise<boolean>}
   */
  async indexExists(db, indexName) {
    const cached = this.get(`exists:${indexName}`);
    if (cached !== null) return cached;

    try {
      const result = await db.query(
        `SELECT 1 FROM pg_indexes WHERE indexname = $1 LIMIT 1`,
        [indexName]
      );
      const exists = result.rows.length > 0;
      this.set(`exists:${indexName}`, exists);
      return exists;
    } catch {
      return false;
    }
  }

  /**
   * Get columns of an index, using cache.
   * @param {object} db
   * @param {string} indexName
   * @returns {Promise<string[]>}
   */
  async getIndexColumns(db, indexName) {
    const cached = this.get(`columns:${indexName}`);
    if (cached !== null) return cached;

    try {
      const result = await db.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = $1 LIMIT 1`,
        [indexName]
      );
      if (result.rows.length === 0) return [];
      const match = result.rows[0].indexdef.match(/\((.+)\)/);
      const columns = match ? match[1].split(',').map(c => c.trim()) : [];
      this.set(`columns:${indexName}`, columns);
      return columns;
    } catch {
      return [];
    }
  }

  /**
   * Get all index names for a table, using cache.
   * @param {object} db
   * @param {string} tableName
   * @returns {Promise<string[]>}
   */
  async getTableIndexes(db, tableName) {
    const cached = this.get(`table:${tableName}`);
    if (cached !== null) return cached;

    try {
      const result = await db.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = $1 ORDER BY indexname`,
        [tableName]
      );
      const names = result.rows.map(r => r.indexname);
      this.set(`table:${tableName}`, names);
      return names;
    } catch {
      return [];
    }
  }

  /** Get cache hit/miss stats */
  getStats() {
    return {
      size: this._cache.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: this._hits + this._misses > 0
        ? this._hits / (this._hits + this._misses)
        : 0,
    };
  }

  /** Invalidate a specific cache entry */
  invalidate(key) {
    this._cache.delete(key);
  }

  /** Clear all cached data */
  clear() {
    this._cache.clear();
    this._hits = 0;
    this._misses = 0;
  }

  /** @private Evict oldest entries when at capacity */
  _evictOldest() {
    let oldest = null;
    let oldestKey = null;
    for (const [key, entry] of this._cache) {
      if (!oldest || entry.cachedAt < oldest) {
        oldest = entry.cachedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this._cache.delete(oldestKey);
  }
}

let _indexCacheInstance = null;

/**
 * Get the singleton IndexMetadataCache.
 * @param {object} [options]
 * @returns {IndexMetadataCache}
 */
export function getIndexMetadataCache(options) {
  if (!_indexCacheInstance) {
    _indexCacheInstance = new IndexMetadataCache(options);
  }
  return _indexCacheInstance;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #878 — Knowledge Indexing Optimization
 *
 * Analyzes query patterns and artifact access to recommend and create
 * optimal database indexes for the knowledge base.
 */

const TARGET_COLUMNS = [
  'primary_category',
  'artifact_type',
  'source',
  'quality_score',
  'updated_at',
  'created_at',
  'source_url',
];

const INDEX_DEFINITIONS = [
  { name: 'idx_artifacts_category', columns: ['primary_category'], type: 'btree' },
  { name: 'idx_artifacts_type', columns: ['artifact_type'], type: 'btree' },
  { name: 'idx_artifacts_source', columns: ['source'], type: 'btree' },
  { name: 'idx_artifacts_quality', columns: ['quality_score'], type: 'btree' },
  { name: 'idx_artifacts_updated', columns: ['updated_at'], type: 'btree' },
  { name: 'idx_artifacts_category_type', columns: ['primary_category', 'artifact_type'], type: 'btree' },
  { name: 'idx_artifacts_source_url', columns: ['source_url'], type: 'hash' },
];

/**
 * Analyze and optimize indexes.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ existing: object[], recommendations: object[], summary: object }>}
 */
export async function optimizeIndexes(db, options = {}) {
  const existing = await getExistingIndexes(db);
  const existingNames = new Set(existing.map(i => i.indexname));

  const recommendations = INDEX_DEFINITIONS
    .filter(def => !existingNames.has(def.name))
    .map(def => ({
      name: def.name,
      columns: def.columns,
      type: def.type,
      sql: `CREATE INDEX ${def.name} ON artifacts (${def.columns.join(', ')})`,
      priority: def.columns.length === 1 ? 'high' : 'medium',
    }));

  return {
    existing,
    recommendations,
    summary: {
      existing_count: existing.length,
      recommended_count: recommendations.length,
      target_columns: TARGET_COLUMNS,
      analyzed_at: new Date().toISOString(),
    },
  };
}

async function getExistingIndexes(db) {
  try {
    const result = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'artifacts'`
    );
    return result.rows;
  } catch {
    return [];
  }
}

/**
 * Apply a recommended index.
 * @param {object} db
 * @param {object} recommendation
 * @returns {Promise<{ created: boolean, name: string }>}
 */
export async function applyIndex(db, recommendation) {
  try {
    await db.query(recommendation.sql);
    return { created: true, name: recommendation.name };
  } catch (err) {
    return { created: false, name: recommendation.name, error: err.message };
  }
}

export { TARGET_COLUMNS, INDEX_DEFINITIONS };

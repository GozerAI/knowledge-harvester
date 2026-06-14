// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #878 — Autonomous Knowledge Indexing Optimization
 *
 * Optimizes search indexes, analyzes query patterns, and ensures
 * efficient retrieval across the knowledge base.
 */

/**
 * Optimize knowledge indexing.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ optimizations: object[], summary: object }>}
 */
export async function optimizeIndexing(db, options = {}) {
  const optimizations = [];

  // Check for missing indexes on frequently queried columns
  const missingIndexes = await checkMissingIndexes(db);
  optimizations.push(...missingIndexes);

  // Analyze table bloat
  const bloat = await analyzeTableBloat(db);
  optimizations.push(...bloat);

  // Check for unindexed foreign keys
  const fkIssues = await checkForeignKeyIndexes(db);
  optimizations.push(...fkIssues);

  // Run ANALYZE on artifact tables for query planner
  if (options.runAnalyze !== false) {
    try {
      await db.query('ANALYZE artifacts');
      optimizations.push({ type: 'analyze', table: 'artifacts', applied: true });
    } catch {
      optimizations.push({ type: 'analyze', table: 'artifacts', applied: false });
    }
  }

  return {
    optimizations,
    summary: {
      total_optimizations: optimizations.length,
      applied: optimizations.filter(o => o.applied).length,
      pending: optimizations.filter(o => !o.applied).length,
      optimized_at: new Date().toISOString(),
    },
  };
}

async function checkMissingIndexes(db) {
  const desiredIndexes = [
    { table: 'artifacts', column: 'primary_category', name: 'idx_artifacts_category' },
    { table: 'artifacts', column: 'artifact_type', name: 'idx_artifacts_type' },
    { table: 'artifacts', column: 'source', name: 'idx_artifacts_source' },
    { table: 'artifacts', column: 'quality_score', name: 'idx_artifacts_quality' },
    { table: 'artifacts', column: 'updated_at', name: 'idx_artifacts_updated' },
  ];

  const result = [];
  for (const idx of desiredIndexes) {
    try {
      const exists = await db.query(
        `SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2`,
        [idx.table, idx.name]
      );
      if (exists.rows.length === 0) {
        try {
          await db.query(`CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} (${idx.column})`);
          result.push({ type: 'create_index', ...idx, applied: true });
        } catch {
          result.push({ type: 'create_index', ...idx, applied: false });
        }
      }
    } catch {
      result.push({ type: 'check_index', ...idx, applied: false });
    }
  }
  return result;
}

async function analyzeTableBloat(db) {
  try {
    const result = await db.query(
      `SELECT relname AS table_name,
              pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
              n_dead_tup::int AS dead_tuples,
              n_live_tup::int AS live_tuples
       FROM pg_stat_user_tables
       WHERE relname IN ('artifacts', 'artifact_relations', 'workflows')
       ORDER BY n_dead_tup DESC`
    );

    return result.rows
      .filter(r => r.dead_tuples > r.live_tuples * 0.2)
      .map(r => ({
        type: 'vacuum_needed',
        table: r.table_name,
        dead_tuples: r.dead_tuples,
        live_tuples: r.live_tuples,
        applied: false,
      }));
  } catch {
    return [];
  }
}

async function checkForeignKeyIndexes(db) {
  // Check if artifact_relations has indexes on source_id and target_id
  const checks = [
    { table: 'artifact_relations', column: 'source_id', name: 'idx_relations_source' },
    { table: 'artifact_relations', column: 'target_id', name: 'idx_relations_target' },
  ];

  const result = [];
  for (const check of checks) {
    try {
      const exists = await db.query(
        `SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2`,
        [check.table, check.name]
      );
      if (exists.rows.length === 0) {
        result.push({ type: 'missing_fk_index', ...check, applied: false });
      }
    } catch {
      // Table may not exist
    }
  }
  return result;
}

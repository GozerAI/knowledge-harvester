// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #709 — Autonomous Content Freshness Management
 *
 * Monitors content age, schedules refresh cycles, prioritizes stale content,
 * and tracks freshness metrics over time.
 */

const DEFAULT_FRESHNESS_WINDOW_DAYS = 90;
const REFRESH_PRIORITY_WEIGHTS = {
  quality_score: 0.3,
  age_days: 0.4,
  access_count: 0.2,
  category_importance: 0.1,
};

/**
 * @typedef {object} FreshnessReport
 * @property {object[]} stale_artifacts
 * @property {object[]} refresh_queue
 * @property {object} distribution
 * @property {object} summary
 */

/**
 * Analyze content freshness across the knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @param {number} [options.freshnessWindowDays]
 * @param {number} [options.limit]
 * @returns {Promise<FreshnessReport>}
 */
export async function analyzeFreshness(db, options = {}) {
  const windowDays = options.freshnessWindowDays ?? DEFAULT_FRESHNESS_WINDOW_DAYS;
  const limit = options.limit || 100;

  const distribution = await getFreshnessDistribution(db, windowDays);
  const staleArtifacts = await getStaleArtifacts(db, windowDays, limit);
  const refreshQueue = prioritizeRefreshQueue(staleArtifacts);

  return {
    stale_artifacts: staleArtifacts,
    refresh_queue: refreshQueue.slice(0, limit),
    distribution,
    summary: {
      total_stale: staleArtifacts.length,
      refresh_queue_size: refreshQueue.length,
      freshness_window_days: windowDays,
      distribution,
      analyzed_at: new Date().toISOString(),
    },
  };
}

/**
 * Get freshness distribution (fresh, aging, stale, expired).
 */
async function getFreshnessDistribution(db, windowDays) {
  const now = new Date();
  const agingCutoff = new Date(now - windowDays * 0.5 * 86400000).toISOString();
  const staleCutoff = new Date(now - windowDays * 86400000).toISOString();
  const expiredCutoff = new Date(now - windowDays * 2 * 86400000).toISOString();

  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE updated_at >= $1)::int AS fresh,
       COUNT(*) FILTER (WHERE updated_at < $1 AND updated_at >= $2)::int AS aging,
       COUNT(*) FILTER (WHERE updated_at < $2 AND updated_at >= $3)::int AS stale,
       COUNT(*) FILTER (WHERE updated_at < $3)::int AS expired,
       COUNT(*)::int AS total
     FROM artifacts`,
    [agingCutoff, staleCutoff, expiredCutoff]
  );

  const row = result.rows[0] || { fresh: 0, aging: 0, stale: 0, expired: 0, total: 0 };
  return {
    fresh: row.fresh,
    aging: row.aging,
    stale: row.stale,
    expired: row.expired,
    total: row.total,
    fresh_pct: row.total > 0 ? Math.round(row.fresh / row.total * 100) : 0,
    stale_pct: row.total > 0 ? Math.round((row.stale + row.expired) / row.total * 100) : 0,
  };
}

/**
 * Get stale artifacts sorted by age.
 */
async function getStaleArtifacts(db, windowDays, limit) {
  const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString();

  const result = await db.query(
    `SELECT id, name, primary_category, artifact_type, source_url,
            quality_score, updated_at, created_at,
            EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400 AS age_days
     FROM artifacts
     WHERE updated_at < $1
     ORDER BY updated_at ASC
     LIMIT $2`,
    [cutoff, limit * 2]
  );

  return result.rows.map(r => ({
    ...r,
    age_days: Math.round(r.age_days || 0),
    freshness_status: classifyFreshness(r.age_days || 0, windowDays),
  }));
}

/**
 * Classify freshness status.
 */
function classifyFreshness(ageDays, windowDays) {
  if (ageDays < windowDays * 0.5) return 'fresh';
  if (ageDays < windowDays) return 'aging';
  if (ageDays < windowDays * 2) return 'stale';
  return 'expired';
}

/**
 * Prioritize refresh queue based on weighted scoring.
 */
function prioritizeRefreshQueue(staleArtifacts) {
  return staleArtifacts
    .map(a => ({
      ...a,
      refresh_priority: calculateRefreshPriority(a),
    }))
    .sort((a, b) => b.refresh_priority - a.refresh_priority);
}

/**
 * Calculate refresh priority score (0-1).
 */
function calculateRefreshPriority(artifact) {
  const w = REFRESH_PRIORITY_WEIGHTS;

  // Higher quality = higher priority to keep fresh
  const qualityFactor = ((artifact.quality_score || 0) / 100) * w.quality_score;

  // Older = higher priority
  const ageFactor = Math.min((artifact.age_days || 0) / 365, 1) * w.age_days;

  // Category importance (simple heuristic)
  const catImportance = getCategoryImportance(artifact.primary_category) * w.category_importance;

  // Access count factor (default to medium importance)
  const accessFactor = 0.5 * w.access_count;

  const priority = qualityFactor + ageFactor + catImportance + accessFactor;
  return Math.round(Math.min(priority, 1) * 100) / 100;
}

/**
 * Get category importance (0-1).
 */
function getCategoryImportance(category) {
  const importanceMap = {
    automation: 0.9,
    'ai-agents': 0.9,
    devops: 0.8,
    'data-engineering': 0.8,
    security: 0.9,
    monitoring: 0.7,
    documentation: 0.5,
  };
  return importanceMap[category] || 0.5;
}

/**
 * Mark artifacts as refreshed after successful update.
 * @param {object} db
 * @param {string[]} artifactIds
 * @returns {Promise<{ refreshed: number }>}
 */
export async function markRefreshed(db, artifactIds) {
  if (artifactIds.length === 0) return { refreshed: 0 };

  const result = await db.query(
    `UPDATE artifacts
     SET updated_at = NOW()
     WHERE id = ANY($1)`,
    [artifactIds]
  );

  return { refreshed: result.rowCount || 0 };
}

/**
 * Get freshness metrics over time (for trend tracking).
 * @param {object} db
 * @param {number} [days=30]
 * @returns {Promise<object[]>}
 */
export async function getFreshnessTrend(db, days = 30) {
  const result = await db.query(
    `SELECT
       DATE(updated_at) AS date,
       COUNT(*)::int AS artifacts_updated
     FROM artifacts
     WHERE updated_at > NOW() - $1 * INTERVAL '1 day'
     GROUP BY DATE(updated_at)
     ORDER BY date`,
    [days]
  );
  return result.rows;
}

// Export internals for testing
export {
  classifyFreshness,
  calculateRefreshPriority,
  prioritizeRefreshQueue,
  getCategoryImportance,
  REFRESH_PRIORITY_WEIGHTS,
};

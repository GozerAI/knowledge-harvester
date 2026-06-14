// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #866 — Source Reliability Scoring
 *
 * Scores harvesting sources based on historical accuracy, yield rates,
 * consistency, freshness, and error rates. Produces reliability tiers
 * that inform source prioritization and scheduling.
 */

const RELIABILITY_WEIGHTS = {
  yield_rate: 0.25,
  quality_avg: 0.25,
  consistency: 0.20,
  freshness: 0.15,
  error_rate: 0.15,
};

/**
 * Score all harvesting sources for reliability.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ scores: object[], summary: object }>}
 */
export async function scoreSourceReliability(db, options = {}) {
  const limit = options.limit || 100;
  const harvestStats = await getHarvestStats(db, limit);
  const qualityStats = await getQualityStatsBySource(db);

  const scores = [];
  for (const harvest of harvestStats) {
    const quality = qualityStats.get(harvest.source_name) || {};
    const factors = calculateFactors(harvest, quality);
    const score = computeWeightedScore(factors);
    const tier = classifyTier(score);
    scores.push({
      source_name: harvest.source_name, score, tier, factors,
      scored_at: new Date().toISOString(),
    });
  }
  scores.sort((a, b) => b.score - a.score);

  return {
    scores,
    summary: {
      total_sources: scores.length,
      by_tier: countByField(scores, 'tier'),
      avg_score: scores.length > 0
        ? Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length) : 0,
      scored_at: new Date().toISOString(),
    },
  };
}

async function getHarvestStats(db, limit) {
  const result = await db.query(
    `SELECT source AS source_name,
            COUNT(*)::int AS run_count,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS success_count,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS fail_count,
            COALESCE(AVG(items_new), 0)::float AS avg_new_items,
            MAX(completed_at) AS last_run
     FROM harvest_runs GROUP BY source ORDER BY run_count DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function getQualityStatsBySource(db) {
  const result = await db.query(
    `SELECT source, ROUND(AVG(quality_score)::numeric, 2)::float AS avg_quality,
            COUNT(*)::int AS artifact_count
     FROM artifacts WHERE source IS NOT NULL AND quality_score IS NOT NULL GROUP BY source`
  );
  const map = new Map();
  for (const row of result.rows) map.set(row.source, row);
  return map;
}

export function calculateFactors(harvest, quality) {
  const yieldRate = harvest.avg_new_items ? Math.min((harvest.avg_new_items / 10) * 100, 100) : 0;
  const qualityAvg = quality.avg_quality || 0;
  const consistency = harvest.run_count ? (harvest.success_count / harvest.run_count) * 100 : 0;
  const lastRun = harvest.last_run ? new Date(harvest.last_run) : null;
  const daysSinceRun = lastRun ? (Date.now() - lastRun.getTime()) / 86400000 : 365;
  const freshness = Math.max(100 - daysSinceRun * 2, 0);
  const errorRate = harvest.run_count ? (harvest.fail_count / harvest.run_count) * 100 : 50;
  return {
    yield_rate: Math.round(yieldRate), quality_avg: Math.round(qualityAvg),
    consistency: Math.round(consistency), freshness: Math.round(freshness),
    error_rate: Math.round(errorRate),
  };
}

export function computeWeightedScore(factors) {
  const w = RELIABILITY_WEIGHTS;
  const raw = factors.yield_rate * w.yield_rate + factors.quality_avg * w.quality_avg +
    factors.consistency * w.consistency + factors.freshness * w.freshness +
    (100 - factors.error_rate) * w.error_rate;
  return Math.round(Math.min(Math.max(raw, 0), 100));
}

export function classifyTier(score) {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'poor';
  return 'unreliable';
}

export async function getReliabilityTrend(db, sourceName, days = 30) {
  const result = await db.query(
    `SELECT DATE(completed_at) AS date, COUNT(*)::int AS runs,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS successes,
            COALESCE(AVG(items_new), 0)::float AS avg_items
     FROM harvest_runs WHERE source = $1 AND completed_at > NOW() - $2 * INTERVAL '1 day'
     GROUP BY DATE(completed_at) ORDER BY date`,
    [sourceName, days]
  );
  return result.rows;
}

function countByField(arr, field) {
  const counts = {};
  for (const item of arr) { counts[item[field]] = (counts[item[field]] || 0) + 1; }
  return counts;
}

export { RELIABILITY_WEIGHTS };

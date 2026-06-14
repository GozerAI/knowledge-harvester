// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #866 — Autonomous Source Reliability Scoring
 *
 * Scores harvesting sources based on historical yield, quality of artifacts,
 * uptime, and consistency. Used to prioritize future harvesting runs.
 */

const RELIABILITY_WEIGHTS = {
  yield_rate: 0.25,
  quality_avg: 0.25,
  consistency: 0.2,
  freshness: 0.15,
  error_rate: 0.15,
};

/**
 * @typedef {object} SourceReliability
 * @property {string} source
 * @property {number} reliability_score - 0-100
 * @property {object} factors
 * @property {string} tier - 'excellent' | 'good' | 'fair' | 'poor' | 'unreliable'
 */

/**
 * Score all known sources for reliability.
 * @param {object} db
 * @returns {Promise<{ scores: SourceReliability[], summary: object }>}
 */
export async function scoreSourceReliability(db) {
  const harvestStats = await getHarvestStats(db);
  const qualityStats = await getSourceQuality(db);

  const scores = [];
  const allSources = new Set([
    ...harvestStats.map(h => h.source),
    ...qualityStats.map(q => q.source),
  ]);

  for (const source of allSources) {
    const harvest = harvestStats.find(h => h.source === source) || {};
    const quality = qualityStats.find(q => q.source === source) || {};

    const factors = calculateFactors(harvest, quality);
    const score = Math.round(
      factors.yield_rate * RELIABILITY_WEIGHTS.yield_rate +
      factors.quality_avg * RELIABILITY_WEIGHTS.quality_avg +
      factors.consistency * RELIABILITY_WEIGHTS.consistency +
      factors.freshness * RELIABILITY_WEIGHTS.freshness +
      (100 - factors.error_rate) * RELIABILITY_WEIGHTS.error_rate
    );

    scores.push({
      source,
      reliability_score: Math.min(Math.max(score, 0), 100),
      factors,
      tier: classifyTier(score),
    });
  }

  scores.sort((a, b) => b.reliability_score - a.reliability_score);

  return {
    scores,
    summary: {
      total_sources: scores.length,
      by_tier: countByField(scores, 'tier'),
      avg_reliability: scores.length > 0
        ? Math.round(scores.reduce((s, r) => s + r.reliability_score, 0) / scores.length)
        : 0,
      scored_at: new Date().toISOString(),
    },
  };
}

async function getHarvestStats(db) {
  try {
    const result = await db.query(
      `SELECT source,
              COUNT(*)::int AS run_count,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS success_count,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS fail_count,
              COALESCE(AVG(items_new), 0)::float AS avg_new_items,
              MAX(completed_at) AS last_run
       FROM harvest_runs
       GROUP BY source`
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function getSourceQuality(db) {
  const result = await db.query(
    `SELECT source,
            COUNT(*)::int AS artifact_count,
            ROUND(AVG(quality_score)::numeric, 2)::float AS avg_quality,
            MAX(updated_at) AS latest_update
     FROM artifacts
     WHERE source IS NOT NULL
     GROUP BY source`
  );
  return result.rows;
}

function calculateFactors(harvest, quality) {
  const yieldRate = harvest.avg_new_items
    ? Math.min((harvest.avg_new_items / 10) * 100, 100)
    : 0;

  const qualityAvg = quality.avg_quality || 0;

  const consistency = harvest.run_count
    ? (harvest.success_count / harvest.run_count) * 100
    : 0;

  const lastRun = harvest.last_run ? new Date(harvest.last_run) : null;
  const daysSinceRun = lastRun ? (Date.now() - lastRun.getTime()) / 86400000 : 365;
  const freshness = Math.max(100 - daysSinceRun * 2, 0);

  const errorRate = harvest.run_count
    ? (harvest.fail_count / harvest.run_count) * 100
    : 50;

  return {
    yield_rate: Math.round(yieldRate),
    quality_avg: Math.round(qualityAvg),
    consistency: Math.round(consistency),
    freshness: Math.round(freshness),
    error_rate: Math.round(errorRate),
  };
}

function classifyTier(score) {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'poor';
  return 'unreliable';
}

function countByField(arr, field) {
  const counts = {};
  for (const item of arr) {
    const val = item[field];
    counts[val] = (counts[val] || 0) + 1;
  }
  return counts;
}

export { calculateFactors, classifyTier, RELIABILITY_WEIGHTS };

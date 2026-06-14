// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #874 — Autonomous Content Quality Scoring
 *
 * Multi-dimensional quality scoring for knowledge artifacts based on
 * completeness, accuracy signals, recency, and community validation.
 */

const QUALITY_DIMENSIONS = {
  completeness: { weight: 0.30, fields: ['name', 'description', 'source_url', 'primary_category', 'tags'] },
  recency: { weight: 0.20, maxAgeDays: 365 },
  metadata_richness: { weight: 0.20, expectedKeys: 5 },
  community_signal: { weight: 0.15, starWeight: 0.6, forkWeight: 0.4 },
  documentation: { weight: 0.15 },
};

/**
 * Score content quality for a batch of artifacts.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ scored: number, summary: object }>}
 */
export async function scoreContentQuality(db, options = {}) {
  const limit = options.limit || 200;

  const result = await db.query(
    `SELECT id, name, description, source_url, primary_category,
            tags, type_metadata, quality_score, updated_at, artifact_type
     FROM artifacts
     ORDER BY quality_score ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  );

  let scored = 0;
  const scoreDistribution = { excellent: 0, good: 0, fair: 0, poor: 0 };

  for (const artifact of result.rows) {
    const score = calculateQualityScore(artifact);
    try {
      await db.query(
        `UPDATE artifacts SET quality_score = $1, updated_at = NOW() WHERE id = $2`,
        [score.total, artifact.id]
      );
      scored++;
    } catch {
      continue;
    }

    if (score.total >= 80) scoreDistribution.excellent++;
    else if (score.total >= 60) scoreDistribution.good++;
    else if (score.total >= 40) scoreDistribution.fair++;
    else scoreDistribution.poor++;
  }

  return {
    scored,
    summary: {
      total_scored: scored,
      distribution: scoreDistribution,
      scored_at: new Date().toISOString(),
    },
  };
}

/**
 * Calculate multi-dimensional quality score for an artifact.
 * @param {object} artifact
 * @returns {{ total: number, dimensions: object }}
 */
export function calculateQualityScore(artifact) {
  const dimensions = {};

  // Completeness: how many required fields are populated
  const completeFields = QUALITY_DIMENSIONS.completeness.fields.filter(f => {
    const val = artifact[f];
    if (val === null || val === undefined) return false;
    if (typeof val === 'string') return val.trim().length > 0;
    if (Array.isArray(val)) return val.length > 0;
    return true;
  });
  dimensions.completeness = Math.round(
    (completeFields.length / QUALITY_DIMENSIONS.completeness.fields.length) * 100
  );

  // Recency: how recently was it updated
  const ageDays = artifact.updated_at
    ? (Date.now() - new Date(artifact.updated_at).getTime()) / 86400000
    : 365;
  dimensions.recency = Math.round(
    Math.max(0, 100 - (ageDays / QUALITY_DIMENSIONS.recency.maxAgeDays) * 100)
  );

  // Metadata richness
  const meta = typeof artifact.type_metadata === 'string'
    ? safeJsonParse(artifact.type_metadata) : artifact.type_metadata;
  const metaKeys = meta ? Object.keys(meta).length : 0;
  dimensions.metadata_richness = Math.round(
    Math.min(metaKeys / QUALITY_DIMENSIONS.metadata_richness.expectedKeys, 1) * 100
  );

  // Community signal
  const stars = meta?.stars || meta?.stargazers_count || 0;
  const forks = meta?.forks || meta?.forks_count || 0;
  const starScore = Math.min(stars / 100, 1) * QUALITY_DIMENSIONS.community_signal.starWeight;
  const forkScore = Math.min(forks / 50, 1) * QUALITY_DIMENSIONS.community_signal.forkWeight;
  dimensions.community_signal = Math.round((starScore + forkScore) * 100);

  // Documentation quality
  const descLen = (artifact.description || '').length;
  dimensions.documentation = Math.round(Math.min(descLen / 200, 1) * 100);

  // Weighted total
  const total = Math.round(
    dimensions.completeness * QUALITY_DIMENSIONS.completeness.weight +
    dimensions.recency * QUALITY_DIMENSIONS.recency.weight +
    dimensions.metadata_richness * QUALITY_DIMENSIONS.metadata_richness.weight +
    dimensions.community_signal * QUALITY_DIMENSIONS.community_signal.weight +
    dimensions.documentation * QUALITY_DIMENSIONS.documentation.weight
  );

  return { total: Math.min(Math.max(total, 0), 100), dimensions };
}

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

export { QUALITY_DIMENSIONS };

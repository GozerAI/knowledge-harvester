// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #883 — Autonomous Knowledge Recommendation
 *
 * Generates personalized knowledge recommendations based on artifact
 * relationships, quality scores, and access patterns.
 */

/**
 * Generate recommendations for related content.
 * @param {object} db
 * @param {string} artifactId - seed artifact
 * @param {object} [options]
 * @returns {Promise<{ recommendations: object[], summary: object }>}
 */
export async function recommendKnowledge(db, artifactId, options = {}) {
  const limit = options.limit || 10;

  const seed = await getArtifact(db, artifactId);
  if (!seed) return { recommendations: [], summary: { error: 'Artifact not found' } };

  const byCategoryType = await findByCategoryType(db, seed, limit);
  const byRelation = await findByRelation(db, artifactId, limit);
  const byTags = await findByTags(db, seed, limit);

  // Merge and deduplicate
  const allCandidates = [...byRelation, ...byCategoryType, ...byTags];
  const seen = new Set([artifactId]);
  const unique = [];
  for (const c of allCandidates) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      unique.push(c);
    }
  }

  // Score and sort
  const scored = unique.map(c => ({
    ...c,
    recommendation_score: computeRecommendationScore(c, seed),
  })).sort((a, b) => b.recommendation_score - a.recommendation_score);

  const recommendations = scored.slice(0, limit);

  return {
    recommendations,
    summary: {
      seed_artifact: artifactId,
      candidates_found: allCandidates.length,
      recommendations_returned: recommendations.length,
      recommended_at: new Date().toISOString(),
    },
  };
}

/**
 * Generate top recommendations across the whole knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ recommendations: object[], summary: object }>}
 */
export async function recommendTopKnowledge(db, options = {}) {
  const limit = options.limit || 20;

  const result = await db.query(
    `SELECT id, name, primary_category, artifact_type, quality_score,
            source_url, description
     FROM artifacts
     WHERE quality_score IS NOT NULL
     ORDER BY quality_score DESC
     LIMIT $1`,
    [limit]
  );

  return {
    recommendations: result.rows,
    summary: {
      total: result.rows.length,
      avg_quality: result.rows.length > 0
        ? Math.round(result.rows.reduce((s, r) => s + (r.quality_score || 0), 0) / result.rows.length)
        : 0,
      recommended_at: new Date().toISOString(),
    },
  };
}

async function getArtifact(db, id) {
  const result = await db.query(
    `SELECT id, name, primary_category, artifact_type, tags, quality_score
     FROM artifacts WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function findByCategoryType(db, seed, limit) {
  const result = await db.query(
    `SELECT id, name, primary_category, artifact_type, quality_score, source_url
     FROM artifacts
     WHERE primary_category = $1 AND artifact_type = $2 AND id != $3
     ORDER BY quality_score DESC NULLS LAST
     LIMIT $4`,
    [seed.primary_category, seed.artifact_type, seed.id, limit]
  );
  return result.rows.map(r => ({ ...r, source: 'category_type' }));
}

async function findByRelation(db, artifactId, limit) {
  try {
    const result = await db.query(
      `SELECT a.id, a.name, a.primary_category, a.artifact_type, a.quality_score, a.source_url
       FROM artifact_relations r
       JOIN artifacts a ON (r.target_id = a.id AND r.source_id = $1)
                        OR (r.source_id = a.id AND r.target_id = $1)
       WHERE a.id != $1
       ORDER BY r.strength DESC NULLS LAST
       LIMIT $2`,
      [artifactId, limit]
    );
    return result.rows.map(r => ({ ...r, source: 'relation' }));
  } catch {
    return [];
  }
}

async function findByTags(db, seed, limit) {
  const tags = Array.isArray(seed.tags) ? seed.tags : [];
  if (tags.length === 0) return [];

  try {
    const result = await db.query(
      `SELECT id, name, primary_category, artifact_type, quality_score, source_url
       FROM artifacts
       WHERE id != $1 AND tags ?| $2
       ORDER BY quality_score DESC NULLS LAST
       LIMIT $3`,
      [seed.id, tags, limit]
    );
    return result.rows.map(r => ({ ...r, source: 'tags' }));
  } catch {
    return [];
  }
}

function computeRecommendationScore(candidate, seed) {
  let score = 0;

  // Quality bonus
  score += (candidate.quality_score || 0) * 0.005;

  // Same category bonus
  if (candidate.primary_category === seed.primary_category) score += 0.3;

  // Relation source bonus
  if (candidate.source === 'relation') score += 0.4;
  else if (candidate.source === 'tags') score += 0.2;

  return Math.round(Math.min(score, 1) * 100) / 100;
}

export { computeRecommendationScore };

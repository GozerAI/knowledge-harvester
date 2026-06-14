// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #883 — Knowledge Recommendation Engine
 *
 * Recommends related artifacts based on category, tags, relations,
 * and quality signals. Supports content-based and collaborative filtering.
 */

/**
 * Compute recommendation score for a candidate relative to a seed artifact.
 * @param {object} candidate
 * @param {object} seed
 * @returns {number} 0-1
 */
export function computeRecommendationScore(candidate, seed) {
  let score = 0;

  // Quality factor
  score += (candidate.quality_score || 0) * 0.005;

  // Category match
  if (candidate.primary_category === seed.primary_category) score += 0.3;

  // Source signal (how the candidate was found)
  if (candidate.source === 'relation') score += 0.4;
  else if (candidate.source === 'tags') score += 0.2;
  else if (candidate.source === 'category_type') score += 0.1;

  return Math.round(Math.min(score, 1) * 100) / 100;
}

/**
 * Compute tag overlap between two artifacts.
 * @param {string[]} tagsA
 * @param {string[]} tagsB
 * @returns {number} 0-1
 */
export function tagOverlap(tagsA, tagsB) {
  if (!tagsA?.length || !tagsB?.length) return 0;
  const setA = new Set(tagsA.map(t => t.toLowerCase()));
  const setB = new Set(tagsB.map(t => t.toLowerCase()));
  let intersection = 0;
  for (const t of setA) { if (setB.has(t)) intersection++; }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Get recommendations for an artifact.
 * @param {object} db
 * @param {string} artifactId
 * @param {object} [options]
 * @returns {Promise<{ recommendations: object[], summary: object }>}
 */
export async function getRecommendations(db, artifactId, options = {}) {
  const limit = options.limit || 10;

  // Get the seed artifact
  const seedResult = await db.query(
    `SELECT id, name, primary_category, artifact_type, tags, quality_score
     FROM artifacts WHERE id = $1`,
    [artifactId]
  );
  if (seedResult.rows.length === 0) return { recommendations: [], summary: { error: 'not_found' } };

  const seed = seedResult.rows[0];
  const candidates = [];

  // Related by graph edges
  try {
    const relResult = await db.query(
      `SELECT a.id, a.name, a.primary_category, a.quality_score, a.tags,
              'relation' AS source
       FROM artifact_relations r
       JOIN artifacts a ON (a.id = r.target_id OR a.id = r.source_id) AND a.id != $1
       WHERE r.source_id = $1 OR r.target_id = $1
       LIMIT $2`,
      [artifactId, limit * 2]
    );
    candidates.push(...relResult.rows);
  } catch { /* table may not exist */ }

  // Same category + type
  const catResult = await db.query(
    `SELECT id, name, primary_category, quality_score, tags,
            'category_type' AS source
     FROM artifacts
     WHERE primary_category = $1 AND artifact_type = $2 AND id != $3
     ORDER BY quality_score DESC NULLS LAST LIMIT $4`,
    [seed.primary_category, seed.artifact_type, artifactId, limit * 2]
  );
  candidates.push(...catResult.rows);

  // Score and deduplicate
  const seen = new Set();
  const scored = [];
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    scored.push({
      ...c,
      recommendation_score: computeRecommendationScore(c, seed),
    });
  }

  scored.sort((a, b) => b.recommendation_score - a.recommendation_score);

  return {
    recommendations: scored.slice(0, limit),
    summary: {
      seed_id: artifactId,
      total_candidates: candidates.length,
      returned: Math.min(scored.length, limit),
      recommended_at: new Date().toISOString(),
    },
  };
}

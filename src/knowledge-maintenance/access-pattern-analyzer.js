// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #882 — Autonomous Knowledge Access Pattern Analysis
 *
 * Analyzes how knowledge is accessed to optimize caching, prioritize
 * freshness, and identify popular vs. neglected content.
 */

/**
 * Analyze access patterns across the knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ patterns: object[], recommendations: object[], summary: object }>}
 */
export async function analyzeAccessPatterns(db, options = {}) {
  const days = options.days || 30;

  const popularContent = await getPopularContent(db, days);
  const neglectedContent = await getNeglectedContent(db, days);
  const categoryDistribution = await getAccessByCategory(db, days);
  const timePatterns = await getAccessTimePatterns(db, days);

  const recommendations = generateAccessRecommendations({
    popularContent,
    neglectedContent,
    categoryDistribution,
  });

  return {
    patterns: {
      popular: popularContent,
      neglected: neglectedContent,
      by_category: categoryDistribution,
      time_patterns: timePatterns,
    },
    recommendations,
    summary: {
      popular_count: popularContent.length,
      neglected_count: neglectedContent.length,
      recommendation_count: recommendations.length,
      period_days: days,
      analyzed_at: new Date().toISOString(),
    },
  };
}

async function getPopularContent(db, days) {
  try {
    const result = await db.query(
      `SELECT a.id, a.name, a.primary_category, a.artifact_type,
              a.quality_score, COUNT(al.id)::int AS access_count
       FROM artifacts a
       JOIN access_log al ON a.id = al.artifact_id
       WHERE al.accessed_at > NOW() - $1 * INTERVAL '1 day'
       GROUP BY a.id, a.name, a.primary_category, a.artifact_type, a.quality_score
       ORDER BY access_count DESC
       LIMIT 20`,
      [days]
    );
    return result.rows;
  } catch {
    // access_log table may not exist — use quality_score as proxy
    const result = await db.query(
      `SELECT id, name, primary_category, artifact_type, quality_score
       FROM artifacts
       WHERE quality_score IS NOT NULL
       ORDER BY quality_score DESC
       LIMIT 20`
    );
    return result.rows.map(r => ({ ...r, access_count: 0 }));
  }
}

async function getNeglectedContent(db, days) {
  try {
    const result = await db.query(
      `SELECT a.id, a.name, a.primary_category, a.artifact_type,
              a.quality_score, a.updated_at
       FROM artifacts a
       LEFT JOIN access_log al ON a.id = al.artifact_id
         AND al.accessed_at > NOW() - $1 * INTERVAL '1 day'
       WHERE al.id IS NULL
         AND a.quality_score IS NOT NULL AND a.quality_score >= 50
       ORDER BY a.quality_score DESC
       LIMIT 20`,
      [days]
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function getAccessByCategory(db, days) {
  try {
    const result = await db.query(
      `SELECT a.primary_category AS category,
              COUNT(al.id)::int AS access_count,
              COUNT(DISTINCT a.id)::int AS unique_artifacts
       FROM artifacts a
       JOIN access_log al ON a.id = al.artifact_id
       WHERE al.accessed_at > NOW() - $1 * INTERVAL '1 day'
         AND a.primary_category IS NOT NULL
       GROUP BY a.primary_category
       ORDER BY access_count DESC`,
      [days]
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function getAccessTimePatterns(db, days) {
  try {
    const result = await db.query(
      `SELECT EXTRACT(DOW FROM accessed_at)::int AS day_of_week,
              EXTRACT(HOUR FROM accessed_at)::int AS hour,
              COUNT(*)::int AS access_count
       FROM access_log
       WHERE accessed_at > NOW() - $1 * INTERVAL '1 day'
       GROUP BY EXTRACT(DOW FROM accessed_at), EXTRACT(HOUR FROM accessed_at)
       ORDER BY access_count DESC
       LIMIT 24`,
      [days]
    );
    return result.rows;
  } catch {
    return [];
  }
}

function generateAccessRecommendations({ popularContent, neglectedContent, categoryDistribution }) {
  const recs = [];

  // Popular content should be kept fresh
  for (const item of popularContent.slice(0, 5)) {
    recs.push({
      action: 'prioritize_freshness',
      artifact_id: item.id,
      reason: `Frequently accessed (${item.access_count} times)`,
    });
  }

  // Neglected high-quality content may need better discoverability
  for (const item of neglectedContent.slice(0, 5)) {
    recs.push({
      action: 'improve_discoverability',
      artifact_id: item.id,
      reason: `High quality (${item.quality_score}) but no recent access`,
    });
  }

  return recs;
}

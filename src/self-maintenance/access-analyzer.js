// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #882 — Access Pattern Analysis
 *
 * Analyzes how artifacts are accessed (queries, views, exports) to identify
 * popular content, neglected artifacts, and temporal usage patterns.
 */

const ANALYSIS_DIMENSIONS = ['popular', 'neglected', 'by_category', 'time_patterns'];

/**
 * Analyze access patterns across the knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ popular: object[], neglected: object[], patterns: object, summary: object }>}
 */
export async function analyzeAccessPatterns(db, options = {}) {
  const days = options.days || 30;
  const limit = options.limit || 50;

  const popular = await getPopularArtifacts(db, days, limit);
  const neglected = await getNeglectedArtifacts(db, days, limit);
  const categoryBreakdown = await getCategoryAccessBreakdown(db, days);

  return {
    popular,
    neglected,
    patterns: { by_category: categoryBreakdown },
    summary: {
      popular_count: popular.length,
      neglected_count: neglected.length,
      analysis_window_days: days,
      analyzed_at: new Date().toISOString(),
    },
  };
}

async function getPopularArtifacts(db, days, limit) {
  try {
    const result = await db.query(
      `SELECT a.id, a.name, a.primary_category, a.quality_score,
              COUNT(al.id)::int AS access_count
       FROM artifacts a
       JOIN access_log al ON al.artifact_id = a.id
       WHERE al.accessed_at > NOW() - $1 * INTERVAL '1 day'
       GROUP BY a.id, a.name, a.primary_category, a.quality_score
       ORDER BY access_count DESC LIMIT $2`,
      [days, limit]
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function getNeglectedArtifacts(db, days, limit) {
  try {
    const result = await db.query(
      `SELECT a.id, a.name, a.primary_category, a.quality_score, a.updated_at
       FROM artifacts a
       LEFT JOIN access_log al ON al.artifact_id = a.id
         AND al.accessed_at > NOW() - $1 * INTERVAL '1 day'
       WHERE al.id IS NULL AND (a.archived IS NULL OR a.archived = false)
       ORDER BY a.quality_score DESC NULLS LAST LIMIT $2`,
      [days, limit]
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function getCategoryAccessBreakdown(db, days) {
  try {
    const result = await db.query(
      `SELECT a.primary_category, COUNT(al.id)::int AS access_count,
              COUNT(DISTINCT a.id)::int AS unique_artifacts
       FROM artifacts a
       JOIN access_log al ON al.artifact_id = a.id
       WHERE al.accessed_at > NOW() - $1 * INTERVAL '1 day'
         AND a.primary_category IS NOT NULL
       GROUP BY a.primary_category ORDER BY access_count DESC`,
      [days]
    );
    return result.rows;
  } catch {
    return [];
  }
}

export { ANALYSIS_DIMENSIONS };

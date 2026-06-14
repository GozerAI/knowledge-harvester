// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Category Coverage Analysis — matrix, gap detection, and reporting.
 *
 * Analyzes the artifact table to produce a coverage matrix showing
 * which category×type cells have sufficient artifacts.
 */

/**
 * Analyze coverage: artifact counts by category and type.
 * @param {object} db
 * @returns {Promise<Array<{ primary_category: string, artifact_type: string, count: number, avg_quality: number, last_updated: string }>>}
 */
export async function analyzeCoverage(db) {
  const result = await db.query(
    `SELECT primary_category, artifact_type,
            COUNT(*)::int AS count,
            ROUND(AVG(quality_score)::numeric, 2)::float AS avg_quality,
            MAX(updated_at)::text AS last_updated
     FROM artifacts
     WHERE primary_category IS NOT NULL
     GROUP BY primary_category, artifact_type
     ORDER BY primary_category, artifact_type`
  );
  return result.rows;
}

/**
 * Identify coverage gaps — category×type cells with fewer than minArtifacts.
 * @param {object} db
 * @param {number} [minArtifacts=5]
 * @returns {Promise<Array<{ primary_category: string, artifact_type: string, count: number }>>}
 */
export async function identifyGaps(db, minArtifacts = 5) {
  const matrix = await analyzeCoverage(db);
  return matrix.filter(cell => cell.count < minArtifacts);
}

/**
 * Full coverage report with matrix, gaps, and summary stats.
 * @param {object} db
 * @param {number} [minArtifacts=5]
 * @returns {Promise<object>}
 */
export async function getCoverageReport(db, minArtifacts = 5) {
  const matrix = await analyzeCoverage(db);
  const gaps = matrix.filter(cell => cell.count < minArtifacts);

  const categories = new Set(matrix.map(r => r.primary_category));
  const types = new Set(matrix.map(r => r.artifact_type));
  const totalCoverage = matrix.length > 0
    ? matrix.reduce((sum, r) => sum + r.count, 0) / matrix.length
    : 0;

  return {
    matrix,
    gaps,
    summary: {
      total_categories: categories.size,
      total_types: types.size,
      total_cells: matrix.length,
      gap_count: gaps.length,
      avg_coverage: Math.round(totalCoverage * 100) / 100,
    },
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #889 — Completeness Assessment
 *
 * Assesses the completeness of the knowledge base across multiple
 * dimensions: field population, category coverage, cross-references,
 * depth coverage, and temporal coverage.
 */

const COMPLETENESS_DIMENSIONS = [
  'field_population',
  'category_coverage',
  'cross_references',
  'depth_coverage',
  'temporal_coverage',
];

const REQUIRED_FIELDS = ['name', 'artifact_type'];
const DESIRED_FIELDS = ['description', 'primary_category', 'source_url', 'tags', 'quality_score'];

/**
 * Assess field population rate for an artifact.
 * @param {object} artifact
 * @returns {{ score: number, populated: string[], missing: string[] }}
 */
export function assessFieldPopulation(artifact) {
  const allFields = [...REQUIRED_FIELDS, ...DESIRED_FIELDS];
  const populated = [];
  const missing = [];

  for (const field of allFields) {
    const val = artifact[field];
    const hasValue = val != null && (typeof val !== 'string' || val.trim().length > 0) &&
      (!Array.isArray(val) || val.length > 0);
    if (hasValue) populated.push(field);
    else missing.push(field);
  }

  return {
    score: Math.round((populated.length / allFields.length) * 100),
    populated,
    missing,
  };
}

/**
 * Run a full completeness assessment.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ dimensions: object, overall_score: number, summary: object }>}
 */
export async function assessCompleteness(db, options = {}) {
  const dimensions = {};

  // Field population
  const fieldResult = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE name IS NOT NULL AND name != '')::int AS has_name,
       COUNT(*) FILTER (WHERE description IS NOT NULL AND length(description) > 10)::int AS has_desc,
       COUNT(*) FILTER (WHERE primary_category IS NOT NULL)::int AS has_category,
       COUNT(*) FILTER (WHERE source_url IS NOT NULL)::int AS has_source_url,
       COUNT(*) FILTER (WHERE quality_score IS NOT NULL)::int AS has_quality
     FROM artifacts`
  );
  const fr = fieldResult.rows[0] || {};
  const total = fr.total || 1;
  dimensions.field_population = {
    score: Math.round(((fr.has_name + fr.has_desc + fr.has_category + fr.has_source_url + fr.has_quality) / (total * 5)) * 100),
    details: {
      name: Math.round((fr.has_name / total) * 100),
      description: Math.round((fr.has_desc / total) * 100),
      category: Math.round((fr.has_category / total) * 100),
      source_url: Math.round((fr.has_source_url / total) * 100),
      quality_score: Math.round((fr.has_quality / total) * 100),
    },
  };

  // Category coverage
  const catResult = await db.query(
    `SELECT COUNT(DISTINCT primary_category)::int AS categories FROM artifacts WHERE primary_category IS NOT NULL`
  );
  const catCount = catResult.rows[0]?.categories || 0;
  dimensions.category_coverage = {
    score: Math.min(catCount * 10, 100),
    categories: catCount,
  };

  // Cross-references
  try {
    const refResult = await db.query(
      `SELECT COUNT(*)::int AS refs FROM artifact_relations`
    );
    const refCount = refResult.rows[0]?.refs || 0;
    dimensions.cross_references = {
      score: Math.min(Math.round((refCount / Math.max(total, 1)) * 50), 100),
      total_relations: refCount,
    };
  } catch {
    dimensions.cross_references = { score: 0, total_relations: 0 };
  }

  // Depth coverage (quality score distribution)
  const qualResult = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE quality_score >= 70)::int AS high,
       COUNT(*) FILTER (WHERE quality_score >= 40 AND quality_score < 70)::int AS medium,
       COUNT(*) FILTER (WHERE quality_score < 40)::int AS low,
       COUNT(*) FILTER (WHERE quality_score IS NULL)::int AS unscored
     FROM artifacts`
  );
  const qr = qualResult.rows[0] || {};
  const highRatio = (qr.high || 0) / Math.max(total, 1);
  dimensions.depth_coverage = {
    score: Math.round(highRatio * 100),
    distribution: { high: qr.high, medium: qr.medium, low: qr.low, unscored: qr.unscored },
  };

  // Temporal coverage
  const tempResult = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '30 days')::int AS last_30d,
       COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '90 days')::int AS last_90d
     FROM artifacts`
  );
  const tr = tempResult.rows[0] || {};
  dimensions.temporal_coverage = {
    score: Math.round(((tr.last_90d || 0) / Math.max(total, 1)) * 100),
    last_30d: tr.last_30d || 0,
    last_90d: tr.last_90d || 0,
  };

  // Overall score (weighted average)
  const weights = { field_population: 0.3, category_coverage: 0.2, cross_references: 0.15,
    depth_coverage: 0.2, temporal_coverage: 0.15 };
  const overall_score = Math.round(
    Object.entries(weights).reduce((s, [dim, w]) => s + (dimensions[dim]?.score || 0) * w, 0)
  );

  return {
    dimensions,
    overall_score,
    summary: {
      overall_score,
      dimension_count: COMPLETENESS_DIMENSIONS.length,
      assessed_at: new Date().toISOString(),
    },
  };
}

export { COMPLETENESS_DIMENSIONS, REQUIRED_FIELDS, DESIRED_FIELDS };

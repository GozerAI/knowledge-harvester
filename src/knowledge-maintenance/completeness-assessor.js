// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #889 — Autonomous Knowledge Completeness Assessment
 *
 * Assesses the completeness of the knowledge base across dimensions:
 * field population, category coverage, cross-references, and depth.
 */

const COMPLETENESS_DIMENSIONS = [
  'field_population',
  'category_coverage',
  'cross_references',
  'depth_coverage',
  'temporal_coverage',
];

/**
 * Assess knowledge base completeness.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ scores: object, overall: number, gaps: object[], summary: object }>}
 */
export async function assessCompleteness(db, options = {}) {
  const scores = {};

  scores.field_population = await assessFieldPopulation(db);
  scores.category_coverage = await assessCategoryCoverage(db);
  scores.cross_references = await assessCrossReferences(db);
  scores.depth_coverage = await assessDepthCoverage(db);
  scores.temporal_coverage = await assessTemporalCoverage(db);

  const overall = Math.round(
    Object.values(scores).reduce((s, dim) => s + dim.score, 0) / COMPLETENESS_DIMENSIONS.length
  );

  const gaps = Object.entries(scores)
    .filter(([, dim]) => dim.score < 60)
    .map(([name, dim]) => ({
      dimension: name,
      score: dim.score,
      issues: dim.issues || [],
    }));

  return {
    scores,
    overall,
    gaps,
    summary: {
      overall_completeness: overall,
      dimension_count: COMPLETENESS_DIMENSIONS.length,
      gaps_found: gaps.length,
      assessed_at: new Date().toISOString(),
    },
  };
}

async function assessFieldPopulation(db) {
  const result = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE name IS NOT NULL AND name != '')::int AS has_name,
       COUNT(*) FILTER (WHERE description IS NOT NULL AND length(description) > 10)::int AS has_desc,
       COUNT(*) FILTER (WHERE primary_category IS NOT NULL)::int AS has_category,
       COUNT(*) FILTER (WHERE source_url IS NOT NULL)::int AS has_source,
       COUNT(*) FILTER (WHERE quality_score IS NOT NULL)::int AS has_score,
       COUNT(*) FILTER (WHERE tags IS NOT NULL)::int AS has_tags
     FROM artifacts`
  );

  const row = result.rows[0] || {};
  const total = row.total || 1;
  const fields = {
    name: (row.has_name || 0) / total,
    description: (row.has_desc || 0) / total,
    category: (row.has_category || 0) / total,
    source_url: (row.has_source || 0) / total,
    quality_score: (row.has_score || 0) / total,
    tags: (row.has_tags || 0) / total,
  };

  const avg = Object.values(fields).reduce((s, v) => s + v, 0) / Object.keys(fields).length;
  const issues = Object.entries(fields).filter(([, v]) => v < 0.5).map(([k, v]) => `${k}: ${Math.round(v * 100)}%`);

  return { score: Math.round(avg * 100), fields, issues };
}

async function assessCategoryCoverage(db) {
  const result = await db.query(
    `SELECT COUNT(DISTINCT primary_category)::int AS categories,
            COUNT(DISTINCT artifact_type)::int AS types
     FROM artifacts
     WHERE primary_category IS NOT NULL`
  );

  const cats = result.rows[0]?.categories || 0;
  const types = result.rows[0]?.types || 0;
  const expectedCats = 10;
  const expectedTypes = 7;

  const score = Math.round(
    (Math.min(cats / expectedCats, 1) * 0.6 + Math.min(types / expectedTypes, 1) * 0.4) * 100
  );

  const issues = [];
  if (cats < expectedCats) issues.push(`Only ${cats}/${expectedCats} expected categories`);
  if (types < expectedTypes) issues.push(`Only ${types}/${expectedTypes} expected types`);

  return { score, categories: cats, types, issues };
}

async function assessCrossReferences(db) {
  try {
    const total = await db.query(`SELECT COUNT(*)::int AS count FROM artifacts`);
    const withRefs = await db.query(
      `SELECT COUNT(DISTINCT source_id)::int AS count FROM artifact_relations`
    );

    const totalCount = total.rows[0]?.count || 1;
    const refCount = withRefs.rows[0]?.count || 0;
    const ratio = refCount / totalCount;

    return {
      score: Math.round(Math.min(ratio / 0.3, 1) * 100),
      with_references: refCount,
      total: totalCount,
      issues: ratio < 0.1 ? ['Less than 10% of artifacts have cross-references'] : [],
    };
  } catch {
    return { score: 0, issues: ['Cross-reference table not available'] };
  }
}

async function assessDepthCoverage(db) {
  const result = await db.query(
    `SELECT primary_category, COUNT(*)::int AS count
     FROM artifacts
     WHERE primary_category IS NOT NULL
     GROUP BY primary_category`
  );

  const counts = result.rows.map(r => r.count);
  const shallow = counts.filter(c => c < 5).length;
  const total = counts.length || 1;

  return {
    score: Math.round((1 - shallow / total) * 100),
    categories: total,
    shallow_categories: shallow,
    issues: shallow > 0 ? [`${shallow} categories have fewer than 5 artifacts`] : [],
  };
}

async function assessTemporalCoverage(db) {
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '30 days')::int AS recent,
       COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '90 days')::int AS quarter,
       COUNT(*)::int AS total
     FROM artifacts`
  );

  const row = result.rows[0] || {};
  const total = row.total || 1;
  const recentRatio = (row.recent || 0) / total;
  const quarterRatio = (row.quarter || 0) / total;

  return {
    score: Math.round((recentRatio * 0.6 + quarterRatio * 0.4) * 100),
    recent_30d: row.recent || 0,
    recent_90d: row.quarter || 0,
    total: row.total || 0,
    issues: recentRatio < 0.1 ? ['Less than 10% of content updated in last 30 days'] : [],
  };
}

export { COMPLETENESS_DIMENSIONS };

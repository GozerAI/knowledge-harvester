// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #693 — Autonomous Knowledge Gap Detection
 *
 * Continuously analyzes the knowledge base to identify missing coverage areas,
 * under-represented topics, and emerging domains that need harvesting attention.
 */

const DEFAULT_MIN_ARTIFACTS = 3;
const DEFAULT_STALENESS_DAYS = 90;
const EMERGING_TOPIC_THRESHOLD = 0.6;

/**
 * @typedef {object} KnowledgeGap
 * @property {string} category
 * @property {string} type
 * @property {string} severity - 'critical' | 'high' | 'medium' | 'low'
 * @property {string} reason
 * @property {number} current_count
 * @property {number} recommended_count
 * @property {string[]} suggested_sources
 */

/**
 * Analyze the knowledge base for coverage gaps.
 * @param {object} db
 * @param {object} [options]
 * @param {number} [options.minArtifacts]
 * @param {number} [options.stalenessDays]
 * @returns {Promise<{ gaps: KnowledgeGap[], summary: object }>}
 */
export async function detectKnowledgeGaps(db, options = {}) {
  const minArtifacts = options.minArtifacts ?? DEFAULT_MIN_ARTIFACTS;
  const stalenessDays = options.stalenessDays ?? DEFAULT_STALENESS_DAYS;

  const coverageGaps = await findCoverageGaps(db, minArtifacts);
  const stalenessGaps = await findStalenessGaps(db, stalenessDays);
  const depthGaps = await findDepthGaps(db);
  const crossRefGaps = await findCrossReferenceGaps(db);

  const allGaps = [...coverageGaps, ...stalenessGaps, ...depthGaps, ...crossRefGaps];
  allGaps.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  return {
    gaps: allGaps,
    summary: {
      total_gaps: allGaps.length,
      critical: allGaps.filter(g => g.severity === 'critical').length,
      high: allGaps.filter(g => g.severity === 'high').length,
      medium: allGaps.filter(g => g.severity === 'medium').length,
      low: allGaps.filter(g => g.severity === 'low').length,
      scanned_at: new Date().toISOString(),
    },
  };
}

/**
 * Find categories/types with fewer than minArtifacts.
 */
async function findCoverageGaps(db, minArtifacts) {
  const result = await db.query(
    `SELECT primary_category, artifact_type, COUNT(*)::int AS cnt
     FROM artifacts
     WHERE primary_category IS NOT NULL
     GROUP BY primary_category, artifact_type`
  );

  const gaps = [];
  for (const row of result.rows) {
    if (row.cnt < minArtifacts) {
      const severity = row.cnt === 0 ? 'critical' : row.cnt < Math.floor(minArtifacts / 2) ? 'high' : 'medium';
      gaps.push({
        category: row.primary_category,
        type: row.artifact_type,
        severity,
        reason: 'insufficient_coverage',
        current_count: row.cnt,
        recommended_count: minArtifacts,
        suggested_sources: suggestSources(row.primary_category, row.artifact_type),
      });
    }
  }
  return gaps;
}

/**
 * Find categories where all artifacts are stale.
 */
async function findStalenessGaps(db, stalenessDays) {
  const cutoff = new Date(Date.now() - stalenessDays * 86400000).toISOString();
  const result = await db.query(
    `SELECT primary_category, artifact_type,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE updated_at < $1)::int AS stale
     FROM artifacts
     WHERE primary_category IS NOT NULL
     GROUP BY primary_category, artifact_type
     HAVING COUNT(*) FILTER (WHERE updated_at < $1)::float / COUNT(*) > 0.7`,
    [cutoff]
  );

  return result.rows.map(row => ({
    category: row.primary_category,
    type: row.artifact_type,
    severity: row.stale === row.total ? 'critical' : 'high',
    reason: 'stale_content',
    current_count: row.total,
    recommended_count: row.total,
    suggested_sources: suggestSources(row.primary_category, row.artifact_type),
  }));
}

/**
 * Find categories with low average quality (depth gaps).
 */
async function findDepthGaps(db) {
  const result = await db.query(
    `SELECT primary_category, artifact_type,
            COUNT(*)::int AS total,
            ROUND(AVG(quality_score)::numeric, 2)::float AS avg_quality
     FROM artifacts
     WHERE primary_category IS NOT NULL AND quality_score IS NOT NULL
     GROUP BY primary_category, artifact_type
     HAVING AVG(quality_score) < 40`
  );

  return result.rows.map(row => ({
    category: row.primary_category,
    type: row.artifact_type,
    severity: row.avg_quality < 20 ? 'high' : 'medium',
    reason: 'low_quality_depth',
    current_count: row.total,
    recommended_count: row.total,
    suggested_sources: suggestSources(row.primary_category, row.artifact_type),
  }));
}

/**
 * Find isolated categories with no cross-references.
 */
async function findCrossReferenceGaps(db) {
  try {
    const result = await db.query(
      `SELECT a.primary_category, a.artifact_type, COUNT(DISTINCT a.id)::int AS total,
              COUNT(DISTINCT r.source_id)::int AS with_refs
       FROM artifacts a
       LEFT JOIN artifact_relations r ON a.id = r.source_id OR a.id = r.target_id
       WHERE a.primary_category IS NOT NULL
       GROUP BY a.primary_category, a.artifact_type
       HAVING COUNT(DISTINCT r.source_id)::float / NULLIF(COUNT(DISTINCT a.id), 0) < 0.1`
    );

    return result.rows.map(row => ({
      category: row.primary_category,
      type: row.artifact_type,
      severity: 'low',
      reason: 'isolated_content',
      current_count: row.total,
      recommended_count: row.total,
      suggested_sources: [],
    }));
  } catch {
    // artifact_relations table may not exist
    return [];
  }
}

/**
 * Suggest harvesting sources for a given category/type.
 */
function suggestSources(category, type) {
  const sourceMap = {
    workflow: ['n8n-community', 'github', 'activepieces', 'temporal'],
    code_pattern: ['github', 'github-agents', 'langgraph'],
    infra_config: ['terraform', 'helm', 'docker-compose', 'k8s-manifests', 'ansible'],
    ai_ml_asset: ['github-agents', 'comfyui', 'mlflow', 'jupyter'],
    api_spec: ['github', 'openapi-specs'],
    data_asset: ['dbt', 'kaggle'],
    documentation: ['github', 'adrs', 'runbooks'],
  };
  return sourceMap[type] || ['github'];
}

function severityRank(severity) {
  const ranks = { critical: 0, high: 1, medium: 2, low: 3 };
  return ranks[severity] ?? 4;
}

/**
 * Quick summary scan — returns just counts by severity.
 */
export async function gapSummary(db, options = {}) {
  const { summary } = await detectKnowledgeGaps(db, options);
  return summary;
}

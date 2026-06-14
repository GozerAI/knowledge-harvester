// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #869 — Autonomous Knowledge Gap Identification
 *
 * Identifies gaps in the knowledge base by analyzing category coverage,
 * topic completeness, and comparison with expected knowledge domains.
 */

const EXPECTED_DOMAINS = [
  { domain: 'automation', types: ['workflow', 'code_pattern'], minArtifacts: 10 },
  { domain: 'infrastructure', types: ['infra_config'], minArtifacts: 10 },
  { domain: 'ai-ml', types: ['ai_ml_asset', 'code_pattern'], minArtifacts: 5 },
  { domain: 'api-design', types: ['api_spec', 'documentation'], minArtifacts: 5 },
  { domain: 'data', types: ['data_asset', 'code_pattern'], minArtifacts: 5 },
  { domain: 'devops', types: ['infra_config', 'workflow'], minArtifacts: 10 },
  { domain: 'security', types: ['code_pattern', 'documentation'], minArtifacts: 3 },
  { domain: 'monitoring', types: ['infra_config', 'code_pattern'], minArtifacts: 3 },
];

/**
 * Identify knowledge gaps across all dimensions.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ gaps: object[], recommendations: object[], summary: object }>}
 */
export async function identifyKnowledgeGaps(db, options = {}) {
  const domainGaps = await checkDomainCoverage(db);
  const typeGaps = await checkTypeCoverage(db);
  const topicGaps = await checkTopicCompleteness(db);

  const allGaps = [...domainGaps, ...typeGaps, ...topicGaps];
  const recommendations = generateRecommendations(allGaps);

  return {
    gaps: allGaps,
    recommendations,
    summary: {
      total_gaps: allGaps.length,
      by_dimension: {
        domain: domainGaps.length,
        type: typeGaps.length,
        topic: topicGaps.length,
      },
      recommendation_count: recommendations.length,
      identified_at: new Date().toISOString(),
    },
  };
}

async function checkDomainCoverage(db) {
  const gaps = [];
  for (const domain of EXPECTED_DOMAINS) {
    const placeholders = domain.types.map((_, i) => `$${i + 1}`).join(', ');
    const result = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM artifacts
       WHERE artifact_type IN (${placeholders})
         AND (primary_category = $${domain.types.length + 1} OR primary_category IS NULL)`,
      [...domain.types, domain.domain]
    );

    const count = result.rows[0]?.count || 0;
    if (count < domain.minArtifacts) {
      gaps.push({
        dimension: 'domain',
        name: domain.domain,
        current: count,
        expected: domain.minArtifacts,
        deficit: domain.minArtifacts - count,
        severity: count === 0 ? 'critical' : count < domain.minArtifacts / 2 ? 'high' : 'medium',
      });
    }
  }
  return gaps;
}

async function checkTypeCoverage(db) {
  const result = await db.query(
    `SELECT artifact_type, COUNT(*)::int AS count
     FROM artifacts
     GROUP BY artifact_type`
  );

  const typeCounts = new Map(result.rows.map(r => [r.artifact_type, r.count]));
  const allTypes = ['workflow', 'code_pattern', 'infra_config', 'ai_ml_asset', 'api_spec', 'data_asset', 'documentation'];
  const gaps = [];

  for (const type of allTypes) {
    const count = typeCounts.get(type) || 0;
    if (count < 5) {
      gaps.push({
        dimension: 'type',
        name: type,
        current: count,
        expected: 5,
        deficit: 5 - count,
        severity: count === 0 ? 'critical' : 'high',
      });
    }
  }
  return gaps;
}

async function checkTopicCompleteness(db) {
  const result = await db.query(
    `SELECT primary_category, COUNT(*)::int AS count,
            COUNT(DISTINCT artifact_type)::int AS type_count
     FROM artifacts
     WHERE primary_category IS NOT NULL
     GROUP BY primary_category`
  );

  const gaps = [];
  for (const row of result.rows) {
    if (row.type_count < 2) {
      gaps.push({
        dimension: 'topic',
        name: row.primary_category,
        current: row.type_count,
        expected: 2,
        deficit: 2 - row.type_count,
        severity: 'medium',
      });
    }
  }
  return gaps;
}

function generateRecommendations(gaps) {
  return gaps
    .filter(g => g.severity === 'critical' || g.severity === 'high')
    .map(g => ({
      action: `Harvest more ${g.name} content`,
      priority: g.severity === 'critical' ? 'immediate' : 'soon',
      deficit: g.deficit,
      suggested_sources: getSuggestedSources(g.name),
    }));
}

function getSuggestedSources(domain) {
  const mapping = {
    automation: ['n8n-community', 'github', 'activepieces'],
    infrastructure: ['terraform', 'helm', 'ansible', 'docker-compose'],
    'ai-ml': ['github-agents', 'comfyui', 'mlflow', 'jupyter'],
    'api-design': ['github', 'openapi-specs'],
    data: ['dbt', 'dagster', 'airflow'],
    devops: ['github-actions', 'ci-configs', 'terraform'],
    security: ['github'],
    monitoring: ['github'],
    workflow: ['n8n-community', 'github', 'temporal'],
    code_pattern: ['github', 'github-agents'],
    infra_config: ['terraform', 'helm', 'ansible'],
    ai_ml_asset: ['github-agents', 'jupyter', 'mlflow'],
    api_spec: ['openapi-specs', 'github'],
    data_asset: ['dbt', 'dagster'],
    documentation: ['github', 'adrs', 'runbooks'],
  };
  return mapping[domain] || ['github'];
}

export { EXPECTED_DOMAINS, generateRecommendations };

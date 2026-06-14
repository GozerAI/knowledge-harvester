// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #869 — Knowledge Gap Identification
 *
 * Identifies gaps in knowledge coverage by analyzing query patterns,
 * expected domains, and artifact distribution to find under-served areas.
 */

const EXPECTED_DOMAINS = [
  { domain: 'automation', types: ['workflow', 'code_pattern'], minArtifacts: 10 },
  { domain: 'infrastructure', types: ['infra_config'], minArtifacts: 10 },
  { domain: 'ai-agents', types: ['ai_ml_asset', 'code_pattern'], minArtifacts: 10 },
  { domain: 'data-engineering', types: ['data_asset', 'code_pattern'], minArtifacts: 5 },
  { domain: 'security', types: ['infra_config', 'documentation'], minArtifacts: 5 },
  { domain: 'monitoring', types: ['infra_config', 'documentation'], minArtifacts: 5 },
];

/**
 * Identify knowledge gaps from domain expectations vs reality.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ gaps: object[], coverage: object, summary: object }>}
 */
export async function identifyGaps(db, options = {}) {
  const domains = options.domains || EXPECTED_DOMAINS;
  const distribution = await getDistribution(db);
  const queryGaps = await analyzeQueryPatterns(db);

  const gaps = [];

  for (const domain of domains) {
    const actual = distribution.get(domain.domain) || {};
    const totalCount = domain.types.reduce((s, t) => s + (actual[t] || 0), 0);

    if (totalCount < domain.minArtifacts) {
      gaps.push({
        domain: domain.domain,
        expected_types: domain.types,
        current_count: totalCount,
        expected_count: domain.minArtifacts,
        deficit: domain.minArtifacts - totalCount,
        severity: totalCount === 0 ? 'critical' : totalCount < domain.minArtifacts / 2 ? 'high' : 'medium',
        source: 'domain_expectation',
      });
    }
  }

  for (const qg of queryGaps) {
    gaps.push({ ...qg, source: 'query_pattern' });
  }

  gaps.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const coverage = {};
  for (const domain of domains) {
    const actual = distribution.get(domain.domain) || {};
    const totalCount = domain.types.reduce((s, t) => s + (actual[t] || 0), 0);
    coverage[domain.domain] = {
      count: totalCount,
      expected: domain.minArtifacts,
      pct: Math.round((totalCount / domain.minArtifacts) * 100),
    };
  }

  return {
    gaps,
    coverage,
    summary: {
      total_gaps: gaps.length,
      by_severity: countBy(gaps, 'severity'),
      assessed_at: new Date().toISOString(),
    },
  };
}

async function getDistribution(db) {
  const result = await db.query(
    `SELECT primary_category, artifact_type, COUNT(*)::int AS cnt
     FROM artifacts WHERE primary_category IS NOT NULL
     GROUP BY primary_category, artifact_type`
  );
  const map = new Map();
  for (const row of result.rows) {
    if (!map.has(row.primary_category)) map.set(row.primary_category, {});
    map.get(row.primary_category)[row.artifact_type] = row.cnt;
  }
  return map;
}

async function analyzeQueryPatterns(db) {
  try {
    const result = await db.query(
      `SELECT query_category, COUNT(*)::int AS query_count,
              COUNT(*) FILTER (WHERE result_count = 0)::int AS zero_results
       FROM query_log WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY query_category HAVING COUNT(*) FILTER (WHERE result_count = 0)::float / COUNT(*) > 0.5`
    );
    return result.rows.map(r => ({
      domain: r.query_category,
      severity: r.zero_results > 10 ? 'high' : 'medium',
      current_count: 0,
      expected_count: r.query_count,
      deficit: r.query_count,
    }));
  } catch {
    return [];
  }
}

function severityRank(s) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[s] ?? 4;
}

function countBy(arr, field) {
  const c = {};
  for (const i of arr) { c[i[field]] = (c[i[field]] || 0) + 1; }
  return c;
}

export { EXPECTED_DOMAINS };

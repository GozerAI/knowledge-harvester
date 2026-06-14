// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Recommender — Generates per-artifact recommendations based on artifact_relations.
 *
 * For each artifact, queries its relation graph (both directions), scores each
 * candidate using a weighted blend of relation confidence, category affinity,
 * and type compatibility, selects the top-10, then persists them into
 * type_metadata.recommendations.
 *
 * Score formula:
 *   score = relation.confidence × 0.4 + categoryAffinity × 0.3 + typeCompatibility × 0.3
 */

import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

// Category clusters used for affinity scoring.
// Categories within the same cluster score 0.5 (related), others score 0.1.
const CATEGORY_CLUSTERS = [
  new Set(['ai-agent', 'ml-data-ops', 'ai-image-generation']),
  new Set(['data-pipeline', 'data-processing', 'streaming-realtime']),
  new Set(['devops-monitoring', 'ci-cd-pipeline', 'infrastructure-as-code']),
  new Set(['orchestration', 'multi-step-automation', 'business-process']),
  new Set(['ecommerce', 'finance-accounting', 'lead-gen-crm']),
  new Set(['content-marketing', 'customer-support', 'general-productivity']),
  new Set(['integration-pipeline', 'iot-home-automation']),
  new Set(['security-automation']),
];

// Artifact type compatibility table — pairs that work well together score high.
const HIGH_COMPAT_PAIRS = new Set([
  'workflow|infra_config',
  'infra_config|workflow',
  'workflow|api_spec',
  'api_spec|workflow',
  'code_pattern|documentation',
  'documentation|code_pattern',
  'ai_ml_asset|workflow',
  'workflow|ai_ml_asset',
  'data_asset|workflow',
  'workflow|data_asset',
  'infra_config|api_spec',
  'api_spec|infra_config',
]);

// ── Pure scoring functions (also exported for testing) ────────────────────────

/**
 * Determine how related two category strings are.
 *
 * @param {string|null} catA
 * @param {string|null} catB
 * @returns {number} 1.0 (identical) | 0.5 (same cluster) | 0.1 (unrelated)
 */
export function categoryAffinity(catA, catB) {
  if (!catA || !catB) return 0.1;
  if (catA === catB) return 1.0;

  for (const cluster of CATEGORY_CLUSTERS) {
    if (cluster.has(catA) && cluster.has(catB)) return 0.5;
  }

  return 0.1;
}

/**
 * Score the type compatibility of two artifact types.
 *
 * @param {string|null} typeA
 * @param {string|null} typeB
 * @returns {number} 1.0 (high compat) | 0.6 (same type) | 0.3 (unrelated)
 */
export function typeCompatibility(typeA, typeB) {
  if (!typeA || !typeB) return 0.3;
  if (typeA === typeB) return 0.6;
  if (HIGH_COMPAT_PAIRS.has(`${typeA}|${typeB}`)) return 1.0;
  return 0.3;
}

/**
 * Compute a 0-1 composite recommendation score for a candidate artifact.
 *
 * @param {object} source - The artifact we are generating recommendations for
 * @param {object} candidate - A related artifact being evaluated
 * @param {object} relation - The artifact_relation row joining them
 * @returns {number}
 */
export function scoreCandidate(source, candidate, relation) {
  if (!source || !candidate || !relation) return 0;

  const relConfidence = Math.max(0, Math.min(1, parseFloat(relation.confidence) || 0));
  const affinity = categoryAffinity(source.primary_category, candidate.primary_category);
  const compat = typeCompatibility(source.artifact_type, candidate.artifact_type);

  return relConfidence * 0.4 + affinity * 0.3 + compat * 0.3;
}

/**
 * Apply a trend boost to a recommendation score.
 *
 * Artifacts with active BUY or STRONG_BUY trend signals get a +0.1 boost,
 * capped at 1.0.
 *
 * @param {number} baseScore - The original 0-1 recommendation score
 * @param {object|null} marketplaceMetadata - The candidate's marketplace_metadata
 * @returns {number} Boosted score, capped at 1.0
 */
export function applyTrendBoost(baseScore, marketplaceMetadata) {
  if (!marketplaceMetadata) return baseScore;

  const trendSignals = marketplaceMetadata.trend_signals;
  if (!Array.isArray(trendSignals) || trendSignals.length === 0) return baseScore;

  const hasBuySignal = trendSignals.some(
    s => s.signal === 'buy' || s.signal === 'strong_buy'
  );

  if (hasBuySignal) {
    return Math.min(1.0, baseScore + 0.1);
  }

  return baseScore;
}

// ── DB-backed main export ─────────────────────────────────────────────────────

/**
 * Generate recommendations for each artifact and persist them into
 * type_metadata.recommendations.
 *
 * @param {object} dbClient - db client (pool wrapper with .query())
 * @param {number} [limit=100] - Maximum number of artifacts to process
 * @returns {Promise<{ processed: number, recommendations_generated: number }>}
 */
export async function generateRecommendations(dbClient, limit = 100) {
  logger.info('Generating recommendations', { limit });

  const artifactsResult = await dbClient.query(
    `SELECT id, artifact_type, primary_category, name
     FROM artifacts
     WHERE primary_category IS NOT NULL
     ORDER BY quality_score DESC
     LIMIT $1`,
    [limit],
  );

  const artifacts = artifactsResult.rows;

  if (artifacts.length === 0) {
    logger.info('No artifacts available for recommendations');
    return { processed: 0, recommendations_generated: 0 };
  }

  let recommendations_generated = 0;

  for (const source of artifacts) {
    try {
      // Query relations in both directions, joining the related artifact's data
      const relResult = await dbClient.query(
        `SELECT
           r.confidence,
           r.relation_type,
           CASE
             WHEN r.source_id = $1 THEN r.target_id
             ELSE r.source_id
           END AS related_id
         FROM artifact_relations r
         WHERE r.source_id = $1 OR r.target_id = $1`,
        [source.id],
      );

      if (relResult.rows.length === 0) continue;

      // Fetch candidate artifact details in a single query
      const relatedIds = relResult.rows.map(r => r.related_id);
      const candidatesResult = await dbClient.query(
        `SELECT id, name, artifact_type, primary_category, quality_score, marketplace_metadata
         FROM artifacts
         WHERE id = ANY($1::uuid[])`,
        [relatedIds],
      );

      const candidateMap = new Map(candidatesResult.rows.map(c => [c.id, c]));

      // Score each candidate
      const scored = [];
      for (const rel of relResult.rows) {
        const candidate = candidateMap.get(rel.related_id);
        if (!candidate) continue;

        const score = scoreCandidate(source, candidate, rel);
        const boostedScore = applyTrendBoost(score, candidate.marketplace_metadata);
        scored.push({
          artifact_id: candidate.id,
          name: candidate.name,
          score: Math.round(boostedScore * 1000) / 1000, // 3 decimal places
          reason: rel.relation_type,
        });
      }

      // Sort descending, take top 10
      scored.sort((a, b) => b.score - a.score);
      const top10 = scored.slice(0, 10);

      if (top10.length === 0) continue;

      // Merge into existing type_metadata
      await dbClient.query(
        `UPDATE artifacts
         SET type_metadata = jsonb_set(
           COALESCE(type_metadata, '{}'),
           '{recommendations}',
           $1::jsonb
         )
         WHERE id = $2`,
        [JSON.stringify(top10), source.id],
      );

      recommendations_generated++;
    } catch (err) {
      logger.error('Failed to generate recommendations', { id: source.id, error: err.message });
    }
  }

  logger.info('Recommendations complete', {
    processed: artifacts.length,
    recommendations_generated,
  });

  return { processed: artifacts.length, recommendations_generated };
}

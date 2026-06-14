// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Monetizer — Assigns price tiers and marketplace metadata to artifacts.
 *
 * Price tiers (based on quality, complexity, and value signals):
 *   - free:       quality < 30 or incomplete
 *   - starter:    quality 30-55, basic but usable
 *   - pro:        quality 55-80, well-structured with docs
 *   - enterprise: quality 80+, production-ready, fully documented
 *
 * Marketplace metadata includes:
 *   - suggested_price, license, preview_available, bundle_eligible
 *   - value_signals, target_audience, monetization_score
 */

import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

// ── Price Tier Thresholds ──

const TIER_THRESHOLDS = {
  enterprise: 80,
  pro: 55,
  starter: 30,
  free: 0,
};

// ── Suggested Pricing by Tier and Type ──

const PRICING = {
  enterprise: {
    workflow: 14.99,
    code_pattern: 9.99,
    infra_config: 12.99,
    ai_ml_asset: 19.99,
    api_spec: 7.99,
    data_asset: 14.99,
    documentation: 4.99,
  },
  pro: {
    workflow: 7.99,
    code_pattern: 4.99,
    infra_config: 6.99,
    ai_ml_asset: 9.99,
    api_spec: 3.99,
    data_asset: 7.99,
    documentation: 2.99,
  },
  starter: {
    workflow: 2.99,
    code_pattern: 1.99,
    infra_config: 2.99,
    ai_ml_asset: 3.99,
    api_spec: 1.99,
    data_asset: 2.99,
    documentation: 0.99,
  },
  free: {},
};

// ── Target Audience Mapping ──

const AUDIENCE_MAP = {
  // By artifact type
  workflow: ['automation-engineers', 'no-code-builders'],
  code_pattern: ['software-developers'],
  infra_config: ['devops-engineers', 'sre-teams'],
  ai_ml_asset: ['ml-engineers', 'data-scientists'],
  api_spec: ['api-developers', 'integration-engineers'],
  data_asset: ['data-engineers', 'analysts'],
  documentation: ['technical-writers', 'dev-teams'],
};

const AUDIENCE_BY_CATEGORY = {
  'api-pattern': ['backend-developers', 'api-developers'],
  'design-pattern': ['software-architects', 'senior-developers'],
  'authentication': ['security-engineers', 'backend-developers'],
  'infrastructure-as-code': ['devops-engineers', 'cloud-architects'],
  'ci-cd-pipeline': ['devops-engineers', 'platform-teams'],
  'orchestration': ['platform-engineers', 'sre-teams'],
  'nlp-text': ['nlp-engineers', 'data-scientists'],
  'computer-vision': ['cv-engineers', 'ml-researchers'],
  'generative-ai': ['ai-engineers', 'llm-developers'],
  'mlops-experiment': ['mlops-engineers', 'ml-teams'],
};

/**
 * Assign price tiers and marketplace metadata to unpricedartifacts.
 *
 * @param {number} limit - Max artifacts to process
 * @returns {{ monetized: number, byTier: Record<string, number> }}
 */
export async function monetizeArtifacts(limit = 200) {
  const result = await db.query(
    `SELECT id, artifact_type, name, description, quality_score,
            complexity_score, primary_category, has_description,
            has_documentation, is_complete, type_metadata, tags
     FROM artifacts
     WHERE price_tier IS NULL AND quality_score > 0
     ORDER BY quality_score DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No artifacts to monetize');
    return { monetized: 0, byTier: {} };
  }

  logger.info(`Monetizing ${result.rows.length} artifacts`);
  const byTier = { free: 0, starter: 0, pro: 0, enterprise: 0 };
  let monetized = 0;

  for (const row of result.rows) {
    const meta = typeof row.type_metadata === 'string'
      ? JSON.parse(row.type_metadata) : (row.type_metadata || {});

    const assessment = assessValue(row, meta);

    await db.query(
      `UPDATE artifacts SET
        price_tier = $1,
        marketplace_metadata = $2,
        updated_at = NOW()
      WHERE id = $3`,
      [
        assessment.price_tier,
        JSON.stringify(assessment.marketplace_metadata),
        row.id,
      ]
    );

    byTier[assessment.price_tier]++;
    monetized++;
  }

  logger.info('Monetization complete', { monetized, byTier });
  return { monetized, byTier };
}

/**
 * Assess the monetary value of an artifact.
 *
 * @param {object} row - Database row
 * @param {object} meta - Parsed type_metadata
 * @returns {{ price_tier: string, marketplace_metadata: object }}
 */
export function assessValue(row, meta) {
  const qualityScore = row.quality_score || 0;
  const complexityScore = row.complexity_score || 0;

  // Calculate monetization score (weighted blend)
  const monetizationScore = calculateMonetizationScore(row, meta);

  // Determine price tier
  const priceTier = determinePriceTier(monetizationScore, row);

  // Suggested price
  const suggestedPrice = PRICING[priceTier]?.[row.artifact_type] || 0;

  // Value signals
  const valueSignals = extractValueSignals(row, meta);

  // Target audience
  const targetAudience = determineAudience(row);

  // Bundle eligibility (pro+ with quality > 50)
  const bundleEligible = monetizationScore >= 50 && priceTier !== 'free';

  return {
    price_tier: priceTier,
    marketplace_metadata: {
      monetization_score: monetizationScore,
      suggested_price: suggestedPrice,
      license: detectLicense(meta),
      preview_available: true,
      bundle_eligible: bundleEligible,
      value_signals: valueSignals,
      target_audience: targetAudience,
      assessed_at: new Date().toISOString(),
    },
  };
}

/**
 * Calculate a monetization score (0-100) based on multiple signals.
 */
export function calculateMonetizationScore(row, meta) {
  let score = 0;

  // Quality is the primary driver (0-40)
  score += Math.min((row.quality_score || 0) * 0.4, 40);

  // Completeness signals (0-20)
  if (row.has_description) score += 5;
  if (row.has_documentation) score += 8;
  if (row.is_complete) score += 7;

  // Complexity adds value (0-15)
  const complexity = row.complexity_score || 0;
  if (complexity >= 20) score += 5;
  if (complexity >= 40) score += 5;
  if (complexity >= 60) score += 5;

  // Classification adds discoverability value (0-10)
  if (row.primary_category) score += 5;
  if ((row.tags || []).length >= 3) score += 5;

  // Type-specific value signals (0-15)
  score += typeSpecificValue(row.artifact_type, meta);

  return Math.round(Math.min(score, 100));
}

/**
 * Type-specific value assessment.
 */
function typeSpecificValue(artifactType, meta) {
  let bonus = 0;

  switch (artifactType) {
    case 'workflow':
      if ((meta?.node_count || 0) >= 5) bonus += 5;
      if ((meta?.trigger_count || 0) >= 1) bonus += 3;
      if (meta?.has_error_handling) bonus += 4;
      break;

    case 'code_pattern':
      if (meta?.framework) bonus += 5;
      if (meta?.has_tests) bonus += 5;
      if (meta?.has_types) bonus += 3;
      if ((meta?.function_count || 0) >= 3) bonus += 2;
      break;

    case 'infra_config':
      if ((meta?.resource_count || meta?.service_count || 0) >= 3) bonus += 5;
      if (meta?.has_healthcheck || meta?.has_probes) bonus += 4;
      if ((meta?.variables_count || 0) >= 3) bonus += 3;
      if ((meta?.outputs_count || 0) > 0) bonus += 3;
      break;

    case 'ai_ml_asset':
      if (meta?.framework) bonus += 5;
      if (meta?.model_type) bonus += 3;
      if ((meta?.dataset_refs || []).length > 0) bonus += 4;
      if (meta?.has_gpu_config) bonus += 3;
      break;

    default:
      break;
  }

  return Math.min(bonus, 15);
}

/**
 * Determine the price tier from the monetization score.
 */
export function determinePriceTier(monetizationScore, row) {
  // Incomplete artifacts are always free
  if (!row.is_complete) return 'free';

  if (monetizationScore >= TIER_THRESHOLDS.enterprise) return 'enterprise';
  if (monetizationScore >= TIER_THRESHOLDS.pro) return 'pro';
  if (monetizationScore >= TIER_THRESHOLDS.starter) return 'starter';
  return 'free';
}

/**
 * Extract human-readable value signals for marketplace display.
 */
export function extractValueSignals(row, meta) {
  const signals = [];

  if (row.has_documentation) signals.push('well-documented');
  if (row.has_description) signals.push('has-description');
  if (row.is_complete) signals.push('complete');
  if ((row.quality_score || 0) >= 80) signals.push('high-quality');
  if ((row.complexity_score || 0) >= 50) signals.push('production-complexity');

  // Type-specific
  if (meta?.framework) signals.push(`uses-${meta.framework}`);
  if (meta?.has_tests) signals.push('includes-tests');
  if (meta?.has_error_handling) signals.push('error-handling');
  if (meta?.has_types) signals.push('type-safe');
  if (meta?.has_gpu_config) signals.push('gpu-ready');
  if (meta?.has_healthcheck || meta?.has_probes) signals.push('production-ready');

  return signals.slice(0, 10);
}

/**
 * Determine target audience based on artifact type and category.
 */
export function determineAudience(row) {
  const typeAudience = AUDIENCE_MAP[row.artifact_type] || [];
  const categoryAudience = AUDIENCE_BY_CATEGORY[row.primary_category] || [];
  return [...new Set([...categoryAudience, ...typeAudience])].slice(0, 5);
}

/**
 * Detect license from metadata.
 */
function detectLicense(meta) {
  if (meta?.license) return meta.license;
  // Default to permissive for harvested content
  return 'source-license';
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement pure functions for testing (no DB deps) ──

const TIER_THRESHOLDS = {
  enterprise: 80,
  pro: 55,
  starter: 30,
  free: 0,
};

const PRICING = {
  enterprise: {
    workflow: 14.99, code_pattern: 9.99, infra_config: 12.99,
    ai_ml_asset: 19.99, api_spec: 7.99, data_asset: 14.99, documentation: 4.99,
  },
  pro: {
    workflow: 7.99, code_pattern: 4.99, infra_config: 6.99,
    ai_ml_asset: 9.99, api_spec: 3.99, data_asset: 7.99, documentation: 2.99,
  },
  starter: {
    workflow: 2.99, code_pattern: 1.99, infra_config: 2.99,
    ai_ml_asset: 3.99, api_spec: 1.99, data_asset: 2.99, documentation: 0.99,
  },
  free: {},
};

const AUDIENCE_MAP = {
  workflow: ['automation-engineers', 'no-code-builders'],
  code_pattern: ['software-developers'],
  infra_config: ['devops-engineers', 'sre-teams'],
  ai_ml_asset: ['ml-engineers', 'data-scientists'],
};

const AUDIENCE_BY_CATEGORY = {
  'api-pattern': ['backend-developers', 'api-developers'],
  'design-pattern': ['software-architects', 'senior-developers'],
  'infrastructure-as-code': ['devops-engineers', 'cloud-architects'],
  'generative-ai': ['ai-engineers', 'llm-developers'],
};

function calculateMonetizationScore(row, meta) {
  let score = 0;
  score += Math.min((row.quality_score || 0) * 0.4, 40);
  if (row.has_description) score += 5;
  if (row.has_documentation) score += 8;
  if (row.is_complete) score += 7;
  const complexity = row.complexity_score || 0;
  if (complexity >= 20) score += 5;
  if (complexity >= 40) score += 5;
  if (complexity >= 60) score += 5;
  if (row.primary_category) score += 5;
  if ((row.tags || []).length >= 3) score += 5;
  score += typeSpecificValue(row.artifact_type, meta);
  return Math.round(Math.min(score, 100));
}

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
  }
  return Math.min(bonus, 15);
}

function determinePriceTier(monetizationScore, row) {
  if (!row.is_complete) return 'free';
  if (monetizationScore >= TIER_THRESHOLDS.enterprise) return 'enterprise';
  if (monetizationScore >= TIER_THRESHOLDS.pro) return 'pro';
  if (monetizationScore >= TIER_THRESHOLDS.starter) return 'starter';
  return 'free';
}

function extractValueSignals(row, meta) {
  const signals = [];
  if (row.has_documentation) signals.push('well-documented');
  if (row.has_description) signals.push('has-description');
  if (row.is_complete) signals.push('complete');
  if ((row.quality_score || 0) >= 80) signals.push('high-quality');
  if ((row.complexity_score || 0) >= 50) signals.push('production-complexity');
  if (meta?.framework) signals.push(`uses-${meta.framework}`);
  if (meta?.has_tests) signals.push('includes-tests');
  if (meta?.has_error_handling) signals.push('error-handling');
  if (meta?.has_types) signals.push('type-safe');
  if (meta?.has_gpu_config) signals.push('gpu-ready');
  if (meta?.has_healthcheck || meta?.has_probes) signals.push('production-ready');
  return signals.slice(0, 10);
}

function determineAudience(row) {
  const typeAudience = AUDIENCE_MAP[row.artifact_type] || [];
  const categoryAudience = AUDIENCE_BY_CATEGORY[row.primary_category] || [];
  return [...new Set([...categoryAudience, ...typeAudience])].slice(0, 5);
}

function assessValue(row, meta) {
  const monetizationScore = calculateMonetizationScore(row, meta);
  const priceTier = determinePriceTier(monetizationScore, row);
  const suggestedPrice = PRICING[priceTier]?.[row.artifact_type] || 0;
  const valueSignals = extractValueSignals(row, meta);
  const targetAudience = determineAudience(row);
  const bundleEligible = monetizationScore >= 50 && priceTier !== 'free';

  return {
    price_tier: priceTier,
    marketplace_metadata: {
      monetization_score: monetizationScore,
      suggested_price: suggestedPrice,
      license: meta?.license || 'source-license',
      preview_available: true,
      bundle_eligible: bundleEligible,
      value_signals: valueSignals,
      target_audience: targetAudience,
    },
  };
}

function formatTitle(str) {
  if (!str) return '';
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Tests ──

describe('calculateMonetizationScore', () => {
  it('scores high for premium artifact', () => {
    const row = {
      quality_score: 90, has_description: true, has_documentation: true,
      is_complete: true, complexity_score: 70, primary_category: 'api-pattern',
      tags: ['fastapi', 'auth', 'production'], artifact_type: 'code_pattern',
    };
    const meta = { framework: 'fastapi', has_tests: true, has_types: true, function_count: 5 };
    const score = calculateMonetizationScore(row, meta);
    assert.ok(score >= 80, `Expected >= 80, got ${score}`);
  });

  it('scores low for minimal artifact', () => {
    const row = {
      quality_score: 10, has_description: false, has_documentation: false,
      is_complete: true, complexity_score: 0, artifact_type: 'code_pattern',
    };
    const score = calculateMonetizationScore(row, {});
    assert.ok(score < 20, `Expected < 20, got ${score}`);
  });

  it('quality score is primary driver (40% weight)', () => {
    const row = { quality_score: 100, is_complete: true, artifact_type: 'workflow' };
    const score = calculateMonetizationScore(row, {});
    assert.ok(score >= 40, `Quality alone should give >= 40, got ${score}`);
  });

  it('documentation adds significant value', () => {
    const base = { quality_score: 50, is_complete: true, artifact_type: 'code_pattern' };
    const withDocs = { ...base, has_description: true, has_documentation: true };
    const withoutDocs = { ...base, has_description: false, has_documentation: false };
    const scoreWithDocs = calculateMonetizationScore(withDocs, {});
    const scoreWithoutDocs = calculateMonetizationScore(withoutDocs, {});
    assert.ok(scoreWithDocs > scoreWithoutDocs + 10, 'Docs should add >10 points');
  });

  it('caps at 100', () => {
    const row = {
      quality_score: 100, has_description: true, has_documentation: true,
      is_complete: true, complexity_score: 80, primary_category: 'api-pattern',
      tags: ['a', 'b', 'c'], artifact_type: 'code_pattern',
    };
    const meta = { framework: 'fastapi', has_tests: true, has_types: true, function_count: 10 };
    const score = calculateMonetizationScore(row, meta);
    assert.ok(score <= 100, `Should cap at 100, got ${score}`);
  });
});

describe('typeSpecificValue', () => {
  it('scores workflows with nodes and triggers', () => {
    const bonus = typeSpecificValue('workflow', {
      node_count: 10, trigger_count: 2, has_error_handling: true,
    });
    assert.ok(bonus >= 10, `Expected >= 10, got ${bonus}`);
  });

  it('scores code patterns with tests and framework', () => {
    const bonus = typeSpecificValue('code_pattern', {
      framework: 'fastapi', has_tests: true, has_types: true, function_count: 5,
    });
    assert.ok(bonus >= 13, `Expected >= 13, got ${bonus}`);
  });

  it('scores infra configs with resources', () => {
    const bonus = typeSpecificValue('infra_config', {
      resource_count: 5, has_healthcheck: true, variables_count: 4, outputs_count: 2,
    });
    assert.ok(bonus >= 12, `Expected >= 12, got ${bonus}`);
  });

  it('scores ML assets with framework and datasets', () => {
    const bonus = typeSpecificValue('ai_ml_asset', {
      framework: 'pytorch', model_type: 'transformer', dataset_refs: ['squad'],
      has_gpu_config: true,
    });
    assert.ok(bonus >= 12, `Expected >= 12, got ${bonus}`);
  });

  it('caps at 15', () => {
    const bonus = typeSpecificValue('code_pattern', {
      framework: 'x', has_tests: true, has_types: true, function_count: 100,
    });
    assert.equal(bonus, 15);
  });

  it('returns 0 for unknown type', () => {
    const bonus = typeSpecificValue('unknown', {});
    assert.equal(bonus, 0);
  });
});

describe('determinePriceTier', () => {
  it('assigns enterprise for score >= 80', () => {
    assert.equal(determinePriceTier(85, { is_complete: true }), 'enterprise');
  });

  it('assigns pro for score 55-79', () => {
    assert.equal(determinePriceTier(65, { is_complete: true }), 'pro');
  });

  it('assigns starter for score 30-54', () => {
    assert.equal(determinePriceTier(40, { is_complete: true }), 'starter');
  });

  it('assigns free for score < 30', () => {
    assert.equal(determinePriceTier(15, { is_complete: true }), 'free');
  });

  it('assigns free for incomplete artifacts regardless of score', () => {
    assert.equal(determinePriceTier(90, { is_complete: false }), 'free');
  });

  it('uses exact threshold boundaries', () => {
    assert.equal(determinePriceTier(80, { is_complete: true }), 'enterprise');
    assert.equal(determinePriceTier(79, { is_complete: true }), 'pro');
    assert.equal(determinePriceTier(55, { is_complete: true }), 'pro');
    assert.equal(determinePriceTier(54, { is_complete: true }), 'starter');
    assert.equal(determinePriceTier(30, { is_complete: true }), 'starter');
    assert.equal(determinePriceTier(29, { is_complete: true }), 'free');
  });
});

describe('extractValueSignals', () => {
  it('extracts all applicable signals', () => {
    const row = {
      has_documentation: true, has_description: true, is_complete: true,
      quality_score: 90, complexity_score: 60,
    };
    const meta = {
      framework: 'fastapi', has_tests: true, has_error_handling: true,
      has_types: true,
    };
    const signals = extractValueSignals(row, meta);
    assert.ok(signals.includes('well-documented'));
    assert.ok(signals.includes('high-quality'));
    assert.ok(signals.includes('production-complexity'));
    assert.ok(signals.includes('uses-fastapi'));
    assert.ok(signals.includes('includes-tests'));
    assert.ok(signals.includes('type-safe'));
  });

  it('returns empty for minimal artifact', () => {
    const signals = extractValueSignals({}, {});
    assert.equal(signals.length, 0);
  });

  it('caps at 10 signals', () => {
    const row = {
      has_documentation: true, has_description: true, is_complete: true,
      quality_score: 90, complexity_score: 60,
    };
    const meta = {
      framework: 'x', has_tests: true, has_error_handling: true,
      has_types: true, has_gpu_config: true, has_healthcheck: true,
    };
    const signals = extractValueSignals(row, meta);
    assert.ok(signals.length <= 10);
  });

  it('includes GPU-ready for ML assets', () => {
    const signals = extractValueSignals({}, { has_gpu_config: true });
    assert.ok(signals.includes('gpu-ready'));
  });

  it('includes production-ready for healthcheck configs', () => {
    const signals = extractValueSignals({}, { has_healthcheck: true });
    assert.ok(signals.includes('production-ready'));
  });
});

describe('determineAudience', () => {
  it('combines type and category audiences', () => {
    const audience = determineAudience({
      artifact_type: 'code_pattern', primary_category: 'api-pattern',
    });
    assert.ok(audience.includes('software-developers'));
    assert.ok(audience.includes('backend-developers'));
    assert.ok(audience.includes('api-developers'));
  });

  it('deduplicates audience', () => {
    const audience = determineAudience({
      artifact_type: 'infra_config', primary_category: 'infrastructure-as-code',
    });
    const unique = [...new Set(audience)];
    assert.equal(audience.length, unique.length);
  });

  it('handles missing category', () => {
    const audience = determineAudience({ artifact_type: 'ai_ml_asset' });
    assert.ok(audience.includes('ml-engineers'));
    assert.ok(audience.includes('data-scientists'));
  });

  it('caps at 5 entries', () => {
    const audience = determineAudience({
      artifact_type: 'code_pattern', primary_category: 'api-pattern',
    });
    assert.ok(audience.length <= 5);
  });
});

describe('assessValue', () => {
  it('produces complete assessment for enterprise artifact', () => {
    const row = {
      quality_score: 95, has_description: true, has_documentation: true,
      is_complete: true, complexity_score: 70, primary_category: 'api-pattern',
      tags: ['auth', 'jwt', 'production'], artifact_type: 'code_pattern',
    };
    const meta = { framework: 'fastapi', has_tests: true };
    const result = assessValue(row, meta);
    assert.equal(result.price_tier, 'enterprise');
    assert.equal(result.marketplace_metadata.suggested_price, 9.99);
    assert.ok(result.marketplace_metadata.bundle_eligible);
    assert.ok(result.marketplace_metadata.value_signals.length > 0);
    assert.ok(result.marketplace_metadata.target_audience.length > 0);
  });

  it('assigns free tier for low-quality artifact', () => {
    const row = {
      quality_score: 10, is_complete: true, artifact_type: 'code_pattern',
    };
    const result = assessValue(row, {});
    assert.equal(result.price_tier, 'free');
    assert.equal(result.marketplace_metadata.suggested_price, 0);
    assert.ok(!result.marketplace_metadata.bundle_eligible);
  });

  it('prices ML assets higher than code patterns at same tier', () => {
    const makeRow = (type) => ({
      quality_score: 70, has_description: true, is_complete: true,
      artifact_type: type,
    });
    const mlResult = assessValue(makeRow('ai_ml_asset'), { framework: 'pytorch' });
    const codeResult = assessValue(makeRow('code_pattern'), { framework: 'fastapi' });
    assert.ok(
      mlResult.marketplace_metadata.suggested_price >= codeResult.marketplace_metadata.suggested_price,
      'ML assets should price >= code patterns'
    );
  });

  it('includes license from metadata', () => {
    const row = { quality_score: 50, is_complete: true, artifact_type: 'ai_ml_asset' };
    const result = assessValue(row, { license: 'mit' });
    assert.equal(result.marketplace_metadata.license, 'mit');
  });

  it('defaults license to source-license', () => {
    const row = { quality_score: 50, is_complete: true, artifact_type: 'code_pattern' };
    const result = assessValue(row, {});
    assert.equal(result.marketplace_metadata.license, 'source-license');
  });
});

describe('formatTitle', () => {
  it('formats slug to title', () => {
    assert.equal(formatTitle('api-pattern'), 'Api Pattern');
    assert.equal(formatTitle('infrastructure-as-code'), 'Infrastructure As Code');
    assert.equal(formatTitle('code_pattern'), 'Code Pattern');
  });

  it('handles empty string', () => {
    assert.equal(formatTitle(''), '');
    assert.equal(formatTitle(null), '');
  });

  it('handles single word', () => {
    assert.equal(formatTitle('pytorch'), 'Pytorch');
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Reimplemented pure functions from recommender.js ──────────────────────────

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

function categoryAffinity(catA, catB) {
  if (!catA || !catB) return 0.1;
  if (catA === catB) return 1.0;
  for (const cluster of CATEGORY_CLUSTERS) {
    if (cluster.has(catA) && cluster.has(catB)) return 0.5;
  }
  return 0.1;
}

function typeCompatibility(typeA, typeB) {
  if (!typeA || !typeB) return 0.3;
  if (typeA === typeB) return 0.6;
  if (HIGH_COMPAT_PAIRS.has(`${typeA}|${typeB}`)) return 1.0;
  return 0.3;
}

function scoreCandidate(source, candidate, relation) {
  if (!source || !candidate || !relation) return 0;
  const relConfidence = Math.max(0, Math.min(1, parseFloat(relation.confidence) || 0));
  const affinity = categoryAffinity(source.primary_category, candidate.primary_category);
  const compat = typeCompatibility(source.artifact_type, candidate.artifact_type);
  return relConfidence * 0.4 + affinity * 0.3 + compat * 0.3;
}

function selectTop10(scored) {
  return [...scored].sort((a, b) => b.score - a.score).slice(0, 10);
}

// ── scoreCandidate tests ──────────────────────────────────────────────────────

describe('scoreCandidate — basic inputs', () => {
  const source = { id: 's', artifact_type: 'workflow', primary_category: 'data-pipeline' };
  const candidate = { id: 'c', artifact_type: 'infra_config', primary_category: 'data-pipeline' };
  const relation = { confidence: 0.9, relation_type: 'similar_to' };

  it('returns a number between 0 and 1', () => {
    const score = scoreCandidate(source, candidate, relation);
    assert.ok(score >= 0 && score <= 1);
  });

  it('higher confidence increases score', () => {
    const lowConf = { confidence: 0.3, relation_type: 'similar_to' };
    const highConf = { confidence: 0.9, relation_type: 'similar_to' };
    assert.ok(scoreCandidate(source, candidate, highConf) > scoreCandidate(source, candidate, lowConf));
  });

  it('returns 0 for null source', () => {
    assert.equal(scoreCandidate(null, candidate, relation), 0);
  });

  it('returns 0 for null candidate', () => {
    assert.equal(scoreCandidate(source, null, relation), 0);
  });

  it('returns 0 for null relation', () => {
    assert.equal(scoreCandidate(source, candidate, null), 0);
  });

  it('clamps confidence above 1.0', () => {
    const overConf = { confidence: 1.5 };
    const score = scoreCandidate(source, candidate, overConf);
    assert.ok(score <= 1);
  });

  it('clamps negative confidence to 0', () => {
    const negConf = { confidence: -0.5 };
    const score = scoreCandidate(source, candidate, negConf);
    assert.ok(score >= 0);
  });

  it('correctly computes weighted sum for known inputs', () => {
    // confidence=0.8, same category→1.0, workflow|infra_config→1.0
    // 0.8*0.4 + 1.0*0.3 + 1.0*0.3 = 0.32 + 0.30 + 0.30 = 0.92
    const rel = { confidence: 0.8 };
    const score = scoreCandidate(source, candidate, rel);
    assert.ok(Math.abs(score - 0.92) < 0.001);
  });
});

// ── categoryAffinity tests ────────────────────────────────────────────────────

describe('categoryAffinity — identical categories', () => {
  it('same category → 1.0', () => {
    assert.equal(categoryAffinity('data-pipeline', 'data-pipeline'), 1.0);
  });

  it('same ai category → 1.0', () => {
    assert.equal(categoryAffinity('ai-agent', 'ai-agent'), 1.0);
  });
});

describe('categoryAffinity — related categories', () => {
  it('ai-agent and ml-data-ops are in same cluster → 0.5', () => {
    assert.equal(categoryAffinity('ai-agent', 'ml-data-ops'), 0.5);
  });

  it('data-pipeline and streaming-realtime are in same cluster → 0.5', () => {
    assert.equal(categoryAffinity('data-pipeline', 'streaming-realtime'), 0.5);
  });

  it('ci-cd-pipeline and infrastructure-as-code are in same cluster → 0.5', () => {
    assert.equal(categoryAffinity('ci-cd-pipeline', 'infrastructure-as-code'), 0.5);
  });

  it('ecommerce and lead-gen-crm are in same cluster → 0.5', () => {
    assert.equal(categoryAffinity('ecommerce', 'lead-gen-crm'), 0.5);
  });
});

describe('categoryAffinity — unrelated categories', () => {
  it('ai-agent and ecommerce → 0.1', () => {
    assert.equal(categoryAffinity('ai-agent', 'ecommerce'), 0.1);
  });

  it('security-automation and finance-accounting → 0.1', () => {
    assert.equal(categoryAffinity('security-automation', 'finance-accounting'), 0.1);
  });

  it('null catA → 0.1', () => {
    assert.equal(categoryAffinity(null, 'data-pipeline'), 0.1);
  });

  it('null catB → 0.1', () => {
    assert.equal(categoryAffinity('data-pipeline', null), 0.1);
  });
});

// ── typeCompatibility tests ───────────────────────────────────────────────────

describe('typeCompatibility — high compatibility pairs', () => {
  it('workflow + infra_config → 1.0', () => {
    assert.equal(typeCompatibility('workflow', 'infra_config'), 1.0);
  });

  it('infra_config + workflow → 1.0 (symmetric)', () => {
    assert.equal(typeCompatibility('infra_config', 'workflow'), 1.0);
  });

  it('workflow + api_spec → 1.0', () => {
    assert.equal(typeCompatibility('workflow', 'api_spec'), 1.0);
  });

  it('code_pattern + documentation → 1.0', () => {
    assert.equal(typeCompatibility('code_pattern', 'documentation'), 1.0);
  });

  it('ai_ml_asset + workflow → 1.0', () => {
    assert.equal(typeCompatibility('ai_ml_asset', 'workflow'), 1.0);
  });
});

describe('typeCompatibility — same type and unrelated', () => {
  it('same artifact type → 0.6', () => {
    assert.equal(typeCompatibility('workflow', 'workflow'), 0.6);
  });

  it('unrelated types → 0.3', () => {
    assert.equal(typeCompatibility('data_asset', 'documentation'), 0.3);
  });

  it('null typeA → 0.3', () => {
    assert.equal(typeCompatibility(null, 'workflow'), 0.3);
  });

  it('null typeB → 0.3', () => {
    assert.equal(typeCompatibility('workflow', null), 0.3);
  });
});

// ── Top-10 selection and sorting ──────────────────────────────────────────────

describe('top-10 selection', () => {
  it('returns at most 10 candidates', () => {
    const candidates = Array.from({ length: 15 }, (_, i) => ({
      artifact_id: `id-${i}`,
      score: Math.random(),
      name: `item-${i}`,
      reason: 'similar_to',
    }));
    const top = selectTop10(candidates);
    assert.equal(top.length, 10);
  });

  it('results are sorted descending by score', () => {
    const candidates = [
      { artifact_id: 'a', score: 0.3 },
      { artifact_id: 'b', score: 0.9 },
      { artifact_id: 'c', score: 0.6 },
    ];
    const top = selectTop10(candidates);
    assert.equal(top[0].artifact_id, 'b');
    assert.equal(top[1].artifact_id, 'c');
    assert.equal(top[2].artifact_id, 'a');
  });

  it('returns fewer than 10 when fewer candidates exist', () => {
    const candidates = [
      { artifact_id: 'a', score: 0.8 },
      { artifact_id: 'b', score: 0.5 },
    ];
    const top = selectTop10(candidates);
    assert.equal(top.length, 2);
  });

  it('returns empty array for no candidates', () => {
    const top = selectTop10([]);
    assert.equal(top.length, 0);
  });

  it('handles all-same scores without throwing', () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({
      artifact_id: `id-${i}`,
      score: 0.5,
    }));
    const top = selectTop10(candidates);
    assert.equal(top.length, 5);
  });
});

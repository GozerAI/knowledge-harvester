// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Reimplemented pure functions from relation-builder.js ─────────────────────

const TAG_OVERLAP_THRESHOLD = 3;

function calculateTagOverlap(tagsA, tagsB) {
  if (!Array.isArray(tagsA) || !Array.isArray(tagsB) || tagsA.length === 0 || tagsB.length === 0) {
    return { overlap_count: 0, overlap_ratio: 0 };
  }
  const setA = new Set(tagsA);
  let overlap_count = 0;
  for (const tag of tagsB) {
    if (setA.has(tag)) overlap_count++;
  }
  const union = new Set([...tagsA, ...tagsB]).size;
  const overlap_ratio = union === 0 ? 0 : overlap_count / union;
  return { overlap_count, overlap_ratio };
}

function shouldRelate(artifactA, artifactB) {
  if (!artifactA || !artifactB || artifactA.id === artifactB.id) {
    return { relate: false, relation_type: null, confidence: 0 };
  }

  const { overlap_count, overlap_ratio } = calculateTagOverlap(
    artifactA.tags || [],
    artifactB.tags || [],
  );
  if (overlap_count >= TAG_OVERLAP_THRESHOLD) {
    return {
      relate: true,
      relation_type: 'similar_to',
      confidence: Math.min(0.95, 0.5 + overlap_ratio * 0.5),
    };
  }

  if (
    artifactA.primary_category &&
    artifactB.primary_category &&
    artifactA.primary_category === artifactB.primary_category &&
    artifactA.artifact_type !== artifactB.artifact_type
  ) {
    return { relate: true, relation_type: 'pairs_with', confidence: 0.6 };
  }

  if (
    artifactA.tool_type &&
    artifactB.tool_type &&
    artifactA.tool_type === artifactB.tool_type &&
    artifactA.artifact_type !== artifactB.artifact_type
  ) {
    return { relate: true, relation_type: 'uses', confidence: 0.5 };
  }

  return { relate: false, relation_type: null, confidence: 0 };
}

// Confidence formula used in the module
function tagOverlapConfidence(overlap_count, tagsA, tagsB) {
  const { overlap_ratio } = calculateTagOverlap(tagsA, tagsB);
  return Math.min(0.95, 0.5 + overlap_ratio * 0.5);
}

// ── Tag overlap tests ─────────────────────────────────────────────────────────

describe('calculateTagOverlap — zero tags', () => {
  it('returns 0 for both empty arrays', () => {
    const result = calculateTagOverlap([], []);
    assert.equal(result.overlap_count, 0);
    assert.equal(result.overlap_ratio, 0);
  });

  it('returns 0 when tagsA is empty', () => {
    const result = calculateTagOverlap([], ['api', 'rest', 'webhook']);
    assert.equal(result.overlap_count, 0);
  });

  it('returns 0 when tagsB is empty', () => {
    const result = calculateTagOverlap(['api', 'rest'], []);
    assert.equal(result.overlap_count, 0);
  });

  it('returns 0 for null inputs', () => {
    const result = calculateTagOverlap(null, ['api']);
    assert.equal(result.overlap_count, 0);
    assert.equal(result.overlap_ratio, 0);
  });

  it('returns 0 for non-array inputs', () => {
    const result = calculateTagOverlap('api', ['api']);
    assert.equal(result.overlap_count, 0);
  });
});

describe('calculateTagOverlap — partial overlap', () => {
  it('counts 1 shared tag correctly', () => {
    const result = calculateTagOverlap(['api', 'auth'], ['api', 'oauth', 'jwt']);
    assert.equal(result.overlap_count, 1);
  });

  it('counts 2 shared tags correctly', () => {
    const result = calculateTagOverlap(['api', 'rest', 'auth'], ['api', 'rest', 'graphql']);
    assert.equal(result.overlap_count, 2);
  });

  it('overlap_ratio is between 0 and 1', () => {
    const result = calculateTagOverlap(['a', 'b', 'c'], ['b', 'c', 'd']);
    assert.ok(result.overlap_ratio > 0 && result.overlap_ratio < 1);
  });

  it('uses union for ratio denominator (Jaccard)', () => {
    // union = {a,b,c,d} = 4, overlap = {b,c} = 2 → 0.5
    const result = calculateTagOverlap(['a', 'b', 'c'], ['b', 'c', 'd']);
    assert.equal(result.overlap_count, 2);
    assert.equal(result.overlap_ratio, 0.5);
  });
});

describe('calculateTagOverlap — full overlap', () => {
  it('identical tag arrays give ratio 1.0', () => {
    const tags = ['n8n', 'webhook', 'crm', 'lead-gen'];
    const result = calculateTagOverlap(tags, tags);
    assert.equal(result.overlap_count, 4);
    assert.equal(result.overlap_ratio, 1.0);
  });

  it('subset has ratio less than 1.0', () => {
    const result = calculateTagOverlap(['a', 'b', 'c'], ['a', 'b', 'c', 'd']);
    assert.ok(result.overlap_ratio < 1.0);
  });
});

describe('calculateTagOverlap — threshold boundary', () => {
  it('2 shared tags is below threshold', () => {
    const result = calculateTagOverlap(['a', 'b', 'c'], ['a', 'b', 'd', 'e']);
    assert.equal(result.overlap_count, 2);
    assert.ok(result.overlap_count < TAG_OVERLAP_THRESHOLD);
  });

  it('exactly 3 shared tags meets threshold', () => {
    const result = calculateTagOverlap(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'e']);
    assert.equal(result.overlap_count, 3);
    assert.ok(result.overlap_count >= TAG_OVERLAP_THRESHOLD);
  });

  it('4 shared tags exceeds threshold', () => {
    const result = calculateTagOverlap(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'f']);
    assert.equal(result.overlap_count, 4);
    assert.ok(result.overlap_count >= TAG_OVERLAP_THRESHOLD);
  });
});

// ── shouldRelate: category pairing ───────────────────────────────────────────

describe('shouldRelate — category pairing', () => {
  const base = {
    id: 'a',
    tags: [],
    primary_category: 'data-pipeline',
    artifact_type: 'workflow',
    tool_type: null,
  };

  it('same category, different type → pairs_with with confidence 0.6', () => {
    const a = { ...base, id: 'a', artifact_type: 'workflow' };
    const b = { ...base, id: 'b', artifact_type: 'infra_config' };
    const result = shouldRelate(a, b);
    assert.equal(result.relate, true);
    assert.equal(result.relation_type, 'pairs_with');
    assert.equal(result.confidence, 0.6);
  });

  it('same category AND same artifact_type → no relation', () => {
    const a = { ...base, id: 'a', artifact_type: 'workflow' };
    const b = { ...base, id: 'b', artifact_type: 'workflow' };
    const result = shouldRelate(a, b);
    assert.equal(result.relate, false);
  });

  it('different categories → no pairs_with relation', () => {
    const a = { ...base, id: 'a', primary_category: 'ai-agent' };
    const b = { ...base, id: 'b', primary_category: 'data-pipeline', artifact_type: 'infra_config' };
    const result = shouldRelate(a, b);
    assert.equal(result.relate, false);
  });

  it('null category on either side → no pairs_with', () => {
    const a = { ...base, id: 'a', primary_category: null };
    const b = { ...base, id: 'b', artifact_type: 'infra_config' };
    const result = shouldRelate(a, b);
    assert.equal(result.relate, false);
  });
});

// ── shouldRelate: tag overlap strategy ───────────────────────────────────────

describe('shouldRelate — tag overlap strategy', () => {
  it('≥3 shared tags → similar_to', () => {
    const a = { id: 'a', tags: ['api', 'rest', 'json', 'webhook'], primary_category: null, artifact_type: 'workflow', tool_type: null };
    const b = { id: 'b', tags: ['api', 'rest', 'json', 'auth'], primary_category: null, artifact_type: 'workflow', tool_type: null };
    const result = shouldRelate(a, b);
    assert.equal(result.relate, true);
    assert.equal(result.relation_type, 'similar_to');
  });

  it('<3 shared tags with same category → falls through to pairs_with', () => {
    const a = { id: 'a', tags: ['api', 'rest'], primary_category: 'data-pipeline', artifact_type: 'workflow', tool_type: null };
    const b = { id: 'b', tags: ['api', 'auth'], primary_category: 'data-pipeline', artifact_type: 'infra_config', tool_type: null };
    const result = shouldRelate(a, b);
    assert.equal(result.relate, true);
    assert.equal(result.relation_type, 'pairs_with');
  });

  it('tag overlap takes priority over category pairing', () => {
    const a = { id: 'a', tags: ['api', 'rest', 'json'], primary_category: 'data-pipeline', artifact_type: 'workflow', tool_type: null };
    const b = { id: 'b', tags: ['api', 'rest', 'json'], primary_category: 'data-pipeline', artifact_type: 'infra_config', tool_type: null };
    const result = shouldRelate(a, b);
    assert.equal(result.relation_type, 'similar_to');
  });
});

// ── shouldRelate: tool_type sharing ──────────────────────────────────────────

describe('shouldRelate — shared tool_type strategy', () => {
  it('shared tool_type with different artifact_type → uses with confidence 0.5', () => {
    const a = { id: 'a', tags: [], primary_category: 'ci-cd-pipeline', artifact_type: 'workflow', tool_type: 'github-actions' };
    const b = { id: 'b', tags: [], primary_category: 'devops-monitoring', artifact_type: 'infra_config', tool_type: 'github-actions' };
    const result = shouldRelate(a, b);
    assert.equal(result.relate, true);
    assert.equal(result.relation_type, 'uses');
    assert.equal(result.confidence, 0.5);
  });

  it('null tool_type on either artifact → no uses relation', () => {
    const a = { id: 'a', tags: [], primary_category: null, artifact_type: 'workflow', tool_type: null };
    const b = { id: 'b', tags: [], primary_category: null, artifact_type: 'infra_config', tool_type: 'terraform' };
    const result = shouldRelate(a, b);
    assert.equal(result.relate, false);
  });

  it('same tool_type same artifact_type → no relation', () => {
    const a = { id: 'a', tags: [], primary_category: null, artifact_type: 'workflow', tool_type: 'n8n' };
    const b = { id: 'b', tags: [], primary_category: null, artifact_type: 'workflow', tool_type: 'n8n' };
    const result = shouldRelate(a, b);
    assert.equal(result.relate, false);
  });
});

// ── shouldRelate: edge cases ──────────────────────────────────────────────────

describe('shouldRelate — edge cases', () => {
  it('same artifact id → no relation', () => {
    const a = { id: 'x', tags: ['a', 'b', 'c', 'd'], primary_category: 'ai-agent', artifact_type: 'workflow', tool_type: 'n8n' };
    const result = shouldRelate(a, a);
    assert.equal(result.relate, false);
  });

  it('null artifactA → no relation', () => {
    const b = { id: 'b', tags: [], primary_category: null, artifact_type: 'workflow', tool_type: null };
    const result = shouldRelate(null, b);
    assert.equal(result.relate, false);
  });

  it('null artifactB → no relation', () => {
    const a = { id: 'a', tags: [], primary_category: null, artifact_type: 'workflow', tool_type: null };
    const result = shouldRelate(a, null);
    assert.equal(result.relate, false);
  });

  it('no matching strategy → relate is false', () => {
    const a = { id: 'a', tags: ['x'], primary_category: 'ai-agent', artifact_type: 'workflow', tool_type: 'n8n' };
    const b = { id: 'b', tags: ['y'], primary_category: 'ecommerce', artifact_type: 'workflow', tool_type: 'shopify' };
    const result = shouldRelate(a, b);
    assert.equal(result.relate, false);
    assert.equal(result.relation_type, null);
  });
});

// ── Confidence scoring ────────────────────────────────────────────────────────

describe('confidence scoring accuracy', () => {
  it('full tag overlap → confidence capped at 0.95', () => {
    const tags = ['a', 'b', 'c', 'd', 'e'];
    const confidence = tagOverlapConfidence(5, tags, tags);
    assert.equal(confidence, 0.95);
  });

  it('50% overlap ratio → confidence is 0.75', () => {
    // union=4, overlap=2 → ratio=0.5 → 0.5 + 0.5*0.5 = 0.75
    const a = ['x', 'y', 'z'];
    const b = ['y', 'z', 'w'];
    const confidence = tagOverlapConfidence(2, a, b);
    assert.equal(confidence, 0.75);
  });

  it('confidence is always between 0.5 and 0.95 for valid overlap', () => {
    const a = ['a', 'b', 'c'];
    const b = ['a', 'b', 'c', 'd', 'e', 'f'];
    const { overlap_count } = calculateTagOverlap(a, b);
    const confidence = tagOverlapConfidence(overlap_count, a, b);
    assert.ok(confidence >= 0.5 && confidence <= 0.95);
  });
});

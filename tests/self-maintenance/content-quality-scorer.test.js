// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #874 — Autonomous Content Quality Scoring
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const QUALITY_DIMENSIONS = {
  completeness: { weight: 0.30, fields: ['name', 'description', 'source_url', 'primary_category', 'tags'] },
  recency: { weight: 0.20, maxAgeDays: 365 },
  metadata_richness: { weight: 0.20, expectedKeys: 5 },
  community_signal: { weight: 0.15, starWeight: 0.6, forkWeight: 0.4 },
  documentation: { weight: 0.15 },
};

function calculateQualityScore(artifact) {
  const dimensions = {};
  const completeFields = QUALITY_DIMENSIONS.completeness.fields.filter(f => {
    const val = artifact[f];
    if (val === null || val === undefined) return false;
    if (typeof val === 'string') return val.trim().length > 0;
    if (Array.isArray(val)) return val.length > 0;
    return true;
  });
  dimensions.completeness = Math.round((completeFields.length / QUALITY_DIMENSIONS.completeness.fields.length) * 100);

  const ageDays = artifact.updated_at
    ? (Date.now() - new Date(artifact.updated_at).getTime()) / 86400000 : 365;
  dimensions.recency = Math.round(Math.max(0, 100 - (ageDays / QUALITY_DIMENSIONS.recency.maxAgeDays) * 100));

  const meta = typeof artifact.type_metadata === 'string'
    ? JSON.parse(artifact.type_metadata) : artifact.type_metadata;
  const metaKeys = meta ? Object.keys(meta).length : 0;
  dimensions.metadata_richness = Math.round(Math.min(metaKeys / QUALITY_DIMENSIONS.metadata_richness.expectedKeys, 1) * 100);

  const stars = meta?.stars || 0;
  const forks = meta?.forks || 0;
  const starScore = Math.min(stars / 100, 1) * QUALITY_DIMENSIONS.community_signal.starWeight;
  const forkScore = Math.min(forks / 50, 1) * QUALITY_DIMENSIONS.community_signal.forkWeight;
  dimensions.community_signal = Math.round((starScore + forkScore) * 100);

  const descLen = (artifact.description || '').length;
  dimensions.documentation = Math.round(Math.min(descLen / 200, 1) * 100);

  const total = Math.round(
    dimensions.completeness * QUALITY_DIMENSIONS.completeness.weight +
    dimensions.recency * QUALITY_DIMENSIONS.recency.weight +
    dimensions.metadata_richness * QUALITY_DIMENSIONS.metadata_richness.weight +
    dimensions.community_signal * QUALITY_DIMENSIONS.community_signal.weight +
    dimensions.documentation * QUALITY_DIMENSIONS.documentation.weight
  );

  return { total: Math.min(Math.max(total, 0), 100), dimensions };
}

describe('Content Quality Scorer', () => {
  describe('calculateQualityScore', () => {
    it('should score a complete artifact highly', () => {
      const score = calculateQualityScore({
        name: 'Test Artifact',
        description: 'A very detailed description that is long enough to count as good documentation for this artifact. It contains enough detail.',
        source_url: 'https://github.com/org/repo',
        primary_category: 'automation',
        tags: ['docker', 'deploy'],
        updated_at: new Date().toISOString(),
        type_metadata: { stars: 100, forks: 50, language: 'python', version: '1.0', framework: 'fastapi' },
      });
      assert.ok(score.total > 50);
    });

    it('should score an empty artifact low', () => {
      const score = calculateQualityScore({
        name: null, description: null, source_url: null,
        primary_category: null, tags: null, updated_at: null, type_metadata: null,
      });
      assert.ok(score.total < 20);
    });

    it('should have completeness dimension', () => {
      const score = calculateQualityScore({ name: 'Test', description: null, source_url: null, primary_category: null, tags: null, type_metadata: null });
      assert.ok('completeness' in score.dimensions);
    });

    it('should score 100% completeness for all fields', () => {
      const score = calculateQualityScore({
        name: 'Test', description: 'desc', source_url: 'https://x.com',
        primary_category: 'auto', tags: ['a'], type_metadata: null,
      });
      assert.equal(score.dimensions.completeness, 100);
    });

    it('should handle string type_metadata', () => {
      const score = calculateQualityScore({
        name: 'Test', description: null, source_url: null,
        primary_category: null, tags: null,
        type_metadata: '{"stars": 50, "forks": 25}',
      });
      assert.ok(score.dimensions.community_signal > 0);
    });

    it('should factor recency', () => {
      const recent = calculateQualityScore({
        name: 'Test', description: null, source_url: null,
        primary_category: null, tags: null,
        updated_at: new Date().toISOString(), type_metadata: null,
      });
      const old = calculateQualityScore({
        name: 'Test', description: null, source_url: null,
        primary_category: null, tags: null,
        updated_at: new Date(Date.now() - 300 * 86400000).toISOString(), type_metadata: null,
      });
      assert.ok(recent.dimensions.recency > old.dimensions.recency);
    });

    it('should clamp total to 0-100', () => {
      const score = calculateQualityScore({
        name: 'T', description: null, source_url: null,
        primary_category: null, tags: null, type_metadata: null,
      });
      assert.ok(score.total >= 0);
      assert.ok(score.total <= 100);
    });

    it('should score documentation based on description length', () => {
      const short = calculateQualityScore({ name: 'T', description: 'Hi', type_metadata: null });
      const long = calculateQualityScore({
        name: 'T',
        description: 'A very long description that contains a lot of detail about how this artifact works and what it does and why it is important. It goes on for quite a while to test the documentation scoring.',
        type_metadata: null,
      });
      assert.ok(long.dimensions.documentation > short.dimensions.documentation);
    });
  });

  describe('weight validation', () => {
    it('should have weights summing to 1', () => {
      const sum = Object.values(QUALITY_DIMENSIONS).reduce((s, d) => s + d.weight, 0);
      assert.ok(Math.abs(sum - 1.0) < 0.001);
    });
  });
});

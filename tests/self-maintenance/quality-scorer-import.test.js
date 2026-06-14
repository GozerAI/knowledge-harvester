// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #874 — Quality Scorer (source import)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateQualityScore, QUALITY_DIMENSIONS } from '../../src/self-maintenance/quality-scorer.js';

describe('Quality Scorer (source import)', () => {
  describe('QUALITY_DIMENSIONS', () => {
    it('should have weights summing to 1', () => {
      const sum = Object.values(QUALITY_DIMENSIONS).reduce((s, d) => s + d.weight, 0);
      assert.ok(Math.abs(sum - 1.0) < 0.001);
    });
    it('should have 5 dimensions', () => {
      assert.equal(Object.keys(QUALITY_DIMENSIONS).length, 5);
    });
  });

  describe('calculateQualityScore', () => {
    it('should score complete artifact highly', () => {
      const score = calculateQualityScore({
        name: 'Test Artifact',
        description: 'A very detailed description that is long enough to count as good documentation.',
        source_url: 'https://github.com/org/repo',
        primary_category: 'automation',
        tags: ['docker', 'deploy'],
        updated_at: new Date().toISOString(),
        type_metadata: { stars: 100, forks: 50, language: 'python', version: '1.0', framework: 'fastapi' },
      });
      assert.ok(score.total > 50);
    });

    it('should score empty artifact low', () => {
      const score = calculateQualityScore({
        name: null, description: null, source_url: null,
        primary_category: null, tags: null, updated_at: null, type_metadata: null,
      });
      assert.ok(score.total < 20);
    });

    it('should clamp total to 0-100', () => {
      const score = calculateQualityScore({ name: 'T', type_metadata: null });
      assert.ok(score.total >= 0);
      assert.ok(score.total <= 100);
    });

    it('should have all dimension scores', () => {
      const score = calculateQualityScore({ name: 'T', type_metadata: null });
      assert.ok('completeness' in score.dimensions);
      assert.ok('recency' in score.dimensions);
      assert.ok('metadata_richness' in score.dimensions);
      assert.ok('community_signal' in score.dimensions);
      assert.ok('documentation' in score.dimensions);
    });

    it('should score 100% completeness for all fields', () => {
      const score = calculateQualityScore({
        name: 'Test', description: 'desc', source_url: 'https://x.com',
        primary_category: 'auto', tags: ['a'], type_metadata: null,
      });
      assert.equal(score.dimensions.completeness, 100);
    });

    it('should factor recency', () => {
      const recent = calculateQualityScore({
        name: 'Test', updated_at: new Date().toISOString(), type_metadata: null,
      });
      const old = calculateQualityScore({
        name: 'Test', updated_at: new Date(Date.now() - 300 * 86400000).toISOString(), type_metadata: null,
      });
      assert.ok(recent.dimensions.recency > old.dimensions.recency);
    });

    it('should handle string type_metadata', () => {
      const score = calculateQualityScore({
        name: 'Test', type_metadata: '{"stars": 50, "forks": 25}',
      });
      assert.ok(score.dimensions.community_signal > 0);
    });
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #883 — Knowledge Recommender (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRecommendationScore, tagOverlap } from '../../src/self-maintenance/recommender.js';

describe('Recommender (source import)', () => {
  describe('computeRecommendationScore', () => {
    it('should boost score for same category', () => {
      const a = computeRecommendationScore(
        { primary_category: 'ai', quality_score: 50, source: 'category_type' },
        { primary_category: 'ai' }
      );
      const b = computeRecommendationScore(
        { primary_category: 'other', quality_score: 50, source: 'category_type' },
        { primary_category: 'ai' }
      );
      assert.ok(a > b);
    });

    it('should boost relation-based over tag-based', () => {
      const relation = computeRecommendationScore({ quality_score: 50, source: 'relation' }, {});
      const tags = computeRecommendationScore({ quality_score: 50, source: 'tags' }, {});
      assert.ok(relation > tags);
    });

    it('should clamp to 0-1', () => {
      const score = computeRecommendationScore(
        { primary_category: 'x', quality_score: 100, source: 'relation' },
        { primary_category: 'x' }
      );
      assert.ok(score <= 1);
      assert.ok(score >= 0);
    });

    it('should handle zero quality score', () => {
      const score = computeRecommendationScore({ quality_score: 0, source: 'tags' }, {});
      assert.ok(score >= 0);
    });

    it('should handle null quality score', () => {
      const score = computeRecommendationScore({ quality_score: null, source: 'relation' }, {});
      assert.ok(score >= 0);
    });
  });

  describe('tagOverlap', () => {
    it('should return 1 for identical tags', () => {
      assert.equal(tagOverlap(['a', 'b'], ['a', 'b']), 1);
    });
    it('should return 0 for no overlap', () => {
      assert.equal(tagOverlap(['a'], ['b']), 0);
    });
    it('should return 0 for empty arrays', () => {
      assert.equal(tagOverlap([], []), 0);
    });
    it('should return 0 for null inputs', () => {
      assert.equal(tagOverlap(null, ['a']), 0);
      assert.equal(tagOverlap(['a'], null), 0);
    });
    it('should compute partial overlap', () => {
      const score = tagOverlap(['a', 'b', 'c'], ['b', 'c', 'd']);
      assert.ok(score > 0);
      assert.ok(score < 1);
    });
    it('should be case insensitive', () => {
      assert.equal(tagOverlap(['Docker'], ['docker']), 1);
    });
  });
});

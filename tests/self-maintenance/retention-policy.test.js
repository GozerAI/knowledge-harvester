// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #887 — Retention Policy (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRetentionTier, checkRetention, DEFAULT_POLICIES } from '../../src/self-maintenance/retention-policy.js';

describe('Retention Policy (source import)', () => {
  describe('DEFAULT_POLICIES', () => {
    it('should keep high quality indefinitely', () => {
      assert.equal(DEFAULT_POLICIES.high_quality.retentionDays, Infinity);
    });
    it('should keep medium for 1 year', () => {
      assert.equal(DEFAULT_POLICIES.medium_quality.retentionDays, 365);
    });
    it('should keep low for 6 months', () => {
      assert.equal(DEFAULT_POLICIES.low_quality.retentionDays, 180);
    });
    it('should keep unscored for 3 months', () => {
      assert.equal(DEFAULT_POLICIES.unscored.retentionDays, 90);
    });
  });

  describe('classifyRetentionTier', () => {
    it('should classify high quality', () => {
      assert.equal(classifyRetentionTier({ quality_score: 85 }), 'high_quality');
    });
    it('should classify medium quality', () => {
      assert.equal(classifyRetentionTier({ quality_score: 55 }), 'medium_quality');
    });
    it('should classify low quality', () => {
      assert.equal(classifyRetentionTier({ quality_score: 20 }), 'low_quality');
    });
    it('should classify unscored', () => {
      assert.equal(classifyRetentionTier({ quality_score: null }), 'unscored');
    });
    it('should classify boundary at 70', () => {
      assert.equal(classifyRetentionTier({ quality_score: 70 }), 'high_quality');
    });
    it('should classify boundary at 40', () => {
      assert.equal(classifyRetentionTier({ quality_score: 40 }), 'medium_quality');
    });
    it('should classify 0 as low_quality', () => {
      assert.equal(classifyRetentionTier({ quality_score: 0 }), 'low_quality');
    });
  });

  describe('checkRetention', () => {
    it('should not expire high quality artifacts', () => {
      const result = checkRetention({
        quality_score: 90,
        updated_at: new Date(Date.now() - 500 * 86400000).toISOString(),
      });
      assert.equal(result.expired, false);
      assert.equal(result.tier, 'high_quality');
    });

    it('should expire old low quality artifacts', () => {
      const result = checkRetention({
        quality_score: 10,
        updated_at: new Date(Date.now() - 200 * 86400000).toISOString(),
      });
      assert.equal(result.expired, true);
      assert.equal(result.tier, 'low_quality');
    });

    it('should not expire recent low quality artifacts', () => {
      const result = checkRetention({
        quality_score: 10,
        updated_at: new Date().toISOString(),
      });
      assert.equal(result.expired, false);
    });

    it('should return age in days', () => {
      const result = checkRetention({
        quality_score: 50,
        updated_at: new Date(Date.now() - 30 * 86400000).toISOString(),
      });
      assert.ok(result.ageDays >= 29 && result.ageDays <= 31);
    });
  });
});

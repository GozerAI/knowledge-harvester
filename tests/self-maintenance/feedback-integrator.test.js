// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #888 — Feedback Integrator (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidFeedback, computeAdjustment, FEEDBACK_TYPES, FEEDBACK_WEIGHTS } from '../../src/self-maintenance/feedback-integrator.js';

describe('Feedback Integrator (source import)', () => {
  describe('FEEDBACK_TYPES', () => {
    it('should define 5 feedback types', () => { assert.equal(FEEDBACK_TYPES.length, 5); });
    it('should include quality_report', () => { assert.ok(FEEDBACK_TYPES.includes('quality_report')); });
    it('should include user_rating', () => { assert.ok(FEEDBACK_TYPES.includes('user_rating')); });
    it('should include usage_signal', () => { assert.ok(FEEDBACK_TYPES.includes('usage_signal')); });
    it('should include deprecation_notice', () => { assert.ok(FEEDBACK_TYPES.includes('deprecation_notice')); });
    it('should include correction', () => { assert.ok(FEEDBACK_TYPES.includes('correction')); });
  });

  describe('FEEDBACK_WEIGHTS', () => {
    it('should have weights summing to 1', () => {
      const sum = Object.values(FEEDBACK_WEIGHTS).reduce((s, w) => s + w, 0);
      assert.ok(Math.abs(sum - 1.0) < 0.001);
    });
  });

  describe('isValidFeedback', () => {
    it('should validate correct feedback', () => {
      assert.ok(isValidFeedback({ artifact_id: '1', type: 'user_rating', value: 5 }));
    });
    it('should reject missing artifact_id', () => {
      assert.ok(!isValidFeedback({ type: 'user_rating' }));
    });
    it('should reject invalid type', () => {
      assert.ok(!isValidFeedback({ artifact_id: '1', type: 'invalid' }));
    });
    it('should reject null', () => { assert.ok(!isValidFeedback(null)); });
    it('should reject undefined', () => { assert.ok(!isValidFeedback(undefined)); });
    it('should accept all feedback types', () => {
      for (const t of FEEDBACK_TYPES) {
        assert.ok(isValidFeedback({ artifact_id: '1', type: t }));
      }
    });
  });

  describe('computeAdjustment', () => {
    it('should give positive adjustment for high user_rating', () => {
      const adj = computeAdjustment({ type: 'user_rating', value: 5 });
      assert.ok(adj > 0);
    });
    it('should give negative adjustment for low user_rating', () => {
      const adj = computeAdjustment({ type: 'user_rating', value: 1 });
      assert.ok(adj < 0);
    });
    it('should give zero for neutral rating', () => {
      const adj = computeAdjustment({ type: 'user_rating', value: 3 });
      assert.equal(adj, 0);
    });
    it('should give negative for deprecation_notice', () => {
      const adj = computeAdjustment({ type: 'deprecation_notice' });
      assert.ok(adj < 0);
    });
    it('should give negative for correction', () => {
      const adj = computeAdjustment({ type: 'correction' });
      assert.ok(adj < 0);
    });
    it('should give positive for good quality_report', () => {
      const adj = computeAdjustment({ type: 'quality_report', value: 'good' });
      assert.ok(adj > 0);
    });
    it('should give negative for poor quality_report', () => {
      const adj = computeAdjustment({ type: 'quality_report', value: 'poor' });
      assert.ok(adj < 0);
    });
  });
});

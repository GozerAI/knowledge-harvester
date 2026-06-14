// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #866 — Autonomous Source Reliability Scoring
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const RELIABILITY_WEIGHTS = {
  yield_rate: 0.25, quality_avg: 0.25, consistency: 0.2, freshness: 0.15, error_rate: 0.15,
};

function calculateFactors(harvest, quality) {
  const yieldRate = harvest.avg_new_items ? Math.min((harvest.avg_new_items / 10) * 100, 100) : 0;
  const qualityAvg = quality.avg_quality || 0;
  const consistency = harvest.run_count ? (harvest.success_count / harvest.run_count) * 100 : 0;
  const lastRun = harvest.last_run ? new Date(harvest.last_run) : null;
  const daysSinceRun = lastRun ? (Date.now() - lastRun.getTime()) / 86400000 : 365;
  const freshness = Math.max(100 - daysSinceRun * 2, 0);
  const errorRate = harvest.run_count ? (harvest.fail_count / harvest.run_count) * 100 : 50;
  return {
    yield_rate: Math.round(yieldRate), quality_avg: Math.round(qualityAvg),
    consistency: Math.round(consistency), freshness: Math.round(freshness), error_rate: Math.round(errorRate),
  };
}

function classifyTier(score) {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'poor';
  return 'unreliable';
}

describe('Source Reliability Scorer', () => {
  describe('classifyTier', () => {
    it('should classify excellent', () => { assert.equal(classifyTier(85), 'excellent'); });
    it('should classify good', () => { assert.equal(classifyTier(65), 'good'); });
    it('should classify fair', () => { assert.equal(classifyTier(45), 'fair'); });
    it('should classify poor', () => { assert.equal(classifyTier(25), 'poor'); });
    it('should classify unreliable', () => { assert.equal(classifyTier(10), 'unreliable'); });
    it('should classify boundary at 80', () => { assert.equal(classifyTier(80), 'excellent'); });
    it('should classify boundary at 60', () => { assert.equal(classifyTier(60), 'good'); });
  });

  describe('calculateFactors', () => {
    it('should compute yield rate from avg_new_items', () => {
      const f = calculateFactors({ avg_new_items: 5, run_count: 10, success_count: 10, fail_count: 0, last_run: new Date().toISOString() }, {});
      assert.equal(f.yield_rate, 50);
    });

    it('should cap yield rate at 100', () => {
      const f = calculateFactors({ avg_new_items: 20, run_count: 1, success_count: 1, fail_count: 0, last_run: new Date().toISOString() }, {});
      assert.equal(f.yield_rate, 100);
    });

    it('should compute consistency from success rate', () => {
      const f = calculateFactors({ avg_new_items: 0, run_count: 10, success_count: 8, fail_count: 2, last_run: new Date().toISOString() }, {});
      assert.equal(f.consistency, 80);
    });

    it('should handle zero runs', () => {
      const f = calculateFactors({ avg_new_items: 0, run_count: 0, success_count: 0, fail_count: 0 }, {});
      assert.equal(f.consistency, 0);
      assert.equal(f.error_rate, 50);
    });

    it('should use quality average from quality stats', () => {
      const f = calculateFactors({ avg_new_items: 0, run_count: 1, success_count: 1, fail_count: 0, last_run: new Date().toISOString() }, { avg_quality: 72 });
      assert.equal(f.quality_avg, 72);
    });
  });

  describe('weight validation', () => {
    it('should have weights summing to 1', () => {
      const sum = Object.values(RELIABILITY_WEIGHTS).reduce((s, w) => s + w, 0);
      assert.ok(Math.abs(sum - 1.0) < 0.001);
    });
  });
});

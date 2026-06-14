// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #866 — Source Reliability Scorer (source import)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFactors, computeWeightedScore, classifyTier, RELIABILITY_WEIGHTS, scoreSourceReliability } from '../../src/self-maintenance/reliability-scorer.js';

describe('Reliability Scorer (source import)', () => {
  describe('RELIABILITY_WEIGHTS', () => {
    it('should sum to 1', () => {
      const sum = Object.values(RELIABILITY_WEIGHTS).reduce((s, w) => s + w, 0);
      assert.ok(Math.abs(sum - 1.0) < 0.001);
    });
    it('should have 5 weight factors', () => {
      assert.equal(Object.keys(RELIABILITY_WEIGHTS).length, 5);
    });
  });

  describe('calculateFactors', () => {
    it('should compute yield rate from avg_new_items', () => {
      const f = calculateFactors(
        { avg_new_items: 5, run_count: 10, success_count: 10, fail_count: 0, last_run: new Date().toISOString() }, {}
      );
      assert.equal(f.yield_rate, 50);
    });
    it('should cap yield rate at 100', () => {
      const f = calculateFactors(
        { avg_new_items: 20, run_count: 1, success_count: 1, fail_count: 0, last_run: new Date().toISOString() }, {}
      );
      assert.equal(f.yield_rate, 100);
    });
    it('should compute consistency from success rate', () => {
      const f = calculateFactors(
        { avg_new_items: 0, run_count: 10, success_count: 8, fail_count: 2, last_run: new Date().toISOString() }, {}
      );
      assert.equal(f.consistency, 80);
    });
    it('should handle zero runs', () => {
      const f = calculateFactors({ avg_new_items: 0, run_count: 0, success_count: 0, fail_count: 0 }, {});
      assert.equal(f.consistency, 0);
      assert.equal(f.error_rate, 50);
    });
    it('should use quality average from stats', () => {
      const f = calculateFactors(
        { avg_new_items: 0, run_count: 1, success_count: 1, fail_count: 0, last_run: new Date().toISOString() },
        { avg_quality: 72 }
      );
      assert.equal(f.quality_avg, 72);
    });
    it('should compute freshness from last_run', () => {
      const f = calculateFactors(
        { avg_new_items: 0, run_count: 1, success_count: 1, fail_count: 0, last_run: new Date().toISOString() }, {}
      );
      assert.ok(f.freshness >= 98); // Very recent
    });
  });

  describe('computeWeightedScore', () => {
    it('should return 0-100', () => {
      const score = computeWeightedScore({ yield_rate: 50, quality_avg: 60, consistency: 80, freshness: 90, error_rate: 10 });
      assert.ok(score >= 0 && score <= 100);
    });
    it('should return high score for excellent factors', () => {
      const score = computeWeightedScore({ yield_rate: 100, quality_avg: 100, consistency: 100, freshness: 100, error_rate: 0 });
      assert.ok(score >= 90);
    });
    it('should return low score for poor factors', () => {
      const score = computeWeightedScore({ yield_rate: 0, quality_avg: 0, consistency: 0, freshness: 0, error_rate: 100 });
      assert.ok(score <= 10);
    });
  });

  describe('classifyTier', () => {
    it('should classify excellent', () => { assert.equal(classifyTier(85), 'excellent'); });
    it('should classify good', () => { assert.equal(classifyTier(65), 'good'); });
    it('should classify fair', () => { assert.equal(classifyTier(45), 'fair'); });
    it('should classify poor', () => { assert.equal(classifyTier(25), 'poor'); });
    it('should classify unreliable', () => { assert.equal(classifyTier(10), 'unreliable'); });
    it('should classify boundary at 80', () => { assert.equal(classifyTier(80), 'excellent'); });
    it('should classify boundary at 60', () => { assert.equal(classifyTier(60), 'good'); });
    it('should classify boundary at 40', () => { assert.equal(classifyTier(40), 'fair'); });
    it('should classify boundary at 20', () => { assert.equal(classifyTier(20), 'poor'); });
    it('should classify 0 as unreliable', () => { assert.equal(classifyTier(0), 'unreliable'); });
  });

  describe('scoreSourceReliability', () => {
    it('queries harvest_runs using completed status and items_new', async () => {
      const seenSql = [];
      const db = {
        async query(sql) {
          seenSql.push(sql);
          if (sql.includes('FROM harvest_runs')) {
            return { rows: [] };
          }
          return { rows: [] };
        },
      };

      await scoreSourceReliability(db, { limit: 10 });

      assert.ok(seenSql.some(sql => sql.includes("COUNT(*) FILTER (WHERE status = 'completed')")));
      assert.ok(seenSql.some(sql => sql.includes('COALESCE(AVG(items_new), 0)::float AS avg_new_items')));
    });
  });
});

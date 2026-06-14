// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #867 — Freshness Monitor (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAge, generateAlerts, AGE_BUCKETS } from '../../src/self-maintenance/freshness-monitor.js';

describe('Freshness Monitor (source import)', () => {
  describe('AGE_BUCKETS', () => {
    it('should define fresh at 30 days', () => { assert.equal(AGE_BUCKETS.fresh, 30); });
    it('should define recent at 90 days', () => { assert.equal(AGE_BUCKETS.recent, 90); });
    it('should define aging at 180 days', () => { assert.equal(AGE_BUCKETS.aging, 180); });
    it('should define stale at 365 days', () => { assert.equal(AGE_BUCKETS.stale, 365); });
  });

  describe('classifyAge', () => {
    it('should classify 0 days as fresh', () => { assert.equal(classifyAge(0), 'fresh'); });
    it('should classify 30 days as fresh', () => { assert.equal(classifyAge(30), 'fresh'); });
    it('should classify 31 days as recent', () => { assert.equal(classifyAge(31), 'recent'); });
    it('should classify 90 days as recent', () => { assert.equal(classifyAge(90), 'recent'); });
    it('should classify 91 days as aging', () => { assert.equal(classifyAge(91), 'aging'); });
    it('should classify 180 days as aging', () => { assert.equal(classifyAge(180), 'aging'); });
    it('should classify 181 days as stale', () => { assert.equal(classifyAge(181), 'stale'); });
    it('should classify 365 days as stale', () => { assert.equal(classifyAge(365), 'stale'); });
    it('should classify 366 days as expired', () => { assert.equal(classifyAge(366), 'expired'); });
    it('should classify 1000 days as expired', () => { assert.equal(classifyAge(1000), 'expired'); });
  });

  describe('generateAlerts', () => {
    it('should return empty for empty buckets', () => {
      assert.deepEqual(generateAlerts({}), []);
    });

    it('should generate critical when >50% stale+expired', () => {
      const alerts = generateAlerts({
        fresh: { count: 10 }, stale: { count: 30 }, expired: { count: 30 },
      });
      assert.ok(alerts.some(a => a.level === 'critical'));
    });

    it('should generate warning when 30-50% stale', () => {
      const alerts = generateAlerts({
        fresh: { count: 60 }, stale: { count: 25 }, expired: { count: 5 },
      });
      assert.ok(alerts.some(a => a.level === 'warning'));
    });

    it('should generate no alerts when mostly fresh', () => {
      const alerts = generateAlerts({
        fresh: { count: 90 }, recent: { count: 5 }, stale: { count: 3 }, expired: { count: 2 },
      });
      assert.equal(alerts.filter(a => a.level === 'critical').length, 0);
    });

    it('should handle missing bucket counts gracefully', () => {
      const alerts = generateAlerts({ fresh: { count: 100 } });
      assert.equal(alerts.filter(a => a.level === 'critical').length, 0);
    });

    it('should warn when >20% expired', () => {
      const alerts = generateAlerts({
        fresh: { count: 60 }, expired: { count: 25 },
      });
      assert.ok(alerts.some(a => a.message.includes('expired')));
    });
  });
});

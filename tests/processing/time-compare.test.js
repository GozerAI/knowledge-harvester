// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Time-Window Comparisons.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock DB ────────────────────────────────────────────────────────────────

function mockDb(queryResponses = []) {
  let callIndex = 0;
  const calls = [];
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (callIndex < queryResponses.length) {
        const resp = queryResponses[callIndex++];
        if (typeof resp === 'function') return resp(sql, params);
        return resp;
      }
      return { rows: [] };
    },
    getCalls: () => calls,
  };
}

// ── Re-implement comparison logic locally ──────────────────────────────────

function compareWindowsLogic(dataA, dataB, windowA, windowB) {
  const mapA = new Map(dataA.map(r => [r.primary_category, r]));
  const mapB = new Map(dataB.map(r => [r.primary_category, r]));
  const allCategories = new Set([...mapA.keys(), ...mapB.keys()]);
  const comparison = [];

  for (const cat of allCategories) {
    const a = mapA.get(cat) || { count: 0, avg_quality: 0 };
    const b = mapB.get(cat) || { count: 0, avg_quality: 0 };
    comparison.push({
      primary_category: cat,
      window_a: { count: a.count, avg_quality: a.avg_quality },
      window_b: { count: b.count, avg_quality: b.avg_quality },
      count_delta: b.count - a.count,
      quality_delta: Math.round((b.avg_quality - a.avg_quality) * 100) / 100,
    });
  }

  return {
    window_a: windowA,
    window_b: windowB,
    comparison,
    total_a: dataA.reduce((s, r) => s + r.count, 0),
    total_b: dataB.reduce((s, r) => s + r.count, 0),
  };
}

function velocityLogic(comparison) {
  return comparison.map(c => {
    const previous = c.window_a.count;
    const current = c.window_b.count;
    const rate = previous > 0 ? (current - previous) / previous : (current > 0 ? 1 : 0);
    return {
      primary_category: c.primary_category,
      previous_count: previous,
      current_count: current,
      growth_rate: Math.round(rate * 10000) / 10000,
    };
  });
}

function computeTimeWindows(period) {
  const now = new Date();
  let currentStart, previousStart, previousEnd;

  if (period === 'day') {
    currentStart = new Date(now);
    currentStart.setHours(0, 0, 0, 0);
    previousEnd = new Date(currentStart);
    previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - 1);
  } else if (period === 'month') {
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    previousEnd = new Date(currentStart);
    previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  } else {
    const dayOfWeek = now.getUTCDay();
    currentStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek));
    previousEnd = new Date(currentStart);
    previousStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek - 7));
  }

  return { currentStart, previousStart, previousEnd: previousEnd || new Date(currentStart), now };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Time-Window Comparisons', () => {
  const dataA = [
    { primary_category: 'ai-agent', count: 10, avg_quality: 80 },
    { primary_category: 'devops', count: 5, avg_quality: 75 },
  ];
  const dataB = [
    { primary_category: 'ai-agent', count: 15, avg_quality: 85 },
    { primary_category: 'devops', count: 8, avg_quality: 78 },
    { primary_category: 'new-cat', count: 3, avg_quality: 70 },
  ];

  describe('compareWindows', () => {
    it('computes count delta per category', () => {
      const result = compareWindowsLogic(dataA, dataB, { start: 'a', end: 'b' }, { start: 'c', end: 'd' });
      const aiAgent = result.comparison.find(c => c.primary_category === 'ai-agent');
      assert.equal(aiAgent.count_delta, 5);
    });

    it('computes quality delta per category', () => {
      const result = compareWindowsLogic(dataA, dataB, { start: 'a', end: 'b' }, { start: 'c', end: 'd' });
      const aiAgent = result.comparison.find(c => c.primary_category === 'ai-agent');
      assert.equal(aiAgent.quality_delta, 5);
    });

    it('includes categories only in window B as additions', () => {
      const result = compareWindowsLogic(dataA, dataB, { start: 'a', end: 'b' }, { start: 'c', end: 'd' });
      const newCat = result.comparison.find(c => c.primary_category === 'new-cat');
      assert.ok(newCat);
      assert.equal(newCat.window_a.count, 0);
      assert.equal(newCat.window_b.count, 3);
    });

    it('includes totals for both windows', () => {
      const result = compareWindowsLogic(dataA, dataB, { start: 'a', end: 'b' }, { start: 'c', end: 'd' });
      assert.equal(result.total_a, 15); // 10 + 5
      assert.equal(result.total_b, 26); // 15 + 8 + 3
    });

    it('includes window definitions in result', () => {
      const wA = { start: '2026-01-01', end: '2026-01-07' };
      const wB = { start: '2026-01-08', end: '2026-01-14' };
      const result = compareWindowsLogic([], [], wA, wB);
      assert.deepEqual(result.window_a, wA);
      assert.deepEqual(result.window_b, wB);
    });

    it('handles empty windows', () => {
      const result = compareWindowsLogic([], [], { start: 'a', end: 'b' }, { start: 'c', end: 'd' });
      assert.equal(result.comparison.length, 0);
      assert.equal(result.total_a, 0);
      assert.equal(result.total_b, 0);
    });
  });

  describe('thisVsLast — window computation', () => {
    it('day period produces valid windows', () => {
      const { currentStart, previousStart, previousEnd } = computeTimeWindows('day');
      assert.ok(previousStart < previousEnd);
      assert.ok(previousEnd <= currentStart);
    });

    it('week period produces 7-day gap', () => {
      const { currentStart, previousStart } = computeTimeWindows('week');
      const diff = currentStart.getTime() - previousStart.getTime();
      assert.equal(diff, 7 * 24 * 60 * 60 * 1000);
    });

    it('month period produces valid windows', () => {
      const { currentStart, previousStart, previousEnd } = computeTimeWindows('month');
      assert.ok(previousStart < previousEnd);
      assert.ok(previousEnd <= currentStart);
    });
  });

  describe('velocityReport', () => {
    it('computes growth rate per category', () => {
      const comparison = [
        { primary_category: 'ai-agent', window_a: { count: 10 }, window_b: { count: 15 } },
      ];
      const velocities = velocityLogic(comparison);
      assert.equal(velocities[0].growth_rate, 0.5); // (15-10)/10 = 0.5
    });

    it('handles zero previous count (no division by zero)', () => {
      const comparison = [
        { primary_category: 'new', window_a: { count: 0 }, window_b: { count: 5 } },
      ];
      const velocities = velocityLogic(comparison);
      assert.equal(velocities[0].growth_rate, 1); // convention: 1 when prev=0, curr>0
    });

    it('handles both zero (no activity)', () => {
      const comparison = [
        { primary_category: 'dead', window_a: { count: 0 }, window_b: { count: 0 } },
      ];
      const velocities = velocityLogic(comparison);
      assert.equal(velocities[0].growth_rate, 0);
    });

    it('negative growth when count decreases', () => {
      const comparison = [
        { primary_category: 'shrinking', window_a: { count: 10 }, window_b: { count: 5 } },
      ];
      const velocities = velocityLogic(comparison);
      assert.ok(velocities[0].growth_rate < 0);
      assert.equal(velocities[0].growth_rate, -0.5);
    });

    it('velocity entries have category, counts, and rate', () => {
      const comparison = [
        { primary_category: 'test', window_a: { count: 10 }, window_b: { count: 12 } },
      ];
      const velocities = velocityLogic(comparison);
      const v = velocities[0];
      assert.ok('primary_category' in v);
      assert.ok('previous_count' in v);
      assert.ok('current_count' in v);
      assert.ok('growth_rate' in v);
    });
  });
});

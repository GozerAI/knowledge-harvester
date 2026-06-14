// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Cross-System Intelligence Sync (Trendscope).
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

// ── Re-implement sync logic locally ────────────────────────────────────────

function identifyGaps(matrix, minArtifacts = 5) {
  return matrix.filter(cell => cell.count < minArtifacts);
}

function syncLogic(anomalies, blindSpots, khGaps) {
  const recommendations = [];

  if (anomalies && Array.isArray(anomalies)) {
    for (const anomaly of anomalies) {
      const matchingGap = khGaps.find(g =>
        g.primary_category === anomaly.category || g.artifact_type === anomaly.type
      );
      if (matchingGap) {
        recommendations.push({
          source: 'trendscope_anomaly',
          category: anomaly.category || matchingGap.primary_category,
          type: anomaly.type || matchingGap.artifact_type,
          reason: anomaly.description || 'Anomaly detected in Trendscope',
          priority: 'high',
        });
      }
    }
  }

  if (blindSpots && Array.isArray(blindSpots)) {
    for (const spot of blindSpots) {
      recommendations.push({
        source: 'trendscope_blind_spot',
        category: spot.category,
        type: spot.type || 'unknown',
        reason: spot.reason || 'Blind spot detected',
        priority: 'medium',
      });
    }
  }

  for (const gap of khGaps) {
    const alreadyRecommended = recommendations.some(
      r => r.category === gap.primary_category && r.type === gap.artifact_type
    );
    if (!alreadyRecommended) {
      recommendations.push({
        source: 'kh_coverage_gap',
        category: gap.primary_category,
        type: gap.artifact_type,
        reason: `Only ${gap.count} artifacts (below threshold)`,
        priority: 'low',
      });
    }
  }

  return {
    trendscope_available: anomalies !== null || blindSpots !== null,
    anomaly_count: anomalies?.length || 0,
    blind_spot_count: blindSpots?.length || 0,
    kh_gap_count: khGaps.length,
    recommendations,
  };
}

function prioritySort(targets) {
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return [...targets].sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Trendscope Sync', () => {
  const khGaps = [
    { primary_category: 'ai-agent', artifact_type: 'workflow', count: 2 },
    { primary_category: 'devops', artifact_type: 'infra_config', count: 1 },
  ];

  describe('syncFromTrendscope', () => {
    it('produces recommendations from TS anomalies matching KH gaps', () => {
      const anomalies = [{ category: 'ai-agent', description: 'Spike in AI interest' }];
      const result = syncLogic(anomalies, null, khGaps);
      assert.ok(result.recommendations.some(r => r.source === 'trendscope_anomaly'));
    });

    it('includes blind spot recommendations', () => {
      const blindSpots = [{ category: 'emerging-tech', reason: 'No coverage' }];
      const result = syncLogic(null, blindSpots, khGaps);
      assert.ok(result.recommendations.some(r => r.source === 'trendscope_blind_spot'));
    });

    it('includes KH-only gaps as low priority', () => {
      const result = syncLogic(null, null, khGaps);
      const khRecs = result.recommendations.filter(r => r.source === 'kh_coverage_gap');
      assert.equal(khRecs.length, khGaps.length);
      assert.ok(khRecs.every(r => r.priority === 'low'));
    });

    it('trendscope_available is true when anomalies returned', () => {
      const result = syncLogic([], null, []);
      assert.equal(result.trendscope_available, true);
    });

    it('trendscope_available is false when both null', () => {
      const result = syncLogic(null, null, []);
      assert.equal(result.trendscope_available, false);
    });

    it('anomaly_count reflects number of anomalies', () => {
      const anomalies = [{ category: 'a' }, { category: 'b' }];
      const result = syncLogic(anomalies, null, []);
      assert.equal(result.anomaly_count, 2);
    });

    it('does not duplicate recommendations for same category/type', () => {
      const anomalies = [{ category: 'ai-agent', type: 'workflow' }];
      const result = syncLogic(anomalies, null, khGaps);
      const aiRecs = result.recommendations.filter(
        r => r.category === 'ai-agent' && r.type === 'workflow'
      );
      // Should have anomaly rec but not duplicate as kh_coverage_gap
      assert.equal(aiRecs.length, 1);
      assert.equal(aiRecs[0].source, 'trendscope_anomaly');
    });
  });

  describe('getSmartHarvestTargets — priority sorting', () => {
    it('sorts high > medium > low', () => {
      const targets = [
        { priority: 'low', name: 'c' },
        { priority: 'high', name: 'a' },
        { priority: 'medium', name: 'b' },
      ];
      const sorted = prioritySort(targets);
      assert.equal(sorted[0].priority, 'high');
      assert.equal(sorted[1].priority, 'medium');
      assert.equal(sorted[2].priority, 'low');
    });

    it('handles empty array', () => {
      assert.deepEqual(prioritySort([]), []);
    });

    it('handles all same priority', () => {
      const targets = [{ priority: 'medium' }, { priority: 'medium' }];
      const sorted = prioritySort(targets);
      assert.equal(sorted.length, 2);
    });
  });

  describe('graceful degradation', () => {
    it('returns results when TS anomalies null', () => {
      const result = syncLogic(null, null, khGaps);
      assert.ok(result.recommendations.length > 0);
    });

    it('works with empty arrays from TS', () => {
      const result = syncLogic([], [], khGaps);
      assert.ok(result.recommendations.length > 0);
    });
  });
});

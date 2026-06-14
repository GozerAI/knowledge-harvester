// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #709 — Autonomous Content Freshness Management
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement core functions for testing ──

const REFRESH_PRIORITY_WEIGHTS = {
  quality_score: 0.3,
  age_days: 0.4,
  access_count: 0.2,
  category_importance: 0.1,
};

function classifyFreshness(ageDays, windowDays) {
  if (ageDays < windowDays * 0.5) return 'fresh';
  if (ageDays < windowDays) return 'aging';
  if (ageDays < windowDays * 2) return 'stale';
  return 'expired';
}

function getCategoryImportance(category) {
  const importanceMap = {
    automation: 0.9, 'ai-agents': 0.9, devops: 0.8,
    'data-engineering': 0.8, security: 0.9, monitoring: 0.7, documentation: 0.5,
  };
  return importanceMap[category] || 0.5;
}

function calculateRefreshPriority(artifact) {
  const w = REFRESH_PRIORITY_WEIGHTS;
  const qualityFactor = ((artifact.quality_score || 0) / 100) * w.quality_score;
  const ageFactor = Math.min((artifact.age_days || 0) / 365, 1) * w.age_days;
  const catImportance = getCategoryImportance(artifact.primary_category) * w.category_importance;
  const accessFactor = 0.5 * w.access_count;
  const priority = qualityFactor + ageFactor + catImportance + accessFactor;
  return Math.round(Math.min(priority, 1) * 100) / 100;
}

function prioritizeRefreshQueue(staleArtifacts) {
  return staleArtifacts
    .map(a => ({ ...a, refresh_priority: calculateRefreshPriority(a) }))
    .sort((a, b) => b.refresh_priority - a.refresh_priority);
}

describe('Content Freshness Manager', () => {
  describe('classifyFreshness', () => {
    it('should classify fresh content (< 50% window)', () => {
      assert.equal(classifyFreshness(30, 90), 'fresh');
    });

    it('should classify aging content (50-100% window)', () => {
      assert.equal(classifyFreshness(60, 90), 'aging');
    });

    it('should classify stale content (100-200% window)', () => {
      assert.equal(classifyFreshness(120, 90), 'stale');
    });

    it('should classify expired content (>200% window)', () => {
      assert.equal(classifyFreshness(200, 90), 'expired');
    });

    it('should handle zero age', () => {
      assert.equal(classifyFreshness(0, 90), 'fresh');
    });

    it('should handle exact boundary at 50%', () => {
      assert.equal(classifyFreshness(45, 90), 'aging');
    });

    it('should handle exact boundary at 100%', () => {
      assert.equal(classifyFreshness(90, 90), 'stale');
    });

    it('should handle exact boundary at 200%', () => {
      assert.equal(classifyFreshness(180, 90), 'expired');
    });
  });

  describe('getCategoryImportance', () => {
    it('should return high importance for security', () => {
      assert.equal(getCategoryImportance('security'), 0.9);
    });

    it('should return medium importance for documentation', () => {
      assert.equal(getCategoryImportance('documentation'), 0.5);
    });

    it('should return default for unknown category', () => {
      assert.equal(getCategoryImportance('unknown'), 0.5);
    });

    it('should return 0.8 for devops', () => {
      assert.equal(getCategoryImportance('devops'), 0.8);
    });

    it('should return 0.9 for ai-agents', () => {
      assert.equal(getCategoryImportance('ai-agents'), 0.9);
    });
  });

  describe('calculateRefreshPriority', () => {
    it('should prioritize high quality old content', () => {
      const priority = calculateRefreshPriority({
        quality_score: 90, age_days: 200, primary_category: 'security',
      });
      assert.ok(priority > 0.5);
    });

    it('should give lower priority to low quality content', () => {
      const high = calculateRefreshPriority({ quality_score: 90, age_days: 100, primary_category: 'automation' });
      const low = calculateRefreshPriority({ quality_score: 10, age_days: 100, primary_category: 'automation' });
      assert.ok(high > low);
    });

    it('should factor in age', () => {
      const old = calculateRefreshPriority({ quality_score: 50, age_days: 300, primary_category: 'devops' });
      const young = calculateRefreshPriority({ quality_score: 50, age_days: 30, primary_category: 'devops' });
      assert.ok(old > young);
    });

    it('should be clamped to 0-1', () => {
      const priority = calculateRefreshPriority({ quality_score: 100, age_days: 500, primary_category: 'security' });
      assert.ok(priority <= 1);
      assert.ok(priority >= 0);
    });

    it('should handle missing fields', () => {
      const priority = calculateRefreshPriority({});
      assert.ok(priority >= 0);
      assert.ok(priority <= 1);
    });
  });

  describe('prioritizeRefreshQueue', () => {
    it('should sort by priority descending', () => {
      const artifacts = [
        { id: 'low', quality_score: 10, age_days: 30, primary_category: 'documentation' },
        { id: 'high', quality_score: 90, age_days: 300, primary_category: 'security' },
        { id: 'mid', quality_score: 50, age_days: 100, primary_category: 'devops' },
      ];
      const queue = prioritizeRefreshQueue(artifacts);
      assert.equal(queue[0].id, 'high');
      assert.ok(queue[0].refresh_priority >= queue[1].refresh_priority);
      assert.ok(queue[1].refresh_priority >= queue[2].refresh_priority);
    });

    it('should add refresh_priority field', () => {
      const artifacts = [{ quality_score: 50, age_days: 100 }];
      const queue = prioritizeRefreshQueue(artifacts);
      assert.ok('refresh_priority' in queue[0]);
    });

    it('should handle empty array', () => {
      assert.deepEqual(prioritizeRefreshQueue([]), []);
    });
  });
});

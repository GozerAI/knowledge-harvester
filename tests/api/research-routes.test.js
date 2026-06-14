// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for research gap analysis route handler logic.
 *
 * No HTTP server or real DB required. The core logic is re-implemented
 * as pure functions mirroring the route handlers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implemented research gap logic ────────────────────────────────────────

function analyzeResearchGap(body, existingCount, relatedCategories) {
  const { category, priority } = body || {};

  if (!category) {
    return { status: 400, data: { error: 'category is required' } };
  }

  const response = {
    category,
    priority: priority || 'medium',
    existing_artifacts: existingCount,
    status: existingCount < 3 ? 'gap_confirmed' : 'sufficient',
    related_categories: relatedCategories.map(r => ({
      category: r.primary_category,
      artifact_count: parseInt(r.count),
    })),
    recommendation: existingCount === 0
      ? `Critical gap: No artifacts in ${category}. Recommend immediate harvesting.`
      : existingCount < 3
        ? `Low coverage in ${category}. ${existingCount} artifacts found. Recommend targeted harvesting.`
        : `Sufficient coverage in ${category}. ${existingCount} artifacts available.`,
  };

  return { status: 200, data: response };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Research Gap Analysis', () => {
  it('rejects request without category', () => {
    const result = analyzeResearchGap({}, 0, []);
    assert.equal(result.status, 400);
    assert.equal(result.data.error, 'category is required');
  });

  it('rejects null body', () => {
    const result = analyzeResearchGap(null, 0, []);
    assert.equal(result.status, 400);
  });

  it('confirms gap when zero artifacts exist', () => {
    const result = analyzeResearchGap({ category: 'HEALTH' }, 0, []);
    assert.equal(result.status, 200);
    assert.equal(result.data.status, 'gap_confirmed');
    assert.equal(result.data.existing_artifacts, 0);
    assert.ok(result.data.recommendation.includes('Critical gap'));
  });

  it('confirms gap when fewer than 3 artifacts', () => {
    const result = analyzeResearchGap({ category: 'HEALTH' }, 2, []);
    assert.equal(result.data.status, 'gap_confirmed');
    assert.ok(result.data.recommendation.includes('Low coverage'));
  });

  it('reports sufficient when 3+ artifacts exist', () => {
    const result = analyzeResearchGap({ category: 'TECHNOLOGY' }, 10, []);
    assert.equal(result.data.status, 'sufficient');
    assert.ok(result.data.recommendation.includes('Sufficient coverage'));
  });

  it('uses default priority when not specified', () => {
    const result = analyzeResearchGap({ category: 'AI' }, 0, []);
    assert.equal(result.data.priority, 'medium');
  });

  it('preserves custom priority', () => {
    const result = analyzeResearchGap({ category: 'AI', priority: 'high' }, 0, []);
    assert.equal(result.data.priority, 'high');
  });

  it('maps related categories correctly', () => {
    const related = [
      { primary_category: 'ai-agent', count: '15' },
      { primary_category: 'ml-data-ops', count: '8' },
    ];
    const result = analyzeResearchGap({ category: 'AI' }, 0, related);
    assert.equal(result.data.related_categories.length, 2);
    assert.equal(result.data.related_categories[0].category, 'ai-agent');
    assert.equal(result.data.related_categories[0].artifact_count, 15);
  });

  it('handles empty related categories', () => {
    const result = analyzeResearchGap({ category: 'NICHE' }, 0, []);
    assert.deepEqual(result.data.related_categories, []);
  });

  it('returns category in response', () => {
    const result = analyzeResearchGap({ category: 'BLOCKCHAIN' }, 5, []);
    assert.equal(result.data.category, 'BLOCKCHAIN');
  });

  it('includes existing artifact count', () => {
    const result = analyzeResearchGap({ category: 'AI' }, 42, []);
    assert.equal(result.data.existing_artifacts, 42);
  });

  it('boundary: exactly 3 artifacts is sufficient', () => {
    const result = analyzeResearchGap({ category: 'X' }, 3, []);
    assert.equal(result.data.status, 'sufficient');
  });
});

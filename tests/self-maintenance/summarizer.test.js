// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #884 — Knowledge Summarizer (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateArtifactSummary, generateCategorySummary, IMPORTANT_TERMS } from '../../src/self-maintenance/summarizer.js';

describe('Summarizer (source import)', () => {
  describe('IMPORTANT_TERMS', () => {
    it('should have at least 8 important terms', () => {
      assert.ok(IMPORTANT_TERMS.length >= 8);
    });
    it('should include provides', () => { assert.ok(IMPORTANT_TERMS.includes('provides')); });
    it('should include implements', () => { assert.ok(IMPORTANT_TERMS.includes('implements')); });
  });

  describe('generateArtifactSummary', () => {
    it('should summarize from description', () => {
      const s = generateArtifactSummary({
        description: 'This is a useful workflow. It provides automation for common tasks.',
      });
      assert.ok(s.length > 0);
      assert.ok(s.includes('useful workflow'));
    });

    it('should fall back to name-based summary', () => {
      const s = generateArtifactSummary({
        name: 'MyFlow', artifact_type: 'workflow', primary_category: 'automation', description: '',
      });
      assert.ok(s.includes('MyFlow'));
      assert.ok(s.includes('workflow'));
    });

    it('should limit to 500 chars', () => {
      const s = generateArtifactSummary({ description: 'x'.repeat(600) + '. And more content.' });
      assert.ok(s.length <= 500);
    });

    it('should extract key sentences with important terms', () => {
      const s = generateArtifactSummary({
        description: 'First sentence here. This provides cool features. Another random bit.',
      });
      assert.ok(s.includes('provides'));
    });

    it('should handle null description and name', () => {
      const s = generateArtifactSummary({ name: null, description: null });
      assert.ok(s.includes('Untitled'));
    });

    it('should handle artifact with only short description', () => {
      const s = generateArtifactSummary({ name: 'X', description: 'Short' });
      assert.ok(s.includes('X'));
    });
  });

  describe('generateCategorySummary', () => {
    it('should summarize a category', () => {
      const s = generateCategorySummary('automation', [
        { id: '1', name: 'A', artifact_type: 'workflow', quality_score: 80 },
        { id: '2', name: 'B', artifact_type: 'workflow', quality_score: 60 },
        { id: '3', name: 'C', artifact_type: 'code_pattern', quality_score: 90 },
      ]);
      assert.equal(s.category, 'automation');
      assert.equal(s.artifact_count, 3);
      assert.ok(s.type_distribution.workflow === 2);
      assert.ok(s.avg_quality > 0);
      assert.ok(s.top_artifacts.length <= 5);
    });

    it('should handle empty artifacts', () => {
      const s = generateCategorySummary('empty', []);
      assert.equal(s.artifact_count, 0);
      assert.equal(s.avg_quality, null);
    });

    it('should limit top_artifacts to 5', () => {
      const arts = Array.from({ length: 10 }, (_, i) => ({
        id: String(i), name: `A${i}`, quality_score: i * 10,
      }));
      const s = generateCategorySummary('test', arts);
      assert.equal(s.top_artifacts.length, 5);
    });
  });
});

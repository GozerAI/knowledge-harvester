// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #889 — Completeness Assessor (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessFieldPopulation, COMPLETENESS_DIMENSIONS, REQUIRED_FIELDS, DESIRED_FIELDS } from '../../src/self-maintenance/completeness-assessor.js';

describe('Completeness Assessor (source import)', () => {
  describe('COMPLETENESS_DIMENSIONS', () => {
    it('should define 5 dimensions', () => {
      assert.equal(COMPLETENESS_DIMENSIONS.length, 5);
    });
    it('should include field_population', () => {
      assert.ok(COMPLETENESS_DIMENSIONS.includes('field_population'));
    });
    it('should include category_coverage', () => {
      assert.ok(COMPLETENESS_DIMENSIONS.includes('category_coverage'));
    });
    it('should include cross_references', () => {
      assert.ok(COMPLETENESS_DIMENSIONS.includes('cross_references'));
    });
    it('should include depth_coverage', () => {
      assert.ok(COMPLETENESS_DIMENSIONS.includes('depth_coverage'));
    });
    it('should include temporal_coverage', () => {
      assert.ok(COMPLETENESS_DIMENSIONS.includes('temporal_coverage'));
    });
  });

  describe('REQUIRED_FIELDS', () => {
    it('should include name', () => { assert.ok(REQUIRED_FIELDS.includes('name')); });
    it('should include artifact_type', () => { assert.ok(REQUIRED_FIELDS.includes('artifact_type')); });
  });

  describe('assessFieldPopulation', () => {
    it('should score 100% for fully populated artifact', () => {
      const result = assessFieldPopulation({
        name: 'Test', artifact_type: 'workflow', description: 'Desc',
        primary_category: 'auto', source_url: 'https://x.com',
        tags: ['a'], quality_score: 80,
      });
      assert.equal(result.score, 100);
      assert.equal(result.missing.length, 0);
    });

    it('should score 0% for empty artifact', () => {
      const result = assessFieldPopulation({});
      assert.equal(result.score, 0);
      assert.ok(result.missing.length > 0);
    });

    it('should list missing fields', () => {
      const result = assessFieldPopulation({ name: 'Test' });
      assert.ok(result.missing.includes('artifact_type'));
      assert.ok(result.populated.includes('name'));
    });

    it('should not count empty strings as populated', () => {
      const result = assessFieldPopulation({ name: '', description: '  ' });
      assert.ok(result.missing.includes('name'));
      assert.ok(result.missing.includes('description'));
    });

    it('should not count empty arrays as populated', () => {
      const result = assessFieldPopulation({ tags: [] });
      assert.ok(result.missing.includes('tags'));
    });

    it('should count non-empty arrays as populated', () => {
      const result = assessFieldPopulation({ tags: ['docker'] });
      assert.ok(result.populated.includes('tags'));
    });
  });
});

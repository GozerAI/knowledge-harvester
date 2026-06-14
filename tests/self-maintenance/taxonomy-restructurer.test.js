// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #870 — Taxonomy Restructurer (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { areSimilarCategories } from '../../src/self-maintenance/taxonomy-restructurer.js';

describe('Taxonomy Restructurer (source import)', () => {
  describe('areSimilarCategories', () => {
    it('should detect containment (singular/plural)', () => {
      assert.ok(areSimilarCategories('automation', 'automations'));
    });

    it('should detect word overlap', () => {
      assert.ok(areSimilarCategories('data-pipeline', 'data-processing'));
    });

    it('should reject completely different categories', () => {
      assert.ok(!areSimilarCategories('python', 'kubernetes'));
    });

    it('should be case insensitive', () => {
      assert.ok(areSimilarCategories('Automation', 'AUTOMATION'));
    });

    it('should handle dashes and underscores', () => {
      assert.ok(areSimilarCategories('data-engineering', 'data_engineering'));
    });

    it('should detect subset containment', () => {
      assert.ok(areSimilarCategories('ml', 'ml-ops'));
    });

    it('should reject single-word non-matching', () => {
      assert.ok(!areSimilarCategories('security', 'monitoring'));
    });

    it('should detect high overlap with multi-word', () => {
      assert.ok(areSimilarCategories('machine-learning-ops', 'machine-learning'));
    });
  });
});

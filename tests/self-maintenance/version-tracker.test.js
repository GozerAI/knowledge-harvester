// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #881 — Version Tracker (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeContentHash, detectChanges } from '../../src/self-maintenance/version-tracker.js';

describe('Version Tracker (source import)', () => {
  describe('computeContentHash', () => {
    it('should produce consistent hashes', () => {
      const a = { name: 'Test', description: 'Desc', quality_score: 50, type_metadata: {} };
      assert.equal(computeContentHash(a), computeContentHash(a));
    });
    it('should produce different hashes for different names', () => {
      const a = { name: 'A', description: 'X', quality_score: 50, type_metadata: {} };
      const b = { name: 'B', description: 'X', quality_score: 50, type_metadata: {} };
      assert.notEqual(computeContentHash(a), computeContentHash(b));
    });
    it('should produce different hashes for different descriptions', () => {
      const a = { name: 'A', description: 'X', quality_score: 50, type_metadata: {} };
      const b = { name: 'A', description: 'Y', quality_score: 50, type_metadata: {} };
      assert.notEqual(computeContentHash(a), computeContentHash(b));
    });
    it('should produce different hashes for different scores', () => {
      const a = { name: 'A', description: 'X', quality_score: 50, type_metadata: {} };
      const b = { name: 'A', description: 'X', quality_score: 80, type_metadata: {} };
      assert.notEqual(computeContentHash(a), computeContentHash(b));
    });
    it('should return a string', () => {
      const h = computeContentHash({ name: 'T', description: 'D', quality_score: 0, type_metadata: {} });
      assert.equal(typeof h, 'string');
      assert.ok(h.length > 0);
    });
  });

  describe('detectChanges', () => {
    it('should detect name change', () => {
      assert.ok(detectChanges({ name: 'Old' }, { name: 'New' }).includes('name_changed'));
    });
    it('should detect description change', () => {
      assert.ok(detectChanges({ description: 'Old' }, { description: 'New' }).includes('description_changed'));
    });
    it('should detect quality_score change', () => {
      assert.ok(detectChanges({ quality_score: 50 }, { quality_score: 80 }).includes('quality_score_changed'));
    });
    it('should detect category change', () => {
      assert.ok(detectChanges({ primary_category: 'a' }, { primary_category: 'b' }).includes('category_changed'));
    });
    it('should return metadata_updated when no field changes', () => {
      const snap = { name: 'A', description: 'B', quality_score: 50, primary_category: 'c', type_metadata: {} };
      assert.deepEqual(detectChanges(snap, { ...snap }), ['metadata_updated']);
    });
    it('should detect multiple changes', () => {
      const changes = detectChanges(
        { name: 'A', description: 'B', quality_score: 50 },
        { name: 'X', description: 'Y', quality_score: 80 }
      );
      assert.ok(changes.includes('name_changed'));
      assert.ok(changes.includes('description_changed'));
      assert.ok(changes.includes('quality_score_changed'));
    });
  });
});

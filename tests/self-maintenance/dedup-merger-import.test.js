// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #868 — Dedup Merger (source import)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizedSimilarity, deduplicateGroups, DEDUP_THRESHOLD } from '../../src/self-maintenance/dedup-merger.js';

describe('Dedup Merger (source import)', () => {
  describe('DEDUP_THRESHOLD', () => {
    it('should be 0.85', () => { assert.equal(DEDUP_THRESHOLD, 0.85); });
  });

  describe('normalizedSimilarity', () => {
    it('should return 1 for identical', () => {
      assert.equal(normalizedSimilarity('Docker Deployment', 'Docker Deployment'), 1);
    });
    it('should return 0 for completely different', () => {
      assert.equal(normalizedSimilarity('Python Script', 'Terraform Module'), 0);
    });
    it('should be case insensitive', () => {
      assert.equal(normalizedSimilarity('Docker Setup', 'docker setup'), 1);
    });
    it('should handle null inputs', () => {
      assert.equal(normalizedSimilarity(null, 'test'), 0);
      assert.equal(normalizedSimilarity('test', null), 0);
    });
    it('should find partial similarity', () => {
      const sim = normalizedSimilarity('Docker Container Setup', 'Docker Container Config');
      assert.ok(sim > 0.4);
      assert.ok(sim < 1);
    });
    it('should split on dashes', () => {
      assert.equal(normalizedSimilarity('docker-compose', 'docker compose'), 1);
    });
  });

  describe('deduplicateGroups', () => {
    it('should merge groups with same canonical', () => {
      const groups = [
        { canonical_id: 'a', duplicate_ids: ['b'], similarity: 0.9, detection_method: 'url' },
        { canonical_id: 'a', duplicate_ids: ['c'], similarity: 0.8, detection_method: 'name' },
      ];
      const result = deduplicateGroups(groups);
      assert.equal(result.length, 1);
      assert.deepEqual(result[0].duplicate_ids, ['b', 'c']);
    });
    it('should keep max similarity', () => {
      const groups = [
        { canonical_id: 'a', duplicate_ids: ['b'], similarity: 0.7, detection_method: 'url' },
        { canonical_id: 'a', duplicate_ids: ['c'], similarity: 0.95, detection_method: 'name' },
      ];
      const result = deduplicateGroups(groups);
      assert.equal(result[0].similarity, 0.95);
    });
    it('should handle empty input', () => {
      assert.deepEqual(deduplicateGroups([]), []);
    });
  });
});

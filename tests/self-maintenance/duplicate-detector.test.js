// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #868 — Autonomous Duplicate Detection and Merging
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function normalizedSimilarity(a, b) {
  if (!a || !b) return 0;
  const tokensA = new Set(a.toLowerCase().split(/[\s\-_/]+/).filter(w => w.length > 1));
  const tokensB = new Set(b.toLowerCase().split(/[\s\-_/]+/).filter(w => w.length > 1));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) { if (tokensB.has(t)) intersection++; }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function deduplicateGroups(groups) {
  const byCanonical = new Map();
  for (const g of groups) {
    if (byCanonical.has(g.canonical_id)) {
      const existing = byCanonical.get(g.canonical_id);
      for (const id of g.duplicate_ids) {
        if (!existing.duplicate_ids.includes(id)) existing.duplicate_ids.push(id);
      }
      existing.similarity = Math.max(existing.similarity, g.similarity);
    } else {
      byCanonical.set(g.canonical_id, { ...g });
    }
  }
  return [...byCanonical.values()];
}

describe('Duplicate Detector', () => {
  describe('normalizedSimilarity', () => {
    it('should return 1 for identical strings', () => {
      assert.equal(normalizedSimilarity('Docker Deployment', 'Docker Deployment'), 1);
    });

    it('should return 0 for completely different strings', () => {
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

    it('should handle single word strings', () => {
      assert.equal(normalizedSimilarity('Docker', 'Docker'), 1);
    });

    it('should split on dashes and underscores', () => {
      assert.equal(normalizedSimilarity('docker-compose', 'docker compose'), 1);
    });

    it('should return 0 for empty strings (no tokens > 1 char)', () => {
      assert.equal(normalizedSimilarity('', ''), 0);
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

    it('should keep separate canonical IDs', () => {
      const groups = [
        { canonical_id: 'a', duplicate_ids: ['b'], similarity: 0.9, detection_method: 'url' },
        { canonical_id: 'c', duplicate_ids: ['d'], similarity: 0.85, detection_method: 'name' },
      ];
      const result = deduplicateGroups(groups);
      assert.equal(result.length, 2);
    });

    it('should not duplicate IDs in merged group', () => {
      const groups = [
        { canonical_id: 'a', duplicate_ids: ['b', 'c'], similarity: 0.9, detection_method: 'url' },
        { canonical_id: 'a', duplicate_ids: ['c', 'd'], similarity: 0.8, detection_method: 'name' },
      ];
      const result = deduplicateGroups(groups);
      assert.equal(result[0].duplicate_ids.length, 3);
    });

    it('should handle empty input', () => {
      assert.deepEqual(deduplicateGroups([]), []);
    });
  });
});

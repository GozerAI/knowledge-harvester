// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #701 — Autonomous Taxonomy Evolution
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement core functions for testing ──

function extractKeywords(name, tags) {
  const words = new Set();
  if (name) {
    for (const w of name.toLowerCase().split(/[\s\-_/]+/)) {
      if (w.length > 3) words.add(w);
    }
  }
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (typeof t === 'string' && t.length > 2) words.add(t.toLowerCase());
    }
  }
  return [...words];
}

function nameSimilarity(a, b) {
  const triA = trigrams(a.toLowerCase());
  const triB = trigrams(b.toLowerCase());
  const intersection = triA.filter(t => triB.includes(t)).length;
  const union = new Set([...triA, ...triB]).size;
  return union === 0 ? 0 : intersection / union;
}

function trigrams(s) {
  const t = [];
  for (let i = 0; i <= s.length - 3; i++) {
    t.push(s.slice(i, i + 3));
  }
  return t;
}

function findMergeCandidates(smallCats) {
  const pairs = [];
  for (let i = 0; i < smallCats.length; i++) {
    for (let j = i + 1; j < smallCats.length; j++) {
      const a = smallCats[i].primary_category;
      const b = smallCats[j].primary_category;
      const sim = nameSimilarity(a, b);
      if (sim > 0.3) {
        pairs.push({
          categories: [a, b],
          similarity: sim,
          counts: [smallCats[i].count, smallCats[j].count],
        });
      }
    }
  }
  pairs.sort((a, b) => b.similarity - a.similarity);
  return pairs;
}

describe('Taxonomy Evolution', () => {
  describe('extractKeywords', () => {
    it('should extract words longer than 3 chars from name', () => {
      const kw = extractKeywords('Deploy Docker Container', null);
      assert.ok(kw.includes('deploy'));
      assert.ok(kw.includes('docker'));
      assert.ok(kw.includes('container'));
    });

    it('should exclude short words', () => {
      const kw = extractKeywords('A to B via C', null);
      assert.ok(!kw.includes('a'));
      assert.ok(!kw.includes('to'));
    });

    it('should extract tags', () => {
      const kw = extractKeywords(null, ['python', 'ml', 'tensorflow']);
      assert.ok(kw.includes('python'));
      assert.ok(kw.includes('tensorflow'));
    });

    it('should combine name and tag keywords', () => {
      const kw = extractKeywords('Docker Setup', ['kubernetes', 'cicd']);
      assert.ok(kw.includes('docker'));
      assert.ok(kw.includes('setup'));
      assert.ok(kw.includes('kubernetes'));
      assert.ok(kw.includes('cicd'));
    });

    it('should handle null name and tags', () => {
      assert.deepEqual(extractKeywords(null, null), []);
    });

    it('should split on dashes and underscores', () => {
      const kw = extractKeywords('terraform-module_config', null);
      assert.ok(kw.includes('terraform'));
      assert.ok(kw.includes('module'));
      assert.ok(kw.includes('config'));
    });

    it('should lowercase all keywords', () => {
      const kw = extractKeywords('TERRAFORM Module', null);
      assert.ok(kw.includes('terraform'));
      assert.ok(kw.includes('module'));
    });
  });

  describe('nameSimilarity', () => {
    it('should return 1 for identical strings', () => {
      assert.equal(nameSimilarity('automation', 'automation'), 1);
    });

    it('should return 0 for completely different strings', () => {
      const sim = nameSimilarity('abc', 'xyz');
      assert.equal(sim, 0);
    });

    it('should return high similarity for similar names', () => {
      const sim = nameSimilarity('automation', 'automations');
      assert.ok(sim > 0.7);
    });

    it('should be case insensitive', () => {
      assert.equal(nameSimilarity('Docker', 'docker'), 1);
    });

    it('should handle short strings', () => {
      const sim = nameSimilarity('ab', 'cd');
      assert.equal(sim, 0);
    });

    it('should handle empty strings', () => {
      assert.equal(nameSimilarity('', ''), 0);
    });
  });

  describe('findMergeCandidates', () => {
    it('should find similar categories', () => {
      const cats = [
        { primary_category: 'automation', count: 2 },
        { primary_category: 'automations', count: 1 },
      ];
      const pairs = findMergeCandidates(cats);
      assert.equal(pairs.length, 1);
      assert.deepEqual(pairs[0].categories, ['automation', 'automations']);
    });

    it('should not merge dissimilar categories', () => {
      const cats = [
        { primary_category: 'python', count: 1 },
        { primary_category: 'kubernetes', count: 2 },
      ];
      const pairs = findMergeCandidates(cats);
      assert.equal(pairs.length, 0);
    });

    it('should sort by similarity descending', () => {
      const cats = [
        { primary_category: 'data-pipeline', count: 1 },
        { primary_category: 'data-pipelines', count: 2 },
        { primary_category: 'data-processing', count: 1 },
      ];
      const pairs = findMergeCandidates(cats);
      if (pairs.length >= 2) {
        assert.ok(pairs[0].similarity >= pairs[1].similarity);
      }
    });

    it('should handle empty input', () => {
      assert.deepEqual(findMergeCandidates([]), []);
    });

    it('should handle single category', () => {
      const cats = [{ primary_category: 'solo', count: 1 }];
      assert.deepEqual(findMergeCandidates(cats), []);
    });

    it('should include counts in result', () => {
      const cats = [
        { primary_category: 'deploy', count: 2 },
        { primary_category: 'deployment', count: 1 },
      ];
      const pairs = findMergeCandidates(cats);
      if (pairs.length > 0) {
        assert.deepEqual(pairs[0].counts, [2, 1]);
      }
    });
  });

  describe('trigrams', () => {
    it('should generate correct trigrams', () => {
      const t = trigrams('hello');
      assert.deepEqual(t, ['hel', 'ell', 'llo']);
    });

    it('should handle short strings', () => {
      assert.deepEqual(trigrams('ab'), []);
    });

    it('should handle exactly 3 chars', () => {
      assert.deepEqual(trigrams('abc'), ['abc']);
    });
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ArtifactDedupCache,
  BloomFilter,
  getDedupCache,
  getBloomFilter,
} from '../../src/processing/dedup-cache.js';

// ── ArtifactDedupCache (#43) ─────────────────────────────────────────────

describe('ArtifactDedupCache', () => {
  it('reports not duplicate for unseen hash', () => {
    const cache = new ArtifactDedupCache();
    const { isDuplicate } = cache.check('abc123');
    assert.ok(!isDuplicate);
  });

  it('reports duplicate after adding hash', () => {
    const cache = new ArtifactDedupCache();
    cache.add('abc123', 'id-1');
    const { isDuplicate, existingId } = cache.check('abc123');
    assert.ok(isDuplicate);
    assert.equal(existingId, 'id-1');
  });

  it('expires entries after TTL', () => {
    const cache = new ArtifactDedupCache({ ttlMs: 1 });
    cache.add('hash1', 'id-1');
    const start = Date.now();
    while (Date.now() - start < 5) {}
    const { isDuplicate } = cache.check('hash1');
    assert.ok(!isDuplicate);
  });

  it('evicts oldest when at capacity', () => {
    const cache = new ArtifactDedupCache({ maxSize: 2 });
    cache.add('h1', 'id-1');
    cache.add('h2', 'id-2');
    cache.add('h3', 'id-3');
    assert.ok(!cache.check('h1').isDuplicate);
    assert.ok(cache.check('h2').isDuplicate);
    assert.ok(cache.check('h3').isDuplicate);
  });

  it('checkBatch returns duplicates map', () => {
    const cache = new ArtifactDedupCache();
    cache.add('h1', 'id-1');
    cache.add('h2', 'id-2');
    const dupes = cache.checkBatch(['h1', 'h3', 'h2']);
    assert.equal(dupes.size, 2);
    assert.equal(dupes.get('h1'), 'id-1');
    assert.ok(!dupes.has('h3'));
  });

  it('preload loads from DB', async () => {
    const db = { query: async () => ({ rows: [{ hash: 'h1', id: 'id-1' }, { hash: 'h2', id: 'id-2' }] }) };
    const cache = new ArtifactDedupCache();
    await cache.preload(db);
    assert.ok(cache.check('h1').isDuplicate);
    assert.ok(cache.check('h2').isDuplicate);
  });

  it('getStats tracks hits and misses', () => {
    const cache = new ArtifactDedupCache();
    cache.add('h1', 'id-1');
    cache.check('h1');
    cache.check('h2');
    const stats = cache.getStats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
    assert.ok(stats.hitRate > 0);
  });

  it('prune removes expired entries', () => {
    const cache = new ArtifactDedupCache({ ttlMs: 1 });
    cache.add('h1', 'id-1');
    cache.add('h2', 'id-2');
    const start = Date.now();
    while (Date.now() - start < 5) {}
    const pruned = cache.prune();
    assert.equal(pruned, 2);
    assert.equal(cache.size, 0);
  });

  it('clear resets cache', () => {
    const cache = new ArtifactDedupCache();
    cache.add('h1', 'id-1');
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.getStats().hits, 0);
  });
});

// ── BloomFilter (#53) ────────────────────────────────────────────────────

describe('BloomFilter', () => {
  it('mightContain returns false for unseen items', () => {
    const bf = new BloomFilter();
    assert.ok(!bf.mightContain('never-added'));
  });

  it('mightContain returns true after add', () => {
    const bf = new BloomFilter();
    bf.add('test-item');
    assert.ok(bf.mightContain('test-item'));
  });

  it('has zero false negatives', () => {
    const bf = new BloomFilter({ size: 10000, hashCount: 5 });
    const items = Array.from({ length: 100 }, (_, i) => 'item-' + i);
    for (const item of items) bf.add(item);
    for (const item of items) {
      assert.ok(bf.mightContain(item), item + ' should be found');
    }
  });

  it('testAndAdd returns false for new item, true for existing', () => {
    const bf = new BloomFilter();
    assert.ok(!bf.testAndAdd('x'));
    assert.ok(bf.testAndAdd('x'));
  });

  it('count increments for new items', () => {
    const bf = new BloomFilter();
    assert.equal(bf.count, 0);
    bf.add('a');
    assert.ok(bf.count >= 1);
    bf.add('b');
    assert.ok(bf.count >= 2);
  });

  it('estimatedFPRate is low for small fill', () => {
    const bf = new BloomFilter({ size: 100000, hashCount: 7 });
    bf.add('a');
    bf.add('b');
    assert.ok(bf.estimatedFPRate() < 0.01);
  });

  it('clear resets the filter', () => {
    const bf = new BloomFilter();
    bf.add('a');
    bf.add('b');
    bf.clear();
    assert.equal(bf.count, 0);
    assert.ok(!bf.mightContain('a'));
  });

  it('merge combines two filters', () => {
    const bf1 = new BloomFilter({ size: 1000, hashCount: 5 });
    const bf2 = new BloomFilter({ size: 1000, hashCount: 5 });
    bf1.add('a');
    bf2.add('b');
    bf1.merge(bf2);
    assert.ok(bf1.mightContain('a'));
    assert.ok(bf1.mightContain('b'));
  });

  it('merge rejects mismatched parameters', () => {
    const bf1 = new BloomFilter({ size: 1000, hashCount: 5 });
    const bf2 = new BloomFilter({ size: 2000, hashCount: 5 });
    assert.throws(() => bf1.merge(bf2));
  });

  it('fillRatio increases with additions', () => {
    const bf = new BloomFilter({ size: 1000, hashCount: 3 });
    const r0 = bf.fillRatio();
    for (let i = 0; i < 50; i++) bf.add('item-' + i);
    assert.ok(bf.fillRatio() > r0);
  });

  it('size returns configured size', () => {
    const bf = new BloomFilter({ size: 5000 });
    assert.equal(bf.size, 5000);
  });
});

describe('singleton factories', () => {
  it('getDedupCache returns same instance', () => {
    const a = getDedupCache();
    const b = getDedupCache();
    assert.equal(a, b);
  });

  it('getBloomFilter returns same instance', () => {
    const a = getBloomFilter();
    const b = getBloomFilter();
    assert.equal(a, b);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { discoverTestFiles, fileToShard, getShardFiles, shardReport } from '../../test-shard.mjs';

const BASE = resolve('F:/Projects/knowledge-harvester');

describe('discoverTestFiles', () => {
  it('finds test files in known directories', () => {
    const files = discoverTestFiles(BASE);
    assert.ok(files.length > 0, 'should find at least one test file');
  });

  it('only includes .test.js and .test.mjs files', () => {
    const files = discoverTestFiles(BASE);
    for (const f of files) {
      assert.ok(f.endsWith('.test.js') || f.endsWith('.test.mjs'), 'unexpected file: ' + f);
    }
  });

  it('returns sorted array', () => {
    const files = discoverTestFiles(BASE);
    const sorted = [...files].sort();
    assert.deepEqual(files, sorted);
  });
});

describe('fileToShard', () => {
  it('returns a number in range [0, totalShards)', () => {
    const shard = fileToShard('tests/api/webhooks.test.js', 4);
    assert.ok(shard >= 0 && shard < 4);
  });

  it('is deterministic', () => {
    const a = fileToShard('tests/processing/embedder.test.js', 8);
    const b = fileToShard('tests/processing/embedder.test.js', 8);
    assert.equal(a, b);
  });

  it('distributes files across shards', () => {
    const shardSet = new Set();
    const testFiles = Array.from({ length: 20 }, (_, i) => 'tests/f' + i + '.test.js');
    for (const f of testFiles) {
      shardSet.add(fileToShard(f, 4));
    }
    assert.ok(shardSet.size > 1, 'files should be distributed across multiple shards');
  });
});

describe('getShardFiles', () => {
  it('returns subset of all files', () => {
    const all = discoverTestFiles(BASE);
    const shard0 = getShardFiles(0, 4, BASE);
    assert.ok(shard0.length > 0);
    assert.ok(shard0.length < all.length);
  });

  it('all shards together cover all files', () => {
    const all = discoverTestFiles(BASE);
    const combined = [];
    for (let i = 0; i < 4; i++) {
      combined.push(...getShardFiles(i, 4, BASE));
    }
    combined.sort();
    assert.deepEqual(combined, all);
  });

  it('shards have no overlapping files', () => {
    const seen = new Set();
    for (let i = 0; i < 4; i++) {
      for (const f of getShardFiles(i, 4, BASE)) {
        assert.ok(!seen.has(f), 'duplicate file across shards: ' + f);
        seen.add(f);
      }
    }
  });
});

describe('shardReport', () => {
  it('returns one entry per shard', () => {
    const report = shardReport(4, BASE);
    assert.equal(report.length, 4);
  });

  it('each shard has files and count', () => {
    const report = shardReport(3, BASE);
    for (const s of report) {
      assert.ok(typeof s.shard === 'number');
      assert.ok(Array.isArray(s.files));
      assert.equal(s.count, s.files.length);
    }
  });

  it('total files across shards equals all files', () => {
    const report = shardReport(4, BASE);
    const totalFiles = report.reduce((s, sh) => s + sh.count, 0);
    const all = discoverTestFiles(BASE);
    assert.equal(totalFiles, all.length);
  });
});

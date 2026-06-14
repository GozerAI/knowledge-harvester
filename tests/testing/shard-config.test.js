// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for parallel test sharding (#244).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implemented locally for pure-logic testing ──────────────────────────

function shardTestFiles(files, shardCount, { strategy = 'file-size', durations = {} } = {}) {
  if (shardCount <= 0) throw new Error('shardCount must be positive');
  if (files.length === 0) return Array.from({ length: shardCount }, () => []);

  const effectiveShards = Math.min(shardCount, files.length);
  const shards = Array.from({ length: effectiveShards }, () => []);

  if (strategy === 'round-robin') {
    for (let i = 0; i < files.length; i++) {
      shards[i % effectiveShards].push(files[i]);
    }
  } else if (strategy === 'file-size' || strategy === 'duration') {
    const weighted = files.map(f => ({
      file: f,
      weight: strategy === 'duration' ? (durations[f] || 1000) : f.length, // use name length as proxy for size in tests
    })).sort((a, b) => b.weight - a.weight);

    const shardWeights = new Array(effectiveShards).fill(0);
    for (const { file, weight } of weighted) {
      let minIdx = 0;
      for (let i = 1; i < effectiveShards; i++) {
        if (shardWeights[i] < shardWeights[minIdx]) minIdx = i;
      }
      shards[minIdx].push(file);
      shardWeights[minIdx] += weight;
    }
  } else {
    throw new Error(`Unknown shard strategy: ${strategy}`);
  }

  while (shards.length < shardCount) shards.push([]);
  return shards;
}

function buildShardCommand(files, { shardIndex = 0, concurrency = 1 } = {}) {
  if (files.length === 0) return 'echo "Shard empty, nothing to run"';
  const fileList = files.join(' ');
  return `node --test --test-concurrency=${concurrency} ${fileList}`;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Test Sharding (#244)', () => {
  const testFiles = [
    'tests/a.test.js',
    'tests/b.test.js',
    'tests/c.test.js',
    'tests/d.test.js',
    'tests/e.test.js',
    'tests/f.test.js',
  ];

  describe('shardTestFiles', () => {
    it('should throw for non-positive shardCount', () => {
      assert.throws(() => shardTestFiles([], 0), /positive/);
      assert.throws(() => shardTestFiles([], -1), /positive/);
    });

    it('should return empty shards for empty files', () => {
      const shards = shardTestFiles([], 3);
      assert.equal(shards.length, 3);
      assert.deepEqual(shards[0], []);
    });

    it('should split files with round-robin', () => {
      const shards = shardTestFiles(testFiles, 3, { strategy: 'round-robin' });
      assert.equal(shards.length, 3);
      assert.equal(shards[0].length, 2);
      assert.equal(shards[1].length, 2);
      assert.equal(shards[2].length, 2);
    });

    it('should distribute all files across shards', () => {
      const shards = shardTestFiles(testFiles, 3, { strategy: 'round-robin' });
      const allFiles = shards.flat();
      assert.equal(allFiles.length, testFiles.length);
      for (const f of testFiles) {
        assert.ok(allFiles.includes(f), `Missing file: ${f}`);
      }
    });

    it('should handle more shards than files', () => {
      const shards = shardTestFiles(['a.test.js'], 5, { strategy: 'round-robin' });
      assert.equal(shards.length, 5);
      const nonEmpty = shards.filter(s => s.length > 0);
      assert.equal(nonEmpty.length, 1);
    });

    it('should shard by file-size strategy', () => {
      const shards = shardTestFiles(testFiles, 2, { strategy: 'file-size' });
      assert.equal(shards.length, 2);
      const allFiles = shards.flat();
      assert.equal(allFiles.length, testFiles.length);
    });

    it('should shard by duration strategy', () => {
      const durations = {
        'tests/a.test.js': 5000,
        'tests/b.test.js': 1000,
        'tests/c.test.js': 3000,
        'tests/d.test.js': 2000,
        'tests/e.test.js': 500,
        'tests/f.test.js': 4000,
      };
      const shards = shardTestFiles(testFiles, 2, { strategy: 'duration', durations });
      assert.equal(shards.length, 2);
      const allFiles = shards.flat();
      assert.equal(allFiles.length, testFiles.length);
    });

    it('should throw for unknown strategy', () => {
      assert.throws(() => shardTestFiles(testFiles, 2, { strategy: 'unknown' }), /Unknown/);
    });

    it('should balance shards roughly evenly with round-robin', () => {
      const shards = shardTestFiles(testFiles, 3, { strategy: 'round-robin' });
      const sizes = shards.map(s => s.length);
      const maxDiff = Math.max(...sizes) - Math.min(...sizes);
      assert.ok(maxDiff <= 1);
    });

    it('should use default duration for missing entries', () => {
      const shards = shardTestFiles(testFiles, 2, { strategy: 'duration', durations: {} });
      const allFiles = shards.flat();
      assert.equal(allFiles.length, testFiles.length);
    });
  });

  describe('buildShardCommand', () => {
    it('should generate node --test command', () => {
      const cmd = buildShardCommand(['a.test.js', 'b.test.js']);
      assert.ok(cmd.includes('node --test'));
      assert.ok(cmd.includes('a.test.js'));
      assert.ok(cmd.includes('b.test.js'));
    });

    it('should include concurrency flag', () => {
      const cmd = buildShardCommand(['a.test.js'], { concurrency: 4 });
      assert.ok(cmd.includes('--test-concurrency=4'));
    });

    it('should handle empty files', () => {
      const cmd = buildShardCommand([]);
      assert.ok(cmd.includes('empty'));
    });
  });
});

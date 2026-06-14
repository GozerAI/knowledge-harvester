// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveBatchSizer } from '../../src/processing/adaptive-batch.js';

describe('AdaptiveBatchSizer', () => {
  describe('constructor', () => {
    it('uses default options', () => {
      const sizer = new AdaptiveBatchSizer();
      assert.equal(sizer.currentSize, 10);
    });

    it('accepts custom options', () => {
      const sizer = new AdaptiveBatchSizer({ initialSize: 50, minSize: 5, maxSize: 500 });
      assert.equal(sizer.currentSize, 50);
    });
  });

  describe('record and AIMD', () => {
    it('increases size on healthy observations', () => {
      const sizer = new AdaptiveBatchSizer({
        initialSize: 10, targetLatencyMs: 2000, maxErrorRate: 0.1,
        increaseStep: 5, windowSize: 5,
      });
      // Record healthy observations (low latency, no errors)
      for (let i = 0; i < 5; i++) {
        sizer.record({ latencyMs: 500, batchSize: 10, errors: 0, total: 10 });
      }
      assert.ok(sizer.currentSize > 10, 'Should increase from 10, got ' + sizer.currentSize);
    });

    it('decreases size on high error rate', () => {
      const sizer = new AdaptiveBatchSizer({
        initialSize: 20, maxErrorRate: 0.1, decreaseFactor: 0.5, windowSize: 5,
      });
      for (let i = 0; i < 5; i++) {
        sizer.record({ latencyMs: 100, batchSize: 10, errors: 5, total: 10 });
      }
      assert.ok(sizer.currentSize < 20, 'Should decrease from 20, got ' + sizer.currentSize);
    });

    it('decreases size on high latency', () => {
      const sizer = new AdaptiveBatchSizer({
        initialSize: 20, targetLatencyMs: 1000, decreaseFactor: 0.5, windowSize: 5,
      });
      for (let i = 0; i < 5; i++) {
        sizer.record({ latencyMs: 3000, batchSize: 20, errors: 0, total: 20 });
      }
      assert.ok(sizer.currentSize < 20);
    });

    it('does not go below minSize', () => {
      const sizer = new AdaptiveBatchSizer({
        initialSize: 5, minSize: 3, maxErrorRate: 0.01, decreaseFactor: 0.1, windowSize: 3,
      });
      for (let i = 0; i < 10; i++) {
        sizer.record({ latencyMs: 100, batchSize: 5, errors: 5, total: 5 });
      }
      assert.ok(sizer.currentSize >= 3);
    });

    it('does not go above maxSize', () => {
      const sizer = new AdaptiveBatchSizer({
        initialSize: 190, maxSize: 200, increaseStep: 50, windowSize: 3,
      });
      for (let i = 0; i < 10; i++) {
        sizer.record({ latencyMs: 100, batchSize: 190, errors: 0, total: 190 });
      }
      assert.ok(sizer.currentSize <= 200);
    });

    it('no adjustment with fewer than 3 observations', () => {
      const sizer = new AdaptiveBatchSizer({ initialSize: 10 });
      sizer.record({ latencyMs: 5000, batchSize: 10, errors: 10, total: 10 });
      assert.equal(sizer.currentSize, 10);
    });
  });

  describe('getWindowStats', () => {
    it('returns zeros for no observations', () => {
      const stats = new AdaptiveBatchSizer().getWindowStats();
      assert.equal(stats.avgLatency, 0);
      assert.equal(stats.samples, 0);
    });

    it('computes stats from observations', () => {
      const sizer = new AdaptiveBatchSizer();
      sizer.record({ latencyMs: 100, batchSize: 10, errors: 1, total: 10 });
      sizer.record({ latencyMs: 200, batchSize: 10, errors: 0, total: 10 });
      sizer.record({ latencyMs: 300, batchSize: 10, errors: 0, total: 10 });
      const stats = sizer.getWindowStats();
      assert.equal(stats.avgLatency, 200);
      assert.equal(stats.samples, 3);
      assert.ok(stats.errorRate > 0);
    });
  });

  describe('execute', () => {
    it('processes all items in batches', async () => {
      const sizer = new AdaptiveBatchSizer({ initialSize: 3 });
      const items = [1, 2, 3, 4, 5, 6, 7];
      const { results, totalErrors } = await sizer.execute(items, async (batch) => {
        return { results: batch.map(x => x * 2), errors: 0 };
      });
      assert.equal(results.length, 7);
      assert.equal(totalErrors, 0);
    });

    it('counts errors from batches', async () => {
      const sizer = new AdaptiveBatchSizer({ initialSize: 5 });
      const { totalErrors } = await sizer.execute([1, 2, 3], async () => {
        return { results: [], errors: 2 };
      });
      assert.equal(totalErrors, 2);
    });

    it('handles batch function throwing', async () => {
      const sizer = new AdaptiveBatchSizer({ initialSize: 5 });
      const { totalErrors } = await sizer.execute([1, 2, 3], async () => {
        throw new Error('batch fail');
      });
      assert.equal(totalErrors, 3);
    });
  });

  describe('getStats', () => {
    it('returns comprehensive stats', () => {
      const sizer = new AdaptiveBatchSizer({ initialSize: 10, minSize: 1, maxSize: 100 });
      const stats = sizer.getStats();
      assert.equal(stats.currentSize, 10);
      assert.equal(stats.minSize, 1);
      assert.equal(stats.maxSize, 100);
      assert.equal(stats.totalBatches, 0);
    });
  });

  describe('reset', () => {
    it('resets to specified size', () => {
      const sizer = new AdaptiveBatchSizer({ initialSize: 10 });
      sizer.record({ latencyMs: 100, batchSize: 10, errors: 0, total: 10 });
      sizer.reset(20);
      assert.equal(sizer.currentSize, 20);
      assert.equal(sizer.getStats().totalBatches, 0);
    });
  });
});

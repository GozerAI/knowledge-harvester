// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WorkerPool,
  CheckpointManager,
  EnrichmentPipeline,
  PriorityQueue,
} from '../../src/processing/worker-pool.js';

describe('WorkerPool', () => {
  it('processes tasks with concurrency limit', async () => {
    const pool = new WorkerPool({ concurrency: 2 });
    let maxActive = 0;
    const results = [];
    const tasks = Array.from({ length: 5 }, (_, i) => () => {
      maxActive = Math.max(maxActive, pool.active);
      results.push(i);
      return Promise.resolve(i);
    });
    await Promise.all(tasks.map(fn => pool.submit(fn)));
    assert.equal(results.length, 5);
    assert.ok(maxActive <= 2);
  });

  it('map processes all items', async () => {
    const pool = new WorkerPool({ concurrency: 3 });
    const results = await pool.map([1, 2, 3, 4], async (n) => n * 2);
    assert.equal(results.length, 4);
    assert.equal(results[0].result, 2);
    assert.equal(results[3].result, 8);
  });

  it('map captures errors per item', async () => {
    const pool = new WorkerPool({ concurrency: 2 });
    const results = await pool.map([1, 2, 3], async (n) => {
      if (n === 2) throw new Error('bad');
      return n;
    });
    assert.ok(results[1].error);
    assert.equal(results[0].result, 1);
  });

  it('drain resolves when all tasks complete', async () => {
    const pool = new WorkerPool({ concurrency: 1 });
    const order = [];
    pool.submit(async () => { order.push(1); });
    pool.submit(async () => { order.push(2); });
    await pool.drain();
    assert.deepEqual(order, [1, 2]);
  });

  it('drain resolves immediately when empty', async () => {
    await new WorkerPool().drain();
  });

  it('abort rejects pending tasks', async () => {
    const pool = new WorkerPool({ concurrency: 1 });
    pool.submit(async () => new Promise(r => setTimeout(r, 50)));
    const p2 = pool.submit(async () => 2);
    pool.abort();
    await assert.rejects(p2, /aborted/);
  });

  it('submit rejects after abort', async () => {
    const pool = new WorkerPool();
    pool.abort();
    await assert.rejects(() => pool.submit(async () => 1), /aborted/);
  });

  it('getStats returns correct counts', async () => {
    const pool = new WorkerPool({ concurrency: 2, name: 'test-pool' });
    await pool.submit(async () => 1);
    await pool.submit(async () => { throw new Error('x'); }).catch(() => {});
    const stats = pool.getStats();
    assert.equal(stats.name, 'test-pool');
    assert.equal(stats.completed, 1);
    assert.equal(stats.failed, 1);
  });

  it('calls onTaskComplete callback', async () => {
    const completed = [];
    const pool = new WorkerPool({ onTaskComplete: (r) => completed.push(r) });
    await pool.submit(async () => 42);
    assert.deepEqual(completed, [42]);
  });

  it('calls onTaskError callback', async () => {
    const errors = [];
    const pool = new WorkerPool({ onTaskError: (e) => errors.push(e.message) });
    await pool.submit(async () => { throw new Error('oops'); }).catch(() => {});
    assert.deepEqual(errors, ['oops']);
  });
});

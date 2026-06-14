// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CheckpointManager } from '../../src/processing/worker-pool.js';

describe('CheckpointManager', () => {
  it('saves and loads in memory', async () => {
    const mgr = new CheckpointManager();
    await mgr.save('job-1', { lastIndex: 5, count: 10 });
    const state = await mgr.load('job-1');
    assert.deepEqual(state, { lastIndex: 5, count: 10 });
  });

  it('returns null for unknown job', async () => {
    assert.equal(await new CheckpointManager().load('nonexistent'), null);
  });

  it('clear removes checkpoint', async () => {
    const mgr = new CheckpointManager();
    await mgr.save('j1', { x: 1 });
    await mgr.clear('j1');
    assert.equal(await mgr.load('j1'), null);
  });

  it('listActive returns all checkpoints', async () => {
    const mgr = new CheckpointManager();
    await mgr.save('a', { i: 1 });
    await mgr.save('b', { i: 2 });
    assert.equal((await mgr.listActive()).length, 2);
  });

  it('runWithCheckpoints processes all items', async () => {
    const mgr = new CheckpointManager();
    const result = await mgr.runWithCheckpoints('jx', [1, 2, 3, 4, 5], async (item) => item * 2);
    assert.equal(result.processed, 5);
    assert.deepEqual(result.results, [2, 4, 6, 8, 10]);
  });

  it('runWithCheckpoints resumes from checkpoint', async () => {
    const mgr = new CheckpointManager();
    await mgr.save('jy', { lastIndex: 3, results: [10, 20, 30] });
    const result = await mgr.runWithCheckpoints('jy', [1, 2, 3, 4, 5], async (item) => item * 10);
    assert.equal(result.skipped, 3);
    assert.equal(result.processed, 2);
    assert.deepEqual(result.results, [10, 20, 30, 40, 50]);
  });

  it('runWithCheckpoints saves checkpoint on error', async () => {
    const mgr = new CheckpointManager();
    try {
      await mgr.runWithCheckpoints('jz', [1, 2, 3], async (item) => {
        if (item === 2) throw new Error('fail');
        return item;
      }, { checkpointInterval: 1 });
    } catch {}
    const state = await mgr.load('jz');
    assert.ok(state);
    assert.ok(state.lastError);
  });

  it('saves to DB when available', async () => {
    const queries = [];
    const db = { query: async (sql) => { queries.push(sql); return { rows: [] }; } };
    const mgr = new CheckpointManager({ db, namespace: 'test' });
    await mgr.save('j1', { x: 1 });
    assert.ok(queries.some(q => q.includes('processing_checkpoints')));
  });

  it('loads from DB when available', async () => {
    const db = { query: async () => ({ rows: [{ state: JSON.stringify({ x: 99 }) }] }) };
    const mgr = new CheckpointManager({ db });
    assert.deepEqual(await mgr.load('j1'), { x: 99 });
  });
});

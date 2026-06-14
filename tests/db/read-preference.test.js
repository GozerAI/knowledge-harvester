// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ReadPreferenceManager,
  getReadPreferenceManager,
} from '../../src/db/read-preference.js';

describe('ReadPreferenceManager', () => {
  it('returns default preferences for known tables', () => {
    const mgr = new ReadPreferenceManager();
    const pref = mgr.getPreference('artifacts');
    assert.equal(pref.mode, 'primary');
    assert.ok(pref.statementTimeoutMs > 0);
    assert.ok(pref.workMem);
  });

  it('returns fallback for unknown tables', () => {
    const mgr = new ReadPreferenceManager();
    const pref = mgr.getPreference('unknown_table');
    assert.equal(pref.mode, 'primary');
    assert.equal(pref.parallelWorkers, 0);
  });

  it('accepts overrides in constructor', () => {
    const mgr = new ReadPreferenceManager({ artifacts: { mode: 'secondary' } });
    assert.equal(mgr.getPreference('artifacts').mode, 'secondary');
  });

  it('setPreference updates an existing preference', () => {
    const mgr = new ReadPreferenceManager();
    mgr.setPreference('artifacts', { workMem: '128MB' });
    assert.equal(mgr.getPreference('artifacts').workMem, '128MB');
    assert.equal(mgr.getPreference('artifacts').mode, 'primary');
  });

  it('prefersReplica returns true for secondary/nearest', () => {
    const mgr = new ReadPreferenceManager();
    assert.ok(mgr.prefersReplica('harvest_runs'));
    assert.ok(mgr.prefersReplica('graph_nodes'));
    assert.ok(!mgr.prefersReplica('artifacts'));
  });

  it('getAllPreferences returns all configured tables', () => {
    const mgr = new ReadPreferenceManager();
    const all = mgr.getAllPreferences();
    assert.ok('artifacts' in all);
    assert.ok('harvest_runs' in all);
    assert.ok('analytics_events' in all);
  });

  it('applySessionSettings sends SET LOCAL queries', async () => {
    const queries = [];
    const client = { query: async (sql) => { queries.push(sql); } };
    const mgr = new ReadPreferenceManager();
    await mgr.applySessionSettings(client, 'artifacts');
    assert.ok(queries.some(q => q.includes('statement_timeout')));
    assert.ok(queries.some(q => q.includes('work_mem')));
  });

  it('executeRead wraps in transaction', async () => {
    const queries = [];
    const client = {
      query: async (sql, params) => { queries.push(sql); return { rows: [{ id: 1 }] }; },
      release: () => {},
    };
    const db = { getClient: async () => client };
    const mgr = new ReadPreferenceManager();
    const result = await mgr.executeRead(db, 'artifacts', 'SELECT 1');
    assert.ok(queries.includes('BEGIN'));
    assert.ok(queries.includes('COMMIT'));
    assert.equal(result.rows[0].id, 1);
  });

  it('executeRead rolls back on error', async () => {
    const queries = [];
    let callCount = 0;
    const client = {
      query: async (sql) => {
        queries.push(sql);
        callCount++;
        if (sql === 'SELECT 1') throw new Error('query fail');
        return { rows: [] };
      },
      release: () => {},
    };
    const db = { getClient: async () => client };
    const mgr = new ReadPreferenceManager();
    await assert.rejects(() => mgr.executeRead(db, 'artifacts', 'SELECT 1'));
    assert.ok(queries.includes('ROLLBACK'));
  });
});

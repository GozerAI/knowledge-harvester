// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPOUND_INDEXES,
  generateCompoundIndexSQL,
  applyCompoundIndexes,
  TTL_POLICIES,
  generateTTLIndexSQL,
  runTTLExpiration,
  applyTTLIndexes,
  IndexMetadataCache,
  getIndexMetadataCache,
} from '../../src/db/indexes.js';

describe('COMPOUND_INDEXES', () => {
  it('defines at least 5 compound indexes', () => {
    assert.ok(COMPOUND_INDEXES.length >= 5);
  });

  it('each index has required fields', () => {
    for (const idx of COMPOUND_INDEXES) {
      assert.ok(idx.name);
      assert.ok(idx.table);
      assert.ok(Array.isArray(idx.columns) && idx.columns.length >= 2);
      assert.ok(idx.description);
    }
  });

  it('index names are unique', () => {
    const names = COMPOUND_INDEXES.map(i => i.name);
    assert.equal(names.length, new Set(names).size);
  });
});

describe('generateCompoundIndexSQL', () => {
  it('returns one SQL statement per index', () => {
    const sqls = generateCompoundIndexSQL();
    assert.equal(sqls.length, COMPOUND_INDEXES.length);
  });

  it('generates CREATE INDEX IF NOT EXISTS', () => {
    for (const sql of generateCompoundIndexSQL()) {
      assert.ok(sql.startsWith('CREATE INDEX IF NOT EXISTS'));
    }
  });

  it('includes table and columns in SQL', () => {
    const sqls = generateCompoundIndexSQL();
    for (let i = 0; i < sqls.length; i++) {
      assert.ok(sqls[i].includes(COMPOUND_INDEXES[i].table));
      assert.ok(sqls[i].includes(COMPOUND_INDEXES[i].columns[0]));
    }
  });
});

describe('applyCompoundIndexes', () => {
  it('applies all indexes successfully', async () => {
    const queries = [];
    const db = { query: async (sql) => { queries.push(sql); return { rows: [] }; } };
    const result = await applyCompoundIndexes(db);
    assert.equal(result.applied, COMPOUND_INDEXES.length);
    assert.equal(result.errors.length, 0);
  });

  it('counts already-existing indexes as skipped', async () => {
    const db = { query: async () => { const e = new Error('exists'); e.code = '42710'; throw e; } };
    const result = await applyCompoundIndexes(db);
    assert.equal(result.skipped, COMPOUND_INDEXES.length);
  });

  it('captures other errors', async () => {
    const db = { query: async () => { throw new Error('bad sql'); } };
    const result = await applyCompoundIndexes(db);
    assert.ok(result.errors.length > 0);
  });
});

describe('TTL_POLICIES', () => {
  it('defines at least 3 TTL policies', () => {
    assert.ok(TTL_POLICIES.length >= 3);
  });

  it('each policy has required fields', () => {
    for (const p of TTL_POLICIES) {
      assert.ok(p.name);
      assert.ok(p.table);
      assert.ok(p.timestampColumn);
      assert.ok(p.ttlSeconds > 0);
    }
  });
});

describe('generateTTLIndexSQL', () => {
  it('returns one SQL per policy', () => {
    assert.equal(generateTTLIndexSQL().length, TTL_POLICIES.length);
  });

  it('includes WHERE for conditional policies', () => {
    const sqls = generateTTLIndexSQL();
    const condPol = TTL_POLICIES.filter(p => p.condition);
    for (const p of condPol) {
      const sql = sqls.find(s => s.includes(p.name));
      assert.ok(sql.includes('WHERE'));
    }
  });
});

describe('runTTLExpiration', () => {
  it('deletes expired rows', async () => {
    const db = { query: async () => ({ rowCount: 5 }) };
    const results = await runTTLExpiration(db);
    assert.equal(results.length, TTL_POLICIES.length);
    for (const r of results) assert.equal(r.deleted, 5);
  });

  it('handles errors gracefully', async () => {
    const db = { query: async () => { throw new Error('fail'); } };
    const results = await runTTLExpiration(db);
    for (const r of results) {
      assert.equal(r.deleted, 0);
      assert.ok(r.error);
    }
  });
});

describe('applyTTLIndexes', () => {
  it('applies TTL indexes', async () => {
    const db = { query: async () => ({}) };
    const result = await applyTTLIndexes(db);
    assert.equal(result.applied, TTL_POLICIES.length);
  });
});

describe('IndexMetadataCache', () => {
  it('returns null for cache miss', () => {
    const c = new IndexMetadataCache();
    assert.equal(c.get('nonexistent'), null);
  });

  it('stores and retrieves values', () => {
    const c = new IndexMetadataCache();
    c.set('test', { columns: ['a', 'b'] });
    assert.deepEqual(c.get('test'), { columns: ['a', 'b'] });
  });

  it('expires entries after TTL', () => {
    const c = new IndexMetadataCache({ ttlMs: 1 });
    c.set('test', 'data');
    const start = Date.now();
    while (Date.now() - start < 5) {}
    assert.equal(c.get('test'), null);
  });

  it('evicts oldest when at capacity', () => {
    const c = new IndexMetadataCache({ maxEntries: 2 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    assert.equal(c.get('a'), null);
    assert.equal(c.get('b'), 2);
    assert.equal(c.get('c'), 3);
  });

  it('tracks hit/miss stats', () => {
    const c = new IndexMetadataCache();
    c.set('x', 1);
    c.get('x');
    c.get('y');
    const stats = c.getStats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
  });

  it('invalidate removes key', () => {
    const c = new IndexMetadataCache();
    c.set('a', 1);
    c.invalidate('a');
    assert.equal(c.get('a'), null);
  });

  it('clear resets everything', () => {
    const c = new IndexMetadataCache();
    c.set('a', 1);
    c.clear();
    assert.equal(c.getStats().size, 0);
  });

  it('indexExists queries DB on miss', async () => {
    let queried = false;
    const db = { query: async () => { queried = true; return { rows: [{ n: 1 }] }; } };
    const c = new IndexMetadataCache();
    assert.ok(await c.indexExists(db, 'idx_test'));
    assert.ok(queried);
    queried = false;
    assert.ok(await c.indexExists(db, 'idx_test'));
    assert.ok(!queried);
  });

  it('getIndexColumns parses indexdef', async () => {
    const db = { query: async () => ({ rows: [{ indexdef: 'CREATE INDEX idx ON t (col_a, col_b DESC)' }] }) };
    const c = new IndexMetadataCache();
    assert.deepEqual(await c.getIndexColumns(db, 'idx'), ['col_a', 'col_b DESC']);
  });

  it('getTableIndexes returns names', async () => {
    const db = { query: async () => ({ rows: [{ indexname: 'idx_b' }, { indexname: 'idx_a' }] }) };
    const c = new IndexMetadataCache();
    assert.deepEqual(await c.getTableIndexes(db, 't'), ['idx_b', 'idx_a']);
  });
});

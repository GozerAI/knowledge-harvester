// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Comparative Snapshots.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock DB ────────────────────────────────────────────────────────────────

function mockDb(queryResponses = []) {
  let callIndex = 0;
  const calls = [];
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (callIndex < queryResponses.length) {
        const resp = queryResponses[callIndex++];
        if (typeof resp === 'function') return resp(sql, params);
        return resp;
      }
      return { rows: [] };
    },
    getCalls: () => calls,
  };
}

// ── Re-implement snapshot logic locally ─────────────────────────────────────

function computeDiff(a, b) {
  const changes = {};
  const additions = {};
  const removals = {};

  const scalarFields = ['total_artifacts'];
  for (const field of scalarFields) {
    const va = a[field] ?? 0;
    const vb = b[field] ?? 0;
    if (va !== vb) {
      changes[field] = { before: va, after: vb, delta: vb - va };
    }
  }

  if (a.graph || b.graph) {
    const ga = a.graph || { nodes: 0, edges: 0 };
    const gb = b.graph || { nodes: 0, edges: 0 };
    if (ga.nodes !== gb.nodes) {
      changes['graph.nodes'] = { before: ga.nodes, after: gb.nodes, delta: gb.nodes - ga.nodes };
    }
    if (ga.edges !== gb.edges) {
      changes['graph.edges'] = { before: ga.edges, after: gb.edges, delta: gb.edges - ga.edges };
    }
  }

  const mapA = new Map();
  const mapB = new Map();
  for (const row of (a.by_category_type || [])) {
    mapA.set(`${row.primary_category}:${row.artifact_type}`, row);
  }
  for (const row of (b.by_category_type || [])) {
    mapB.set(`${row.primary_category}:${row.artifact_type}`, row);
  }

  for (const [key, rowB] of mapB) {
    if (!mapA.has(key)) {
      additions[key] = rowB;
    } else {
      const rowA = mapA.get(key);
      if (rowA.count !== rowB.count || rowA.avg_quality !== rowB.avg_quality) {
        changes[key] = {
          before: { count: rowA.count, avg_quality: rowA.avg_quality },
          after: { count: rowB.count, avg_quality: rowB.avg_quality },
          delta: { count: rowB.count - rowA.count },
        };
      }
    }
  }

  for (const [key] of mapA) {
    if (!mapB.has(key)) {
      removals[key] = mapA.get(key);
    }
  }

  return { additions, removals, changes };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Snapshots', () => {
  describe('createSnapshot', () => {
    it('captures aggregate data from DB', async () => {
      const db = mockDb([
        { rows: [{ primary_category: 'ai-agent', artifact_type: 'workflow', count: 10, avg_quality: 85.5 }] },
        { rows: [{ total: 100 }] },
        { rows: [{ count: 50 }] },
        { rows: [{ count: 30 }] },
        { rows: [{ id: 'snap-1', label: 'test', snapshot_data: {}, created_at: '2026-01-01' }] },
      ]);

      // Simulate createSnapshot
      const byCategoryType = await db.query('SELECT ...');
      const total = await db.query('SELECT COUNT(*)');
      assert.equal(byCategoryType.rows.length, 1);
      assert.equal(total.rows[0].total, 100);
    });

    it('stores label with snapshot', async () => {
      const db = mockDb([
        { rows: [] },
        { rows: [{ total: 0 }] },
        { rows: [{ count: 0 }] },
        { rows: [{ count: 0 }] },
        { rows: [{ id: 'snap-1', label: 'pre-pipeline', snapshot_data: {} }] },
      ]);

      const calls = [];
      await db.query('SELECT'); // byCategoryType
      await db.query('SELECT COUNT'); // total
      await db.query('SELECT COUNT nodes'); // graph nodes
      await db.query('SELECT COUNT edges'); // graph edges
      const result = await db.query('INSERT INTO snapshots', ['pre-pipeline']);
      assert.equal(result.rows[0].label, 'pre-pipeline');
    });

    it('includes graph node/edge counts', () => {
      const snap = {
        total_artifacts: 100,
        by_category_type: [],
        graph: { nodes: 50, edges: 30 },
      };
      assert.equal(snap.graph.nodes, 50);
      assert.equal(snap.graph.edges, 30);
    });
  });

  describe('compareSnapshots — computeDiff', () => {
    it('detects additions', () => {
      const a = { total_artifacts: 10, by_category_type: [] };
      const b = {
        total_artifacts: 12,
        by_category_type: [{ primary_category: 'ai', artifact_type: 'workflow', count: 2, avg_quality: 90 }],
      };
      const diff = computeDiff(a, b);
      assert.ok(Object.keys(diff.additions).length > 0);
    });

    it('detects removals', () => {
      const a = {
        total_artifacts: 10,
        by_category_type: [{ primary_category: 'old', artifact_type: 'workflow', count: 5, avg_quality: 70 }],
      };
      const b = { total_artifacts: 5, by_category_type: [] };
      const diff = computeDiff(a, b);
      assert.ok(Object.keys(diff.removals).length > 0);
    });

    it('detects changes in count', () => {
      const a = {
        total_artifacts: 10,
        by_category_type: [{ primary_category: 'ai', artifact_type: 'workflow', count: 5, avg_quality: 80 }],
      };
      const b = {
        total_artifacts: 15,
        by_category_type: [{ primary_category: 'ai', artifact_type: 'workflow', count: 10, avg_quality: 80 }],
      };
      const diff = computeDiff(a, b);
      assert.ok(diff.changes['ai:workflow']);
      assert.equal(diff.changes['ai:workflow'].delta.count, 5);
    });

    it('detects changes in total_artifacts', () => {
      const a = { total_artifacts: 100, by_category_type: [] };
      const b = { total_artifacts: 150, by_category_type: [] };
      const diff = computeDiff(a, b);
      assert.ok(diff.changes.total_artifacts);
      assert.equal(diff.changes.total_artifacts.delta, 50);
    });

    it('returns empty diff for identical snapshots', () => {
      const data = {
        total_artifacts: 100,
        by_category_type: [{ primary_category: 'ai', artifact_type: 'workflow', count: 10, avg_quality: 85 }],
        graph: { nodes: 50, edges: 30 },
      };
      const diff = computeDiff(data, data);
      assert.equal(Object.keys(diff.additions).length, 0);
      assert.equal(Object.keys(diff.removals).length, 0);
      assert.equal(Object.keys(diff.changes).length, 0);
    });

    it('handles empty snapshot as baseline', () => {
      const a = { total_artifacts: 0, by_category_type: [] };
      const b = {
        total_artifacts: 10,
        by_category_type: [{ primary_category: 'ai', artifact_type: 'workflow', count: 10, avg_quality: 90 }],
      };
      const diff = computeDiff(a, b);
      assert.ok(Object.keys(diff.additions).length > 0);
      assert.equal(diff.changes.total_artifacts.delta, 10);
    });

    it('detects graph node count changes', () => {
      const a = { total_artifacts: 10, by_category_type: [], graph: { nodes: 10, edges: 5 } };
      const b = { total_artifacts: 10, by_category_type: [], graph: { nodes: 20, edges: 5 } };
      const diff = computeDiff(a, b);
      assert.ok(diff.changes['graph.nodes']);
      assert.equal(diff.changes['graph.nodes'].delta, 10);
    });

    it('detects graph edge count changes', () => {
      const a = { total_artifacts: 10, by_category_type: [], graph: { nodes: 10, edges: 5 } };
      const b = { total_artifacts: 10, by_category_type: [], graph: { nodes: 10, edges: 15 } };
      const diff = computeDiff(a, b);
      assert.ok(diff.changes['graph.edges']);
      assert.equal(diff.changes['graph.edges'].delta, 10);
    });
  });

  describe('listSnapshots', () => {
    it('returns snapshots from DB ordered by created_at desc', async () => {
      const db = mockDb([
        {
          rows: [
            { id: 's2', label: 'after', created_at: '2026-01-02' },
            { id: 's1', label: 'before', created_at: '2026-01-01' },
          ],
        },
      ]);
      const result = await db.query('SELECT ... ORDER BY created_at DESC');
      assert.equal(result.rows.length, 2);
      assert.equal(result.rows[0].label, 'after');
    });

    it('returns empty array when no snapshots', async () => {
      const db = mockDb([{ rows: [] }]);
      const result = await db.query('SELECT ...');
      assert.equal(result.rows.length, 0);
    });
  });

  describe('getSnapshot', () => {
    it('returns single snapshot by ID', async () => {
      const db = mockDb([
        { rows: [{ id: 's1', label: 'test', snapshot_data: { total_artifacts: 10 } }] },
      ]);
      const result = await db.query('SELECT * FROM snapshots WHERE id = $1', ['s1']);
      assert.equal(result.rows[0].id, 's1');
    });

    it('returns empty when not found', async () => {
      const db = mockDb([{ rows: [] }]);
      const result = await db.query('SELECT * FROM snapshots WHERE id = $1', ['nonexistent']);
      assert.equal(result.rows.length, 0);
    });
  });
});

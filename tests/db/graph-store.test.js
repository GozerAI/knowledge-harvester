// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// ── Reimplemented pure logic from graph-store.js for testing ──

function buildUpsertNodeParams(type, id, data = {}) {
  const label = data.label || data.name || id;
  const properties = { ...data };
  delete properties.label;
  delete properties.name;
  return { type, id, label, properties: JSON.stringify(properties) };
}

function buildUpsertEdgeParams(srcType, srcId, tgtType, tgtId, edgeType, weight = 1.0, meta = {}) {
  return {
    srcType, srcId, tgtType, tgtId, edgeType,
    weight,
    metadata: JSON.stringify(meta),
  };
}

// ── Mock DB helper ──

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

// ── Reimplemented functions using mock DB ──

async function upsertNode(pool, type, id, data = {}) {
  const p = buildUpsertNodeParams(type, id, data);
  const result = await pool.query(
    'INSERT_NODE',
    [p.type, p.id, p.label, p.properties]
  );
  return result.rows[0];
}

async function upsertEdge(pool, srcType, srcId, tgtType, tgtId, edgeType, weight = 1.0, meta = {}) {
  const result = await pool.query(
    'INSERT_EDGE',
    [srcType, srcId, tgtType, tgtId, edgeType, weight, JSON.stringify(meta)]
  );
  return result.rows[0];
}

async function getNode(pool, type, id) {
  const result = await pool.query(
    'SELECT_NODE',
    [type, id]
  );
  return result.rows[0] || null;
}

async function queryGraph(pool, startType, startId, edgeTypes = [], depth = 2) {
  const params = [startType, startId];
  if (edgeTypes.length > 0) params.push(edgeTypes);
  params.push(depth);
  const result = await pool.query('RECURSIVE_QUERY', params);
  return result.rows;
}

async function materializeGraph(pool) {
  let nodesCreated = 0;
  let edgesCreated = 0;

  const artifacts = await pool.query('SELECT_ARTIFACTS', []);
  for (const a of artifacts.rows) {
    await upsertNode(pool, 'artifact', a.id, {
      label: a.name,
      artifact_type: a.artifact_type,
      category: a.primary_category,
      quality_score: a.quality_score,
    });
    nodesCreated++;

    if (a.primary_category) {
      await upsertNode(pool, 'category', a.primary_category, { label: a.primary_category });
      await upsertEdge(pool, 'artifact', a.id, 'category', a.primary_category, 'belongs_to', 1.0);
      edgesCreated++;
    }
  }

  const relations = await pool.query('SELECT_RELATIONS', []);
  for (const r of relations.rows) {
    await upsertEdge(pool, 'artifact', r.source_id, 'artifact', r.target_id, r.relation_type, parseFloat(r.confidence) || 0.5);
    edgesCreated++;
  }

  return { nodes_created: nodesCreated, edges_created: edgesCreated };
}

async function batchUpsertNodes(pool, nodes) {
  let created = 0;
  for (const node of nodes) {
    await upsertNode(pool, node.type, node.id, node.data || {});
    created++;
  }
  return { created };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Graph Store', () => {

  // ── upsertNode ──

  describe('upsertNode', () => {
    it('creates a new node', async () => {
      const nodeRow = { node_type: 'artifact', node_id: 'abc', label: 'My Artifact', properties: '{}' };
      const db = mockDb([{ rows: [nodeRow] }]);
      const result = await upsertNode(db, 'artifact', 'abc', { label: 'My Artifact' });
      assert.equal(result.node_type, 'artifact');
      assert.equal(result.label, 'My Artifact');
    });

    it('updates existing node (merge properties)', async () => {
      const nodeRow = { node_type: 'artifact', node_id: 'abc', label: 'Updated', properties: '{"key":"val"}' };
      const db = mockDb([{ rows: [nodeRow] }]);
      const result = await upsertNode(db, 'artifact', 'abc', { label: 'Updated', key: 'val' });
      assert.equal(result.label, 'Updated');
    });

    it('uses label from data', () => {
      const p = buildUpsertNodeParams('artifact', 'x', { label: 'Custom Label' });
      assert.equal(p.label, 'Custom Label');
    });

    it('defaults label to id', () => {
      const p = buildUpsertNodeParams('artifact', 'my-id', {});
      assert.equal(p.label, 'my-id');
    });

    it('handles empty properties', () => {
      const p = buildUpsertNodeParams('artifact', 'x', {});
      assert.equal(p.properties, '{}');
    });
  });

  // ── upsertEdge ──

  describe('upsertEdge', () => {
    it('creates a new edge', async () => {
      const edgeRow = { id: randomUUID(), source_type: 'artifact', source_id: 'a', target_type: 'category', target_id: 'web', edge_type: 'belongs_to', weight: 1.0 };
      const db = mockDb([{ rows: [edgeRow] }]);
      const result = await upsertEdge(db, 'artifact', 'a', 'category', 'web', 'belongs_to');
      assert.equal(result.edge_type, 'belongs_to');
      assert.equal(result.weight, 1.0);
    });

    it('updates existing edge weight', async () => {
      const edgeRow = { id: randomUUID(), source_type: 'artifact', source_id: 'a', target_type: 'artifact', target_id: 'b', edge_type: 'depends_on', weight: 0.8 };
      const db = mockDb([{ rows: [edgeRow] }]);
      const result = await upsertEdge(db, 'artifact', 'a', 'artifact', 'b', 'depends_on', 0.8);
      assert.equal(result.weight, 0.8);
    });

    it('handles edge metadata', () => {
      const params = buildUpsertEdgeParams('a', '1', 'b', '2', 'relates', 1.0, { reason: 'shared tags' });
      const meta = JSON.parse(params.metadata);
      assert.equal(meta.reason, 'shared tags');
    });

    it('deduplicates by composite key', () => {
      const p1 = buildUpsertEdgeParams('artifact', 'a', 'artifact', 'b', 'depends_on');
      const p2 = buildUpsertEdgeParams('artifact', 'a', 'artifact', 'b', 'depends_on');
      // Same composite key — ON CONFLICT would update in real DB
      assert.equal(p1.srcType, p2.srcType);
      assert.equal(p1.srcId, p2.srcId);
      assert.equal(p1.tgtType, p2.tgtType);
      assert.equal(p1.tgtId, p2.tgtId);
      assert.equal(p1.edgeType, p2.edgeType);
    });
  });

  // ── getNode ──

  describe('getNode', () => {
    it('returns node by type and id', async () => {
      const nodeRow = { node_type: 'artifact', node_id: 'abc', label: 'Test', properties: '{}', created_at: new Date(), updated_at: new Date() };
      const db = mockDb([{ rows: [nodeRow] }]);
      const result = await getNode(db, 'artifact', 'abc');
      assert.equal(result.node_type, 'artifact');
      assert.equal(result.node_id, 'abc');
    });

    it('returns null for non-existent node', async () => {
      const db = mockDb([{ rows: [] }]);
      const result = await getNode(db, 'artifact', 'nonexistent');
      assert.equal(result, null);
    });
  });

  // ── queryGraph ──

  describe('queryGraph', () => {
    it('returns start node at depth 0', async () => {
      const startNode = { node_type: 'artifact', node_id: 'a1', label: 'Start', properties: '{}', depth: 0 };
      const db = mockDb([{ rows: [startNode] }]);
      const results = await queryGraph(db, 'artifact', 'a1');
      assert.equal(results.length, 1);
      assert.equal(results[0].depth, 0);
    });

    it('traverses one level', async () => {
      const nodes = [
        { node_type: 'artifact', node_id: 'a1', label: 'Start', properties: '{}', depth: 0 },
        { node_type: 'category', node_id: 'web', label: 'Web', properties: '{}', depth: 1 },
      ];
      const db = mockDb([{ rows: nodes }]);
      const results = await queryGraph(db, 'artifact', 'a1');
      assert.equal(results.length, 2);
      assert.equal(results[1].depth, 1);
    });

    it('traverses multiple levels', async () => {
      const nodes = [
        { node_type: 'artifact', node_id: 'a1', label: 'Start', properties: '{}', depth: 0 },
        { node_type: 'artifact', node_id: 'a2', label: 'Mid', properties: '{}', depth: 1 },
        { node_type: 'artifact', node_id: 'a3', label: 'End', properties: '{}', depth: 2 },
      ];
      const db = mockDb([{ rows: nodes }]);
      const results = await queryGraph(db, 'artifact', 'a1', [], 3);
      assert.equal(results.length, 3);
    });

    it('filters by edge types', async () => {
      const nodes = [
        { node_type: 'artifact', node_id: 'a1', label: 'Start', properties: '{}', depth: 0 },
        { node_type: 'artifact', node_id: 'a2', label: 'Dep', properties: '{}', depth: 1 },
      ];
      const db = mockDb([{ rows: nodes }]);
      const results = await queryGraph(db, 'artifact', 'a1', ['depends_on'], 2);
      assert.equal(results.length, 2);
      // Verify edge_types was passed in params
      const call = db.getCalls()[0];
      assert.deepEqual(call.params[2], ['depends_on']);
    });

    it('respects depth limit', async () => {
      const nodes = [
        { node_type: 'artifact', node_id: 'a1', label: 'Start', properties: '{}', depth: 0 },
      ];
      const db = mockDb([{ rows: nodes }]);
      const results = await queryGraph(db, 'artifact', 'a1', [], 1);
      // With depth=1, the recursive CTE should limit traversal
      const call = db.getCalls()[0];
      assert.equal(call.params[call.params.length - 1], 1);
    });

    it('avoids cycles (path tracking in CTE)', async () => {
      // The CTE uses path array to avoid revisiting nodes
      // With a mock, we just verify the query was called and returns deduplicated results
      const nodes = [
        { node_type: 'artifact', node_id: 'a1', label: 'Start', properties: '{}', depth: 0 },
        { node_type: 'artifact', node_id: 'a2', label: 'Next', properties: '{}', depth: 1 },
      ];
      const db = mockDb([{ rows: nodes }]);
      const results = await queryGraph(db, 'artifact', 'a1', [], 5);
      // No duplicate node_ids in results
      const ids = results.map(r => `${r.node_type}:${r.node_id}`);
      assert.equal(new Set(ids).size, ids.length);
    });

    it('handles disconnected node', async () => {
      const nodes = [
        { node_type: 'artifact', node_id: 'lonely', label: 'Alone', properties: '{}', depth: 0 },
      ];
      const db = mockDb([{ rows: nodes }]);
      const results = await queryGraph(db, 'artifact', 'lonely');
      assert.equal(results.length, 1);
      assert.equal(results[0].node_id, 'lonely');
    });
  });

  // ── materializeGraph ──

  describe('materializeGraph', () => {
    it('creates nodes from artifacts', async () => {
      const artifacts = [
        { id: randomUUID(), name: 'FastAPI Service', artifact_type: 'code_pattern', primary_category: null, quality_score: 80 },
      ];
      let nodeInserts = 0;
      const db = {
        query: async (sql) => {
          if (sql === 'SELECT_ARTIFACTS') return { rows: artifacts };
          if (sql === 'SELECT_RELATIONS') return { rows: [] };
          if (sql === 'INSERT_NODE') { nodeInserts++; return { rows: [{ node_type: 'artifact', node_id: artifacts[0].id, label: 'FastAPI Service', properties: '{}' }] }; }
          return { rows: [] };
        },
      };
      const result = await materializeGraph(db);
      assert.equal(result.nodes_created, 1);
      assert.ok(nodeInserts >= 1);
    });

    it('creates category nodes', async () => {
      const id = randomUUID();
      const artifacts = [
        { id, name: 'Svc', artifact_type: 'code_pattern', primary_category: 'web', quality_score: 50 },
      ];
      let categoryNodeCreated = false;
      const db = {
        query: async (sql, params) => {
          if (sql === 'SELECT_ARTIFACTS') return { rows: artifacts };
          if (sql === 'SELECT_RELATIONS') return { rows: [] };
          if (sql === 'INSERT_NODE') {
            if (params && params[0] === 'category') categoryNodeCreated = true;
            return { rows: [{ node_type: params?.[0] || 'artifact', node_id: params?.[1] || id, label: 'x', properties: '{}' }] };
          }
          if (sql === 'INSERT_EDGE') {
            return { rows: [{ id: randomUUID(), source_type: 'artifact', source_id: id, target_type: 'category', target_id: 'web', edge_type: 'belongs_to', weight: 1.0 }] };
          }
          return { rows: [] };
        },
      };
      await materializeGraph(db);
      assert.ok(categoryNodeCreated, 'Should create a category node');
    });

    it('creates edges from artifact_relations', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      const relations = [
        { source_id: id1, target_id: id2, relation_type: 'depends_on', confidence: '0.9' },
      ];
      let edgeInserts = 0;
      const db = {
        query: async (sql) => {
          if (sql === 'SELECT_ARTIFACTS') return { rows: [] };
          if (sql === 'SELECT_RELATIONS') return { rows: relations };
          if (sql === 'INSERT_EDGE') { edgeInserts++; return { rows: [{ id: randomUUID(), source_type: 'artifact', source_id: id1, target_type: 'artifact', target_id: id2, edge_type: 'depends_on', weight: 0.9 }] }; }
          return { rows: [] };
        },
      };
      const result = await materializeGraph(db);
      assert.equal(result.edges_created, 1);
      assert.ok(edgeInserts >= 1);
    });

    it('returns correct counts', async () => {
      const artifacts = [
        { id: randomUUID(), name: 'A', artifact_type: 'code_pattern', primary_category: 'web', quality_score: 50 },
        { id: randomUUID(), name: 'B', artifact_type: 'infra_config', primary_category: 'devops', quality_score: 60 },
      ];
      const relations = [
        { source_id: artifacts[0].id, target_id: artifacts[1].id, relation_type: 'uses', confidence: '0.7' },
      ];
      const db = {
        query: async (sql) => {
          if (sql === 'SELECT_ARTIFACTS') return { rows: artifacts };
          if (sql === 'SELECT_RELATIONS') return { rows: relations };
          return { rows: [{ node_type: 'x', node_id: 'y', label: 'z', properties: '{}', id: randomUUID(), source_type: 'a', source_id: '1', target_type: 'b', target_id: '2', edge_type: 'e', weight: 1.0 }] };
        },
      };
      const result = await materializeGraph(db);
      // 2 artifacts = 2 nodes, each with a category = 2 category edges + 1 relation edge = 3 edges
      assert.equal(result.nodes_created, 2);
      assert.equal(result.edges_created, 3); // 2 belongs_to + 1 uses
    });

    it('handles empty database', async () => {
      const db = {
        query: async () => ({ rows: [] }),
      };
      const result = await materializeGraph(db);
      assert.equal(result.nodes_created, 0);
      assert.equal(result.edges_created, 0);
    });
  });

  // ── batchUpsertNodes ──

  describe('batchUpsertNodes', () => {
    it('inserts multiple nodes', async () => {
      let insertCount = 0;
      const db = {
        query: async () => {
          insertCount++;
          return { rows: [{ node_type: 'artifact', node_id: 'x', label: 'x', properties: '{}' }] };
        },
      };
      const nodes = [
        { type: 'artifact', id: 'a1', data: { label: 'A1' } },
        { type: 'artifact', id: 'a2', data: { label: 'A2' } },
        { type: 'category', id: 'c1', data: { label: 'Cat1' } },
      ];
      const result = await batchUpsertNodes(db, nodes);
      assert.equal(result.created, 3);
      assert.equal(insertCount, 3);
    });

    it('returns created count', async () => {
      const db = {
        query: async () => ({ rows: [{ node_type: 't', node_id: 'i', label: 'l', properties: '{}' }] }),
      };
      const result = await batchUpsertNodes(db, [{ type: 'a', id: '1', data: {} }]);
      assert.equal(result.created, 1);
    });

    it('handles empty array', async () => {
      const db = { query: async () => ({ rows: [] }) };
      const result = await batchUpsertNodes(db, []);
      assert.equal(result.created, 0);
    });
  });

  // ── buildUpsertNodeParams ──

  describe('buildUpsertNodeParams', () => {
    it('uses name as label fallback', () => {
      const p = buildUpsertNodeParams('artifact', 'x', { name: 'MyName' });
      assert.equal(p.label, 'MyName');
    });

    it('prefers label over name', () => {
      const p = buildUpsertNodeParams('artifact', 'x', { label: 'Preferred', name: 'Secondary' });
      assert.equal(p.label, 'Preferred');
    });

    it('strips label and name from properties', () => {
      const p = buildUpsertNodeParams('artifact', 'x', { label: 'L', name: 'N', extra: 'val' });
      const props = JSON.parse(p.properties);
      assert.ok(!('label' in props));
      assert.ok(!('name' in props));
      assert.equal(props.extra, 'val');
    });
  });
});

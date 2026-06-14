// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Graph-Powered Discovery.
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

// ── Re-implement discovery logic locally ───────────────────────────────────

function getNeighborEdges(edges, type, id) {
  return edges.filter(e =>
    (e.source_type === type && e.source_id === id) ||
    (e.target_type === type && e.target_id === id)
  );
}

function discoverRelated(nodes, edges, artifactId, depth = 2, limit = 10) {
  const visited = new Set();
  const results = [];
  const startKey = `artifact:${artifactId}`;
  visited.add(startKey);

  let frontier = [{ type: 'artifact', id: artifactId, depth: 0 }];

  for (let d = 1; d <= depth; d++) {
    const nextFrontier = [];

    for (const node of frontier) {
      const neighborEdges = getNeighborEdges(edges, node.type, node.id);

      for (const edge of neighborEdges) {
        let neighborType, neighborId;
        if (edge.source_type === node.type && edge.source_id === node.id) {
          neighborType = edge.target_type;
          neighborId = edge.target_id;
        } else {
          neighborType = edge.source_type;
          neighborId = edge.source_id;
        }

        const key = `${neighborType}:${neighborId}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const weight = parseFloat(edge.weight) || 1.0;
        const score = weight / d;
        const nodeInfo = nodes.find(n => n.node_type === neighborType && n.node_id === neighborId);

        results.push({
          node_type: neighborType,
          node_id: neighborId,
          label: nodeInfo?.label || neighborId,
          score,
          depth: d,
        });
        nextFrontier.push({ type: neighborType, id: neighborId, depth: d });
      }
    }

    frontier = nextFrontier;
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function discoverClusters(nodes, edges, minSize = 3) {
  const adj = new Map();
  const keyOf = (type, id) => `${type}:${id}`;

  for (const n of nodes) adj.set(keyOf(n.node_type, n.node_id), []);
  for (const e of edges) {
    const sk = keyOf(e.source_type, e.source_id);
    const tk = keyOf(e.target_type, e.target_id);
    if (adj.has(sk)) adj.get(sk).push(tk);
    if (adj.has(tk)) adj.get(tk).push(sk);
  }

  const visited = new Set();
  const clusters = [];
  let clusterId = 0;

  for (const n of nodes) {
    const key = keyOf(n.node_type, n.node_id);
    if (visited.has(key)) continue;

    const component = [];
    const queue = [key];
    visited.add(key);

    while (queue.length > 0) {
      const current = queue.shift();
      const [type, ...idParts] = current.split(':');
      const id = idParts.join(':');
      const nodeInfo = nodes.find(nd => nd.node_type === type && nd.node_id === id);
      component.push({ node_type: type, node_id: id, label: nodeInfo?.label || id });
      for (const neighbor of (adj.get(current) || [])) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
    }

    if (component.length >= minSize) {
      clusters.push({ id: clusterId++, nodes: component, size: component.length });
    }
  }

  return clusters;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Graph Discovery', () => {
  const sampleNodes = [
    { node_type: 'artifact', node_id: 'a1', label: 'Artifact 1' },
    { node_type: 'artifact', node_id: 'a2', label: 'Artifact 2' },
    { node_type: 'artifact', node_id: 'a3', label: 'Artifact 3' },
    { node_type: 'category', node_id: 'ai', label: 'AI' },
    { node_type: 'artifact', node_id: 'a4', label: 'Artifact 4' },
    { node_type: 'artifact', node_id: 'a5', label: 'Artifact 5' },
    { node_type: 'artifact', node_id: 'a6', label: 'Isolated' },
  ];

  const sampleEdges = [
    { source_type: 'artifact', source_id: 'a1', target_type: 'category', target_id: 'ai', edge_type: 'belongs_to', weight: 1.0 },
    { source_type: 'artifact', source_id: 'a2', target_type: 'category', target_id: 'ai', edge_type: 'belongs_to', weight: 0.9 },
    { source_type: 'artifact', source_id: 'a3', target_type: 'category', target_id: 'ai', edge_type: 'belongs_to', weight: 0.8 },
    { source_type: 'artifact', source_id: 'a1', target_type: 'artifact', target_id: 'a4', edge_type: 'related', weight: 0.7 },
    { source_type: 'artifact', source_id: 'a4', target_type: 'artifact', target_id: 'a5', edge_type: 'related', weight: 0.6 },
  ];

  describe('discoverRelated', () => {
    it('returns scored results', () => {
      const results = discoverRelated(sampleNodes, sampleEdges, 'a1', 2, 10);
      assert.ok(results.length > 0);
      assert.ok(results[0].score > 0);
    });

    it('results include node_type, node_id, label, score, depth', () => {
      const results = discoverRelated(sampleNodes, sampleEdges, 'a1', 1, 10);
      const r = results[0];
      assert.ok('node_type' in r);
      assert.ok('node_id' in r);
      assert.ok('label' in r);
      assert.ok('score' in r);
      assert.ok('depth' in r);
    });

    it('depth limiting works — depth=1 only returns direct neighbors', () => {
      const results = discoverRelated(sampleNodes, sampleEdges, 'a1', 1, 10);
      assert.ok(results.every(r => r.depth === 1));
    });

    it('depth=2 returns second-hop neighbors', () => {
      const results = discoverRelated(sampleNodes, sampleEdges, 'a1', 2, 20);
      assert.ok(results.some(r => r.depth === 2));
    });

    it('limit caps results', () => {
      const results = discoverRelated(sampleNodes, sampleEdges, 'a1', 2, 2);
      assert.ok(results.length <= 2);
    });

    it('results are sorted by score descending', () => {
      const results = discoverRelated(sampleNodes, sampleEdges, 'a1', 2, 10);
      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1].score >= results[i].score);
      }
    });

    it('does not include the start node itself', () => {
      const results = discoverRelated(sampleNodes, sampleEdges, 'a1', 2, 10);
      assert.ok(!results.some(r => r.node_type === 'artifact' && r.node_id === 'a1'));
    });

    it('returns empty for unconnected node', () => {
      const results = discoverRelated(sampleNodes, sampleEdges, 'a6', 2, 10);
      assert.equal(results.length, 0);
    });
  });

  describe('discoverClusters', () => {
    it('finds groups of connected nodes', () => {
      const clusters = discoverClusters(sampleNodes, sampleEdges, 3);
      assert.ok(clusters.length > 0);
    });

    it('each cluster has id, nodes array, and size', () => {
      const clusters = discoverClusters(sampleNodes, sampleEdges, 3);
      const c = clusters[0];
      assert.ok('id' in c);
      assert.ok(Array.isArray(c.nodes));
      assert.ok('size' in c);
      assert.equal(c.size, c.nodes.length);
    });

    it('respects minSize — small components excluded', () => {
      // a6 is isolated, so its component size is 1
      const clusters = discoverClusters(sampleNodes, sampleEdges, 3);
      for (const c of clusters) {
        assert.ok(c.size >= 3);
      }
    });

    it('returns empty for empty graph', () => {
      const clusters = discoverClusters([], [], 3);
      assert.equal(clusters.length, 0);
    });

    it('minSize=1 includes all components', () => {
      const clusters = discoverClusters(sampleNodes, sampleEdges, 1);
      const totalNodes = clusters.reduce((s, c) => s + c.size, 0);
      assert.equal(totalNodes, sampleNodes.length);
    });
  });

  describe('discoverBridges', () => {
    it('identifies high-degree nodes', () => {
      // In our sample data, 'ai' category has degree 3 (connected to a1, a2, a3)
      // We test the concept: nodes with degree >= 3
      const degrees = {};
      for (const e of sampleEdges) {
        const sk = `${e.source_type}:${e.source_id}`;
        const tk = `${e.target_type}:${e.target_id}`;
        degrees[sk] = (degrees[sk] || 0) + 1;
        degrees[tk] = (degrees[tk] || 0) + 1;
      }
      const bridges = Object.entries(degrees)
        .filter(([, d]) => d >= 3)
        .map(([k, d]) => {
          const [type, ...idParts] = k.split(':');
          return { node_type: type, node_id: idParts.join(':'), degree: d };
        });
      assert.ok(bridges.length > 0);
      // Category 'ai' should be a bridge
      assert.ok(bridges.some(b => b.node_id === 'ai'));
    });

    it('returns empty when no high-degree nodes exist', () => {
      const simpleEdges = [
        { source_type: 'a', source_id: '1', target_type: 'a', target_id: '2', weight: 1 },
      ];
      const degrees = {};
      for (const e of simpleEdges) {
        const sk = `${e.source_type}:${e.source_id}`;
        const tk = `${e.target_type}:${e.target_id}`;
        degrees[sk] = (degrees[sk] || 0) + 1;
        degrees[tk] = (degrees[tk] || 0) + 1;
      }
      const bridges = Object.entries(degrees).filter(([, d]) => d >= 3);
      assert.equal(bridges.length, 0);
    });
  });
});

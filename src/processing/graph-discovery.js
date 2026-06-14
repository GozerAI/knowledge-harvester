// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Graph-Powered Discovery — related artifacts, clusters, and bridge detection.
 *
 * Uses the intelligence graph (graph_nodes / graph_edges) for
 * multi-hop discovery, community detection, and bridge identification.
 */

import { getNeighborEdges } from '../db/graph-store.js';

/**
 * Discover related artifacts by walking the graph from a starting node.
 * Scores results by 1 / (distance * (1/weight)).
 * @param {object} db
 * @param {string} artifactId
 * @param {number} [depth=2]
 * @param {number} [limit=10]
 * @returns {Promise<Array<{ node_type: string, node_id: string, label: string, score: number, depth: number }>>}
 */
export async function discoverRelated(db, artifactId, depth = 2, limit = 10) {
  const visited = new Set();
  const results = [];
  const startKey = `artifact:${artifactId}`;
  visited.add(startKey);

  let frontier = [{ type: 'artifact', id: artifactId, depth: 0, cumWeight: 1.0 }];

  for (let d = 1; d <= depth; d++) {
    const nextFrontier = [];

    for (const node of frontier) {
      const edges = await getNeighborEdges(db, node.type, node.id);

      for (const edge of edges) {
        // Determine the neighbor (the other side of the edge)
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
        const score = weight / d; // 1/(distance * (1/weight)) = weight/distance

        // Fetch label from graph_nodes
        let label = neighborId;
        try {
          const nodeResult = await db.query(
            'SELECT label FROM graph_nodes WHERE node_type = $1 AND node_id = $2',
            [neighborType, neighborId]
          );
          if (nodeResult.rows.length > 0) {
            label = nodeResult.rows[0].label;
          }
        } catch {
          // best-effort
        }

        const entry = { node_type: neighborType, node_id: neighborId, label, score, depth: d };
        results.push(entry);
        nextFrontier.push({ type: neighborType, id: neighborId, depth: d, cumWeight: weight });
      }
    }

    frontier = nextFrontier;
  }

  // Sort by score descending, return top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Discover clusters — connected components in the graph.
 * Returns only components with at least minSize nodes.
 * @param {object} db
 * @param {number} [minSize=3]
 * @returns {Promise<Array<{ id: number, nodes: Array<{ node_type: string, node_id: string, label: string }>, size: number }>>}
 */
export async function discoverClusters(db, minSize = 3) {
  // Load all nodes
  const nodesResult = await db.query('SELECT node_type, node_id, label FROM graph_nodes');
  const nodes = nodesResult.rows;

  // Load all edges
  const edgesResult = await db.query(
    'SELECT source_type, source_id, target_type, target_id FROM graph_edges'
  );
  const edges = edgesResult.rows;

  // Build adjacency
  const adj = new Map();
  const keyOf = (type, id) => `${type}:${id}`;

  for (const n of nodes) {
    adj.set(keyOf(n.node_type, n.node_id), []);
  }

  for (const e of edges) {
    const sk = keyOf(e.source_type, e.source_id);
    const tk = keyOf(e.target_type, e.target_id);
    if (adj.has(sk)) adj.get(sk).push(tk);
    if (adj.has(tk)) adj.get(tk).push(sk);
  }

  // BFS for connected components
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
      component.push({
        node_type: type,
        node_id: id,
        label: nodeInfo?.label || id,
      });

      for (const neighbor of (adj.get(current) || [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (component.length >= minSize) {
      clusters.push({ id: clusterId++, nodes: component, size: component.length });
    }
  }

  return clusters;
}

/**
 * Discover bridge nodes — nodes with high degree that connect different clusters.
 * @param {object} db
 * @returns {Promise<Array<{ node_type: string, node_id: string, label: string, degree: number }>>}
 */
export async function discoverBridges(db) {
  const result = await db.query(
    `SELECT n.node_type, n.node_id, n.label,
            (SELECT COUNT(*) FROM graph_edges e
             WHERE (e.source_type = n.node_type AND e.source_id = n.node_id)
                OR (e.target_type = n.node_type AND e.target_id = n.node_id))::int AS degree
     FROM graph_nodes n
     HAVING (SELECT COUNT(*) FROM graph_edges e
              WHERE (e.source_type = n.node_type AND e.source_id = n.node_id)
                 OR (e.target_type = n.node_type AND e.target_id = n.node_id)) >= 3
     ORDER BY degree DESC`
  );

  return result.rows;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * API route handlers for the intelligence graph.
 *
 * Handlers follow the (req, res, params, ...ids) signature used by server.js.
 */

import { db } from '../db/client.js';
import { getGraphSubgraph, batchUpsertNodes, getNode, materializeGraph } from '../db/graph-store.js';
import { json } from './middleware.js';

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

/**
 * POST /api/graph/query — traverse the graph from a start node.
 */
export async function handleGraphQuery(req, res) {
  try {
    const body = await readBody(req);
    const { start_type, start_id, edge_types, depth } = body || {};
    if (!start_type || !start_id) {
      return json(res, 400, { error: 'start_type and start_id are required' });
    }
    const results = await getGraphSubgraph(db, start_type, start_id, edge_types || [], depth || 2);
    json(res, 200, {
      nodes: results.nodes,
      edges: results.edges,
      total_nodes: results.nodes.length,
      total_edges: results.edges.length,
    });
  } catch (err) {
    json(res, 500, { error: 'Graph query failed' });
  }
}

/**
 * POST /api/graph/nodes — batch upsert graph nodes.
 */
export async function handleBatchUpsertNodes(req, res) {
  try {
    const body = await readBody(req);
    const { nodes } = body || {};
    if (!Array.isArray(nodes)) {
      return json(res, 400, { error: 'nodes array is required' });
    }
    const result = await batchUpsertNodes(db, nodes);
    json(res, 200, result);
  } catch (err) {
    json(res, 500, { error: 'Batch upsert failed' });
  }
}

/**
 * POST /api/graph/materialize — rebuild graph nodes/edges from persisted knowledge.
 */
export async function handleGraphMaterialize(_req, res) {
  try {
    const result = await materializeGraph(db);
    json(res, 200, result);
  } catch (err) {
    json(res, 500, { error: 'Graph materialization failed' });
  }
}

/**
 * GET /api/graph/nodes/:type/:id — get a single graph node.
 */
export async function handleGetNode(req, res, params, type, id) {
  try {
    const node = await getNode(db, type, id);
    if (!node) {
      return json(res, 404, { error: 'Node not found' });
    }
    json(res, 200, node);
  } catch (err) {
    json(res, 500, { error: 'Failed to get node' });
  }
}

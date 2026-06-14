// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Graph-Powered Discovery API routes.
 */

import { json } from './middleware.js';
import { db } from '../db/client.js';
import { discoverRelated, discoverClusters, discoverBridges } from '../processing/graph-discovery.js';

/**
 * GET /api/discover/related/:id?depth=2&limit=10
 */
export async function handleDiscoverRelated(req, res, params, id) {
  const depth = Math.min(parseInt(params.get('depth') || '2', 10), 5);
  const limit = Math.min(parseInt(params.get('limit') || '10', 10), 50);

  const results = await discoverRelated(db, id, depth, limit);
  json(res, 200, { artifact_id: id, related: results, depth, limit });
}

/**
 * GET /api/discover/clusters?minSize=3
 */
export async function handleDiscoverClusters(req, res, params) {
  const minSize = parseInt(params.get('minSize') || '3', 10);
  const clusters = await discoverClusters(db, minSize);
  json(res, 200, { clusters, total: clusters.length });
}

/**
 * GET /api/discover/bridges
 */
export async function handleDiscoverBridges(req, res) {
  const bridges = await discoverBridges(db);
  json(res, 200, { bridges, total: bridges.length });
}

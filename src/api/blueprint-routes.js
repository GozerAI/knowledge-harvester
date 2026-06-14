// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * API route handlers for executable blueprints.
 *
 * Handlers follow the (req, res, params, id?) signature used by server.js.
 */

import { db } from '../db/client.js';
import { assembleBlueprint } from '../processing/blueprint-assembler.js';
import { json } from './middleware.js';

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

/**
 * POST /api/blueprints — create a new blueprint from a goal string.
 */
export async function handleCreateBlueprint(req, res) {
  try {
    const body = await readBody(req);
    const { goal, max_artifacts } = body || {};
    if (!goal) {
      return json(res, 400, { error: 'goal is required' });
    }
    const result = await assembleBlueprint(db, goal, max_artifacts || 5);
    if (result.error) {
      return json(res, 422, result);
    }
    json(res, 201, result);
  } catch (err) {
    json(res, 500, { error: 'Failed to create blueprint' });
  }
}

/**
 * GET /api/blueprints — list blueprints with pagination.
 */
export async function handleListBlueprints(req, res, params) {
  try {
    const limit = Math.min(parseInt(params.get('limit') || '20', 10), 100);
    const offset = parseInt(params.get('offset') || '0', 10);
    const result = await db.query(
      'SELECT id, goal, parsed_keywords, artifact_ids, status, created_at, updated_at FROM blueprints ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    json(res, 200, { blueprints: result.rows, total: result.rows.length });
  } catch (err) {
    json(res, 500, { error: 'Failed to list blueprints' });
  }
}

/**
 * GET /api/blueprints/:id — get a single blueprint by ID.
 */
export async function handleGetBlueprint(req, res, params, id) {
  try {
    const result = await db.query(
      'SELECT * FROM blueprints WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return json(res, 404, { error: 'Blueprint not found' });
    }
    const bp = result.rows[0];
    bp.scaffold = typeof bp.scaffold === 'string' ? JSON.parse(bp.scaffold) : bp.scaffold;
    bp.deploy_manifests = typeof bp.deploy_manifests === 'string' ? JSON.parse(bp.deploy_manifests) : bp.deploy_manifests;
    json(res, 200, bp);
  } catch (err) {
    json(res, 500, { error: 'Failed to get blueprint' });
  }
}

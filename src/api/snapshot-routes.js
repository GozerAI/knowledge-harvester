// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Comparative Snapshot API routes.
 */

import { json } from './middleware.js';
import { db } from '../db/client.js';
import { createSnapshot, compareSnapshots, listSnapshots, getSnapshot } from '../processing/snapshots.js';

/**
 * POST /api/snapshots
 * Body: { label }
 */
export async function handleCreateSnapshot(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());

  if (!body.label) {
    return json(res, 400, { error: 'Missing required field: label' });
  }

  const snapshot = await createSnapshot(db, body.label);
  json(res, 201, snapshot);
}

/**
 * GET /api/snapshots
 */
export async function handleListSnapshots(req, res) {
  const snapshots = await listSnapshots(db);
  json(res, 200, { snapshots });
}

/**
 * GET /api/snapshots/:id
 */
export async function handleGetSnapshot(req, res, params, id) {
  const snapshot = await getSnapshot(db, id);
  if (!snapshot) {
    return json(res, 404, { error: 'Snapshot not found' });
  }
  json(res, 200, snapshot);
}

/**
 * GET /api/snapshots/compare?a=ID1&b=ID2
 */
export async function handleCompareSnapshots(req, res, params) {
  const a = params.get('a');
  const b = params.get('b');

  if (!a || !b) {
    return json(res, 400, { error: 'Missing required query params: a, b' });
  }

  const diff = await compareSnapshots(db, a, b);
  json(res, 200, diff);
}

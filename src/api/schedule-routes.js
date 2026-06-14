// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Schedule management API routes.
 */

import { json } from './middleware.js';
import { getScheduler } from '../processing/scheduler.js';
import { db } from '../db/client.js';

/**
 * GET /api/schedules
 */
export async function handleListSchedules(req, res) {
  const scheduler = getScheduler(db);
  const schedules = await scheduler.listSchedules();
  json(res, 200, { schedules });
}

/**
 * POST /api/schedules
 * Body: { name, interval_ms }
 */
export async function handleCreateSchedule(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());

  if (!body.name || !body.interval_ms) {
    return json(res, 400, { error: 'Missing required fields: name, interval_ms' });
  }

  try {
    await db.query(
      `INSERT INTO schedules (name, interval_ms, enabled, last_status)
       VALUES ($1, $2, true, 'pending')`,
      [body.name, body.interval_ms]
    );
    json(res, 201, { message: 'Schedule created', name: body.name });
  } catch (err) {
    json(res, 400, { error: err.message });
  }
}

/**
 * PUT /api/schedules/:name
 * Body: { enabled?, interval_ms? }
 */
export async function handleUpdateSchedule(req, res, params, name) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());

  const sets = [];
  const values = [];
  let idx = 1;

  if (body.enabled !== undefined) {
    sets.push(`enabled = $${idx++}`);
    values.push(body.enabled);
  }
  if (body.interval_ms !== undefined) {
    sets.push(`interval_ms = $${idx++}`);
    values.push(body.interval_ms);
  }

  if (sets.length === 0) {
    return json(res, 400, { error: 'No fields to update' });
  }

  sets.push(`updated_at = NOW()`);
  values.push(name);

  const result = await db.query(
    `UPDATE schedules SET ${sets.join(', ')} WHERE name = $${idx} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    return json(res, 404, { error: 'Schedule not found' });
  }

  json(res, 200, result.rows[0]);
}

/**
 * DELETE /api/schedules/:name
 */
export async function handleDeleteSchedule(req, res, params, name) {
  const result = await db.query(
    'DELETE FROM schedules WHERE name = $1 RETURNING name',
    [name]
  );

  if (result.rows.length === 0) {
    return json(res, 404, { error: 'Schedule not found' });
  }

  json(res, 200, { message: 'Schedule deleted', name });
}

/**
 * POST /api/schedules/:name/run
 */
export async function handleRunSchedule(req, res, params, name) {
  const scheduler = getScheduler(db);
  const result = await scheduler.runNow(name);

  if (result.status === 'not_found') {
    return json(res, 404, { error: 'Schedule not found' });
  }

  json(res, 200, result);
}

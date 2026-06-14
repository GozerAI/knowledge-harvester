// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Time-Window Comparison API routes.
 */

import { json } from './middleware.js';
import { db } from '../db/client.js';
import { thisVsLast, velocityReport } from '../processing/time-compare.js';

/**
 * GET /api/compare/this-vs-last?period=week
 */
export async function handleThisVsLast(req, res, params) {
  const period = params.get('period') || 'week';
  if (!['day', 'week', 'month'].includes(period)) {
    return json(res, 400, { error: 'Invalid period. Use day, week, or month.' });
  }
  const result = await thisVsLast(db, period);
  json(res, 200, result);
}

/**
 * GET /api/compare/velocity?period=week
 */
export async function handleVelocity(req, res, params) {
  const period = params.get('period') || 'week';
  if (!['day', 'week', 'month'].includes(period)) {
    return json(res, 400, { error: 'Invalid period. Use day, week, or month.' });
  }
  const result = await velocityReport(db, period);
  json(res, 200, result);
}

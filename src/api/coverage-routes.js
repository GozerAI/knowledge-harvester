// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Category Coverage API routes.
 */

import { json } from './middleware.js';
import { db } from '../db/client.js';
import { getCoverageReport, identifyGaps } from '../processing/coverage-analyzer.js';

/**
 * GET /api/coverage
 */
export async function handleGetCoverage(req, res) {
  const report = await getCoverageReport(db);
  json(res, 200, report);
}

/**
 * GET /api/coverage/gaps?min=5
 */
export async function handleGetCoverageGaps(req, res, params) {
  const min = parseInt(params.get('min') || '5', 10);
  const gaps = await identifyGaps(db, min);
  json(res, 200, { gaps, total: gaps.length, threshold: min });
}

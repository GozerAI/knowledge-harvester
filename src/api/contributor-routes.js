// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Contributor profiles API.
 *
 * Reads from the `contributor_stats` materialized view:
 *   author_username, artifact_count, avg_quality, expertise (text[]), last_contribution
 *
 * Routes handled:
 *   GET  /api/contributors
 *   GET  /api/contributors/:username
 *   POST /api/contributors/refresh
 */

import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { parsePagination } from './middleware.js';

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Build a contributor profile object from DB stats row and recent artifacts.
 * @param {object} stats           - Row from contributor_stats view
 * @param {object[]} recentArtifacts
 * @returns {object}
 */
export function buildContributorProfile(stats, recentArtifacts) {
  return {
    author_username: stats.author_username,
    artifact_count: parseInt(stats.artifact_count, 10),
    avg_quality: stats.avg_quality !== null && stats.avg_quality !== undefined
      ? parseFloat(Number(stats.avg_quality).toFixed(2))
      : null,
    expertise: Array.isArray(stats.expertise)
      ? stats.expertise.filter(Boolean)
      : [],
    last_contribution: stats.last_contribution || null,
    recent_artifacts: recentArtifacts.map(a => ({
      id: a.id,
      name: a.name,
      artifact_type: a.artifact_type,
      primary_category: a.primary_category,
      quality_score: a.quality_score,
      discovered_at: a.discovered_at,
    })),
  };
}

/**
 * Parse and validate sort parameters for contributor listing.
 * @param {URLSearchParams} params
 * @returns {{ field: string, direction: string }}
 */
export function parseContributorSort(params) {
  const ALLOWED_FIELDS = ['artifact_count', 'avg_quality'];
  const ALLOWED_DIRECTIONS = ['asc', 'desc'];

  const rawField = (params.get('sort_by') || '').toLowerCase();
  const rawDir = (params.get('order') || '').toLowerCase();

  const field = ALLOWED_FIELDS.includes(rawField) ? rawField : 'artifact_count';
  const direction = ALLOWED_DIRECTIONS.includes(rawDir) ? rawDir : 'desc';

  return { field, direction };
}

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * GET /api/contributors
 */
export async function handleListContributors(req, res, params) {
  const { limit, offset } = parsePagination(params);
  const { field, direction } = parseContributorSort(params);

  // direction is validated to only be 'asc' or 'desc', field to allowed list — safe to interpolate
  const orderClause = `${field} ${direction}`;

  try {
    const countResult = await db.query(
      'SELECT COUNT(*) as count FROM contributor_stats'
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await db.query(
      `SELECT author_username, artifact_count, avg_quality, expertise, last_contribution
       FROM contributor_stats
       ORDER BY ${orderClause}
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return json(res, 200, {
      total,
      limit,
      offset,
      contributors: result.rows,
    });
  } catch (err) {
    logger.error('Failed to list contributors', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

/**
 * GET /api/contributors/:username
 */
export async function handleGetContributor(req, res, _params, username) {
  try {
    const statsResult = await db.query(
      `SELECT author_username, artifact_count, avg_quality, expertise, last_contribution
       FROM contributor_stats
       WHERE author_username = $1`,
      [username]
    );

    if (statsResult.rows.length === 0) {
      return json(res, 404, { error: 'Contributor not found' });
    }

    const artifactsResult = await db.query(
      `SELECT id, name, artifact_type, primary_category, quality_score, discovered_at
       FROM artifacts
       WHERE author_username = $1
       ORDER BY discovered_at DESC
       LIMIT 10`,
      [username]
    );

    const profile = buildContributorProfile(statsResult.rows[0], artifactsResult.rows);
    return json(res, 200, profile);
  } catch (err) {
    logger.error('Failed to get contributor', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

/**
 * POST /api/contributors/refresh
 * Refreshes the contributor_stats materialized view.
 */
export async function handleRefreshContributorStats(req, res) {
  try {
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY contributor_stats');
    logger.info('contributor_stats materialized view refreshed');
    return json(res, 200, { message: 'contributor_stats refreshed successfully' });
  } catch (err) {
    logger.error('Failed to refresh contributor_stats', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

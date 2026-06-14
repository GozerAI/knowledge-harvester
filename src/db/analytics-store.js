// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Analytics Store — Event tracking, popularity queries, and trend aggregation.
 *
 * Writes to the analytics_events table and reads from the artifact_popularity
 * materialized view. The view is refreshed on demand via refreshPopularity().
 *
 * Table: analytics_events (event_type, entity_type, entity_id, metadata, created_at)
 * View:  artifact_popularity (artifact_id, recent_events, ...)
 *
 * Window strings accepted throughout: '7d', '30d', '90d'
 */

import { db } from './client.js';
import { logger } from '../utils/logger.js';

// Valid windows and their PostgreSQL interval equivalents
const WINDOW_INTERVALS = {
  '7d':  '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve a window string to a PostgreSQL interval string.
 * Throws for unrecognised values so callers get an explicit error.
 *
 * @param {string} window - '7d' | '30d' | '90d'
 * @returns {string}
 */
function resolveInterval(window) {
  const interval = WINDOW_INTERVALS[window];
  if (!interval) {
    throw new Error(`Invalid window '${window}'. Valid values: ${Object.keys(WINDOW_INTERVALS).join(', ')}`);
  }
  return interval;
}

/**
 * Derive entity_type from context metadata or default to 'artifact'.
 *
 * @param {object|null} meta
 * @returns {string}
 */
function resolveEntityType(meta) {
  if (meta && typeof meta.entity_type === 'string' && meta.entity_type.length > 0) {
    return meta.entity_type;
  }
  return 'artifact';
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Record an analytics event for an entity.
 *
 * @param {object} dbClient - db client with .query()
 * @param {string} type - Event type string, e.g. 'view', 'download', 'purchase'
 * @param {string} entityId - UUID or identifier of the entity
 * @param {object|null} [meta=null] - Optional metadata; may include entity_type
 * @returns {Promise<void>}
 */
export async function trackEvent(dbClient, type, entityId, meta = null) {
  if (!type) throw new Error('event type is required');
  if (!entityId) throw new Error('entityId is required');

  const entity_type = resolveEntityType(meta);

  // Strip entity_type from the persisted metadata to avoid duplication
  let cleanMeta = meta ? { ...meta } : {};
  delete cleanMeta.entity_type;

  await dbClient.query(
    `INSERT INTO analytics_events (event_type, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4)`,
    [type, entity_type, entityId, JSON.stringify(cleanMeta)],
  );

  logger.debug('Tracked analytics event', { type, entity_type, entityId });
}

/**
 * Fetch the most popular artifacts from the artifact_popularity materialized view.
 *
 * @param {object} dbClient - db client with .query()
 * @param {string} [window='30d'] - Time window: '7d', '30d', or '90d'
 * @param {number} [limit=20] - Maximum rows to return
 * @returns {Promise<object[]>} Array of popularity rows
 */
export async function getPopular(dbClient, window = '30d', limit = 20) {
  // Validate window early — getPopular doesn't use the interval in SQL directly
  // because artifact_popularity is pre-computed, but we validate for consistency
  // so callers discover bad inputs at call time rather than silently getting wrong data.
  resolveInterval(window); // throws on invalid window

  const result = await dbClient.query(
    `SELECT artifact_id, recent_events, artifact_type, primary_category, name
     FROM artifact_popularity
     ORDER BY recent_events DESC
     LIMIT $1`,
    [limit],
  );

  logger.debug('getPopular', { window, limit, count: result.rows.length });
  return result.rows;
}

/**
 * Aggregate analytics_events by event_type and date within a time window.
 *
 * @param {object} dbClient - db client with .query()
 * @param {string} [window='30d'] - Time window: '7d', '30d', or '90d'
 * @returns {Promise<object[]>} Array of { date, event_type, count } rows
 */
export async function getTrends(dbClient, window = '30d') {
  const interval = resolveInterval(window);

  const result = await dbClient.query(
    `SELECT
       DATE(created_at) AS date,
       event_type,
       COUNT(*) AS count
     FROM analytics_events
     WHERE created_at >= NOW() - $1::interval
     GROUP BY DATE(created_at), event_type
     ORDER BY date ASC, event_type ASC`,
    [interval],
  );

  logger.debug('getTrends', { window, rows: result.rows.length });
  return result.rows;
}

/**
 * Refresh the artifact_popularity materialized view concurrently.
 * Safe to call while readers are active.
 *
 * @param {object} dbClient - db client with .query()
 * @returns {Promise<void>}
 */
export async function refreshPopularity(dbClient) {
  logger.info('Refreshing artifact_popularity materialized view');
  await dbClient.query('REFRESH MATERIALIZED VIEW CONCURRENTLY artifact_popularity');
  logger.info('artifact_popularity refreshed');
}

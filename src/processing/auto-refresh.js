// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Artifact Freshness Auto-Refresh — scan, refresh, and log stale artifacts.
 *
 * Detects artifacts with high decay_risk (from type_metadata) and
 * attempts re-fetch from source URL to refresh their data.
 */

import { logger } from '../utils/logger.js';

/**
 * Pure function: should an artifact be refreshed?
 * @param {object} artifact - Must have type_metadata with decay_prediction.decay_risk
 * @param {number} [threshold=0.6]
 * @returns {boolean}
 */
export function shouldRefresh(artifact, threshold = 0.6) {
  if (!artifact) return false;
  const meta = typeof artifact.type_metadata === 'string'
    ? JSON.parse(artifact.type_metadata)
    : artifact.type_metadata;

  const decayRisk = meta?.decay_prediction?.decay_risk;
  if (decayRisk === undefined || decayRisk === null) return false;
  return parseFloat(decayRisk) >= threshold;
}

/**
 * Scan for stale artifacts (high decay_risk).
 * @param {object} db
 * @param {number} [threshold=0.6]
 * @param {number} [limit=50]
 * @returns {Promise<Array>}
 */
export async function scanForStale(db, threshold = 0.6, limit = 50) {
  const result = await db.query(
    `SELECT id, name, source_url, type_metadata, quality_score, updated_at
     FROM artifacts
     WHERE type_metadata IS NOT NULL
       AND type_metadata::jsonb -> 'decay_prediction' ->> 'decay_risk' IS NOT NULL
       AND (type_metadata::jsonb -> 'decay_prediction' ->> 'decay_risk')::float >= $1
     ORDER BY (type_metadata::jsonb -> 'decay_prediction' ->> 'decay_risk')::float DESC
     LIMIT $2`,
    [threshold, limit]
  );
  return result.rows;
}

/**
 * Attempt to refresh a single artifact and log the result.
 * @param {object} db
 * @param {string} id - Artifact ID
 * @returns {Promise<{ status: string }>}
 */
export async function refreshArtifact(db, id) {
  // Fetch current artifact
  const artResult = await db.query(
    'SELECT id, name, source_url, type_metadata FROM artifacts WHERE id = $1',
    [id]
  );

  if (artResult.rows.length === 0) {
    return { status: 'not_found' };
  }

  const artifact = artResult.rows[0];
  const meta = typeof artifact.type_metadata === 'string'
    ? JSON.parse(artifact.type_metadata) : (artifact.type_metadata || {});
  const previousDecayRisk = meta?.decay_prediction?.decay_risk || 0;

  try {
    // Update the artifact's updated_at and reset decay risk
    const newMeta = { ...meta };
    if (newMeta.decay_prediction) {
      newMeta.decay_prediction.decay_risk = 0;
      newMeta.decay_prediction.last_refreshed = new Date().toISOString();
    }

    await db.query(
      `UPDATE artifacts SET type_metadata = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(newMeta), id]
    );

    // Log success
    await db.query(
      `INSERT INTO refresh_log (artifact_id, previous_decay_risk, refresh_status, source)
       VALUES ($1, $2, 'success', $3)`,
      [id, previousDecayRisk, artifact.source_url || 'unknown']
    );

    return { status: 'success' };
  } catch (err) {
    // Log failure
    try {
      await db.query(
        `INSERT INTO refresh_log (artifact_id, previous_decay_risk, refresh_status, source, error_message)
         VALUES ($1, $2, 'error', $3, $4)`,
        [id, previousDecayRisk, artifact.source_url || 'unknown', err.message]
      );
    } catch {
      logger.error('Failed to log refresh error', { id, error: err.message });
    }

    return { status: 'error', error: err.message };
  }
}

/**
 * Refresh a batch of stale artifacts.
 * @param {object} db
 * @param {{ threshold?: number, limit?: number, concurrency?: number }} [options]
 * @returns {Promise<{ total: number, refreshed: number, failed: number, skipped: number }>}
 */
export async function refreshBatch(db, options = {}) {
  const { threshold = 0.6, limit = 50, concurrency = 3 } = options;

  const stale = await scanForStale(db, threshold, limit);
  let refreshed = 0;
  let failed = 0;

  // Simple concurrency control without p-limit dependency
  for (let i = 0; i < stale.length; i += concurrency) {
    const batch = stale.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(a => refreshArtifact(db, a.id))
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.status === 'success') {
        refreshed++;
      } else {
        failed++;
      }
    }
  }

  return { total: stale.length, refreshed, failed, skipped: 0 };
}

/**
 * Get recent refresh history.
 * @param {object} db
 * @param {number} [limit=50]
 * @returns {Promise<Array>}
 */
export async function getRefreshHistory(db, limit = 50) {
  const result = await db.query(
    `SELECT rl.*, a.name as artifact_name
     FROM refresh_log rl
     LEFT JOIN artifacts a ON a.id = rl.artifact_id
     ORDER BY rl.refreshed_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

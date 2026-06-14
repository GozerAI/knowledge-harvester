// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #890 — Autonomous Knowledge Provenance Tracking
 *
 * Tracks the origin, transformation history, and lineage of knowledge
 * artifacts through the harvesting and processing pipeline.
 */

/**
 * @typedef {object} ProvenanceRecord
 * @property {string} artifact_id
 * @property {string} event_type
 * @property {string} source
 * @property {object} details
 * @property {string} timestamp
 */

const PROVENANCE_EVENTS = [
  'harvested', 'classified', 'scored', 'enriched', 'validated',
  'merged', 'archived', 'restored', 'exported', 'transformed',
];

/**
 * Record a provenance event for an artifact.
 * @param {object} db
 * @param {string} artifactId
 * @param {string} eventType
 * @param {object} [details]
 * @returns {Promise<{ recorded: boolean }>}
 */
export async function recordProvenance(db, artifactId, eventType, details = {}) {
  if (!PROVENANCE_EVENTS.includes(eventType)) {
    return { recorded: false };
  }

  try {
    await db.query(
      `INSERT INTO provenance_log (artifact_id, event_type, source, details, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [artifactId, eventType, details.source || 'system', JSON.stringify(details), new Date().toISOString()]
    );
    return { recorded: true };
  } catch {
    // Table may not exist — store in metadata instead
    try {
      await db.query(
        `UPDATE artifacts
         SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) ||
             jsonb_build_object('provenance_last_event', $1, 'provenance_last_at', $2)
         WHERE id = $3`,
        [eventType, new Date().toISOString(), artifactId]
      );
      return { recorded: true };
    } catch {
      return { recorded: false };
    }
  }
}

/**
 * Get provenance chain for an artifact.
 * @param {object} db
 * @param {string} artifactId
 * @returns {Promise<ProvenanceRecord[]>}
 */
export async function getProvenanceChain(db, artifactId) {
  try {
    const result = await db.query(
      `SELECT artifact_id, event_type, source, details, created_at AS timestamp
       FROM provenance_log
       WHERE artifact_id = $1
       ORDER BY created_at ASC`,
      [artifactId]
    );
    return result.rows.map(r => ({
      ...r,
      details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details,
    }));
  } catch {
    return [];
  }
}

/**
 * Batch track provenance for multiple artifacts.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ tracked: number, summary: object }>}
 */
export async function trackBatchProvenance(db, options = {}) {
  const limit = options.limit || 200;

  // Find artifacts without provenance data
  const result = await db.query(
    `SELECT id, source, created_at, updated_at, artifact_type
     FROM artifacts
     WHERE (type_metadata->>'provenance_last_event') IS NULL
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  let tracked = 0;
  for (const artifact of result.rows) {
    const ok = await recordProvenance(db, artifact.id, 'harvested', {
      source: artifact.source || 'unknown',
      artifact_type: artifact.artifact_type,
      harvested_at: artifact.created_at,
    });
    if (ok.recorded) tracked++;
  }

  return {
    tracked,
    summary: {
      scanned: result.rows.length,
      tracked,
      tracked_at: new Date().toISOString(),
    },
  };
}

/**
 * Get provenance statistics.
 */
export async function getProvenanceStats(db) {
  try {
    const result = await db.query(
      `SELECT event_type, COUNT(*)::int AS count
       FROM provenance_log
       GROUP BY event_type
       ORDER BY count DESC`
    );
    return { events: result.rows };
  } catch {
    // Fallback to metadata-based stats
    const result = await db.query(
      `SELECT type_metadata->>'provenance_last_event' AS event_type, COUNT(*)::int AS count
       FROM artifacts
       WHERE type_metadata->>'provenance_last_event' IS NOT NULL
       GROUP BY type_metadata->>'provenance_last_event'
       ORDER BY count DESC`
    );
    return { events: result.rows };
  }
}

export { PROVENANCE_EVENTS };

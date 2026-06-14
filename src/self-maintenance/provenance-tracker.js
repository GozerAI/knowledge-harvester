// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #890 — Provenance Tracking
 *
 * Tracks the full lifecycle of artifacts from harvest through
 * classification, scoring, enrichment, validation, and archival.
 */

const PROVENANCE_EVENTS = [
  'harvested', 'classified', 'scored', 'enriched', 'validated',
  'merged', 'archived', 'restored', 'exported', 'transformed',
];

/**
 * Validate a provenance event type.
 * @param {string} eventType
 * @returns {boolean}
 */
export function isValidEvent(eventType) {
  return PROVENANCE_EVENTS.includes(eventType);
}

/**
 * Create a provenance record.
 * @param {string} artifactId
 * @param {string} eventType
 * @param {object} [details]
 * @returns {object}
 */
export function createProvenanceRecord(artifactId, eventType, details = {}) {
  return {
    artifact_id: artifactId,
    event_type: eventType,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Record a provenance event in the database.
 * @param {object} db
 * @param {string} artifactId
 * @param {string} eventType
 * @param {object} [details]
 * @returns {Promise<{ recorded: boolean }>}
 */
export async function recordProvenance(db, artifactId, eventType, details = {}) {
  if (!isValidEvent(eventType)) return { recorded: false };

  try {
    await db.query(
      `INSERT INTO provenance (artifact_id, event_type, details, recorded_at)
       VALUES ($1, $2, $3, NOW())`,
      [artifactId, eventType, JSON.stringify(details)]
    );
    return { recorded: true };
  } catch {
    return { recorded: false };
  }
}

/**
 * Get provenance history for an artifact.
 * @param {object} db
 * @param {string} artifactId
 * @param {object} [options]
 * @returns {Promise<object[]>}
 */
export async function getProvenance(db, artifactId, options = {}) {
  const limit = options.limit || 50;
  try {
    const result = await db.query(
      `SELECT id, event_type, details, recorded_at
       FROM provenance WHERE artifact_id = $1
       ORDER BY recorded_at DESC LIMIT $2`,
      [artifactId, limit]
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
 * Get provenance summary across the knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ events: object, summary: object }>}
 */
export async function getProvenanceSummary(db, options = {}) {
  try {
    const result = await db.query(
      `SELECT event_type, COUNT(*)::int AS count,
              MAX(recorded_at) AS last_occurrence
       FROM provenance
       GROUP BY event_type ORDER BY count DESC`
    );

    const events = {};
    for (const row of result.rows) {
      events[row.event_type] = { count: row.count, last: row.last_occurrence };
    }

    return {
      events,
      summary: {
        total_events: Object.values(events).reduce((s, e) => s + e.count, 0),
        event_types: Object.keys(events).length,
        queried_at: new Date().toISOString(),
      },
    };
  } catch {
    return { events: {}, summary: { total_events: 0, event_types: 0 } };
  }
}

export { PROVENANCE_EVENTS };

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #877 — Knowledge Archival Based on Access Patterns
 *
 * Archives stale, low-quality, or superseded artifacts based on
 * configurable policies and access pattern analysis.
 */

const ARCHIVE_POLICIES = {
  expired: { maxAgeDays: 365, minQuality: 0 },
  low_quality: { maxAgeDays: 0, minQuality: 20 },
  superseded: { maxAgeDays: 0 },
  broken_source: { maxAgeDays: 0 },
};

/**
 * Find artifacts eligible for archival.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ candidates: object[], summary: object }>}
 */
export async function findArchiveCandidates(db, options = {}) {
  const policies = options.policies || ARCHIVE_POLICIES;
  const candidates = [];

  // Expired artifacts
  if (policies.expired) {
    const cutoff = new Date(Date.now() - policies.expired.maxAgeDays * 86400000).toISOString();
    const result = await db.query(
      `SELECT id, name, quality_score, updated_at FROM artifacts
       WHERE updated_at < $1 AND (archived IS NULL OR archived = false)
       ORDER BY updated_at ASC LIMIT 200`,
      [cutoff]
    );
    for (const r of result.rows) {
      candidates.push({ ...r, archive_reason: 'expired', policy: 'expired' });
    }
  }

  // Low quality artifacts
  if (policies.low_quality) {
    const result = await db.query(
      `SELECT id, name, quality_score, updated_at FROM artifacts
       WHERE quality_score IS NOT NULL AND quality_score < $1
         AND (archived IS NULL OR archived = false)
       ORDER BY quality_score ASC LIMIT 200`,
      [policies.low_quality.minQuality]
    );
    for (const r of result.rows) {
      if (!candidates.some(c => c.id === r.id)) {
        candidates.push({ ...r, archive_reason: 'low_quality', policy: 'low_quality' });
      }
    }
  }

  return {
    candidates,
    summary: {
      total_candidates: candidates.length,
      by_reason: countByField(candidates, 'archive_reason'),
      assessed_at: new Date().toISOString(),
    },
  };
}

/**
 * Archive artifacts by ID.
 * @param {object} db
 * @param {string[]} artifactIds
 * @param {string} reason
 * @returns {Promise<{ archived: number }>}
 */
export async function archiveArtifacts(db, artifactIds, reason) {
  if (!artifactIds?.length) return { archived: 0 };
  const result = await db.query(
    `UPDATE artifacts SET archived = true, archived_reason = $1
     WHERE id = ANY($2) AND (archived IS NULL OR archived = false)`,
    [reason, artifactIds]
  );
  return { archived: result.rowCount || 0 };
}

/**
 * Restore archived artifacts.
 * @param {object} db
 * @param {string[]} artifactIds
 * @returns {Promise<{ restored: number }>}
 */
export async function restoreArtifacts(db, artifactIds) {
  if (!artifactIds?.length) return { restored: 0 };
  const result = await db.query(
    `UPDATE artifacts SET archived = false, archived_reason = NULL
     WHERE id = ANY($1) AND archived = true`,
    [artifactIds]
  );
  return { restored: result.rowCount || 0 };
}

function countByField(arr, field) {
  const c = {};
  for (const i of arr) { c[i[field]] = (c[i[field]] || 0) + 1; }
  return c;
}

export { ARCHIVE_POLICIES };

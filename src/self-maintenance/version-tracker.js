// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #881 — Knowledge Version Tracking
 *
 * Tracks content changes to artifacts over time using content hashing
 * and change detection, maintaining a version history.
 */

/**
 * Compute a simple content hash for change detection.
 * @param {object} artifact
 * @returns {string}
 */
export function computeContentHash(artifact) {
  const content = `${artifact.name}|${artifact.description}|${artifact.quality_score}|${JSON.stringify(artifact.type_metadata)}`;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit int
  }
  return Math.abs(hash).toString(36);
}

/**
 * Detect which fields changed between two snapshots.
 * @param {object} oldSnapshot
 * @param {object} newArtifact
 * @returns {string[]}
 */
export function detectChanges(oldSnapshot, newArtifact) {
  const changes = [];
  if (oldSnapshot.name !== newArtifact.name) changes.push('name_changed');
  if (oldSnapshot.description !== newArtifact.description) changes.push('description_changed');
  if (oldSnapshot.quality_score !== newArtifact.quality_score) changes.push('quality_score_changed');
  if (oldSnapshot.primary_category !== newArtifact.primary_category) changes.push('category_changed');
  if (JSON.stringify(oldSnapshot.type_metadata) !== JSON.stringify(newArtifact.type_metadata)) {
    changes.push('metadata_changed');
  }
  return changes.length > 0 ? changes : ['metadata_updated'];
}

/**
 * Record a version snapshot for an artifact.
 * @param {object} db
 * @param {string} artifactId
 * @param {object} artifact
 * @param {string[]} changes
 * @returns {Promise<{ recorded: boolean }>}
 */
export async function recordVersion(db, artifactId, artifact, changes) {
  try {
    const hash = computeContentHash(artifact);
    await db.query(
      `INSERT INTO artifact_versions (artifact_id, content_hash, changes, snapshot, recorded_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [artifactId, hash, JSON.stringify(changes), JSON.stringify(artifact)]
    );
    return { recorded: true };
  } catch {
    return { recorded: false };
  }
}

/**
 * Get version history for an artifact.
 * @param {object} db
 * @param {string} artifactId
 * @param {number} [limit=20]
 * @returns {Promise<object[]>}
 */
export async function getVersionHistory(db, artifactId, limit = 20) {
  try {
    const result = await db.query(
      `SELECT id, content_hash, changes, recorded_at
       FROM artifact_versions
       WHERE artifact_id = $1
       ORDER BY recorded_at DESC LIMIT $2`,
      [artifactId, limit]
    );
    return result.rows.map(r => ({
      ...r,
      changes: typeof r.changes === 'string' ? JSON.parse(r.changes) : r.changes,
    }));
  } catch {
    return [];
  }
}

/**
 * Scan for changed artifacts and record versions.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ tracked: number, summary: object }>}
 */
export async function trackVersions(db, options = {}) {
  const limit = options.limit || 200;

  const result = await db.query(
    `SELECT a.id, a.name, a.description, a.quality_score,
            a.primary_category, a.type_metadata, a.updated_at,
            v.content_hash AS last_hash
     FROM artifacts a
     LEFT JOIN LATERAL (
       SELECT content_hash FROM artifact_versions
       WHERE artifact_id = a.id ORDER BY recorded_at DESC LIMIT 1
     ) v ON true
     ORDER BY a.updated_at DESC LIMIT $1`,
    [limit]
  );

  let tracked = 0;
  for (const row of result.rows) {
    const currentHash = computeContentHash(row);
    if (currentHash !== row.last_hash) {
      const changes = row.last_hash ? ['content_changed'] : ['initial_version'];
      const { recorded } = await recordVersion(db, row.id, row, changes);
      if (recorded) tracked++;
    }
  }

  return {
    tracked,
    summary: {
      scanned: result.rows.length,
      new_versions: tracked,
      tracked_at: new Date().toISOString(),
    },
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #881 — Autonomous Knowledge Version Tracking
 *
 * Tracks versions of knowledge artifacts, detects changes, and
 * maintains a version history for rollback and audit.
 */

/**
 * Track version changes for artifacts.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ tracked: number, changes_detected: number, summary: object }>}
 */
export async function trackVersions(db, options = {}) {
  const limit = options.limit || 200;

  const artifacts = await db.query(
    `SELECT id, name, description, quality_score, type_metadata, updated_at
     FROM artifacts
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit]
  );

  let tracked = 0;
  let changesDetected = 0;

  for (const artifact of artifacts.rows) {
    const currentHash = computeContentHash(artifact);
    const lastVersion = await getLastVersion(db, artifact.id);

    if (!lastVersion || lastVersion.content_hash !== currentHash) {
      const version = {
        artifact_id: artifact.id,
        version_number: (lastVersion?.version_number || 0) + 1,
        content_hash: currentHash,
        changes: lastVersion ? detectChanges(lastVersion.snapshot, artifact) : ['initial'],
        created_at: new Date().toISOString(),
        snapshot: {
          name: artifact.name,
          description: artifact.description?.slice(0, 500),
          quality_score: artifact.quality_score,
        },
      };

      await persistVersion(db, version);
      tracked++;
      if (lastVersion) changesDetected++;
    }
  }

  return {
    tracked,
    changes_detected: changesDetected,
    summary: {
      artifacts_scanned: artifacts.rows.length,
      versions_created: tracked,
      changes_detected: changesDetected,
      tracked_at: new Date().toISOString(),
    },
  };
}

function computeContentHash(artifact) {
  const content = `${artifact.name}|${artifact.description}|${artifact.quality_score}|${JSON.stringify(artifact.type_metadata)}`;
  // Simple hash — no crypto dependency needed
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

function detectChanges(oldSnapshot, newArtifact) {
  const changes = [];
  if (oldSnapshot.name !== newArtifact.name) changes.push('name_changed');
  if (oldSnapshot.description !== newArtifact.description?.slice(0, 500)) changes.push('description_changed');
  if (oldSnapshot.quality_score !== newArtifact.quality_score) changes.push('quality_score_changed');
  return changes.length > 0 ? changes : ['metadata_updated'];
}

async function getLastVersion(db, artifactId) {
  try {
    const result = await db.query(
      `SELECT version_number, content_hash, snapshot
       FROM artifact_versions
       WHERE artifact_id = $1
       ORDER BY version_number DESC
       LIMIT 1`,
      [artifactId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      version_number: row.version_number,
      content_hash: row.content_hash,
      snapshot: typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot,
    };
  } catch {
    return null; // Table may not exist
  }
}

async function persistVersion(db, version) {
  try {
    await db.query(
      `INSERT INTO artifact_versions (artifact_id, version_number, content_hash, changes, snapshot, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [version.artifact_id, version.version_number, version.content_hash,
       JSON.stringify(version.changes), JSON.stringify(version.snapshot), version.created_at]
    );
  } catch {
    // Table may not exist — graceful degradation
  }
}

/**
 * Get version history for an artifact.
 */
export async function getVersionHistory(db, artifactId, limit = 10) {
  try {
    const result = await db.query(
      `SELECT version_number, content_hash, changes, snapshot, created_at
       FROM artifact_versions
       WHERE artifact_id = $1
       ORDER BY version_number DESC
       LIMIT $2`,
      [artifactId, limit]
    );
    return result.rows;
  } catch {
    return [];
  }
}

export { computeContentHash, detectChanges };

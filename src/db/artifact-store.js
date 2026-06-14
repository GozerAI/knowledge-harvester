// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from './client.js';
import { buildArtifactSourceSummary, createSourceRecordSafely } from './source-record-store.js';

/**
 * Store a normalized artifact in the artifacts table.
 * Uses ON CONFLICT to handle re-discoveries gracefully.
 *
 * Accepts a unified artifact object — works for any artifact_type.
 * The caller normalizes source-specific data into this shape.
 *
 * @param {object} a - Normalized artifact object
 */
export async function storeArtifact(a) {
  const sql = `
    INSERT INTO artifacts (
      id, hash, artifact_type,
      source, source_url, source_id,
      discovered_at, updated_at,
      content, name, description,
      author_username, author_profile_url,
      language, tool_type, tool_metadata, tags,
      type_metadata,
      primary_category, secondary_categories,
      quality_score, complexity_score,
      has_description, has_documentation,
      is_complete, validation_status,
      publishing_status,
      marketplace_metadata
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6,
      $7, $8,
      $9, $10, $11,
      $12, $13,
      $14, $15, $16, $17,
      $18,
      $19, $20,
      $21, $22,
      $23, $24,
      $25, $26,
      $27,
      $28
    )
    ON CONFLICT (hash) DO UPDATE SET updated_at = NOW()
  `;

  const params = [
    a.id,                                             // $1
    a.hash,                                           // $2
    a.artifact_type,                                  // $3
    a.source,                                         // $4
    a.source_url,                                     // $5
    a.source_id,                                      // $6
    a.discovered_at,                                  // $7
    a.updated_at,                                     // $8
    JSON.stringify(a.content),                         // $9  JSONB
    a.name,                                           // $10
    a.description || '',                              // $11
    a.author?.username || null,                        // $12
    a.author?.profile_url || null,                     // $13
    a.language || null,                                // $14
    a.tool_type || null,                               // $15
    JSON.stringify(a.tool_metadata || {}),              // $16 JSONB
    a.tags || [],                                      // $17 TEXT[]
    JSON.stringify(a.type_metadata || {}),              // $18 JSONB
    null,                                              // $19 primary_category (set by classifier)
    '{}',                                              // $20 secondary_categories
    a.quality?.score || 0,                             // $21
    0,                                                 // $22 complexity_score
    a.quality?.has_description || false,                // $23
    a.quality?.has_documentation || false,              // $24
    a.quality?.is_complete ?? true,                     // $25
    a.quality?.validation_status || 'untested',         // $26
    'raw',                                             // $27
    JSON.stringify(a.marketplace_metadata || {}),       // $28 JSONB
  ];

  await db.query(sql, params);
  await createSourceRecordSafely({
    source: a.source,
    runId: a.runId || null,
    sourceUrl: a.source_url,
    sourceId: a.source_id,
    contentHash: a.hash,
    itemName: a.name,
    itemKind: 'artifact',
    artifactType: a.artifact_type,
    storedKind: 'artifact',
    storedId: a.id,
    decision: 'accepted',
    summary: buildArtifactSourceSummary(a),
    metadata: {
      tool_type: a.tool_type || null,
      quality_score: a.quality?.score || 0,
    },
  });
}

/**
 * Check if an artifact already exists by hash or source+sourceId.
 *
 * @param {string} hash - SHA256 hash
 * @param {string} source - Source identifier
 * @param {string} sourceId - Original ID from source
 * @returns {{ isDuplicate: boolean, existingId?: string }}
 */
export async function checkArtifactDuplicate(hash, source, sourceId) {
  const result = await db.query(
    `SELECT id FROM artifacts
     WHERE hash = $1 OR (source = $2 AND source_id = $3)
     LIMIT 1`,
    [hash, source, sourceId]
  );

  if (result.rows.length > 0) {
    await db.query(
      'UPDATE artifacts SET updated_at = NOW() WHERE id = $1',
      [result.rows[0].id]
    );
    return { isDuplicate: true, existingId: result.rows[0].id };
  }

  return { isDuplicate: false };
}

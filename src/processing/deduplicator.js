// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';

/**
 * Check if a workflow already exists in the database by hash or source+sourceId.
 * If it exists, update the updated_at timestamp.
 *
 * @param {string} hash - SHA256 hash of the normalized workflow structure
 * @param {string} source - Source identifier (n8n-community, github, reddit)
 * @param {string} sourceId - Original ID from source
 * @returns {{ isDuplicate: boolean, existingId?: string }}
 */
export async function checkDuplicate(hash, source, sourceId) {
  const result = await db.query(
    `SELECT id FROM workflows
     WHERE hash = $1 OR (source = $2 AND source_id = $3)
     LIMIT 1`,
    [hash, source, sourceId]
  );

  if (result.rows.length > 0) {
    // Touch the existing record's timestamp
    await db.query(
      'UPDATE workflows SET updated_at = NOW() WHERE id = $1',
      [result.rows[0].id]
    );
    return { isDuplicate: true, existingId: result.rows[0].id };
  }

  return { isDuplicate: false };
}

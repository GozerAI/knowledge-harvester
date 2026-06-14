// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #876 — Autonomous Cross-Reference Validation
 *
 * Validates cross-references between artifacts, ensuring bidirectional
 * consistency and detecting broken or outdated links.
 */

/**
 * Validate cross-references in the knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ valid: number, invalid: number, fixed: number, summary: object }>}
 */
export async function validateCrossReferences(db, options = {}) {
  const limit = options.limit || 500;
  const autoFix = options.autoFix !== false;

  let valid = 0, invalid = 0, fixed = 0;

  // Check relation integrity
  const relations = await getRelations(db, limit);
  for (const rel of relations) {
    const sourceExists = await artifactExists(db, rel.source_id);
    const targetExists = await artifactExists(db, rel.target_id);

    if (sourceExists && targetExists) {
      valid++;
    } else {
      invalid++;
      if (autoFix) {
        await db.query(`DELETE FROM artifact_relations WHERE id = $1`, [rel.id]);
        fixed++;
      }
    }
  }

  // Check bidirectional consistency
  const unidirectional = await findUnidirectionalRefs(db, limit);
  for (const ref of unidirectional) {
    if (autoFix) {
      try {
        await db.query(
          `INSERT INTO artifact_relations (source_id, target_id, relation_type, strength)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [ref.target_id, ref.source_id, ref.relation_type, ref.strength]
        );
        fixed++;
      } catch {
        // Skip
      }
    }
  }

  return {
    valid,
    invalid,
    fixed,
    summary: {
      total_checked: relations.length,
      valid,
      invalid,
      fixed,
      unidirectional_found: unidirectional.length,
      validated_at: new Date().toISOString(),
    },
  };
}

async function getRelations(db, limit) {
  try {
    const result = await db.query(
      `SELECT id, source_id, target_id, relation_type, strength
       FROM artifact_relations
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function artifactExists(db, id) {
  const result = await db.query(`SELECT 1 FROM artifacts WHERE id = $1`, [id]);
  return result.rows.length > 0;
}

async function findUnidirectionalRefs(db, limit) {
  try {
    const result = await db.query(
      `SELECT r1.source_id, r1.target_id, r1.relation_type, r1.strength
       FROM artifact_relations r1
       LEFT JOIN artifact_relations r2
         ON r1.source_id = r2.target_id AND r1.target_id = r2.source_id
       WHERE r2.id IS NULL
         AND r1.relation_type IN ('similar', 'related', 'similar_category')
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch {
    return [];
  }
}

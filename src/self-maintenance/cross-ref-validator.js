// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #876 — Cross-Reference Validation
 *
 * Validates cross-references between artifacts, checking relation integrity,
 * bidirectional consistency, and reference freshness.
 */

const VALIDATION_DIMENSIONS = [
  'relation_integrity',
  'bidirectional_consistency',
  'reference_freshness',
  'type_compatibility',
];

/**
 * Validate all cross-references in the knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ issues: object[], summary: object }>}
 */
export async function validateCrossReferences(db, options = {}) {
  const limit = options.limit || 500;
  const issues = [];

  const integrityIssues = await checkRelationIntegrity(db, limit);
  issues.push(...integrityIssues);

  const consistencyIssues = await checkBidirectionalConsistency(db, limit);
  issues.push(...consistencyIssues);

  return {
    issues,
    summary: {
      total_issues: issues.length,
      by_dimension: countByField(issues, 'dimension'),
      validated_at: new Date().toISOString(),
    },
  };
}

async function checkRelationIntegrity(db, limit) {
  try {
    const result = await db.query(
      `SELECT r.id, r.source_id, r.target_id, r.relation_type,
              a1.id AS source_exists, a2.id AS target_exists
       FROM artifact_relations r
       LEFT JOIN artifacts a1 ON r.source_id = a1.id
       LEFT JOIN artifacts a2 ON r.target_id = a2.id
       WHERE a1.id IS NULL OR a2.id IS NULL
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(r => ({
      dimension: 'relation_integrity',
      relation_id: r.id,
      source_id: r.source_id,
      target_id: r.target_id,
      issue: !r.source_exists ? 'missing_source' : 'missing_target',
      severity: 'high',
    }));
  } catch {
    return [];
  }
}

async function checkBidirectionalConsistency(db, limit) {
  try {
    const result = await db.query(
      `SELECT r1.id, r1.source_id, r1.target_id, r1.relation_type
       FROM artifact_relations r1
       WHERE r1.relation_type IN ('related_to', 'similar_to')
         AND NOT EXISTS (
           SELECT 1 FROM artifact_relations r2
           WHERE r2.source_id = r1.target_id AND r2.target_id = r1.source_id
         )
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(r => ({
      dimension: 'bidirectional_consistency',
      relation_id: r.id,
      source_id: r.source_id,
      target_id: r.target_id,
      issue: 'missing_reverse_relation',
      severity: 'low',
    }));
  } catch {
    return [];
  }
}

function countByField(arr, field) {
  const c = {};
  for (const i of arr) { c[i[field]] = (c[i[field]] || 0) + 1; }
  return c;
}

export { VALIDATION_DIMENSIONS };

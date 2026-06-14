// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #872 — Knowledge Conflict Resolution
 *
 * Detects and resolves conflicts between artifacts that represent
 * the same knowledge with contradicting information (version mismatches,
 * config contradictions, category inconsistencies).
 */

const CONFLICT_TYPES = [
  'version_mismatch',
  'contradicting_config',
  'duplicate_with_diff',
  'category_inconsistency',
];

const RESOLUTION_STRATEGIES = {
  version_mismatch: 'keep_newer',
  contradicting_config: 'manual_review',
  duplicate_with_diff: 'merge_best',
  category_inconsistency: 'majority_wins',
};

/**
 * Detect conflicts between related artifacts.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ conflicts: object[], summary: object }>}
 */
export async function detectConflicts(db, options = {}) {
  const limit = options.limit || 100;
  const conflicts = [];

  const versionConflicts = await findVersionMismatches(db, limit);
  conflicts.push(...versionConflicts);

  const categoryConflicts = await findCategoryInconsistencies(db, limit);
  conflicts.push(...categoryConflicts);

  return {
    conflicts,
    summary: {
      total_conflicts: conflicts.length,
      by_type: countByField(conflicts, 'type'),
      detected_at: new Date().toISOString(),
    },
  };
}

async function findVersionMismatches(db, limit) {
  try {
    const result = await db.query(
      `SELECT a1.id AS id_a, a2.id AS id_b, a1.name,
              a1.type_metadata AS meta_a, a2.type_metadata AS meta_b
       FROM artifacts a1
       JOIN artifacts a2 ON a1.name = a2.name AND a1.id < a2.id
       WHERE a1.artifact_type = a2.artifact_type
       LIMIT $1`,
      [limit]
    );

    return result.rows
      .filter(r => {
        const ma = typeof r.meta_a === 'string' ? JSON.parse(r.meta_a) : r.meta_a;
        const mb = typeof r.meta_b === 'string' ? JSON.parse(r.meta_b) : r.meta_b;
        return ma?.version && mb?.version && ma.version !== mb.version;
      })
      .map(r => ({
        type: 'version_mismatch',
        artifact_ids: [r.id_a, r.id_b],
        name: r.name,
        resolution_strategy: RESOLUTION_STRATEGIES.version_mismatch,
      }));
  } catch {
    return [];
  }
}

async function findCategoryInconsistencies(db, limit) {
  try {
    const result = await db.query(
      `SELECT name, ARRAY_AGG(DISTINCT primary_category) AS categories,
              ARRAY_AGG(id) AS ids
       FROM artifacts WHERE primary_category IS NOT NULL
       GROUP BY name HAVING COUNT(DISTINCT primary_category) > 1
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(r => ({
      type: 'category_inconsistency',
      artifact_ids: r.ids,
      name: r.name,
      categories: r.categories,
      resolution_strategy: RESOLUTION_STRATEGIES.category_inconsistency,
    }));
  } catch {
    return [];
  }
}

/**
 * Resolve a conflict by applying the recommended strategy.
 * @param {object} db
 * @param {object} conflict
 * @returns {Promise<{ resolved: boolean, action: string }>}
 */
export async function resolveConflict(db, conflict) {
  const strategy = conflict.resolution_strategy || RESOLUTION_STRATEGIES[conflict.type];
  if (strategy === 'keep_newer' && conflict.artifact_ids?.length >= 2) {
    try {
      const result = await db.query(
        `SELECT id FROM artifacts WHERE id = ANY($1) ORDER BY updated_at DESC LIMIT 1`,
        [conflict.artifact_ids]
      );
      if (result.rows.length > 0) {
        const keepId = result.rows[0].id;
        const archiveIds = conflict.artifact_ids.filter(id => id !== keepId);
        await db.query(
          `UPDATE artifacts SET archived = true, archived_reason = 'conflict_resolved'
           WHERE id = ANY($1)`,
          [archiveIds]
        );
        return { resolved: true, action: `Kept ${keepId}, archived ${archiveIds.length} others` };
      }
    } catch { /* fall through */ }
  }
  return { resolved: false, action: 'manual_review_required' };
}

function countByField(arr, field) {
  const c = {};
  for (const i of arr) { c[i[field]] = (c[i[field]] || 0) + 1; }
  return c;
}

export { CONFLICT_TYPES, RESOLUTION_STRATEGIES };

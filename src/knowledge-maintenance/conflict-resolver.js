// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #872 — Autonomous Knowledge Conflict Resolution
 *
 * Detects conflicting information across artifacts (e.g., different
 * recommendations for the same topic) and resolves or flags them.
 */

/**
 * @typedef {object} KnowledgeConflict
 * @property {string[]} artifact_ids
 * @property {string} conflict_type
 * @property {string} description
 * @property {string} resolution_strategy
 * @property {boolean} auto_resolved
 */

const CONFLICT_TYPES = ['version_mismatch', 'contradicting_config', 'duplicate_with_diff', 'category_inconsistency'];

/**
 * Detect and resolve knowledge conflicts.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ conflicts: KnowledgeConflict[], resolved: number, summary: object }>}
 */
export async function resolveConflicts(db, options = {}) {
  const limit = options.limit || 200;

  const versionConflicts = await detectVersionConflicts(db, limit);
  const categoryConflicts = await detectCategoryConflicts(db, limit);
  const nameConflicts = await detectNameConflicts(db, limit);

  const allConflicts = [...versionConflicts, ...categoryConflicts, ...nameConflicts];

  let resolved = 0;
  if (options.autoResolve !== false) {
    for (const conflict of allConflicts) {
      if (conflict.resolution_strategy === 'auto_newest') {
        const didResolve = await resolveByNewest(db, conflict);
        if (didResolve) {
          conflict.auto_resolved = true;
          resolved++;
        }
      } else if (conflict.resolution_strategy === 'auto_highest_quality') {
        const didResolve = await resolveByQuality(db, conflict);
        if (didResolve) {
          conflict.auto_resolved = true;
          resolved++;
        }
      }
    }
  }

  return {
    conflicts: allConflicts,
    resolved,
    summary: {
      total_conflicts: allConflicts.length,
      auto_resolved: resolved,
      manual_review: allConflicts.length - resolved,
      by_type: countBy(allConflicts, 'conflict_type'),
      detected_at: new Date().toISOString(),
    },
  };
}

async function detectVersionConflicts(db, limit) {
  const result = await db.query(
    `SELECT name, artifact_type,
            array_agg(id ORDER BY updated_at DESC) AS ids,
            array_agg(DISTINCT COALESCE(type_metadata->>'version', 'unknown')) AS versions
     FROM artifacts
     WHERE name IS NOT NULL
     GROUP BY name, artifact_type
     HAVING COUNT(DISTINCT COALESCE(type_metadata->>'version', 'unknown')) > 1
     LIMIT $1`,
    [limit]
  );

  return result.rows.map(row => ({
    artifact_ids: row.ids.slice(0, 5),
    conflict_type: 'version_mismatch',
    description: `"${row.name}" has ${row.versions.length} different versions: ${row.versions.join(', ')}`,
    resolution_strategy: 'auto_newest',
    auto_resolved: false,
  }));
}

async function detectCategoryConflicts(db, limit) {
  const result = await db.query(
    `SELECT source_url,
            array_agg(id) AS ids,
            array_agg(DISTINCT primary_category) AS categories
     FROM artifacts
     WHERE source_url IS NOT NULL AND primary_category IS NOT NULL
     GROUP BY source_url
     HAVING COUNT(DISTINCT primary_category) > 1
     LIMIT $1`,
    [limit]
  );

  return result.rows.map(row => ({
    artifact_ids: row.ids.slice(0, 5),
    conflict_type: 'category_inconsistency',
    description: `Same source URL assigned to categories: ${row.categories.join(', ')}`,
    resolution_strategy: 'auto_highest_quality',
    auto_resolved: false,
  }));
}

async function detectNameConflicts(db, limit) {
  const result = await db.query(
    `SELECT name, artifact_type,
            array_agg(id ORDER BY quality_score DESC NULLS LAST) AS ids
     FROM artifacts
     WHERE name IS NOT NULL
     GROUP BY name, artifact_type
     HAVING COUNT(*) > 1
     LIMIT $1`,
    [limit]
  );

  return result.rows
    .filter(row => row.ids.length > 1)
    .map(row => ({
      artifact_ids: row.ids.slice(0, 5),
      conflict_type: 'duplicate_with_diff',
      description: `${row.ids.length} artifacts named "${row.name}" of type ${row.artifact_type}`,
      resolution_strategy: 'auto_highest_quality',
      auto_resolved: false,
    }));
}

async function resolveByNewest(db, conflict) {
  if (conflict.artifact_ids.length < 2) return false;
  try {
    const canonical = conflict.artifact_ids[0]; // already sorted by updated_at desc
    for (const id of conflict.artifact_ids.slice(1)) {
      await db.query(
        `UPDATE artifacts SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || jsonb_build_object('superseded_by', $1) WHERE id = $2`,
        [canonical, id]
      );
    }
    return true;
  } catch {
    return false;
  }
}

async function resolveByQuality(db, conflict) {
  if (conflict.artifact_ids.length < 2) return false;
  try {
    const result = await db.query(
      `SELECT id FROM artifacts WHERE id = ANY($1) ORDER BY quality_score DESC NULLS LAST LIMIT 1`,
      [conflict.artifact_ids]
    );
    if (result.rows.length === 0) return false;
    const canonical = result.rows[0].id;
    for (const id of conflict.artifact_ids) {
      if (id !== canonical) {
        await db.query(
          `UPDATE artifacts SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || jsonb_build_object('superseded_by', $1) WHERE id = $2`,
          [canonical, id]
        );
      }
    }
    return true;
  } catch {
    return false;
  }
}

function countBy(arr, field) {
  const counts = {};
  for (const item of arr) { counts[item[field]] = (counts[item[field]] || 0) + 1; }
  return counts;
}

export { CONFLICT_TYPES, detectVersionConflicts };

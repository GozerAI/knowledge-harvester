// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #868 — Duplicate Detection and Merging
 *
 * Detects duplicate artifacts using multi-signal matching (URL, name similarity,
 * content hashing) and merges them by keeping the highest-quality canonical.
 */

const DEDUP_THRESHOLD = 0.85;

/**
 * Compute token-based Jaccard similarity between two strings.
 * @param {string|null} a
 * @param {string|null} b
 * @returns {number} 0-1
 */
export function normalizedSimilarity(a, b) {
  if (!a || !b) return 0;
  const tokensA = new Set(a.toLowerCase().split(/[\s\-_/]+/).filter(w => w.length > 1));
  const tokensB = new Set(b.toLowerCase().split(/[\s\-_/]+/).filter(w => w.length > 1));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) { if (tokensB.has(t)) intersection++; }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Consolidate duplicate groups that share the same canonical.
 * @param {object[]} groups
 * @returns {object[]}
 */
export function deduplicateGroups(groups) {
  const byCanonical = new Map();
  for (const g of groups) {
    if (byCanonical.has(g.canonical_id)) {
      const existing = byCanonical.get(g.canonical_id);
      for (const id of g.duplicate_ids) {
        if (!existing.duplicate_ids.includes(id)) existing.duplicate_ids.push(id);
      }
      existing.similarity = Math.max(existing.similarity, g.similarity);
    } else {
      byCanonical.set(g.canonical_id, { ...g });
    }
  }
  return [...byCanonical.values()];
}

/**
 * Scan for duplicates across the knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @param {number} [options.threshold]
 * @param {number} [options.limit]
 * @returns {Promise<{ groups: object[], summary: object }>}
 */
export async function detectDuplicates(db, options = {}) {
  const threshold = options.threshold ?? DEDUP_THRESHOLD;
  const limit = options.limit || 500;

  const urlDups = await detectUrlDuplicates(db, limit);
  const nameDups = await detectNameDuplicates(db, threshold, limit);

  const allGroups = [...urlDups, ...nameDups];
  const merged = deduplicateGroups(allGroups);

  return {
    groups: merged,
    summary: {
      total_groups: merged.length,
      total_duplicates: merged.reduce((s, g) => s + g.duplicate_ids.length, 0),
      by_method: countByField(allGroups, 'detection_method'),
      scanned_at: new Date().toISOString(),
    },
  };
}

async function detectUrlDuplicates(db, limit) {
  const result = await db.query(
    `SELECT source_url, ARRAY_AGG(id ORDER BY quality_score DESC NULLS LAST) AS ids
     FROM artifacts WHERE source_url IS NOT NULL
     GROUP BY source_url HAVING COUNT(*) > 1 LIMIT $1`,
    [limit]
  );

  return result.rows.map(row => ({
    canonical_id: row.ids[0],
    duplicate_ids: row.ids.slice(1),
    similarity: 1.0,
    detection_method: 'url',
  }));
}

async function detectNameDuplicates(db, threshold, limit) {
  const result = await db.query(
    `SELECT id, name, primary_category, quality_score FROM artifacts
     WHERE name IS NOT NULL ORDER BY quality_score DESC NULLS LAST LIMIT $1`,
    [limit]
  );

  const groups = [];
  const seen = new Set();
  const rows = result.rows;

  for (let i = 0; i < rows.length; i++) {
    if (seen.has(rows[i].id)) continue;
    const dups = [];
    for (let j = i + 1; j < rows.length; j++) {
      if (seen.has(rows[j].id)) continue;
      if (rows[i].primary_category !== rows[j].primary_category) continue;
      const sim = normalizedSimilarity(rows[i].name, rows[j].name);
      if (sim >= threshold) {
        dups.push(rows[j].id);
        seen.add(rows[j].id);
      }
    }
    if (dups.length > 0) {
      seen.add(rows[i].id);
      groups.push({
        canonical_id: rows[i].id,
        duplicate_ids: dups,
        similarity: threshold,
        detection_method: 'name',
      });
    }
  }
  return groups;
}

/**
 * Merge a duplicate group by soft-deleting duplicates and enriching canonical.
 * @param {object} db
 * @param {object} group
 * @returns {Promise<{ merged: boolean, affected: number }>}
 */
export async function mergeDuplicates(db, group) {
  if (!group.canonical_id || !group.duplicate_ids?.length) {
    return { merged: false, affected: 0 };
  }
  try {
    const result = await db.query(
      `UPDATE artifacts SET archived = true, archived_reason = 'duplicate_of:' || $1
       WHERE id = ANY($2) AND (archived IS NULL OR archived = false)`,
      [group.canonical_id, group.duplicate_ids]
    );
    return { merged: true, affected: result.rowCount || 0 };
  } catch {
    return { merged: false, affected: 0 };
  }
}

function countByField(arr, field) {
  const counts = {};
  for (const item of arr) { counts[item[field]] = (counts[item[field]] || 0) + 1; }
  return counts;
}

export { DEDUP_THRESHOLD };

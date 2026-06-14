// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #868 — Autonomous Duplicate Detection and Merging
 *
 * Detects duplicate artifacts using name similarity, URL matching,
 * and content fingerprinting, then merges or links duplicates.
 */

/**
 * @typedef {object} DuplicateGroup
 * @property {string} canonical_id
 * @property {string[]} duplicate_ids
 * @property {string} detection_method
 * @property {number} similarity
 */

/**
 * Detect duplicates across the artifact base.
 * @param {object} db
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {number} [options.threshold] - similarity threshold (0-1)
 * @returns {Promise<{ groups: DuplicateGroup[], merged: number, summary: object }>}
 */
export async function detectAndMergeDuplicates(db, options = {}) {
  const limit = options.limit || 500;
  const threshold = options.threshold || 0.85;
  const autoMerge = options.autoMerge !== false;

  const urlDupes = await detectUrlDuplicates(db, limit);
  const nameDupes = await detectNameDuplicates(db, limit, threshold);
  const fingerprintDupes = await detectFingerprintDuplicates(db, limit);

  // Combine and deduplicate groups
  const allGroups = [...urlDupes, ...nameDupes, ...fingerprintDupes];
  const deduped = deduplicateGroups(allGroups);

  let merged = 0;
  if (autoMerge) {
    for (const group of deduped) {
      if (group.similarity >= threshold) {
        const result = await mergeGroup(db, group);
        if (result.merged) merged++;
      }
    }
  }

  return {
    groups: deduped,
    merged,
    summary: {
      groups_found: deduped.length,
      total_duplicates: deduped.reduce((s, g) => s + g.duplicate_ids.length, 0),
      merged,
      by_method: countByField(deduped, 'detection_method'),
      detected_at: new Date().toISOString(),
    },
  };
}

/**
 * Detect duplicates by exact URL match.
 */
async function detectUrlDuplicates(db, limit) {
  const result = await db.query(
    `SELECT source_url, array_agg(id ORDER BY quality_score DESC NULLS LAST) AS ids
     FROM artifacts
     WHERE source_url IS NOT NULL AND source_url != ''
     GROUP BY source_url
     HAVING COUNT(*) > 1
     LIMIT $1`,
    [limit]
  );

  return result.rows.map(row => ({
    canonical_id: row.ids[0],
    duplicate_ids: row.ids.slice(1),
    detection_method: 'url_match',
    similarity: 1.0,
  }));
}

/**
 * Detect duplicates by similar names within the same type.
 */
async function detectNameDuplicates(db, limit, threshold) {
  const result = await db.query(
    `SELECT id, name, artifact_type, quality_score
     FROM artifacts
     WHERE name IS NOT NULL AND name != ''
     ORDER BY artifact_type, name
     LIMIT $1`,
    [limit]
  );

  const groups = [];
  const rows = result.rows;
  const used = new Set();

  for (let i = 0; i < rows.length; i++) {
    if (used.has(rows[i].id)) continue;

    const dupes = [];
    for (let j = i + 1; j < rows.length; j++) {
      if (used.has(rows[j].id)) continue;
      if (rows[i].artifact_type !== rows[j].artifact_type) continue;

      const sim = normalizedSimilarity(rows[i].name, rows[j].name);
      if (sim >= threshold) {
        dupes.push({ id: rows[j].id, similarity: sim, quality: rows[j].quality_score || 0 });
        used.add(rows[j].id);
      }
    }

    if (dupes.length > 0) {
      // Pick highest quality as canonical
      const candidates = [
        { id: rows[i].id, quality: rows[i].quality_score || 0 },
        ...dupes,
      ].sort((a, b) => b.quality - a.quality);

      groups.push({
        canonical_id: candidates[0].id,
        duplicate_ids: candidates.slice(1).map(c => c.id),
        detection_method: 'name_similarity',
        similarity: Math.round(dupes[0].similarity * 100) / 100,
      });
      used.add(rows[i].id);
    }
  }

  return groups;
}

/**
 * Detect duplicates by content fingerprint (hash of description + metadata keys).
 */
async function detectFingerprintDuplicates(db, limit) {
  const result = await db.query(
    `SELECT md5(COALESCE(description, '') || COALESCE(artifact_type, '')) AS fingerprint,
            array_agg(id ORDER BY quality_score DESC NULLS LAST) AS ids
     FROM artifacts
     WHERE description IS NOT NULL AND length(description) > 20
     GROUP BY md5(COALESCE(description, '') || COALESCE(artifact_type, ''))
     HAVING COUNT(*) > 1
     LIMIT $1`,
    [limit]
  );

  return result.rows.map(row => ({
    canonical_id: row.ids[0],
    duplicate_ids: row.ids.slice(1),
    detection_method: 'fingerprint',
    similarity: 0.95,
  }));
}

/**
 * Merge a duplicate group: keep canonical, mark duplicates.
 */
async function mergeGroup(db, group) {
  try {
    // Mark duplicates with a reference to the canonical
    for (const dupeId of group.duplicate_ids) {
      await db.query(
        `UPDATE artifacts
         SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || jsonb_build_object('duplicate_of', $1, 'merged_at', $2)
         WHERE id = $3`,
        [group.canonical_id, new Date().toISOString(), dupeId]
      );
    }
    return { merged: true };
  } catch {
    return { merged: false };
  }
}

/**
 * Normalized string similarity (case-insensitive Jaccard on word tokens).
 */
function normalizedSimilarity(a, b) {
  if (!a || !b) return 0;
  const tokensA = new Set(a.toLowerCase().split(/[\s\-_/]+/).filter(w => w.length > 1));
  const tokensB = new Set(b.toLowerCase().split(/[\s\-_/]+/).filter(w => w.length > 1));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deduplicate groups that share the same canonical ID.
 */
function deduplicateGroups(groups) {
  const byCanonical = new Map();
  for (const g of groups) {
    if (byCanonical.has(g.canonical_id)) {
      const existing = byCanonical.get(g.canonical_id);
      for (const id of g.duplicate_ids) {
        if (!existing.duplicate_ids.includes(id)) {
          existing.duplicate_ids.push(id);
        }
      }
      existing.similarity = Math.max(existing.similarity, g.similarity);
    } else {
      byCanonical.set(g.canonical_id, { ...g });
    }
  }
  return [...byCanonical.values()];
}

function countByField(arr, field) {
  const counts = {};
  for (const item of arr) {
    counts[item[field]] = (counts[item[field]] || 0) + 1;
  }
  return counts;
}

export { normalizedSimilarity, deduplicateGroups };

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Semantic Duplicate Detection & Canonical Selection.
 *
 * Uses pgvector cosine similarity to find near-duplicate artifacts,
 * groups them via Union-Find, selects a canonical artifact per group,
 * and creates see_also relation edges + dedup metadata.
 */

import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

// ── Union-Find (Disjoint Set) ───────────────────────────────────────────────

class UnionFind {
  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }

  find(x) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)));
    }
    return this.parent.get(x);
  }

  union(x, y) {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX === rootY) return;
    const rankX = this.rank.get(rootX);
    const rankY = this.rank.get(rootY);
    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }
}

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Query pgvector for cosine similarity >= threshold between artifact embeddings.
 * Groups artifacts into duplicate clusters using Union-Find.
 *
 * @param {object} db - The pg pool client
 * @param {number} limit - Maximum number of pairs to consider
 * @param {number} threshold - Minimum cosine similarity (0-1)
 * @returns {Promise<Array<Array<object>>>} Array of groups
 */
export async function findSemanticDuplicates(db, limit = 100, threshold = 0.92) {
  const result = await db.query(
    `SELECT a1.id as id1, a1.name as name1, a1.quality_score as quality1, a1.updated_at as updated1,
            a2.id as id2, a2.name as name2, a2.quality_score as quality2, a2.updated_at as updated2,
            1 - (a1.embedding <=> a2.embedding) as similarity
     FROM artifacts a1
     JOIN artifacts a2 ON a1.id < a2.id
     WHERE a1.embedding IS NOT NULL
       AND a2.embedding IS NOT NULL
       AND 1 - (a1.embedding <=> a2.embedding) >= $1
     LIMIT $2`,
    [threshold, limit]
  );

  if (result.rows.length === 0) {
    return [];
  }

  // Build Union-Find groups from pairs
  const uf = new UnionFind();
  const artifactData = new Map();

  for (const row of result.rows) {
    uf.union(row.id1, row.id2);

    // Store artifact info (keep best similarity seen)
    if (!artifactData.has(row.id1)) {
      artifactData.set(row.id1, {
        id: row.id1,
        name: row.name1,
        quality_score: row.quality1,
        updated_at: row.updated1,
        embedding_similarity: parseFloat(row.similarity),
      });
    } else {
      const existing = artifactData.get(row.id1);
      existing.embedding_similarity = Math.max(existing.embedding_similarity, parseFloat(row.similarity));
    }

    if (!artifactData.has(row.id2)) {
      artifactData.set(row.id2, {
        id: row.id2,
        name: row.name2,
        quality_score: row.quality2,
        updated_at: row.updated2,
        embedding_similarity: parseFloat(row.similarity),
      });
    } else {
      const existing = artifactData.get(row.id2);
      existing.embedding_similarity = Math.max(existing.embedding_similarity, parseFloat(row.similarity));
    }
  }

  // Collect groups by root
  const groupMap = new Map();
  for (const [id] of artifactData) {
    const root = uf.find(id);
    if (!groupMap.has(root)) {
      groupMap.set(root, []);
    }
    groupMap.get(root).push(artifactData.get(id));
  }

  // Only return groups with 2+ members
  return Array.from(groupMap.values()).filter(g => g.length >= 2);
}

/**
 * From a group of duplicates, pick the canonical artifact.
 * Highest quality_score wins; ties broken by most recent updated_at.
 *
 * @param {Array<object>} group - Array of artifact objects
 * @returns {object} The canonical artifact
 */
export function selectCanonical(group) {
  if (!group || group.length === 0) return null;
  if (group.length === 1) return group[0];

  return group.reduce((best, current) => {
    const bestScore = best.quality_score ?? 0;
    const currentScore = current.quality_score ?? 0;

    if (currentScore > bestScore) return current;
    if (currentScore < bestScore) return best;

    // Tiebreak by most recent updated_at
    const bestDate = best.updated_at ? new Date(best.updated_at).getTime() : 0;
    const currentDate = current.updated_at ? new Date(current.updated_at).getTime() : 0;
    return currentDate > bestDate ? current : best;
  });
}

/**
 * For each group, insert see_also relations from non-canonical to canonical,
 * and update artifact_duplicates with canonical_id and group_id.
 *
 * @param {object} db - The pg pool client
 * @param {Array<{canonical: object, members: Array<object>, group_id: string}>} groups
 * @returns {Promise<{links_created: number}>}
 */
export async function createSeeAlsoLinks(db, groups) {
  let links_created = 0;

  for (const group of groups) {
    const { canonical, members, group_id } = group;

    for (const member of members) {
      if (member.id === canonical.id) continue;

      // Insert see_also relation
      const relationResult = await db.query(
        `INSERT INTO artifact_relations (source_id, target_id, relation_type, confidence)
         VALUES ($1, $2, 'see_also', 0.9)
         ON CONFLICT DO NOTHING`,
        [member.id, canonical.id]
      );
      links_created += relationResult.rowCount || 0;

      // Update artifact_duplicates with canonical_id and group_id
      await db.query(
        `UPDATE artifact_duplicates
         SET canonical_id = $1, group_id = $2
         WHERE (original_id = $3 OR duplicate_id = $3)`,
        [canonical.id, group_id, member.id]
      );
    }
  }

  return { links_created };
}

/**
 * Orchestrate the full semantic dedup process.
 *
 * @param {object} db - The pg pool client
 * @param {number} limit - Max pairs to consider
 * @param {number} threshold - Minimum cosine similarity
 * @returns {Promise<{groups_found: number, canonical_selected: number, links_created: number}>}
 */
export async function runSemanticDedup(db, limit = 100, threshold = 0.92) {
  try {
    logger.info('Starting semantic dedup', { limit, threshold });

    // Step 1: Find duplicate groups
    const groups = await findSemanticDuplicates(db, limit, threshold);

    if (groups.length === 0) {
      logger.info('No semantic duplicates found');
      return { groups_found: 0, canonical_selected: 0, links_created: 0 };
    }

    // Step 2: Select canonicals and prepare groups
    const preparedGroups = groups.map(group => {
      const canonical = selectCanonical(group);
      return {
        canonical,
        members: group,
        group_id: crypto.randomUUID(),
      };
    });

    // Step 3: Create see_also links and update duplicates
    const { links_created } = await createSeeAlsoLinks(db, preparedGroups);

    const result = {
      groups_found: groups.length,
      canonical_selected: preparedGroups.length,
      links_created,
    };

    logger.info('Semantic dedup complete', result);
    return result;
  } catch (err) {
    logger.error('Semantic dedup failed', { error: err.message });
    throw err;
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #875 — Autonomous Knowledge Graph Maintenance
 *
 * Maintains the knowledge graph by pruning stale edges, discovering
 * new connections, and ensuring graph consistency.
 */

/**
 * Run knowledge graph maintenance cycle.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ pruned: number, created: number, summary: object }>}
 */
export async function maintainKnowledgeGraph(db, options = {}) {
  const maxAgeDays = options.maxAgeDays || 180;

  const pruned = await pruneStaleEdges(db, maxAgeDays);
  const orphans = await removeOrphanNodes(db);
  const newEdges = await discoverNewEdges(db, options.limit || 100);
  const consistency = await checkConsistency(db);

  return {
    pruned: pruned + orphans,
    created: newEdges,
    summary: {
      stale_edges_pruned: pruned,
      orphan_nodes_removed: orphans,
      new_edges_created: newEdges,
      consistency_issues: consistency.issues,
      maintained_at: new Date().toISOString(),
    },
  };
}

async function pruneStaleEdges(db, maxAgeDays) {
  try {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    const result = await db.query(
      `DELETE FROM artifact_relations
       WHERE created_at < $1
         AND relation_type NOT IN ('canonical', 'supersedes')
       RETURNING id`,
      [cutoff]
    );
    return result.rowCount || 0;
  } catch {
    return 0;
  }
}

async function removeOrphanNodes(db) {
  try {
    const result = await db.query(
      `DELETE FROM graph_nodes
       WHERE id NOT IN (SELECT DISTINCT source_node FROM graph_edges)
         AND id NOT IN (SELECT DISTINCT target_node FROM graph_edges)
       RETURNING id`
    );
    return result.rowCount || 0;
  } catch {
    return 0;
  }
}

async function discoverNewEdges(db, limit) {
  try {
    // Find artifacts that share tags but have no relation
    const result = await db.query(
      `SELECT a1.id AS source_id, a2.id AS target_id, a1.artifact_type
       FROM artifacts a1
       JOIN artifacts a2 ON a1.id < a2.id
         AND a1.artifact_type = a2.artifact_type
         AND a1.primary_category = a2.primary_category
       LEFT JOIN artifact_relations r
         ON (r.source_id = a1.id AND r.target_id = a2.id)
         OR (r.source_id = a2.id AND r.target_id = a1.id)
       WHERE r.id IS NULL
         AND a1.primary_category IS NOT NULL
       LIMIT $1`,
      [limit]
    );

    let created = 0;
    for (const row of result.rows) {
      try {
        await db.query(
          `INSERT INTO artifact_relations (source_id, target_id, relation_type, strength)
           VALUES ($1, $2, 'similar_category', 0.5)
           ON CONFLICT DO NOTHING`,
          [row.source_id, row.target_id]
        );
        created++;
      } catch {
        // Skip conflicts
      }
    }
    return created;
  } catch {
    return 0;
  }
}

async function checkConsistency(db) {
  const issues = [];
  try {
    // Check for self-referencing edges
    const selfRef = await db.query(
      `SELECT COUNT(*)::int AS count FROM artifact_relations WHERE source_id = target_id`
    );
    if (selfRef.rows[0]?.count > 0) {
      issues.push({ type: 'self_reference', count: selfRef.rows[0].count });
    }

    // Check for dangling references
    const dangling = await db.query(
      `SELECT COUNT(*)::int AS count FROM artifact_relations r
       LEFT JOIN artifacts a ON r.source_id = a.id
       WHERE a.id IS NULL`
    );
    if (dangling.rows[0]?.count > 0) {
      issues.push({ type: 'dangling_reference', count: dangling.rows[0].count });
    }
  } catch {
    // Tables may not exist
  }
  return { issues };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #875 — Knowledge Graph Maintenance
 *
 * Maintains the artifact relationship graph by pruning stale edges,
 * removing orphan nodes, discovering new relationships, and checking
 * graph consistency.
 */

const MAINTENANCE_OPS = ['pruneStaleEdges', 'removeOrphanNodes', 'discoverNewEdges', 'checkConsistency'];

/**
 * Run full graph maintenance cycle.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ results: object, summary: object }>}
 */
export async function maintainGraph(db, options = {}) {
  const ops = options.operations || MAINTENANCE_OPS;
  const results = {};

  for (const op of ops) {
    switch (op) {
      case 'pruneStaleEdges':
        results.pruned = await pruneStaleEdges(db, options.staleEdgeDays || 180);
        break;
      case 'removeOrphanNodes':
        results.orphans = await removeOrphanNodes(db);
        break;
      case 'discoverNewEdges':
        results.discovered = await discoverNewEdges(db, options.limit || 100);
        break;
      case 'checkConsistency':
        results.consistency = await checkConsistency(db);
        break;
    }
  }

  return {
    results,
    summary: {
      operations_run: ops,
      maintained_at: new Date().toISOString(),
    },
  };
}

async function pruneStaleEdges(db, staleEdgeDays) {
  try {
    const cutoff = new Date(Date.now() - staleEdgeDays * 86400000).toISOString();
    const result = await db.query(
      `DELETE FROM artifact_relations WHERE created_at < $1 RETURNING id`,
      [cutoff]
    );
    return { pruned: result.rowCount || 0 };
  } catch {
    return { pruned: 0, error: 'table_not_found' };
  }
}

async function removeOrphanNodes(db) {
  try {
    const result = await db.query(
      `DELETE FROM artifact_relations
       WHERE source_id NOT IN (SELECT id FROM artifacts)
          OR target_id NOT IN (SELECT id FROM artifacts)
       RETURNING id`
    );
    return { removed: result.rowCount || 0 };
  } catch {
    return { removed: 0, error: 'table_not_found' };
  }
}

async function discoverNewEdges(db, limit) {
  try {
    // Find artifacts with same tags that aren't yet related
    const result = await db.query(
      `SELECT a1.id AS source_id, a2.id AS target_id, a1.primary_category
       FROM artifacts a1
       JOIN artifacts a2 ON a1.primary_category = a2.primary_category
         AND a1.artifact_type = a2.artifact_type AND a1.id < a2.id
       LEFT JOIN artifact_relations r ON r.source_id = a1.id AND r.target_id = a2.id
       WHERE r.id IS NULL AND a1.primary_category IS NOT NULL
       LIMIT $1`,
      [limit]
    );

    let created = 0;
    for (const row of result.rows) {
      try {
        await db.query(
          `INSERT INTO artifact_relations (source_id, target_id, relation_type)
           VALUES ($1, $2, 'same_category')
           ON CONFLICT DO NOTHING`,
          [row.source_id, row.target_id]
        );
        created++;
      } catch { /* skip */ }
    }
    return { discovered: created };
  } catch {
    return { discovered: 0, error: 'table_not_found' };
  }
}

async function checkConsistency(db) {
  try {
    const result = await db.query(
      `SELECT COUNT(*)::int AS dangling
       FROM artifact_relations r
       LEFT JOIN artifacts a1 ON r.source_id = a1.id
       LEFT JOIN artifacts a2 ON r.target_id = a2.id
       WHERE a1.id IS NULL OR a2.id IS NULL`
    );
    return { dangling_edges: result.rows[0]?.dangling || 0 };
  } catch {
    return { dangling_edges: 0, error: 'table_not_found' };
  }
}

export { MAINTENANCE_OPS };

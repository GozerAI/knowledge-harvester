// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Comparative Snapshots — capture and diff aggregate DB state.
 *
 * Creates point-in-time snapshots of artifact statistics for
 * before/after comparisons across pipeline runs.
 */

/**
 * Create a snapshot of current aggregate artifact data.
 * @param {object} db
 * @param {string} label
 * @returns {Promise<object>} The created snapshot row
 */
export async function createSnapshot(db, label) {
  // Aggregate artifact counts by category and type
  const byCategoryType = await db.query(
    `SELECT primary_category, artifact_type, COUNT(*)::int AS count,
            ROUND(AVG(quality_score)::numeric, 2)::float AS avg_quality
     FROM artifacts
     GROUP BY primary_category, artifact_type
     ORDER BY primary_category, artifact_type`
  );

  // Total count
  const totalResult = await db.query('SELECT COUNT(*)::int AS total FROM artifacts');

  // Graph stats
  let graphNodes = 0;
  let graphEdges = 0;
  try {
    const nodeResult = await db.query('SELECT COUNT(*)::int AS count FROM graph_nodes');
    graphNodes = nodeResult.rows[0]?.count || 0;
    const edgeResult = await db.query('SELECT COUNT(*)::int AS count FROM graph_edges');
    graphEdges = edgeResult.rows[0]?.count || 0;
  } catch {
    // graph tables may not exist
  }

  const snapshotData = {
    total_artifacts: totalResult.rows[0]?.total || 0,
    by_category_type: byCategoryType.rows,
    graph: { nodes: graphNodes, edges: graphEdges },
  };

  const result = await db.query(
    `INSERT INTO snapshots (label, snapshot_data)
     VALUES ($1, $2)
     RETURNING *`,
    [label, JSON.stringify(snapshotData)]
  );

  return result.rows[0];
}

/**
 * Compare two snapshots and return a structured diff.
 * @param {object} db
 * @param {string} id1
 * @param {string} id2
 * @returns {Promise<object>} Structured diff
 */
export async function compareSnapshots(db, id1, id2) {
  const r1 = await db.query('SELECT * FROM snapshots WHERE id = $1', [id1]);
  const r2 = await db.query('SELECT * FROM snapshots WHERE id = $2', [id2]);

  if (r1.rows.length === 0 || r2.rows.length === 0) {
    return { error: 'One or both snapshots not found' };
  }

  const snap1 = typeof r1.rows[0].snapshot_data === 'string'
    ? JSON.parse(r1.rows[0].snapshot_data) : r1.rows[0].snapshot_data;
  const snap2 = typeof r2.rows[0].snapshot_data === 'string'
    ? JSON.parse(r2.rows[0].snapshot_data) : r2.rows[0].snapshot_data;

  return computeDiff(snap1, snap2);
}

/**
 * Compute a structured diff between two snapshot data objects.
 * @param {object} a - Before
 * @param {object} b - After
 * @returns {object}
 */
export function computeDiff(a, b) {
  const changes = {};
  const additions = {};
  const removals = {};

  // Compare top-level numeric fields
  const scalarFields = ['total_artifacts'];
  for (const field of scalarFields) {
    const va = a[field] ?? 0;
    const vb = b[field] ?? 0;
    if (va !== vb) {
      changes[field] = { before: va, after: vb, delta: vb - va };
    }
  }

  // Compare graph stats
  if (a.graph || b.graph) {
    const ga = a.graph || { nodes: 0, edges: 0 };
    const gb = b.graph || { nodes: 0, edges: 0 };
    if (ga.nodes !== gb.nodes) {
      changes['graph.nodes'] = { before: ga.nodes, after: gb.nodes, delta: gb.nodes - ga.nodes };
    }
    if (ga.edges !== gb.edges) {
      changes['graph.edges'] = { before: ga.edges, after: gb.edges, delta: gb.edges - ga.edges };
    }
  }

  // Compare by_category_type arrays
  const mapA = new Map();
  const mapB = new Map();
  for (const row of (a.by_category_type || [])) {
    mapA.set(`${row.primary_category}:${row.artifact_type}`, row);
  }
  for (const row of (b.by_category_type || [])) {
    mapB.set(`${row.primary_category}:${row.artifact_type}`, row);
  }

  for (const [key, rowB] of mapB) {
    if (!mapA.has(key)) {
      additions[key] = rowB;
    } else {
      const rowA = mapA.get(key);
      if (rowA.count !== rowB.count || rowA.avg_quality !== rowB.avg_quality) {
        changes[key] = {
          before: { count: rowA.count, avg_quality: rowA.avg_quality },
          after: { count: rowB.count, avg_quality: rowB.avg_quality },
          delta: { count: rowB.count - rowA.count },
        };
      }
    }
  }

  for (const [key] of mapA) {
    if (!mapB.has(key)) {
      removals[key] = mapA.get(key);
    }
  }

  return { additions, removals, changes };
}

/**
 * List all snapshots ordered by creation time (newest first).
 * @param {object} db
 * @returns {Promise<Array>}
 */
export async function listSnapshots(db) {
  const result = await db.query(
    'SELECT id, label, created_at FROM snapshots ORDER BY created_at DESC'
  );
  return result.rows;
}

/**
 * Get a single snapshot by ID.
 * @param {object} db
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getSnapshot(db, id) {
  const result = await db.query('SELECT * FROM snapshots WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Intelligence Graph store with node/edge CRUD and recursive traversal.
 *
 * Provides upsert semantics for nodes and edges, recursive CTE-based
 * graph walking, and full materialization from the artifact/relation tables.
 */

export async function upsertNode(pool, type, id, data = {}) {
  const label = data.label || data.name || id;
  const properties = { ...data };
  delete properties.label;
  delete properties.name;

  const result = await pool.query(
    `INSERT INTO graph_nodes (node_type, node_id, label, properties, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (node_type, node_id) DO UPDATE SET
       label = EXCLUDED.label,
       properties = graph_nodes.properties || EXCLUDED.properties,
       updated_at = NOW()
     RETURNING node_type, node_id, label, properties`,
    [type, id, label, JSON.stringify(properties)]
  );
  return result.rows[0];
}

function truncateLabel(value, maxLength = 180) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeNodeKey(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || null;
}

async function upsertEntityEdges(pool, ownerType, ownerId, values, targetType, edgeType) {
  const items = [...new Set((values || [])
    .map((value) => truncateLabel(value, 120))
    .filter(Boolean))];

  let nodesCreated = 0;
  let edgesCreated = 0;

  for (const item of items) {
    const nodeId = normalizeNodeKey(item);
    if (!nodeId) continue;
    await upsertNode(pool, targetType, nodeId, { label: item });
    await upsertEdge(pool, ownerType, ownerId, targetType, nodeId, edgeType, 0.8);
    nodesCreated++;
    edgesCreated++;
  }

  return { nodesCreated, edgesCreated };
}

async function upsertArtifactUnderstandingNodes(pool, artifact) {
  const typeMetadata = parseJsonObject(artifact.type_metadata);
  const understanding = parseJsonObject(typeMetadata.understanding);

  let nodesCreated = 0;
  let edgesCreated = 0;

  const mappings = [
    { values: understanding.cloud_services, targetType: 'cloud_service', edgeType: 'uses_cloud_service' },
    { values: understanding.integrations, targetType: 'integration', edgeType: 'integrates_with' },
    { values: understanding.problems_solved, targetType: 'problem', edgeType: 'solves' },
    { values: understanding.prerequisites, targetType: 'prerequisite', edgeType: 'requires' },
  ];

  for (const mapping of mappings) {
    const result = await upsertEntityEdges(pool, 'artifact', artifact.id, mapping.values, mapping.targetType, mapping.edgeType);
    nodesCreated += result.nodesCreated;
    edgesCreated += result.edgesCreated;
  }

  if (understanding.architecture_pattern && understanding.architecture_pattern !== 'unknown') {
    const result = await upsertEntityEdges(
      pool,
      'artifact',
      artifact.id,
      [understanding.architecture_pattern],
      'architecture_pattern',
      'follows_pattern',
    );
    nodesCreated += result.nodesCreated;
    edgesCreated += result.edgesCreated;
  }

  return { nodesCreated, edgesCreated };
}

async function upsertCategoryEdge(pool, ownerType, ownerId, category) {
  if (!category) return 0;
  await upsertNode(pool, 'category', category, { label: category });
  await upsertEdge(pool, ownerType, ownerId, 'category', category, 'belongs_to', 1.0);
  return 1;
}

async function upsertWorkflowNodes(pool) {
  const workflows = await pool.query(
    `SELECT id, workflow_name, source, tool_type, primary_category, tags, quality_score,
            node_count, trigger_type, language
     FROM workflows
     WHERE publishing_status IS NULL OR publishing_status != 'archived'
     LIMIT 5000`
  );

  let nodesCreated = 0;
  let edgesCreated = 0;

  for (const workflow of workflows.rows) {
    await upsertNode(pool, 'workflow', workflow.id, {
      label: workflow.workflow_name,
      source: workflow.source,
      tool_type: workflow.tool_type,
      category: workflow.primary_category,
      quality_score: workflow.quality_score,
      node_count: workflow.node_count,
      trigger_type: workflow.trigger_type,
      language: workflow.language,
      tags: workflow.tags || [],
    });
    nodesCreated++;
    edgesCreated += await upsertCategoryEdge(pool, 'workflow', workflow.id, workflow.primary_category);
  }

  return { nodesCreated, edgesCreated };
}

async function upsertSourceRecordNodes(pool) {
  const records = await pool.query(
    `SELECT id, source, run_id, source_url, item_name, item_kind, artifact_type, stored_kind,
            stored_id, decision, summary, discard_reason, metadata
     FROM source_records
     ORDER BY recorded_at DESC
     LIMIT 10000`
  );

  let nodesCreated = 0;
  let edgesCreated = 0;

  for (const record of records.rows) {
    await upsertNode(pool, 'source_record', record.id, {
      label: truncateLabel(record.item_name || record.summary || `${record.source || 'source'} record`),
      source: record.source,
      run_id: record.run_id,
      item_kind: record.item_kind,
      artifact_type: record.artifact_type,
      stored_kind: record.stored_kind,
      stored_id: record.stored_id,
      decision: record.decision,
      source_url: record.source_url,
      summary: record.summary,
      discard_reason: record.discard_reason,
      metadata: parseJsonObject(record.metadata),
    });
    nodesCreated++;

    if (record.stored_kind === 'artifact' && record.stored_id) {
      await upsertEdge(pool, 'source_record', record.id, 'artifact', record.stored_id, 'recorded_as', 1.0, {
        decision: record.decision,
      });
      edgesCreated++;
    }
    if (record.stored_kind === 'workflow' && record.stored_id) {
      await upsertEdge(pool, 'source_record', record.id, 'workflow', record.stored_id, 'recorded_as', 1.0, {
        decision: record.decision,
      });
      edgesCreated++;
    }
  }

  return { nodesCreated, edgesCreated };
}

async function upsertClaimNodes(pool) {
  const claims = await pool.query(
    `SELECT id, claim_text, claim_type, status, confidence, subject_type, subject_id,
            artifact_id, workflow_id, source_record_id, summary, metadata
     FROM knowledge_claims
     WHERE status != 'archived'
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 10000`
  );

  let nodesCreated = 0;
  let edgesCreated = 0;

  for (const claim of claims.rows) {
    await upsertNode(pool, 'claim', claim.id, {
      label: truncateLabel(claim.summary || claim.claim_text),
      claim_type: claim.claim_type,
      status: claim.status,
      confidence: claim.confidence,
      subject_type: claim.subject_type,
      subject_id: claim.subject_id,
      summary: claim.summary,
      metadata: parseJsonObject(claim.metadata),
    });
    nodesCreated++;

    if (claim.artifact_id) {
      await upsertEdge(pool, 'claim', claim.id, 'artifact', claim.artifact_id, 'about', Number(claim.confidence) || 0.5, {
        subject_type: claim.subject_type,
      });
      edgesCreated++;
    }
    if (claim.workflow_id) {
      await upsertEdge(pool, 'claim', claim.id, 'workflow', claim.workflow_id, 'about', Number(claim.confidence) || 0.5, {
        subject_type: claim.subject_type,
      });
      edgesCreated++;
    }
    if (claim.source_record_id) {
      await upsertEdge(pool, 'claim', claim.id, 'source_record', claim.source_record_id, 'sourced_from', Number(claim.confidence) || 0.5);
      edgesCreated++;
    }
  }

  return { nodesCreated, edgesCreated };
}

async function upsertClaimEvidenceNodes(pool) {
  const evidence = await pool.query(
    `SELECT id, claim_id, evidence_role, artifact_id, workflow_id, source_record_id,
            source_url, excerpt, confidence, metadata
     FROM claim_evidence
     ORDER BY created_at DESC
     LIMIT 20000`
  );

  let nodesCreated = 0;
  let edgesCreated = 0;

  for (const item of evidence.rows) {
    await upsertNode(pool, 'claim_evidence', item.id, {
      label: truncateLabel(item.excerpt || item.source_url || `${item.evidence_role} evidence`),
      evidence_role: item.evidence_role,
      confidence: item.confidence,
      source_url: item.source_url,
      excerpt: item.excerpt,
      metadata: parseJsonObject(item.metadata),
    });
    nodesCreated++;

    await upsertEdge(pool, 'claim_evidence', item.id, 'claim', item.claim_id, item.evidence_role, Number(item.confidence) || 0.5);
    edgesCreated++;

    if (item.artifact_id) {
      await upsertEdge(pool, 'claim_evidence', item.id, 'artifact', item.artifact_id, 'references', Number(item.confidence) || 0.5);
      edgesCreated++;
    }
    if (item.workflow_id) {
      await upsertEdge(pool, 'claim_evidence', item.id, 'workflow', item.workflow_id, 'references', Number(item.confidence) || 0.5);
      edgesCreated++;
    }
    if (item.source_record_id) {
      await upsertEdge(pool, 'claim_evidence', item.id, 'source_record', item.source_record_id, 'references', Number(item.confidence) || 0.5);
      edgesCreated++;
    }
  }

  return { nodesCreated, edgesCreated };
}

export async function upsertEdge(pool, srcType, srcId, tgtType, tgtId, edgeType, weight = 1.0, meta = {}) {
  const result = await pool.query(
    `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type, weight, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (source_type, source_id, target_type, target_id, edge_type) DO UPDATE SET
       weight = EXCLUDED.weight,
       metadata = graph_edges.metadata || EXCLUDED.metadata
     RETURNING id, source_type, source_id, target_type, target_id, edge_type, weight`,
    [srcType, srcId, tgtType, tgtId, edgeType, weight, JSON.stringify(meta)]
  );
  return result.rows[0];
}

export async function getNode(pool, type, id) {
  const result = await pool.query(
    'SELECT node_type, node_id, label, properties, created_at, updated_at FROM graph_nodes WHERE node_type = $1 AND node_id = $2',
    [type, id]
  );
  return result.rows[0] || null;
}

export async function queryGraph(pool, startType, startId, edgeTypes = [], depth = 2) {
  const edgeFilter = edgeTypes.length > 0
    ? `AND e.edge_type = ANY($3)`
    : '';

  const params = [startType, startId];
  if (edgeTypes.length > 0) params.push(edgeTypes);

  const depthParam = `$${params.length + 1}`;
  params.push(depth);

  const result = await pool.query(
    `WITH RECURSIVE graph_walk AS (
       -- Start node
       SELECT
         n.node_type, n.node_id, n.label, n.properties,
         0 as depth,
         ARRAY[n.node_type || ':' || n.node_id] as path
       FROM graph_nodes n
       WHERE n.node_type = $1 AND n.node_id = $2

       UNION ALL

       -- Walk edges
       SELECT
         n2.node_type, n2.node_id, n2.label, n2.properties,
         gw.depth + 1,
         gw.path || (n2.node_type || ':' || n2.node_id)
       FROM graph_walk gw
       JOIN graph_edges e ON
         (e.source_type = gw.node_type AND e.source_id = gw.node_id)
         OR (e.target_type = gw.node_type AND e.target_id = gw.node_id)
       JOIN graph_nodes n2 ON
         (n2.node_type = e.target_type AND n2.node_id = e.target_id AND NOT (e.target_type = gw.node_type AND e.target_id = gw.node_id))
         OR (n2.node_type = e.source_type AND n2.node_id = e.source_id AND NOT (e.source_type = gw.node_type AND e.source_id = gw.node_id))
       WHERE gw.depth < ${depthParam}
         AND NOT (n2.node_type || ':' || n2.node_id) = ANY(gw.path)
         ${edgeFilter}
     )
     SELECT DISTINCT node_type, node_id, label, properties, depth
     FROM graph_walk
     ORDER BY depth, node_type, node_id`,
    params
  );

  return result.rows;
}

export async function getGraphSubgraph(pool, startType, startId, edgeTypes = [], depth = 2) {
  const nodes = await queryGraph(pool, startType, startId, edgeTypes, depth);
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodeKeys = nodes.map((node) => `${node.node_type}:${node.node_id}`);
  const params = [nodeKeys];
  let edgeFilter = '';
  if (edgeTypes.length > 0) {
    params.push(edgeTypes);
    edgeFilter = `AND edge_type = ANY($2)`;
  }

  const edgeResult = await pool.query(
    `SELECT id, source_type, source_id, target_type, target_id, edge_type, weight, metadata
     FROM graph_edges
     WHERE (source_type || ':' || source_id) = ANY($1)
       AND (target_type || ':' || target_id) = ANY($1)
       ${edgeFilter}
     ORDER BY edge_type ASC, source_type ASC, source_id ASC, target_type ASC, target_id ASC`,
    params,
  );

  return {
    nodes,
    edges: edgeResult.rows,
  };
}

export async function materializeGraph(pool) {
  let nodesCreated = 0;
  let edgesCreated = 0;

  // 1. Create nodes from artifacts
  const artifacts = await pool.query(
    `SELECT id, name, artifact_type, primary_category, tags, quality_score, type_metadata
     FROM artifacts WHERE publishing_status IS NULL OR publishing_status != 'archived'
     LIMIT 5000`
  );

  for (const a of artifacts.rows) {
    await upsertNode(pool, 'artifact', a.id, {
      label: a.name,
      artifact_type: a.artifact_type,
      category: a.primary_category,
      quality_score: a.quality_score,
    });
    nodesCreated++;

    // Create category node and edge
    edgesCreated += await upsertCategoryEdge(pool, 'artifact', a.id, a.primary_category);

    const understandingResult = await upsertArtifactUnderstandingNodes(pool, a);
    nodesCreated += understandingResult.nodesCreated;
    edgesCreated += understandingResult.edgesCreated;
  }

  // 2. Create edges from artifact_relations
  const relations = await pool.query(
    `SELECT source_id, target_id, relation_type, confidence
     FROM artifact_relations LIMIT 10000`
  );

  for (const r of relations.rows) {
    await upsertEdge(pool, 'artifact', r.source_id, 'artifact', r.target_id, r.relation_type, parseFloat(r.confidence) || 0.5);
    edgesCreated++;
  }

  const workflowResult = await upsertWorkflowNodes(pool);
  nodesCreated += workflowResult.nodesCreated;
  edgesCreated += workflowResult.edgesCreated;

  const sourceRecordResult = await upsertSourceRecordNodes(pool);
  nodesCreated += sourceRecordResult.nodesCreated;
  edgesCreated += sourceRecordResult.edgesCreated;

  const claimResult = await upsertClaimNodes(pool);
  nodesCreated += claimResult.nodesCreated;
  edgesCreated += claimResult.edgesCreated;

  const evidenceResult = await upsertClaimEvidenceNodes(pool);
  nodesCreated += evidenceResult.nodesCreated;
  edgesCreated += evidenceResult.edgesCreated;

  return { nodes_created: nodesCreated, edges_created: edgesCreated };
}

export async function getNeighborEdges(pool, type, id) {
  const result = await pool.query(
    `SELECT id, source_type, source_id, target_type, target_id, edge_type, weight, metadata
     FROM graph_edges
     WHERE (source_type = $1 AND source_id = $2)
        OR (target_type = $1 AND target_id = $2)`,
    [type, id]
  );
  return result.rows;
}

export async function batchUpsertNodes(pool, nodes) {
  let created = 0;
  for (const node of nodes) {
    await upsertNode(pool, node.type, node.id, node.data || {});
    created++;
  }
  return { created };
}

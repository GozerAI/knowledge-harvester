// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from './client.js';
import { buildWorkflowSourceSummary, createSourceRecordSafely } from './source-record-store.js';

/**
 * Store a normalized workflow in the database.
 * Uses ON CONFLICT to handle re-discoveries gracefully.
 *
 * @param {object} w - Normalized workflow object from normalizer.js
 */
export async function storeWorkflow(w) {
  const sql = `
    INSERT INTO workflows (
      id, hash, source, source_url, source_id,
      discovered_at, updated_at,
      workflow_json, workflow_name, original_description,
      author_username, author_profile_url,
      node_types, node_count, trigger_type,
      credentials_required, has_code_node, estimated_complexity,
      primary_category, secondary_categories, tags,
      quality_score, has_description, has_documentation,
      is_complete, validation_status, publishing_status,
      tool_type, tool_metadata, language
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7,
      $8, $9, $10,
      $11, $12,
      $13, $14, $15,
      $16, $17, $18,
      $19, $20, $21,
      $22, $23, $24,
      $25, $26, $27,
      $28, $29, $30
    )
    ON CONFLICT (hash) DO UPDATE SET updated_at = NOW()
  `;

  const params = [
    w.id,                                           // $1
    w.hash,                                         // $2
    w.source,                                       // $3
    w.source_url,                                   // $4
    w.source_id,                                    // $5
    w.discovered_at,                                // $6
    w.updated_at,                                   // $7
    JSON.stringify(w.workflow_json),                 // $8  JSONB
    w.workflow_name,                                // $9
    w.original_description || '',                   // $10
    w.author?.username || null,                     // $11
    w.author?.profile_url || null,                  // $12
    w.metadata.node_types,                          // $13 TEXT[]
    w.metadata.node_count,                          // $14
    w.metadata.trigger_type,                        // $15
    w.metadata.credentials_required,                // $16 TEXT[]
    w.metadata.has_code_node,                       // $17
    w.metadata.estimated_complexity,                // $18
    null,                                           // $19 primary_category (set by classifier)
    '{}',                                           // $20 secondary_categories
    '{}',                                           // $21 tags
    w.quality.score,                                // $22
    w.quality.has_description,                      // $23
    w.quality.has_documentation,                    // $24
    w.quality.is_complete,                          // $25
    w.quality.validation_status,                    // $26
    'raw',                                          // $27 publishing_status
    w.tool_type || 'n8n',                           // $28 tool_type
    JSON.stringify(w.tool_metadata || {}),           // $29 tool_metadata JSONB
    w.language || null,                             // $30 language
  ];

  await db.query(sql, params);
  await createSourceRecordSafely({
    source: w.source,
    runId: w.runId || null,
    sourceUrl: w.source_url,
    sourceId: w.source_id,
    contentHash: w.hash,
    itemName: w.workflow_name,
    itemKind: 'workflow',
    artifactType: 'workflow',
    storedKind: 'workflow',
    storedId: w.id,
    decision: 'accepted',
    summary: buildWorkflowSourceSummary(w),
    metadata: {
      tool_type: w.tool_type || null,
      node_count: w.metadata?.node_count || 0,
      trigger_type: w.metadata?.trigger_type || null,
      quality_score: w.quality?.score || 0,
    },
  });
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { materializeGraph } from '../../src/db/graph-store.js';

function createGraphDb({
  artifacts = [],
  relations = [],
  workflows = [],
  sourceRecords = [],
  claims = [],
  evidence = [],
} = {}) {
  const nodeCalls = [];
  const edgeCalls = [];

  return {
    nodeCalls,
    edgeCalls,
    async query(sql, params = []) {
      if (sql.includes('FROM artifacts WHERE publishing_status')) {
        return { rows: artifacts };
      }
      if (sql.includes('FROM artifact_relations')) {
        return { rows: relations };
      }
      if (sql.includes('FROM workflows')) {
        return { rows: workflows };
      }
      if (sql.includes('FROM source_records')) {
        return { rows: sourceRecords };
      }
      if (sql.includes('FROM knowledge_claims')) {
        return { rows: claims };
      }
      if (sql.includes('FROM claim_evidence')) {
        return { rows: evidence };
      }
      if (sql.includes('INSERT INTO graph_nodes')) {
        nodeCalls.push(params);
        return {
          rows: [{
            node_type: params[0],
            node_id: params[1],
            label: params[2],
            properties: params[3],
          }],
        };
      }
      if (sql.includes('INSERT INTO graph_edges')) {
        edgeCalls.push(params);
        return {
          rows: [{
            source_type: params[0],
            source_id: params[1],
            target_type: params[2],
            target_id: params[3],
            edge_type: params[4],
            weight: params[5],
          }],
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

describe('graph-store materialization', () => {
  it('materializes workflows, source records, claims, and evidence into the graph', async () => {
    const artifactId = randomUUID();
    const workflowId = randomUUID();
    const sourceRecordId = randomUUID();
    const claimId = randomUUID();
    const evidenceId = randomUUID();

    const db = createGraphDb({
      artifacts: [{
        id: artifactId,
        name: 'Incident Runbook',
        artifact_type: 'documentation',
        primary_category: 'operations',
        quality_score: 82,
        type_metadata: {
          understanding: {
            cloud_services: ['AWS Lambda'],
            integrations: ['PagerDuty'],
            problems_solved: ['incident coordination'],
            prerequisites: ['Slack workspace'],
            architecture_pattern: 'event-driven',
          },
        },
      }],
      relations: [{
        source_id: artifactId,
        target_id: workflowId,
        relation_type: 'pairs_with',
        confidence: '0.7',
      }],
      workflows: [{
        id: workflowId,
        workflow_name: 'Pager Escalation Flow',
        source: 'ops',
        tool_type: 'workflow',
        primary_category: 'operations',
        tags: ['incident'],
        quality_score: 77,
        node_count: 6,
        trigger_type: 'manual',
        language: 'yaml',
      }],
      sourceRecords: [{
        id: sourceRecordId,
        source: 'runbooks',
        run_id: randomUUID(),
        source_url: 'https://example.com/runbook',
        item_name: 'Incident Response v2',
        item_kind: 'artifact',
        artifact_type: 'documentation',
        stored_kind: 'artifact',
        stored_id: artifactId,
        decision: 'accepted',
        summary: 'Accepted runbook with rollback guidance.',
        discard_reason: null,
        metadata: { quality_score: 82 },
      }],
      claims: [{
        id: claimId,
        claim_text: 'Incident runbooks should include rollback steps.',
        claim_type: 'policy',
        status: 'accepted',
        confidence: 0.91,
        subject_type: 'artifact',
        subject_id: artifactId,
        artifact_id: artifactId,
        workflow_id: null,
        source_record_id: sourceRecordId,
        summary: 'Runbooks should include rollback steps.',
        metadata: { extracted_from: 'summary' },
      }],
      evidence: [{
        id: evidenceId,
        claim_id: claimId,
        evidence_role: 'supports',
        artifact_id: null,
        workflow_id: workflowId,
        source_record_id: sourceRecordId,
        source_url: 'https://example.com/runbook#rollback',
        excerpt: 'Step 8 covers rollback and recovery.',
        confidence: 0.88,
        metadata: { extractor: 'heuristic' },
      }],
    });

    const result = await materializeGraph(db);

    assert.equal(result.nodes_created, 10);
    assert.equal(result.edges_created, 14);

    const insertedNodeTypes = db.nodeCalls.map((params) => params[0]);
    assert.ok(insertedNodeTypes.includes('workflow'));
    assert.ok(insertedNodeTypes.includes('source_record'));
    assert.ok(insertedNodeTypes.includes('claim'));
    assert.ok(insertedNodeTypes.includes('claim_evidence'));
    assert.ok(insertedNodeTypes.includes('cloud_service'));
    assert.ok(insertedNodeTypes.includes('integration'));
    assert.ok(insertedNodeTypes.includes('problem'));
    assert.ok(insertedNodeTypes.includes('prerequisite'));
    assert.ok(insertedNodeTypes.includes('architecture_pattern'));

    const edgeKeys = db.edgeCalls.map((params) => `${params[0]}:${params[2]}:${params[4]}`);
    assert.ok(edgeKeys.includes('source_record:artifact:recorded_as'));
    assert.ok(edgeKeys.includes('claim:artifact:about'));
    assert.ok(edgeKeys.includes('claim:source_record:sourced_from'));
    assert.ok(edgeKeys.includes('claim_evidence:claim:supports'));
    assert.ok(edgeKeys.includes('claim_evidence:source_record:references'));
    assert.ok(edgeKeys.includes('claim_evidence:workflow:references'));
    assert.ok(edgeKeys.includes('artifact:cloud_service:uses_cloud_service'));
    assert.ok(edgeKeys.includes('artifact:integration:integrates_with'));
    assert.ok(edgeKeys.includes('artifact:problem:solves'));
    assert.ok(edgeKeys.includes('artifact:prerequisite:requires'));
    assert.ok(edgeKeys.includes('artifact:architecture_pattern:follows_pattern'));
  });

  it('still handles an empty provenance layer without failing', async () => {
    const db = createGraphDb();

    const result = await materializeGraph(db);

    assert.equal(result.nodes_created, 0);
    assert.equal(result.edges_created, 0);
    assert.equal(db.nodeCalls.length, 0);
    assert.equal(db.edgeCalls.length, 0);
  });
});

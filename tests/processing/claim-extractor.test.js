// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  buildClaimCandidate,
  buildClaimEvidence,
  inferClaimType,
  batchExtractClaims,
} from '../../src/processing/claim-extractor.js';

describe('claim-extractor', () => {
  it('infers policy claims from control-oriented summaries', () => {
    const claimType = inferClaimType(
      {
        artifact_type: 'documentation',
        item_name: 'Security Policy',
      },
      'Security controls must be reviewed quarterly.',
    );

    assert.equal(claimType, 'policy');
  });

  it('builds workflow-oriented claim candidates', () => {
    const workflowId = randomUUID();
    const candidate = buildClaimCandidate({
      id: randomUUID(),
      source: 'ops',
      item_name: 'Escalation Flow',
      item_kind: 'workflow',
      artifact_type: 'workflow',
      stored_kind: 'workflow',
      stored_id: workflowId,
      decision: 'accepted',
      summary: 'Escalation Flow | workflow | Routes incidents through PagerDuty and Slack',
    });

    assert.equal(candidate.claimType, 'process');
    assert.equal(candidate.workflowId, workflowId);
    assert.equal(candidate.subjectType, 'workflow');
    assert.match(candidate.claimText, /Routes incidents through PagerDuty and Slack\./);
  });

  it('builds evidence from source record summaries', () => {
    const sourceRecordId = randomUUID();
    const evidence = buildClaimEvidence({
      id: sourceRecordId,
      source: 'runbooks',
      source_url: 'https://example.com/runbook',
      item_name: 'Rollback Runbook',
      summary: 'Rollback Runbook | documentation | Includes rollback and verification steps',
      stored_kind: 'artifact',
      stored_id: randomUUID(),
    }, 0.8);

    assert.equal(evidence.evidenceRole, 'supports');
    assert.equal(evidence.sourceRecordId, sourceRecordId);
    assert.match(evidence.excerpt, /Includes rollback and verification steps/);
  });

  it('extracts and persists claims from accepted source records', async () => {
    const sourceRecordId = randomUUID();
    const calls = [];
    const database = {
      async query(sql, params) {
        calls.push({ sql, params });

        if (sql.includes('FROM source_records sr')) {
          return {
            rows: [{
              id: sourceRecordId,
              source: 'runbooks',
              source_url: 'https://example.com/runbook',
              item_name: 'Incident Playbook',
              item_kind: 'artifact',
              artifact_type: 'documentation',
              stored_kind: 'artifact',
              stored_id: randomUUID(),
              decision: 'accepted',
              summary: 'Incident Playbook | documentation | Should include rollback steps for failed deploys',
            }],
          };
        }

        if (sql.includes('INSERT INTO knowledge_claims')) {
          return {
            rows: [{
              id: params[0],
              source_record_id: params[9],
              claim_text: params[1],
            }],
          };
        }

        if (sql.includes('INSERT INTO claim_evidence')) {
          return {
            rows: [{
              id: params[0],
              claim_id: params[1],
              source_record_id: params[5],
            }],
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    const result = await batchExtractClaims(database, 10);

    assert.equal(result.processed, 1);
    assert.equal(result.created, 1);
    assert.equal(result.evidence_created, 1);
    assert.equal(result.failed, 0);
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO knowledge_claims')));
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO claim_evidence')));
  });

  it('skips records that cannot produce a claim candidate', async () => {
    const database = {
      async query(sql) {
        if (sql.includes('FROM source_records sr')) {
          return {
            rows: [{
              id: randomUUID(),
              source: 'runbooks',
              source_url: null,
              item_name: null,
              item_kind: 'artifact',
              artifact_type: 'documentation',
              stored_kind: null,
              stored_id: null,
              decision: 'accepted',
              summary: null,
            }],
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    const result = await batchExtractClaims(database, 10);

    assert.equal(result.processed, 1);
    assert.equal(result.created, 0);
    assert.equal(result.skipped, 1);
  });
});

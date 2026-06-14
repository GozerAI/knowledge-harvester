// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { createClaimHandlers } from '../../src/api/claim-routes.js';

function makeParams(values = {}) {
  return new URLSearchParams(values);
}

function createResponseRecorder() {
  const writes = [];
  return {
    writes,
    writeHead(status, headers) {
      writes.push({ status, headers });
    },
    end(body) {
      try {
        writes.push({ body: JSON.parse(body) });
      } catch {
        writes.push({ raw: body });
      }
    },
  };
}

function makeJsonRequest(body) {
  return Readable.from([Buffer.from(JSON.stringify(body))]);
}

describe('claim routes', () => {
  it('lists claims', async () => {
    const handlers = createClaimHandlers({
      database: {
        async query(sql) {
          if (sql.startsWith('SELECT COUNT(*)::int AS count FROM knowledge_claims')) {
            return { rows: [{ count: 1 }] };
          }

          return {
            rows: [{
              id: '123e4567-e89b-12d3-a456-426614174000',
              claim_text: 'Operational runbooks should include rollback steps.',
              status: 'accepted',
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleListClaims({}, res, makeParams({ status: 'accepted' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.total, 1);
    assert.equal(res.writes[1].body.claims[0].status, 'accepted');
  });

  it('rejects invalid source_record_id filters', async () => {
    const handlers = createClaimHandlers({
      database: {
        async query() {
          throw new Error('should not be called');
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleListClaims({}, res, makeParams({ source_record_id: 'bad-id' }));

    assert.equal(res.writes[0].status, 400);
    assert.equal(res.writes[1].body.error, 'source_record_id must be a valid UUID');
  });

  it('gets claim details', async () => {
    const claimId = '123e4567-e89b-12d3-a456-426614174000';
    const handlers = createClaimHandlers({
      database: {
        async query(sql) {
          if (sql.includes('FROM knowledge_claims')) {
            return {
              rows: [{
                id: claimId,
                claim_text: 'Policies need traceable evidence.',
                status: 'candidate',
              }],
            };
          }

          return {
            rows: [{
              id: '223e4567-e89b-12d3-a456-426614174000',
              claim_id: claimId,
              evidence_role: 'supports',
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleGetClaim({}, res, makeParams({ evidence_limit: '5' }), claimId);

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.claim.id, claimId);
    assert.equal(res.writes[1].body.evidence.length, 1);
  });

  it('returns claim summaries', async () => {
    const handlers = createClaimHandlers({
      database: {
        async query(sql) {
          if (sql.includes('AS total')) return { rows: [{ total: 3 }] };
          if (sql.includes('GROUP BY status')) return { rows: [{ status: 'candidate', count: 2 }] };
          if (sql.includes('GROUP BY claim_type')) return { rows: [{ claim_type: 'policy', count: 1 }] };
          if (sql.includes('needs_review')) {
            return {
              rows: [{
                needs_review: 2,
                disputed: 1,
                accepted_without_support: 0,
                contradicted: 1,
              }],
            };
          }
          return { rows: [{ subject_type: 'artifact', count: 3 }] };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleClaimSummary({}, res, makeParams({ status: 'candidate' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.total, 3);
    assert.equal(res.writes[1].body.by_status[0].status, 'candidate');
  });

  it('returns the claim review queue', async () => {
    const handlers = createClaimHandlers({
      database: {
        async query(sql) {
          if (sql.startsWith('SELECT COUNT(*)::int AS count')) {
            return { rows: [{ count: 1 }] };
          }

          return {
            rows: [{
              id: '123e4567-e89b-12d3-a456-426614174000',
              status: 'disputed',
              claim_type: 'policy',
              contradicts_count: 1,
              supports_count: 0,
              review_priority: 0,
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleClaimQueue({}, res, makeParams({ status: 'disputed' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.total, 1);
    assert.equal(res.writes[1].body.claims[0].review_priority, 0);
  });

  it('creates a claim', async () => {
    const handlers = createClaimHandlers({
      database: {
        async query(_sql, params) {
          return {
            rows: [{
              id: params[0],
              claim_text: params[1],
              claim_type: params[2],
              status: params[3],
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleCreateClaim(
      makeJsonRequest({
        claim_text: 'Audit controls should map back to source evidence.',
        claim_type: 'policy',
        status: 'accepted',
      }),
      res,
    );

    assert.equal(res.writes[0].status, 201);
    assert.equal(res.writes[1].body.claim_type, 'policy');
    assert.equal(res.writes[1].body.status, 'accepted');
  });

  it('runs claim extraction', async () => {
    const handlers = createClaimHandlers({
      database: {
        async query(sql, params) {
          if (sql.includes('FROM source_records sr')) {
            return {
              rows: [{
                id: '123e4567-e89b-12d3-a456-426614174000',
                source: 'runbooks',
                source_url: 'https://example.com/runbook',
                item_name: 'Rollback Guide',
                item_kind: 'artifact',
                artifact_type: 'documentation',
                stored_kind: 'artifact',
                stored_id: '223e4567-e89b-12d3-a456-426614174000',
                decision: 'accepted',
                summary: 'Rollback Guide | documentation | Should include rollback steps',
              }],
            };
          }
          if (sql.includes('INSERT INTO knowledge_claims')) {
            return { rows: [{ id: params[0], source_record_id: params[9] }] };
          }
          if (sql.includes('INSERT INTO claim_evidence')) {
            return { rows: [{ id: params[0], claim_id: params[1] }] };
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleExtractClaims({}, res, makeParams({ limit: '5' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.created, 1);
    assert.equal(res.writes[1].body.evidence_created, 1);
  });

  it('updates a claim', async () => {
    const claimId = '123e4567-e89b-12d3-a456-426614174000';
    const handlers = createClaimHandlers({
      database: {
        async query(sql, params) {
          if (sql.includes('UPDATE knowledge_claims')) {
            return {
              rows: [{
                id: params.at(-1),
                status: 'accepted',
                confidence: 0.93,
              }],
            };
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleUpdateClaim(
      makeJsonRequest({
        status: 'accepted',
        confidence: 0.93,
        metadata: { reviewer: 'cli' },
      }),
      res,
      makeParams(),
      claimId,
    );

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.status, 'accepted');
    assert.equal(res.writes[1].body.confidence, 0.93);
  });

  it('rejects invalid claim payloads', async () => {
    const handlers = createClaimHandlers({
      database: {
        async query() {
          throw new Error('should not be called');
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleCreateClaim(
      makeJsonRequest({
        claim_text: 'Bad IDs should be rejected.',
        artifact_id: 'bad-id',
      }),
      res,
    );

    assert.equal(res.writes[0].status, 400);
    assert.equal(res.writes[1].body.error, 'Validation failed');
    assert.match(res.writes[1].body.errors[0], /artifact_id/);
  });

  it('adds evidence to an existing claim', async () => {
    const claimId = '123e4567-e89b-12d3-a456-426614174000';
    const handlers = createClaimHandlers({
      database: {
        async query(sql, params) {
          if (sql.includes('FROM knowledge_claims')) {
            return {
              rows: [{
                id: claimId,
                claim_text: 'Customer onboarding should include rollback support.',
              }],
            };
          }
          if (sql.includes('FROM claim_evidence')) {
            return { rows: [] };
          }

          return {
            rows: [{
              id: params[0],
              claim_id: params[1],
              evidence_role: params[2],
              source_url: params[6],
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleAddClaimEvidence(
      makeJsonRequest({
        evidence_role: 'supports',
        source_url: 'https://example.com/source',
        excerpt: 'Rollback is documented in step 8.',
      }),
      res,
      makeParams(),
      claimId,
    );

    assert.equal(res.writes[0].status, 201);
    assert.equal(res.writes[1].body.claim_id, claimId);
    assert.equal(res.writes[1].body.evidence_role, 'supports');
  });

  it('rejects evidence without a reference field', async () => {
    const claimId = '123e4567-e89b-12d3-a456-426614174000';
    const handlers = createClaimHandlers({
      database: {
        async query() {
          throw new Error('should not be called');
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleAddClaimEvidence(
      makeJsonRequest({
        evidence_role: 'supports',
      }),
      res,
      makeParams(),
      claimId,
    );

    assert.equal(res.writes[0].status, 400);
    assert.equal(res.writes[1].body.error, 'Validation failed');
    assert.match(res.writes[1].body.errors[0], /reference field/);
  });
});

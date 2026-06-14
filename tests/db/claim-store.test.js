// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeClaimFilters,
  createClaim,
  addClaimEvidence,
  updateClaim,
  listClaims,
  listClaimQueue,
  summarizeClaims,
  getClaimDetails,
} from '../../src/db/claim-store.js';

describe('claim-store', () => {
  it('normalizes claim filters', () => {
    const filters = normalizeClaimFilters({
      status: 'ACCEPTED',
      claimType: 'FACT',
      subjectType: 'Artifact',
      subjectId: 'artifact:123',
      sourceRecordId: '123e4567-e89b-12d3-a456-426614174000',
      limit: '999',
      offset: '-4',
    });

    assert.equal(filters.status, 'accepted');
    assert.equal(filters.claimType, 'fact');
    assert.equal(filters.subjectType, 'artifact');
    assert.equal(filters.subjectId, 'artifact:123');
    assert.equal(filters.sourceRecordId, '123e4567-e89b-12d3-a456-426614174000');
    assert.equal(filters.limit, 100);
    assert.equal(filters.offset, 0);
  });

  it('creates a claim', async () => {
    const calls = [];
    const database = {
      async query(sql, params) {
        calls.push({ sql, params });
        return {
          rows: [{
            id: params[0],
            claim_text: params[1],
            claim_type: params[2],
            status: params[3],
          }],
        };
      },
    };

    const result = await createClaim(database, {
      claimText: 'Webhook workflows depend on signed payload validation.',
      claimType: 'fact',
      status: 'accepted',
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].sql.includes('INSERT INTO knowledge_claims'));
    assert.equal(result.claim_text, 'Webhook workflows depend on signed payload validation.');
    assert.equal(result.status, 'accepted');
  });

  it('rejects empty claim text before querying', async () => {
    const database = {
      async query() {
        throw new Error('should not be called');
      },
    };

    await assert.rejects(
      () => createClaim(database, { claimText: '   ' }),
      /claimText is required/,
    );
  });

  it('adds evidence to a claim', async () => {
    const calls = [];
    const database = {
      async query(sql, params) {
        calls.push({ sql, params });
        return {
          rows: [{
            id: params[0],
            claim_id: params[1],
            evidence_role: params[2],
            source_url: params[6],
          }],
        };
      },
    };

    const result = await addClaimEvidence(
      database,
      '123e4567-e89b-12d3-a456-426614174000',
      {
        evidenceRole: 'supports',
        sourceUrl: 'https://example.com/evidence',
      },
    );

    assert.ok(calls[0].sql.includes('INSERT INTO claim_evidence'));
    assert.equal(result.claim_id, '123e4567-e89b-12d3-a456-426614174000');
    assert.equal(result.source_url, 'https://example.com/evidence');
  });

  it('updates a claim with adjudication fields', async () => {
    const calls = [];
    const database = {
      async query(sql, params) {
        calls.push({ sql, params });
        return {
          rows: [{
            id: params.at(-1),
            status: 'accepted',
            confidence: 0.92,
          }],
        };
      },
    };

    const result = await updateClaim(database, '123e4567-e89b-12d3-a456-426614174000', {
      status: 'accepted',
      confidence: 0.92,
      metadata: { reviewer: 'cli' },
    });

    assert.ok(calls[0].sql.includes('UPDATE knowledge_claims'));
    assert.equal(result.status, 'accepted');
    assert.equal(result.confidence, 0.92);
  });

  it('lists claims with source record filters', async () => {
    const database = {
      async query(sql) {
        if (sql.startsWith('SELECT COUNT(*)::int AS count FROM knowledge_claims')) {
          return { rows: [{ count: 2 }] };
        }

        return {
          rows: [{
            id: '123e4567-e89b-12d3-a456-426614174000',
            claim_text: 'Accepted policy requires audit retention.',
            source_record_id: '223e4567-e89b-12d3-a456-426614174000',
          }],
        };
      },
    };

    const result = await listClaims(database, {
      status: 'accepted',
      sourceRecordId: '223e4567-e89b-12d3-a456-426614174000',
    });

    assert.equal(result.total, 2);
    assert.equal(result.claims[0].source_record_id, '223e4567-e89b-12d3-a456-426614174000');
  });

  it('gets claim details with evidence', async () => {
    const claimId = '123e4567-e89b-12d3-a456-426614174000';
    const database = {
      async query(sql) {
        if (sql.includes('FROM knowledge_claims')) {
          return {
            rows: [{
              id: claimId,
              claim_text: 'Runbooks should include rollback steps.',
              status: 'accepted',
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
    };

    const result = await getClaimDetails(database, claimId, { evidenceLimit: 5 });
    assert.equal(result.claim.id, claimId);
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].evidence_role, 'supports');
  });

  it('summarizes claims by status, type, and subject type', async () => {
    const database = {
      async query(sql) {
        if (sql.includes('AS total')) return { rows: [{ total: 4 }] };
        if (sql.includes('GROUP BY status')) return { rows: [{ status: 'candidate', count: 3 }] };
        if (sql.includes('GROUP BY claim_type')) return { rows: [{ claim_type: 'policy', count: 2 }] };
        if (sql.includes('needs_review')) {
          return {
            rows: [{
              needs_review: 3,
              disputed: 1,
              accepted_without_support: 1,
              contradicted: 2,
            }],
          };
        }
        return { rows: [{ subject_type: 'artifact', count: 4 }] };
      },
    };

    const result = await summarizeClaims(database, { status: 'candidate' });
    assert.equal(result.total, 4);
    assert.equal(result.by_status[0].status, 'candidate');
    assert.equal(result.by_type[0].claim_type, 'policy');
    assert.equal(result.by_subject_type[0].subject_type, 'artifact');
    assert.equal(result.review_queue.needs_review, 3);
    assert.equal(result.review_queue.contradicted, 2);
  });

  it('lists the evidence-aware claim review queue', async () => {
    const database = {
      async query(sql) {
        if (sql.startsWith('SELECT COUNT(*)::int AS count')) {
          return { rows: [{ count: 1 }] };
        }

        return {
          rows: [{
            id: '123e4567-e89b-12d3-a456-426614174000',
            status: 'disputed',
            claim_type: 'policy',
            supports_count: 0,
            contradicts_count: 2,
            context_count: 1,
            review_priority: 0,
            summary: 'Rollback guidance conflicts across sources.',
          }],
        };
      },
    };

    const result = await listClaimQueue(database, {
      limit: 10,
      status: 'disputed',
    });

    assert.equal(result.total, 1);
    assert.equal(result.claims[0].review_priority, 0);
    assert.equal(result.claims[0].contradicts_count, 2);
  });
});

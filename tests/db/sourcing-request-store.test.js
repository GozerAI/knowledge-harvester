// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSourcingRequestFilters,
  createSourcingRequest,
  updateSourcingRequest,
  listSourcingRequests,
  getSourcingRequest,
} from '../../src/db/sourcing-request-store.js';

describe('sourcing-request-store', () => {
  it('normalizes sourcing request filters', () => {
    const filters = normalizeSourcingRequestFilters({
      status: 'QUEUED',
      requesterRole: 'CRO',
      domain: 'Revenue',
      limit: '999',
      offset: '-5',
    });

    assert.equal(filters.status, 'queued');
    assert.equal(filters.requesterRole, 'cro');
    assert.equal(filters.domain, 'revenue');
    assert.equal(filters.limit, 100);
    assert.equal(filters.offset, 0);
  });

  it('creates a sourcing request', async () => {
    const calls = [];
    const database = {
      async query(sql, params) {
        calls.push({ sql, params });
        return {
          rows: [{
            id: params[0],
            requester: params[1],
            requester_role: params[2],
            domain: params[3],
            topic: params[4],
            objective: params[5],
            status: params[6],
          }],
        };
      },
    };

    const result = await createSourcingRequest(database, {
      requester: 'csuite',
      requesterRole: 'cro',
      domain: 'revenue',
      topic: 'partner ecosystem',
      objective: 'Find operating patterns for partner-led growth',
      selectedSources: ['sales-playbooks'],
    });

    assert.ok(calls[0].sql.includes('INSERT INTO sourcing_requests'));
    assert.equal(result.requester_role, 'cro');
    assert.equal(result.domain, 'revenue');
    assert.equal(result.status, 'planned');
  });

  it('updates a sourcing request', async () => {
    const database = {
      async query(_sql, params) {
        return {
          rows: [{
            id: params.at(-1),
            status: 'completed',
            error_message: null,
          }],
        };
      },
    };

    const result = await updateSourcingRequest(
      database,
      '123e4567-e89b-12d3-a456-426614174000',
      {
        status: 'completed',
        completedAt: 'now',
        resultSummary: { dispatched_sources: ['sales-playbooks'] },
      },
    );

    assert.equal(result.status, 'completed');
  });

  it('rejects invalid status values on create', async () => {
    const database = {
      async query() {
        throw new Error('should not be called');
      },
    };

    await assert.rejects(
      () => createSourcingRequest(database, {
        requester: 'csuite',
        requesterRole: 'cro',
        domain: 'revenue',
        topic: 'pricing',
        objective: 'Research pricing operations',
        status: 'invalid',
      }),
      /Invalid status/
    );
  });

  it('rejects invalid priority values on update', async () => {
    const database = {
      async query() {
        throw new Error('should not be called');
      },
    };

    await assert.rejects(
      () => updateSourcingRequest(
        database,
        '123e4567-e89b-12d3-a456-426614174000',
        { priority: 'urgent-now' },
      ),
      /Invalid priority/
    );
  });

  it('lists sourcing requests', async () => {
    const database = {
      async query(sql) {
        if (sql.startsWith('SELECT COUNT(*)::int AS count FROM sourcing_requests')) {
          return { rows: [{ count: 1 }] };
        }
        return {
          rows: [{
            id: '123e4567-e89b-12d3-a456-426614174000',
            requester: 'csuite',
            requester_role: 'cmo',
            domain: 'marketing',
            topic: 'competitive positioning',
            objective: 'Research adjacent messaging patterns',
            status: 'planned',
            research_questions: [],
            preferred_sources: [],
            selected_sources: ['sales-enablement'],
            artifact_types: ['documentation'],
            categories: ['enablement-doc'],
            constraints: {},
            qualification: {},
            result_summary: {},
            metadata: {},
          }],
        };
      },
    };

    const result = await listSourcingRequests(database, { status: 'planned' });
    assert.equal(result.total, 1);
    assert.equal(result.requests[0].requester_role, 'cmo');
  });

  it('gets a sourcing request by id', async () => {
    const database = {
      async query() {
        return {
          rows: [{
            id: '123e4567-e89b-12d3-a456-426614174000',
            requester: 'csuite',
            requester_role: 'cpo',
            domain: 'product',
            topic: 'onboarding',
            objective: 'Research product onboarding docs',
            status: 'dispatching',
            research_questions: [],
            preferred_sources: [],
            selected_sources: ['product-requirements'],
            artifact_types: ['documentation'],
            categories: ['product-doc'],
            constraints: {},
            qualification: {},
            result_summary: {},
            metadata: {},
          }],
        };
      },
    };

    const result = await getSourcingRequest(database, '123e4567-e89b-12d3-a456-426614174000');
    assert.equal(result.status, 'dispatching');
    assert.deepEqual(result.selected_sources, ['product-requirements']);
  });
});

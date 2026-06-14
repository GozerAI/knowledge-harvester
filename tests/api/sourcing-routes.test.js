// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { createSourcingHandlers } from '../../src/api/sourcing-routes.js';

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

describe('sourcing routes', () => {
  it('rejects invalid sourcing request filters', async () => {
    const handlers = createSourcingHandlers({
      database: {
        async query() {
          throw new Error('should not be called');
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleListSourcingRequests({}, res, makeParams({ status: 'unknown' }));

    assert.equal(res.writes[0].status, 400);
    assert.equal(res.writes[1].body.error, 'Validation failed');
  });

  it('lists sourcing requests', async () => {
    const handlers = createSourcingHandlers({
      database: {
        async query(sql) {
          if (sql.startsWith('SELECT COUNT(*)::int AS count FROM sourcing_requests')) {
            return { rows: [{ count: 1 }] };
          }
          return {
            rows: [{
              id: '123e4567-e89b-12d3-a456-426614174000',
              requester: 'csuite',
              requester_role: 'cro',
              domain: 'revenue',
              topic: 'pricing ops',
              objective: 'Research pricing enablement',
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
      },
      buildQualification: async () => ({}),
      dispatchHarvest: async () => ({ sources: [], runs: [] }),
    });
    const res = createResponseRecorder();

    await handlers.handleListSourcingRequests({}, res, makeParams({ status: 'planned' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.total, 1);
  });

  it('creates a sourcing request with qualification', async () => {
    const handlers = createSourcingHandlers({
      database: {
        async query(_sql, params) {
          return {
            rows: [{
              id: params[0],
              requester: params[1],
              requester_role: params[2],
              domain: params[3],
              topic: params[4],
              objective: params[5],
              status: params[6],
              qualification: JSON.parse(params[14]),
              selected_sources: JSON.parse(params[10]),
              metadata: JSON.parse(params[16]),
            }],
          };
        },
      },
      buildQualification: async () => ({
        recommended_sources: ['sales-playbooks'],
        current_coverage: { total_artifacts: 0, status: 'none' },
      }),
      dispatchHarvest: async () => ({ sources: ['sales-playbooks'], runs: [] }),
    });
    const res = createResponseRecorder();

    await handlers.handleCreateSourcingRequest(
      makeJsonRequest({
        requester: 'csuite',
        requester_role: 'cro',
        domain: 'revenue',
        topic: 'partner expansion',
        objective: 'Research partner-led growth',
        metadata: { requester_system: 'csuite' },
      }),
      res,
    );

    assert.equal(res.writes[0].status, 201);
    assert.equal(res.writes[1].body.status, 'planned');
    assert.deepEqual(res.writes[1].body.selected_sources, ['sales-playbooks']);
  });

  it('keeps auto-dispatch requests planned when no supported sources are available', async () => {
    const handlers = createSourcingHandlers({
      database: {
        async query(_sql, params) {
          return {
            rows: [{
              id: params[0],
              requester: params[1],
              requester_role: params[2],
              domain: params[3],
              topic: params[4],
              objective: params[5],
              status: params[6],
              qualification: JSON.parse(params[14]),
              selected_sources: JSON.parse(params[10]),
              metadata: JSON.parse(params[16]),
            }],
          };
        },
      },
      buildQualification: async () => ({
        recommended_sources: [],
        current_coverage: { total_artifacts: 0, status: 'none' },
      }),
      dispatchHarvest: async () => {
        throw new Error('should not dispatch without sources');
      },
    });
    const res = createResponseRecorder();

    await handlers.handleCreateSourcingRequest(
      makeJsonRequest({
        requester: 'csuite',
        requester_role: 'cro',
        domain: 'revenue',
        topic: 'channel growth',
        objective: 'Research partner programs',
        auto_dispatch: true,
      }),
      res,
    );

    assert.equal(res.writes[0].status, 201);
    assert.equal(res.writes[1].body.status, 'planned');
    assert.deepEqual(res.writes[1].body.selected_sources, []);
  });

  it('rejects invalid sourcing request payloads', async () => {
    const handlers = createSourcingHandlers({
      database: {
        async query() {
          throw new Error('should not be called');
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleCreateSourcingRequest(
      makeJsonRequest({
        requester: 'csuite',
        requester_role: 'cro',
      }),
      res,
    );

    assert.equal(res.writes[0].status, 400);
    assert.equal(res.writes[1].body.error, 'Validation failed');
  });

  it('rejects invalid auto_dispatch values', async () => {
    const handlers = createSourcingHandlers({
      database: {
        async query() {
          throw new Error('should not be called');
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleCreateSourcingRequest(
      makeJsonRequest({
        requester: 'csuite',
        requester_role: 'cro',
        domain: 'revenue',
        topic: 'pricing ops',
        objective: 'Research pricing enablement',
        auto_dispatch: 'yes',
      }),
      res,
    );

    assert.equal(res.writes[0].status, 400);
    assert.equal(res.writes[1].body.error, 'Validation failed');
  });

  it('gets a sourcing request by id', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174000';
    const handlers = createSourcingHandlers({
      database: {
        async query() {
          return {
            rows: [{
              id: requestId,
              requester: 'csuite',
              requester_role: 'cpo',
              domain: 'product',
              topic: 'activation',
              objective: 'Research activation playbooks',
              status: 'queued',
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
      },
      buildQualification: async () => ({}),
      dispatchHarvest: async () => ({ sources: [], runs: [] }),
    });
    const res = createResponseRecorder();

    await handlers.handleGetSourcingRequest({}, res, makeParams(), requestId);

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.id, requestId);
  });

  it('dispatches a sourcing request', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174000';
    const updates = [];
    const handlers = createSourcingHandlers({
      database: {
        async query(sql, params = []) {
          if (sql.startsWith('SELECT * FROM sourcing_requests')) {
            return {
              rows: [{
                id: requestId,
                requester: 'csuite',
                requester_role: 'cmo',
                domain: 'marketing',
                topic: 'market map',
                objective: 'Research adjacent competitors',
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
          }

          updates.push({ sql, params });
          const status = params.find((param) => ['dispatching', 'completed', 'failed'].includes(param)) || 'dispatching';
          return {
            rows: [{
              id: requestId,
              status,
              result_summary: { dispatched_sources: ['sales-enablement'] },
              research_questions: [],
              preferred_sources: [],
              selected_sources: ['sales-enablement'],
              artifact_types: ['documentation'],
              categories: ['enablement-doc'],
              constraints: {},
              qualification: {},
              metadata: {},
            }],
          };
        },
      },
      buildQualification: async () => ({}),
      dispatchHarvest: async ({ onDispatchSettled }) => {
        queueMicrotask(() => {
          onDispatchSettled?.({
            sources: ['sales-enablement'],
            runs: [{ source: 'sales-enablement', run_id: '223e4567-e89b-12d3-a456-426614174000' }],
            total_sources: 1,
            completed_sources: 1,
            failed_sources: 0,
            source_results: [{
              source: 'sales-enablement',
              run_id: '223e4567-e89b-12d3-a456-426614174000',
              status: 'completed',
              stats: { items_new: 3 },
            }],
          });
        });
        return {
          sources: ['sales-enablement'],
          runs: [{ source: 'sales-enablement', run_id: '223e4567-e89b-12d3-a456-426614174000' }],
        };
      },
    });
    const res = createResponseRecorder();

    await handlers.handleDispatchSourcingRequest({}, res, makeParams(), requestId);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(res.writes[0].status, 202);
    assert.equal(res.writes[1].body.status, 'dispatching');
    assert.ok(updates.some((entry) => entry.params.includes('completed')));
  });

  it('refuses to redispatch completed sourcing requests', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174000';
    const handlers = createSourcingHandlers({
      database: {
        async query() {
          return {
            rows: [{
              id: requestId,
              requester: 'csuite',
              requester_role: 'cmo',
              domain: 'marketing',
              topic: 'market map',
              objective: 'Research adjacent competitors',
              status: 'completed',
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
      },
    });
    const res = createResponseRecorder();

    await handlers.handleDispatchSourcingRequest({}, res, makeParams(), requestId);

    assert.equal(res.writes[0].status, 409);
    assert.match(res.writes[1].body.error, /Cannot dispatch/);
  });
});

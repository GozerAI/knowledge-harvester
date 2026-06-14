// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSystemRunFilters,
  createSystemRun,
  updateSystemRun,
  listSystemRuns,
  getSystemRunDetails,
} from '../../src/db/system-run-store.js';

describe('system-run-store', () => {
  it('normalizes system run filters', () => {
    const filters = normalizeSystemRunFilters({
      runType: 'PIPELINE',
      status: 'FAILED',
      limit: '999',
      offset: '-2',
    });

    assert.equal(filters.runType, 'pipeline');
    assert.equal(filters.status, 'failed');
    assert.equal(filters.limit, 100);
    assert.equal(filters.offset, 0);
  });

  it('creates a system run', async () => {
    const calls = [];
    const database = {
      async query(sql, params) {
        calls.push({ sql, params });
        return {
          rows: [{
            id: params[0],
            run_type: params[1],
            command: params[2],
            trigger: params[3],
            status: params[4],
          }],
        };
      },
    };

    const result = await createSystemRun(database, {
      id: '123e4567-e89b-12d3-a456-426614174000',
      runType: 'pipeline',
      command: 'pipeline',
      trigger: 'cli',
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].sql.includes('INSERT INTO system_runs'));
    assert.equal(result.run_type, 'pipeline');
  });

  it('updates a system run', async () => {
    const calls = [];
    const database = {
      async query(sql, params) {
        calls.push({ sql, params });
        return {
          rows: [{
            id: params.at(-1),
            status: 'completed',
            current_step: null,
          }],
        };
      },
    };

    const result = await updateSystemRun(database, '123e4567-e89b-12d3-a456-426614174000', {
      status: 'completed',
      currentStep: null,
      completedAt: 'now',
    });

    assert.ok(calls[0].sql.includes('UPDATE system_runs'));
    assert.equal(result.status, 'completed');
  });

  it('lists system runs with aggregated warnings and errors', async () => {
    const database = {
      async query(sql) {
        if (sql.startsWith('SELECT COUNT(*)::int AS count FROM system_runs')) {
          return { rows: [{ count: 1 }] };
        }
        return {
          rows: [{
            id: '123e4567-e89b-12d3-a456-426614174000',
            run_type: 'pipeline',
            command: 'pipeline',
            error_events: 1,
            warning_events: 2,
          }],
        };
      },
    };

    const result = await listSystemRuns(database, { runType: 'pipeline' });
    assert.equal(result.total, 1);
    assert.equal(result.runs[0].warning_events, 2);
  });

  it('gets system run details with linked logs', async () => {
    const database = {
      async query(sql) {
        if (sql.includes('FROM system_runs sr')) {
          return {
            rows: [{
              id: '123e4567-e89b-12d3-a456-426614174000',
              run_type: 'pipeline',
            }],
          };
        }
        return {
          rows: [{
            id: '223e4567-e89b-12d3-a456-426614174000',
            system_run_id: '123e4567-e89b-12d3-a456-426614174000',
            event_type: 'pipeline.run.failed',
          }],
        };
      },
    };

    const result = await getSystemRunDetails(database, '123e4567-e89b-12d3-a456-426614174000');
    assert.equal(result.run.run_type, 'pipeline');
    assert.equal(result.logs.length, 1);
  });
});

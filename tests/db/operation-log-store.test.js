// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LOG_LEVELS,
  normalizeLogFilters,
  buildOperationLogListQuery,
  buildHarvestRunListQuery,
  serializeError,
  createOperationLog,
  summarizeOperationLogs,
  classifySourceHealthStatus,
  listFailureInbox,
  listSourceHealth,
} from '../../src/db/operation-log-store.js';

describe('operation-log-store', () => {
  it('normalizes default log filters', () => {
    const filters = normalizeLogFilters({});
    assert.deepEqual(filters.levels, DEFAULT_LOG_LEVELS);
    assert.equal(filters.limit, 20);
    assert.equal(filters.offset, 0);
    assert.equal(filters.sinceHours, 24);
  });

  it('parses comma-separated levels and clamps numeric filters', () => {
    const filters = normalizeLogFilters({
      level: 'ERROR, warn',
      limit: '999',
      offset: '-5',
      sinceHours: '9999',
    });

    assert.deepEqual(filters.levels, ['error', 'warn']);
    assert.equal(filters.limit, 100);
    assert.equal(filters.offset, 0);
    assert.equal(filters.sinceHours, 24 * 30);
  });

  it('builds an operation log query with filter clauses', () => {
    const query = buildOperationLogListQuery({
      level: 'error',
      category: 'request',
      source: 'github',
      search: 'timeout',
      limit: 5,
    });

    assert.ok(query.countSql.includes('FROM operation_logs'));
    assert.ok(query.listSql.includes('level = ANY'));
    assert.ok(query.listSql.includes('category ='));
    assert.ok(query.listSql.includes('source ='));
    assert.ok(query.listSql.includes('message ILIKE'));
    assert.equal(query.listParams.at(-2), 5);
  });

  it('summarizes operation logs with the same filters as the list view', async () => {
    const calls = [];
    const database = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('AS total')) return { rows: [{ total: 2 }] };
        if (sql.includes('GROUP BY level')) return { rows: [{ level: 'error', count: 2 }] };
        if (sql.includes('GROUP BY category')) return { rows: [{ category: 'pipeline', count: 2 }] };
        return { rows: [{ emitter: 'pipeline', count: 2 }] };
      },
    };

    const summary = await summarizeOperationLogs(database, {
      level: 'error',
      systemRunId: '123e4567-e89b-12d3-a456-426614174000',
      sinceHours: 12,
    });

    assert.equal(summary.total, 2);
    assert.equal(summary.window_hours, 12);
    assert.equal(calls.length, 4);
    assert.ok(calls.every(call => call.sql.includes('system_run_id =')));
  });

  it('builds a harvest run query with aggregated warning/error counts', () => {
    const query = buildHarvestRunListQuery({ status: 'failed', source: 'reddit', limit: 10 });

    assert.ok(query.listSql.includes('LEFT JOIN operation_logs'));
    assert.ok(query.listSql.includes("COUNT(ol.id) FILTER (WHERE ol.level = 'error')"));
    assert.ok(query.listSql.includes('hr.status ='));
    assert.ok(query.listSql.includes('hr.source ='));
    assert.equal(query.listParams.at(-2), 10);
  });

  it('serializes Error instances', () => {
    const error = new Error('boom');
    error.code = 'E_BROKEN';

    const serialized = serializeError(error);
    assert.equal(serialized.name, 'Error');
    assert.equal(serialized.code, 'E_BROKEN');
    assert.equal(serialized.message, 'boom');
    assert.ok(serialized.stack.includes('boom'));
  });

  it('creates operation logs with serialized metadata', async () => {
    const calls = [];
    const database = {
      async query(sql, params) {
        calls.push({ sql, params });
        return {
          rows: [{
            id: '123e4567-e89b-12d3-a456-426614174000',
            created_at: '2026-03-13T10:00:00.000Z',
            level: params[0],
            category: params[1],
            event_type: params[2],
            message: params[3],
            system_run_id: params[7],
            metadata: JSON.parse(params[12]),
          }],
        };
      },
    };

    const error = new Error('request failed');
    error.code = 'ETIMEDOUT';

    const result = await createOperationLog(database, {
      level: 'error',
      category: 'request',
      eventType: 'request.failed',
      message: 'GET /api/errors failed',
      systemRunId: '123e4567-e89b-12d3-a456-426614174000',
      requestPath: '/api/errors',
      error,
      metadata: { method: 'GET' },
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].sql.includes('INSERT INTO operation_logs'));
    assert.equal(calls[0].params[9], 'Error');
    assert.equal(calls[0].params[10], 'ETIMEDOUT');
    assert.equal(result.system_run_id, '123e4567-e89b-12d3-a456-426614174000');
    assert.deepEqual(result.metadata, { method: 'GET' });
  });

  it('classifies source health status from reliability and errors', () => {
    assert.equal(classifySourceHealthStatus({ tier: 'excellent', recentErrorEvents: 0, latestRunStatus: 'completed' }), 'healthy');
    assert.equal(classifySourceHealthStatus({ tier: 'fair', recentErrorEvents: 0, latestRunStatus: 'completed' }), 'degraded');
    assert.equal(classifySourceHealthStatus({ tier: 'good', recentErrorEvents: 6, latestRunStatus: 'completed' }), 'critical');
  });

  it('builds a grouped failure inbox', async () => {
    const database = {
      async query() {
        return {
          rows: [{
            emitter: 'github',
            category: 'harvest',
            event_type: 'harvest.run.failed',
            occurrence_count: 3,
            last_seen: '2026-03-13T10:00:00.000Z',
            message: 'Harvest run failed for github',
          }],
        };
      },
    };

    const inbox = await listFailureInbox(database, { limit: 5, sinceHours: 24 });
    assert.equal(inbox.total, 1);
    assert.equal(inbox.items[0].emitter, 'github');
    assert.equal(inbox.since_hours, 24);
  });

  it('merges reliability, recent errors, and latest runs into source health', async () => {
    const database = {
      async query(sql) {
        if (sql.includes('COUNT(*) FILTER (WHERE status = \'completed\')')) {
          return {
            rows: [{
              source_name: 'github',
              run_count: 10,
              success_count: 8,
              fail_count: 2,
              avg_new_items: 4,
              last_run: new Date().toISOString(),
            }],
          };
        }
        if (sql.includes('ROUND(AVG(quality_score)::numeric, 2)::float')) {
          return {
            rows: [{
              source: 'github',
              avg_quality: 70,
              artifact_count: 50,
            }],
          };
        }
        if (sql.includes('recent_error_events')) {
          return {
            rows: [{
              source: 'github',
              recent_error_events: 2,
              recent_warning_events: 1,
              last_error_at: '2026-03-13T09:00:00.000Z',
            }],
          };
        }
        return {
          rows: [{
            source: 'github',
            status: 'failed',
            started_at: '2026-03-13T08:00:00.000Z',
            completed_at: '2026-03-13T08:05:00.000Z',
            error_message: 'timeout',
            items_discovered: 10,
            items_new: 4,
            items_duplicate: 2,
            items_invalid: 0,
          }],
        };
      },
    };

    const result = await listSourceHealth(database, { limit: 10, sinceHours: 72 });
    assert.equal(result.total, 1);
    assert.equal(result.sources[0].source, 'github');
    assert.equal(result.sources[0].health_status, 'degraded');
    assert.equal(result.sources[0].recent_error_events, 2);
  });
});

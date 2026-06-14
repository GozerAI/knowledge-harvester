// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createOpsHandlers } from '../../src/api/ops-routes.js';

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

describe('ops routes', () => {
  it('lists errors from operation logs', async () => {
    const handlers = createOpsHandlers({
      database: {
        async query(sql) {
          if (sql.startsWith('SELECT COUNT(*)::int AS count FROM operation_logs')) {
            return { rows: [{ count: 1 }] };
          }
          return {
            rows: [{
              id: '123e4567-e89b-12d3-a456-426614174000',
              level: 'error',
              category: 'request',
              event_type: 'request.failed',
              message: 'GET /api/runs failed',
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleListErrors({}, res, makeParams({ level: 'error', limit: '5' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.total, 1);
    assert.equal(res.writes[1].body.errors[0].event_type, 'request.failed');
  });

  it('rejects invalid run_id filters on error listing', async () => {
    const handlers = createOpsHandlers({
      database: {
        async query() {
          throw new Error('should not be called');
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleListErrors({}, res, makeParams({ run_id: 'bad-id' }));

    assert.equal(res.writes[0].status, 400);
    assert.equal(res.writes[1].body.error, 'Invalid run_id');
  });

  it('rejects invalid system_run_id filters on error listing', async () => {
    const handlers = createOpsHandlers({
      database: {
        async query() {
          throw new Error('should not be called');
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleListErrors({}, res, makeParams({ system_run_id: 'bad-id' }));

    assert.equal(res.writes[0].status, 400);
    assert.equal(res.writes[1].body.error, 'Invalid system_run_id');
  });

  it('returns error summaries', async () => {
    const handlers = createOpsHandlers({
      database: {
        async query(sql) {
          if (sql.includes('SELECT COUNT(*)::int AS total')) return { rows: [{ total: 3 }] };
          if (sql.includes('GROUP BY level')) return { rows: [{ level: 'error', count: 2 }] };
          if (sql.includes('GROUP BY category')) return { rows: [{ category: 'harvest', count: 2 }] };
          return { rows: [{ emitter: 'github', count: 2 }] };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleErrorSummary({}, res, makeParams({ since_hours: '12' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.total, 3);
    assert.equal(res.writes[1].body.window_hours, 12);
  });

  it('renders an HTML error log page', async () => {
    const handlers = createOpsHandlers({
      database: {
        async query(sql) {
          if (sql.includes('AS total')) return { rows: [{ total: 1 }] };
          if (sql.includes('GROUP BY level')) return { rows: [{ level: 'error', count: 1 }] };
          if (sql.includes('GROUP BY category')) return { rows: [{ category: 'pipeline', count: 1 }] };
          if (sql.startsWith('SELECT COUNT(*)::int AS count FROM operation_logs')) {
            return { rows: [{ count: 1 }] };
          }
          if (sql.includes('COALESCE(source, command, request_path, \'unknown\')')) {
            return { rows: [{ emitter: 'pipeline', count: 1 }] };
          }
          return {
            rows: [{
              id: '123e4567-e89b-12d3-a456-426614174000',
              created_at: '2026-03-13T10:00:00.000Z',
              level: 'error',
              category: 'pipeline',
              event_type: 'pipeline.step.failed',
              message: 'Pipeline step failed: embed',
              command: 'pipeline',
              system_run_id: '123e4567-e89b-12d3-a456-426614174000',
              run_id: null,
              request_path: null,
              error_code: 'EPIPE',
              error_name: 'Error',
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleErrorLogPage({}, res, makeParams({ system_run_id: '123e4567-e89b-12d3-a456-426614174000' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[0].headers['Content-Type'], 'text/html; charset=utf-8');
    assert.match(res.writes[1].raw, /Error Log/);
    assert.match(res.writes[1].raw, /pipeline\.step\.failed/);
    assert.match(res.writes[1].raw, /system-runs\/123e4567-e89b-12d3-a456-426614174000/);
  });

  it('returns a grouped failure inbox', async () => {
    const handlers = createOpsHandlers({
      database: {
        async query() {
          return {
            rows: [{
              emitter: 'github',
              category: 'harvest',
              event_type: 'harvest.run.failed',
              occurrence_count: 2,
              message: 'Harvest run failed for github',
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleFailureInbox({}, res, makeParams({ limit: '5' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.total, 1);
    assert.equal(res.writes[1].body.items[0].event_type, 'harvest.run.failed');
  });

  it('lists harvest runs', async () => {
    const handlers = createOpsHandlers({
      database: {
        async query(sql) {
          if (sql.startsWith('SELECT COUNT(*)::int AS count FROM harvest_runs')) {
            return { rows: [{ count: 1 }] };
          }
          return {
            rows: [{
              id: '123e4567-e89b-12d3-a456-426614174000',
              source: 'github',
              status: 'failed',
              error_events: 1,
              warning_events: 2,
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleListRuns({}, res, makeParams({ status: 'failed' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.total, 1);
    assert.equal(res.writes[1].body.runs[0].warning_events, 2);
  });

  it('returns harvest run details with associated logs', async () => {
    const runId = '123e4567-e89b-12d3-a456-426614174000';
    const handlers = createOpsHandlers({
      database: {
        async query(sql) {
          if (sql.includes('FROM harvest_runs hr')) {
            return {
              rows: [{
                id: runId,
                source: 'github',
                status: 'failed',
                error_events: 1,
                warning_events: 0,
              }],
            };
          }
          return {
            rows: [{
              id: '223e4567-e89b-12d3-a456-426614174000',
              run_id: runId,
              level: 'error',
              event_type: 'harvest.run.failed',
              message: 'Harvest run failed for github',
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleGetRun({}, res, makeParams({ log_limit: '10' }), runId);

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.run.id, runId);
    assert.equal(res.writes[1].body.logs.length, 1);
  });

  it('returns source health', async () => {
    const handlers = createOpsHandlers({
      database: {
        async query(sql) {
          if (sql.includes('COUNT(*) FILTER (WHERE status = \'completed\')')) {
            return {
              rows: [{
                source_name: 'github',
                run_count: 10,
                success_count: 9,
                fail_count: 1,
                avg_new_items: 6,
                last_run: new Date().toISOString(),
              }],
            };
          }
          if (sql.includes('ROUND(AVG(quality_score)::numeric, 2)::float')) {
            return {
              rows: [{
                source: 'github',
                avg_quality: 82,
                artifact_count: 100,
              }],
            };
          }
          if (sql.includes('recent_error_events')) {
            return {
              rows: [{
                source: 'github',
                recent_error_events: 0,
                recent_warning_events: 1,
                last_error_at: null,
              }],
            };
          }
          return {
            rows: [{
              source: 'github',
              status: 'completed',
              started_at: '2026-03-13T08:00:00.000Z',
              completed_at: '2026-03-13T08:05:00.000Z',
              error_message: null,
              items_discovered: 10,
              items_new: 6,
              items_duplicate: 1,
              items_invalid: 0,
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleSourceHealth({}, res, makeParams({ limit: '10' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.total, 1);
    assert.equal(res.writes[1].body.sources[0].source, 'github');
    assert.equal(res.writes[1].body.sources[0].health_status, 'healthy');
  });

  it('lists system runs', async () => {
    const handlers = createOpsHandlers({
      database: {
        async query(sql) {
          if (sql.startsWith('SELECT COUNT(*)::int AS count FROM system_runs')) {
            return { rows: [{ count: 1 }] };
          }
          return {
            rows: [{
              id: '123e4567-e89b-12d3-a456-426614174000',
              run_type: 'pipeline',
              command: 'pipeline',
              status: 'completed',
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleListSystemRuns({}, res, makeParams({ run_type: 'pipeline' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.total, 1);
    assert.equal(res.writes[1].body.runs[0].run_type, 'pipeline');
  });

  it('lists source records', async () => {
    const handlers = createOpsHandlers({
      database: {
        async query(sql) {
          if (sql.startsWith('SELECT COUNT(*)::int AS count FROM source_records')) {
            return { rows: [{ count: 1 }] };
          }
          return {
            rows: [{
              id: '123e4567-e89b-12d3-a456-426614174000',
              source: 'github',
              decision: 'accepted',
              item_name: 'acme/repo/file.md',
            }],
          };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleListSourceRecords({}, res, makeParams({ decision: 'accepted' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.total, 1);
    assert.equal(res.writes[1].body.records[0].decision, 'accepted');
  });

  it('returns source record summaries', async () => {
    const handlers = createOpsHandlers({
      database: {
        async query(sql) {
          if (sql.includes('AS total')) return { rows: [{ total: 4 }] };
          if (sql.includes('GROUP BY decision')) return { rows: [{ decision: 'discarded', count: 2 }] };
          return { rows: [{ source: 'runbooks', count: 2 }] };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleSourceRecordSummary({}, res, makeParams({ since_hours: '24' }));

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.total, 4);
    assert.equal(res.writes[1].body.by_decision[0].decision, 'discarded');
  });

  it('gets a system run with logs', async () => {
    const runId = '123e4567-e89b-12d3-a456-426614174000';
    const handlers = createOpsHandlers({
      database: {
        async query(sql) {
          if (sql.includes('FROM system_runs sr')) {
            return { rows: [{ id: runId, run_type: 'command' }] };
          }
          return { rows: [{ id: '223e4567-e89b-12d3-a456-426614174000', system_run_id: runId }] };
        },
      },
    });
    const res = createResponseRecorder();

    await handlers.handleGetSystemRun({}, res, makeParams({ log_limit: '5' }), runId);

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.run.id, runId);
    assert.equal(res.writes[1].body.logs.length, 1);
  });
});

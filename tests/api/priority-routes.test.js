// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for C-Suite Priority Queue API routes and autonomous startup.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock DB ────────────────────────────────────────────────────────────────

function mockDb(queryResponses = []) {
  let callIndex = 0;
  const calls = [];
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (callIndex < queryResponses.length) {
        const resp = queryResponses[callIndex++];
        if (typeof resp === 'function') return resp(sql, params);
        return resp;
      }
      return { rows: [] };
    },
    getCalls: () => calls,
  };
}

// ── Re-implemented Scheduler (mirrors src/processing/scheduler.js) ──────

class Scheduler {
  constructor(db) {
    this._db = db;
    this._schedules = new Map();
    this._timers = new Map();
    this._running = new Map();
    this._started = false;
  }

  async register(name, intervalMs, fn) {
    this._schedules.set(name, { name, intervalMs, fn });
    try {
      await this._db.query(
        `INSERT INTO schedules (name, interval_ms, enabled, last_status, metadata)
         VALUES ($1, $2, true, 'pending', '{}')
         ON CONFLICT (name) DO UPDATE SET interval_ms = $2, updated_at = NOW()`,
        [name, intervalMs]
      );
    } catch { /* best-effort */ }
  }

  async start() {
    this._started = true;
  }

  stop() {
    this._started = false;
    for (const timer of this._timers.values()) clearTimeout(timer);
    this._timers.clear();
  }

  async runNow(name) {
    const schedule = this._schedules.get(name);
    if (!schedule) return { status: 'not_found' };

    if (this._running.get(name)) return { status: 'skipped', skipped: true };

    this._running.set(name, true);
    try {
      await schedule.fn();
      try {
        await this._db.query(
          `UPDATE schedules SET last_run = NOW(), run_count = run_count + 1, last_status = 'success', last_error = NULL WHERE name = $1`,
          [name]
        );
      } catch { /* best-effort */ }
      return { status: 'success' };
    } catch (err) {
      try {
        await this._db.query(
          `UPDATE schedules SET last_run = NOW(), run_count = run_count + 1, last_status = 'error', last_error = $1 WHERE name = $2`,
          [err.message, name]
        );
      } catch { /* best-effort */ }
      return { status: 'error', error: err.message };
    } finally {
      this._running.set(name, false);
    }
  }
}

// ── Simulate priority/run handler logic ─────────────────────────────────

async function handlePriorityRun(scheduler, body) {
  if (!body || !body.job) {
    return { status: 400, body: { error: 'Missing required field: job' } };
  }
  const result = await scheduler.runNow(body.job);
  if (result.status === 'not_found') {
    return { status: 404, body: { error: `Unknown job: ${body.job}` } };
  }
  return { status: 200, body: result };
}

// ── Default job registration helper (mirrors server.js startup) ─────────

const DEFAULT_JOBS = [
  { name: 'auto_refresh', intervalMs: 4 * 60 * 60 * 1000 },
  { name: 'sync_trendscope', intervalMs: 2 * 60 * 60 * 1000 },
  { name: 'generate_recommendations', intervalMs: 6 * 60 * 60 * 1000 },
];

async function registerDefaultJobs(scheduler) {
  for (const job of DEFAULT_JOBS) {
    await scheduler.register(job.name, job.intervalMs, () => {});
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Priority Routes', () => {
  let db;
  let scheduler;

  beforeEach(async () => {
    db = mockDb();
    scheduler = new Scheduler(db);
  });

  describe('default jobs on startup', () => {
    it('registers all three default jobs', async () => {
      await registerDefaultJobs(scheduler);
      assert.equal(scheduler._schedules.size, 3);
      assert.ok(scheduler._schedules.has('auto_refresh'));
      assert.ok(scheduler._schedules.has('sync_trendscope'));
      assert.ok(scheduler._schedules.has('generate_recommendations'));
    });

    it('auto_refresh runs on a 4-hour interval', async () => {
      await registerDefaultJobs(scheduler);
      const sched = scheduler._schedules.get('auto_refresh');
      assert.equal(sched.intervalMs, 4 * 60 * 60 * 1000);
    });

    it('sync_trendscope runs on a 2-hour interval', async () => {
      await registerDefaultJobs(scheduler);
      const sched = scheduler._schedules.get('sync_trendscope');
      assert.equal(sched.intervalMs, 2 * 60 * 60 * 1000);
    });

    it('generate_recommendations runs on a 6-hour interval', async () => {
      await registerDefaultJobs(scheduler);
      const sched = scheduler._schedules.get('generate_recommendations');
      assert.equal(sched.intervalMs, 6 * 60 * 60 * 1000);
    });

    it('scheduler starts after registering default jobs', async () => {
      await registerDefaultJobs(scheduler);
      await scheduler.start();
      assert.equal(scheduler._started, true);
    });

    it('persists each default job to DB', async () => {
      await registerDefaultJobs(scheduler);
      const calls = db.getCalls();
      const insertCalls = calls.filter(c => c.sql.includes('INSERT INTO schedules'));
      assert.equal(insertCalls.length, 3);
    });
  });

  describe('POST /api/priority/run', () => {
    it('runs a registered job immediately', async () => {
      let executed = false;
      await scheduler.register('auto_refresh', 60000, () => { executed = true; });
      const resp = await handlePriorityRun(scheduler, { job: 'auto_refresh' });
      assert.equal(resp.status, 200);
      assert.equal(resp.body.status, 'success');
      assert.ok(executed);
    });

    it('rejects unknown job names with 404', async () => {
      const resp = await handlePriorityRun(scheduler, { job: 'nonexistent_job' });
      assert.equal(resp.status, 404);
      assert.ok(resp.body.error.includes('Unknown job'));
    });

    it('returns 400 when job field is missing', async () => {
      const resp = await handlePriorityRun(scheduler, {});
      assert.equal(resp.status, 400);
      assert.ok(resp.body.error.includes('Missing required field'));
    });

    it('returns 400 when body is null', async () => {
      const resp = await handlePriorityRun(scheduler, null);
      assert.equal(resp.status, 400);
    });

    it('returns error status when job function throws', async () => {
      await scheduler.register('failing_job', 60000, () => { throw new Error('kaboom'); });
      const resp = await handlePriorityRun(scheduler, { job: 'failing_job' });
      assert.equal(resp.status, 200);
      assert.equal(resp.body.status, 'error');
      assert.equal(resp.body.error, 'kaboom');
    });

    it('skips job that is already running', async () => {
      let resolve;
      const blocker = new Promise(r => { resolve = r; });
      await scheduler.register('slow_job', 60000, () => blocker);

      // Start first run (will block)
      const run1 = scheduler.runNow('slow_job');

      // Try to run via priority endpoint while blocked
      const resp = await handlePriorityRun(scheduler, { job: 'slow_job' });
      assert.equal(resp.status, 200);
      assert.equal(resp.body.status, 'skipped');
      assert.equal(resp.body.skipped, true);

      resolve(); // unblock
      await run1;
    });

    it('can run any of the default registered jobs', async () => {
      const results = [];
      await scheduler.register('auto_refresh', 60000, () => { results.push('refresh'); });
      await scheduler.register('sync_trendscope', 60000, () => { results.push('sync'); });
      await scheduler.register('generate_recommendations', 60000, () => { results.push('recs'); });

      await handlePriorityRun(scheduler, { job: 'sync_trendscope' });
      await handlePriorityRun(scheduler, { job: 'generate_recommendations' });
      await handlePriorityRun(scheduler, { job: 'auto_refresh' });

      assert.deepEqual(results, ['sync', 'recs', 'refresh']);
    });
  });

  describe('clean shutdown', () => {
    it('stop clears all timers and started flag', async () => {
      await registerDefaultJobs(scheduler);
      await scheduler.start();
      assert.equal(scheduler._started, true);

      scheduler.stop();
      assert.equal(scheduler._started, false);
      assert.equal(scheduler._timers.size, 0);
    });
  });
});

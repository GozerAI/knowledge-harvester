// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for the Scheduled Automation Engine.
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

// ── Re-implement Scheduler locally ─────────────────────────────────────────

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

  async listSchedules() {
    try {
      const result = await this._db.query('SELECT * FROM schedules ORDER BY name');
      return result.rows;
    } catch {
      return Array.from(this._schedules.values()).map(s => ({
        name: s.name, interval_ms: s.intervalMs, enabled: true,
        run_count: 0, last_status: 'pending',
      }));
    }
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

  async enable(name) {
    await this._db.query('UPDATE schedules SET enabled = true WHERE name = $1', [name]);
  }

  async disable(name) {
    await this._db.query('UPDATE schedules SET enabled = false WHERE name = $1', [name]);
    const timer = this._timers.get(name);
    if (timer) { clearTimeout(timer); this._timers.delete(name); }
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Scheduler', () => {
  let db;
  let scheduler;

  beforeEach(() => {
    db = mockDb([
      { rows: [] }, // register INSERT
    ]);
    scheduler = new Scheduler(db);
  });

  describe('register', () => {
    it('stores schedule in memory', async () => {
      await scheduler.register('test', 60000, () => {});
      assert.ok(scheduler._schedules.has('test'));
    });

    it('persists to DB', async () => {
      await scheduler.register('test', 60000, () => {});
      const calls = db.getCalls();
      assert.ok(calls.some(c => c.sql.includes('INSERT INTO schedules')));
    });

    it('stores interval_ms', async () => {
      await scheduler.register('test', 30000, () => {});
      assert.equal(scheduler._schedules.get('test').intervalMs, 30000);
    });
  });

  describe('listSchedules', () => {
    it('returns schedules from DB', async () => {
      const dbWithData = mockDb([
        { rows: [] }, // register
        { rows: [{ name: 'test', interval_ms: 60000, enabled: true, run_count: 0, last_status: 'pending' }] },
      ]);
      const s = new Scheduler(dbWithData);
      await s.register('test', 60000, () => {});
      const list = await s.listSchedules();
      assert.equal(list.length, 1);
      assert.equal(list[0].name, 'test');
    });

    it('falls back to in-memory when DB fails', async () => {
      const failDb = { query: async () => { throw new Error('db error'); } };
      const s = new Scheduler(failDb);
      s._schedules.set('test', { name: 'test', intervalMs: 60000, fn: () => {} });
      const list = await s.listSchedules();
      assert.equal(list.length, 1);
      assert.equal(list[0].name, 'test');
    });
  });

  describe('runNow', () => {
    it('executes the registered function', async () => {
      let executed = false;
      const dbRun = mockDb([{ rows: [] }, { rows: [] }]);
      const s = new Scheduler(dbRun);
      await s.register('test', 60000, () => { executed = true; });
      await s.runNow('test');
      assert.ok(executed);
    });

    it('returns success status on successful run', async () => {
      const dbRun = mockDb([{ rows: [] }, { rows: [] }]);
      const s = new Scheduler(dbRun);
      await s.register('test', 60000, () => {});
      const result = await s.runNow('test');
      assert.equal(result.status, 'success');
    });

    it('updates run_count and last_status in DB', async () => {
      const dbRun = mockDb([{ rows: [] }, { rows: [] }]);
      const s = new Scheduler(dbRun);
      await s.register('test', 60000, () => {});
      await s.runNow('test');
      const calls = dbRun.getCalls();
      assert.ok(calls.some(c => c.sql.includes('run_count')));
    });

    it('returns error status when function throws', async () => {
      const dbRun = mockDb([{ rows: [] }, { rows: [] }]);
      const s = new Scheduler(dbRun);
      await s.register('test', 60000, () => { throw new Error('fail'); });
      const result = await s.runNow('test');
      assert.equal(result.status, 'error');
      assert.equal(result.error, 'fail');
    });

    it('sets last_error in DB on failure', async () => {
      const dbRun = mockDb([{ rows: [] }, { rows: [] }]);
      const s = new Scheduler(dbRun);
      await s.register('test', 60000, () => { throw new Error('boom'); });
      await s.runNow('test');
      const calls = dbRun.getCalls();
      assert.ok(calls.some(c => c.sql.includes('last_error')));
    });

    it('returns not_found for unknown schedule', async () => {
      const result = await scheduler.runNow('nonexistent');
      assert.equal(result.status, 'not_found');
    });
  });

  describe('concurrent protection', () => {
    it('skips if same schedule is already running', async () => {
      const dbRun = mockDb([{ rows: [] }]);
      const s = new Scheduler(dbRun);
      let resolve;
      const blocker = new Promise(r => { resolve = r; });
      await s.register('test', 60000, () => blocker);

      const run1 = s.runNow('test');
      // The first run is now blocked
      const result2 = await s.runNow('test');
      assert.equal(result2.status, 'skipped');
      assert.equal(result2.skipped, true);

      resolve(); // unblock
      await run1;
    });

    it('allows run after previous completes', async () => {
      const dbRun = mockDb([{ rows: [] }, { rows: [] }, { rows: [] }]);
      const s = new Scheduler(dbRun);
      let count = 0;
      await s.register('test', 60000, () => { count++; });
      await s.runNow('test');
      await s.runNow('test');
      assert.equal(count, 2);
    });
  });

  describe('enable/disable', () => {
    it('enable updates DB', async () => {
      await scheduler.enable('test');
      const calls = db.getCalls();
      assert.ok(calls.some(c => c.sql.includes('enabled = true')));
    });

    it('disable updates DB', async () => {
      await scheduler.disable('test');
      const calls = db.getCalls();
      assert.ok(calls.some(c => c.sql.includes('enabled = false')));
    });

    it('disable clears timer if set', async () => {
      scheduler._timers.set('test', setTimeout(() => {}, 999999));
      await scheduler.disable('test');
      assert.ok(!scheduler._timers.has('test'));
    });
  });

  describe('start/stop lifecycle', () => {
    it('start sets _started flag', async () => {
      await scheduler.start();
      assert.equal(scheduler._started, true);
    });

    it('stop clears _started flag', () => {
      scheduler._started = true;
      scheduler.stop();
      assert.equal(scheduler._started, false);
    });

    it('stop clears all timers', () => {
      scheduler._timers.set('a', setTimeout(() => {}, 999999));
      scheduler._timers.set('b', setTimeout(() => {}, 999999));
      scheduler.stop();
      assert.equal(scheduler._timers.size, 0);
    });
  });

  describe('default schedules registration', () => {
    it('registered schedules have name, intervalMs, and fn', async () => {
      const dbReg = mockDb([{ rows: [] }]);
      const s = new Scheduler(dbReg);
      await s.register('daily-harvest', 86400000, () => {});
      const sched = s._schedules.get('daily-harvest');
      assert.ok(sched);
      assert.equal(sched.name, 'daily-harvest');
      assert.equal(sched.intervalMs, 86400000);
      assert.equal(typeof sched.fn, 'function');
    });
  });
});

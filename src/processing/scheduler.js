// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Scheduled Automation Engine — setTimeout-chain scheduler with DB persistence.
 *
 * Uses setTimeout chaining (not setInterval) for drift-free scheduling.
 * Concurrent-run protection prevents overlapping executions of the same schedule.
 */

import { logger } from '../utils/logger.js';

export class Scheduler {
  /**
   * @param {object} db - Database client with query() method
   */
  constructor(db) {
    this._db = db;
    /** @type {Map<string, { name: string, intervalMs: number, fn: Function }>} */
    this._schedules = new Map();
    /** @type {Map<string, ReturnType<typeof setTimeout>>} */
    this._timers = new Map();
    /** @type {Map<string, boolean>} */
    this._running = new Map();
    this._started = false;
  }

  /**
   * Register a schedule. Persists to DB if available.
   * @param {string} name
   * @param {number} intervalMs
   * @param {Function} fn
   */
  async register(name, intervalMs, fn) {
    this._schedules.set(name, { name, intervalMs, fn });

    try {
      await this._db.query(
        `INSERT INTO schedules (name, interval_ms, enabled, last_status, metadata)
         VALUES ($1, $2, true, 'pending', '{}')
         ON CONFLICT (name) DO UPDATE SET interval_ms = $2, updated_at = NOW()`,
        [name, intervalMs]
      );
    } catch {
      // DB persistence is best-effort
    }
  }

  /**
   * Start all enabled schedules.
   */
  async start() {
    this._started = true;
    for (const [name, schedule] of this._schedules) {
      try {
        const dbRow = await this._db.query(
          'SELECT enabled FROM schedules WHERE name = $1',
          [name]
        );
        const enabled = dbRow.rows.length === 0 || dbRow.rows[0].enabled !== false;
        if (enabled) {
          this._scheduleNext(name, schedule.intervalMs);
        }
      } catch {
        this._scheduleNext(name, schedule.intervalMs);
      }
    }
  }

  /**
   * Stop all timers.
   */
  stop() {
    this._started = false;
    for (const timer of this._timers.values()) {
      clearTimeout(timer);
    }
    this._timers.clear();
  }

  /**
   * List all schedules from DB.
   * @returns {Promise<Array>}
   */
  async listSchedules() {
    try {
      const result = await this._db.query(
        'SELECT * FROM schedules ORDER BY name'
      );
      return result.rows;
    } catch {
      // Fallback to in-memory
      return Array.from(this._schedules.values()).map(s => ({
        name: s.name,
        interval_ms: s.intervalMs,
        enabled: true,
        run_count: 0,
        last_status: 'pending',
      }));
    }
  }

  /**
   * Run a schedule immediately. Skips if already running (concurrent protection).
   * @param {string} name
   * @returns {Promise<{ status: string, skipped?: boolean }>}
   */
  async runNow(name) {
    const schedule = this._schedules.get(name);
    if (!schedule) {
      return { status: 'not_found' };
    }

    // Concurrent-run protection
    if (this._running.get(name)) {
      return { status: 'skipped', skipped: true };
    }

    this._running.set(name, true);
    try {
      await schedule.fn();

      // Update DB
      try {
        await this._db.query(
          `UPDATE schedules SET
             last_run = NOW(),
             next_run = NOW() + ($1 || ' milliseconds')::interval,
             run_count = run_count + 1,
             last_status = 'success',
             last_error = NULL,
             updated_at = NOW()
           WHERE name = $2`,
          [schedule.intervalMs, name]
        );
      } catch {
        // DB update is best-effort
      }

      return { status: 'success' };
    } catch (err) {
      // Update DB with error
      try {
        await this._db.query(
          `UPDATE schedules SET
             last_run = NOW(),
             run_count = run_count + 1,
             last_status = 'error',
             last_error = $1,
             updated_at = NOW()
           WHERE name = $2`,
          [err.message, name]
        );
      } catch {
        // DB update is best-effort
      }

      return { status: 'error', error: err.message };
    } finally {
      this._running.set(name, false);
    }
  }

  /**
   * Enable a schedule.
   * @param {string} name
   */
  async enable(name) {
    try {
      await this._db.query(
        'UPDATE schedules SET enabled = true, updated_at = NOW() WHERE name = $1',
        [name]
      );
    } catch {
      // best-effort
    }

    if (this._started && this._schedules.has(name)) {
      const schedule = this._schedules.get(name);
      this._scheduleNext(name, schedule.intervalMs);
    }
  }

  /**
   * Disable a schedule and clear its timer.
   * @param {string} name
   */
  async disable(name) {
    try {
      await this._db.query(
        'UPDATE schedules SET enabled = false, updated_at = NOW() WHERE name = $1',
        [name]
      );
    } catch {
      // best-effort
    }

    const timer = this._timers.get(name);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(name);
    }
  }

  /**
   * Schedule the next execution via setTimeout chaining.
   * @private
   */
  _scheduleNext(name, intervalMs) {
    const timer = setTimeout(async () => {
      if (!this._started) return;
      await this.runNow(name);
      if (this._started) {
        this._scheduleNext(name, intervalMs);
      }
    }, intervalMs);

    // Allow Node to exit even if timer is pending
    if (timer.unref) timer.unref();
    this._timers.set(name, timer);
  }
}

/** @type {Scheduler|null} */
let _instance = null;

/**
 * Get the singleton Scheduler instance.
 * @param {object} db
 * @returns {Scheduler}
 */
export function getScheduler(db) {
  if (!_instance) {
    _instance = new Scheduler(db);
  }
  return _instance;
}

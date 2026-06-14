// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Connection pool monitoring with alerts (item #206).
 *
 * Monitors PostgreSQL connection pool health: utilization, wait times,
 * error rates, and idle connection counts. Fires alert callbacks when
 * thresholds are exceeded.
 */

import { logger } from '../utils/logger.js';

export class PoolMonitor {
  /**
   * @param {object} pool - pg Pool instance (or compatible mock)
   * @param {object} [options]
   * @param {number} [options.intervalMs=5000] - Sampling interval
   * @param {number} [options.historySize=720] - Snapshots to retain (1hr at 5s)
   * @param {object} [options.thresholds]
   * @param {Function} [options.onAlert] - Callback(alert) when threshold exceeded
   */
  constructor(pool, {
    intervalMs = 5000,
    historySize = 720,
    thresholds = {},
    onAlert = null,
  } = {}) {
    this._pool = pool;
    this._intervalMs = intervalMs;
    this._historySize = historySize;
    this._onAlert = onAlert;
    this._timer = null;
    this._running = false;

    this._thresholds = {
      utilizationPct: thresholds.utilizationPct ?? 85,
      waitingRequests: thresholds.waitingRequests ?? 5,
      idleConnectionsPct: thresholds.idleConnectionsPct ?? 10,
      errorRatePerMin: thresholds.errorRatePerMin ?? 10,
    };

    this._history = [];
    this._errorTimestamps = [];
    this._alertCooldowns = new Map();
    this._alertCooldownMs = 60000;
    this._firedAlerts = [];
  }

  /**
   * Take a snapshot of the current pool state.
   * @returns {object}
   */
  snapshot() {
    const total = this._pool.totalCount ?? 0;
    const idle = this._pool.idleCount ?? 0;
    const waiting = this._pool.waitingCount ?? 0;
    const active = total - idle;
    const maxPool = this._pool.options?.max ?? this._pool._max ?? 10;

    return {
      totalConnections: total,
      idleConnections: idle,
      activeConnections: active,
      waitingRequests: waiting,
      maxConnections: maxPool,
      utilizationPct: maxPool > 0 ? Math.round((active / maxPool) * 100) : 0,
      idlePct: total > 0 ? Math.round((idle / total) * 100) : 100,
      timestamp: Date.now(),
    };
  }

  /**
   * Record an error event (call from pool error handler).
   */
  recordError() {
    this._errorTimestamps.push(Date.now());
    const cutoff = Date.now() - 300000;
    this._errorTimestamps = this._errorTimestamps.filter(t => t > cutoff);
  }

  /**
   * Get errors per minute over the last minute.
   * @returns {number}
   */
  getErrorRate() {
    const cutoff = Date.now() - 60000;
    return this._errorTimestamps.filter(t => t > cutoff).length;
  }

  /**
   * Check current state against thresholds and fire alerts.
   * @param {object} snap
   * @returns {Array}
   */
  checkThresholds(snap) {
    const alerts = [];

    if (snap.utilizationPct > this._thresholds.utilizationPct) {
      alerts.push({
        type: 'high_utilization',
        message: 'Pool utilization at ' + snap.utilizationPct + '% (threshold: ' + this._thresholds.utilizationPct + '%)',
        value: snap.utilizationPct,
        threshold: this._thresholds.utilizationPct,
        severity: snap.utilizationPct > 95 ? 'critical' : 'warning',
      });
    }

    if (snap.waitingRequests > this._thresholds.waitingRequests) {
      alerts.push({
        type: 'high_wait_queue',
        message: snap.waitingRequests + ' requests waiting (threshold: ' + this._thresholds.waitingRequests + ')',
        value: snap.waitingRequests,
        threshold: this._thresholds.waitingRequests,
        severity: snap.waitingRequests > 20 ? 'critical' : 'warning',
      });
    }

    if (snap.idlePct < this._thresholds.idleConnectionsPct && snap.totalConnections > 0) {
      alerts.push({
        type: 'low_idle',
        message: 'Idle connections at ' + snap.idlePct + '% (threshold: ' + this._thresholds.idleConnectionsPct + '%)',
        value: snap.idlePct,
        threshold: this._thresholds.idleConnectionsPct,
        severity: 'warning',
      });
    }

    const errorRate = this.getErrorRate();
    if (errorRate > this._thresholds.errorRatePerMin) {
      alerts.push({
        type: 'high_error_rate',
        message: errorRate + ' errors/min (threshold: ' + this._thresholds.errorRatePerMin + ')',
        value: errorRate,
        threshold: this._thresholds.errorRatePerMin,
        severity: 'critical',
      });
    }

    for (const alert of alerts) {
      this._fireAlert(alert);
    }

    return alerts;
  }

  /** @private */
  _fireAlert(alert) {
    const now = Date.now();
    const lastFired = this._alertCooldowns.get(alert.type) || 0;
    if (now - lastFired < this._alertCooldownMs) return;

    this._alertCooldowns.set(alert.type, now);
    this._firedAlerts.push(alert);
    logger.warn('Pool alert: ' + alert.type, alert);
    if (this._onAlert) {
      try { this._onAlert(alert); } catch {}
    }
  }

  /**
   * Start periodic monitoring.
   */
  start() {
    if (this._running) return;
    this._running = true;

    this._timer = setInterval(() => {
      const snap = this.snapshot();
      this._history.push(snap);
      if (this._history.length > this._historySize) {
        this._history.shift();
      }
      this.checkThresholds(snap);
    }, this._intervalMs);

    if (this._timer.unref) this._timer.unref();
  }

  /**
   * Stop monitoring.
   */
  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Get monitoring history.
   * @param {number} [count]
   * @returns {Array}
   */
  getHistory(count) {
    if (count) return this._history.slice(-count);
    return [...this._history];
  }

  /**
   * Get aggregate statistics from history.
   * @returns {object}
   */
  getAggregateStats() {
    if (this._history.length === 0) {
      return { avgUtilization: 0, maxUtilization: 0, avgWaiting: 0, maxWaiting: 0, samples: 0 };
    }

    let sumUtil = 0, maxUtil = 0, sumWait = 0, maxWait = 0;
    for (const s of this._history) {
      sumUtil += s.utilizationPct;
      if (s.utilizationPct > maxUtil) maxUtil = s.utilizationPct;
      sumWait += s.waitingRequests;
      if (s.waitingRequests > maxWait) maxWait = s.waitingRequests;
    }
    const n = this._history.length;
    return {
      avgUtilization: Math.round(sumUtil / n),
      maxUtilization: maxUtil,
      avgWaiting: Math.round(sumWait / n),
      maxWaiting: maxWait,
      samples: n,
      errorRate: this.getErrorRate(),
    };
  }

  get isRunning() { return this._running; }
  get firedAlerts() { return [...this._firedAlerts]; }
}

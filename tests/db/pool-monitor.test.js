// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PoolMonitor } from '../../src/db/pool-monitor.js';

function mockPool({ total = 10, idle = 5, waiting = 0, max = 10 } = {}) {
  return {
    totalCount: total,
    idleCount: idle,
    waitingCount: waiting,
    options: { max },
  };
}

describe('PoolMonitor', () => {
  describe('snapshot', () => {
    it('captures pool state correctly', () => {
      const monitor = new PoolMonitor(mockPool({ total: 10, idle: 3, waiting: 2, max: 10 }));
      const snap = monitor.snapshot();
      assert.equal(snap.totalConnections, 10);
      assert.equal(snap.idleConnections, 3);
      assert.equal(snap.activeConnections, 7);
      assert.equal(snap.waitingRequests, 2);
      assert.equal(snap.maxConnections, 10);
      assert.equal(snap.utilizationPct, 70);
    });

    it('handles empty pool', () => {
      const monitor = new PoolMonitor(mockPool({ total: 0, idle: 0, waiting: 0, max: 10 }));
      const snap = monitor.snapshot();
      assert.equal(snap.utilizationPct, 0);
      assert.equal(snap.idlePct, 100);
    });
  });

  describe('recordError and getErrorRate', () => {
    it('tracks error timestamps', () => {
      const monitor = new PoolMonitor(mockPool());
      assert.equal(monitor.getErrorRate(), 0);
      monitor.recordError();
      monitor.recordError();
      monitor.recordError();
      assert.equal(monitor.getErrorRate(), 3);
    });
  });

  describe('checkThresholds', () => {
    it('fires high_utilization alert', () => {
      const monitor = new PoolMonitor(mockPool(), { thresholds: { utilizationPct: 50 } });
      const snap = { utilizationPct: 60, waitingRequests: 0, idlePct: 50, totalConnections: 10 };
      const alerts = monitor.checkThresholds(snap);
      assert.ok(alerts.some(a => a.type === 'high_utilization'));
    });

    it('fires critical for >95% utilization', () => {
      const monitor = new PoolMonitor(mockPool(), { thresholds: { utilizationPct: 50 } });
      const snap = { utilizationPct: 97, waitingRequests: 0, idlePct: 3, totalConnections: 10 };
      const alerts = monitor.checkThresholds(snap);
      const highUtil = alerts.find(a => a.type === 'high_utilization');
      assert.equal(highUtil.severity, 'critical');
    });

    it('fires high_wait_queue alert', () => {
      const monitor = new PoolMonitor(mockPool(), { thresholds: { waitingRequests: 2 } });
      const snap = { utilizationPct: 50, waitingRequests: 5, idlePct: 50, totalConnections: 10 };
      const alerts = monitor.checkThresholds(snap);
      assert.ok(alerts.some(a => a.type === 'high_wait_queue'));
    });

    it('fires low_idle alert', () => {
      const monitor = new PoolMonitor(mockPool(), { thresholds: { idleConnectionsPct: 20 } });
      const snap = { utilizationPct: 50, waitingRequests: 0, idlePct: 5, totalConnections: 10 };
      const alerts = monitor.checkThresholds(snap);
      assert.ok(alerts.some(a => a.type === 'low_idle'));
    });

    it('fires high_error_rate alert', () => {
      const monitor = new PoolMonitor(mockPool(), { thresholds: { errorRatePerMin: 1 } });
      monitor.recordError();
      monitor.recordError();
      monitor.recordError();
      const snap = { utilizationPct: 10, waitingRequests: 0, idlePct: 90, totalConnections: 10 };
      const alerts = monitor.checkThresholds(snap);
      assert.ok(alerts.some(a => a.type === 'high_error_rate'));
    });

    it('returns empty array when all healthy', () => {
      const monitor = new PoolMonitor(mockPool());
      const snap = { utilizationPct: 30, waitingRequests: 0, idlePct: 70, totalConnections: 10 };
      assert.equal(monitor.checkThresholds(snap).length, 0);
    });
  });

  describe('start/stop', () => {
    it('starts and stops monitoring', () => {
      const monitor = new PoolMonitor(mockPool(), { intervalMs: 100 });
      assert.ok(!monitor.isRunning);
      monitor.start();
      assert.ok(monitor.isRunning);
      monitor.stop();
      assert.ok(!monitor.isRunning);
    });

    it('start is idempotent', () => {
      const monitor = new PoolMonitor(mockPool(), { intervalMs: 100 });
      monitor.start();
      monitor.start();
      assert.ok(monitor.isRunning);
      monitor.stop();
    });
  });

  describe('getHistory', () => {
    it('returns empty array initially', () => {
      const monitor = new PoolMonitor(mockPool());
      assert.deepEqual(monitor.getHistory(), []);
    });

    it('limits returned history with count param', () => {
      const monitor = new PoolMonitor(mockPool());
      monitor._history = [{ a: 1 }, { a: 2 }, { a: 3 }];
      assert.equal(monitor.getHistory(2).length, 2);
    });
  });

  describe('getAggregateStats', () => {
    it('returns zeros for empty history', () => {
      const monitor = new PoolMonitor(mockPool());
      const stats = monitor.getAggregateStats();
      assert.equal(stats.avgUtilization, 0);
      assert.equal(stats.samples, 0);
    });

    it('computes aggregates from history', () => {
      const monitor = new PoolMonitor(mockPool());
      monitor._history = [
        { utilizationPct: 40, waitingRequests: 2 },
        { utilizationPct: 60, waitingRequests: 4 },
        { utilizationPct: 80, waitingRequests: 6 },
      ];
      const stats = monitor.getAggregateStats();
      assert.equal(stats.avgUtilization, 60);
      assert.equal(stats.maxUtilization, 80);
      assert.equal(stats.avgWaiting, 4);
      assert.equal(stats.maxWaiting, 6);
      assert.equal(stats.samples, 3);
    });
  });

  describe('onAlert callback', () => {
    it('calls onAlert when threshold exceeded', () => {
      const received = [];
      const monitor = new PoolMonitor(mockPool(), {
        thresholds: { utilizationPct: 50 },
        onAlert: (alert) => received.push(alert),
      });
      monitor._alertCooldownMs = 0;
      const snap = { utilizationPct: 90, waitingRequests: 0, idlePct: 10, totalConnections: 10 };
      monitor.checkThresholds(snap);
      assert.ok(received.length > 0);
      assert.equal(received[0].type, 'high_utilization');
    });
  });
});

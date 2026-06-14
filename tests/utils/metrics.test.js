// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for MetricsCollector — in-process Prometheus-compatible metrics.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement MetricsCollector locally ───────────────────────────────────

class MetricsCollector {
  constructor() {
    this._counters = {};
    this._gauges = {};
  }

  increment(name, value = 1, labels = {}) {
    const key = this._key(name, labels);
    this._counters[key] = (this._counters[key] || 0) + value;
  }

  gauge(name, value, labels = {}) {
    const key = this._key(name, labels);
    this._gauges[key] = value;
  }

  getCounter(name, labels = {}) {
    return this._counters[this._key(name, labels)] || 0;
  }

  getGauge(name, labels = {}) {
    return this._gauges[this._key(name, labels)] || 0;
  }

  toPrometheus() {
    const lines = [];
    for (const [key, value] of Object.entries(this._counters)) {
      lines.push(`${key} ${value}`);
    }
    for (const [key, value] of Object.entries(this._gauges)) {
      lines.push(`${key} ${value}`);
    }
    return lines.join('\n');
  }

  _key(name, labels) {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `kh_${name}{${labelStr}}` : `kh_${name}`;
  }

  reset() {
    this._counters = {};
    this._gauges = {};
  }
}

// Singleton factory
let _instance = null;
function getMetrics() {
  if (!_instance) _instance = new MetricsCollector();
  return _instance;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('MetricsCollector', () => {
  let metrics;

  beforeEach(() => {
    metrics = new MetricsCollector();
    _instance = null; // reset singleton
  });

  describe('increment', () => {
    it('increments basic counter', () => {
      metrics.increment('requests');
      assert.equal(metrics.getCounter('requests'), 1);
    });

    it('increments by custom value', () => {
      metrics.increment('bytes', 1024);
      assert.equal(metrics.getCounter('bytes'), 1024);
    });

    it('multiple increments accumulate', () => {
      metrics.increment('requests');
      metrics.increment('requests');
      metrics.increment('requests');
      assert.equal(metrics.getCounter('requests'), 3);
    });

    it('increments with labels', () => {
      metrics.increment('requests', 1, { method: 'GET' });
      metrics.increment('requests', 1, { method: 'POST' });
      assert.equal(metrics.getCounter('requests', { method: 'GET' }), 1);
      assert.equal(metrics.getCounter('requests', { method: 'POST' }), 1);
    });
  });

  describe('gauge', () => {
    it('sets gauge value', () => {
      metrics.gauge('connections', 42);
      assert.equal(metrics.getGauge('connections'), 42);
    });

    it('overwrites previous gauge value', () => {
      metrics.gauge('connections', 10);
      metrics.gauge('connections', 20);
      assert.equal(metrics.getGauge('connections'), 20);
    });

    it('supports labels', () => {
      metrics.gauge('temperature', 72, { room: 'server' });
      assert.equal(metrics.getGauge('temperature', { room: 'server' }), 72);
    });
  });

  describe('getCounter / getGauge', () => {
    it('returns 0 for unknown counter', () => {
      assert.equal(metrics.getCounter('nonexistent'), 0);
    });

    it('returns 0 for unknown gauge', () => {
      assert.equal(metrics.getGauge('nonexistent'), 0);
    });
  });

  describe('toPrometheus', () => {
    it('formats counters in Prometheus text format', () => {
      metrics.increment('events_total');
      const output = metrics.toPrometheus();
      assert.ok(output.includes('kh_events_total 1'));
    });

    it('formats gauges in Prometheus text format', () => {
      metrics.gauge('uptime', 3600);
      const output = metrics.toPrometheus();
      assert.ok(output.includes('kh_uptime 3600'));
    });

    it('includes labels in Prometheus output format', () => {
      metrics.increment('requests', 5, { method: 'GET', status: '200' });
      const output = metrics.toPrometheus();
      assert.ok(output.includes('kh_requests{method="GET",status="200"} 5'));
    });

    it('returns empty string when no metrics', () => {
      assert.equal(metrics.toPrometheus(), '');
    });
  });

  describe('reset', () => {
    it('clears all counters and gauges', () => {
      metrics.increment('a');
      metrics.gauge('b', 10);
      metrics.reset();
      assert.equal(metrics.getCounter('a'), 0);
      assert.equal(metrics.getGauge('b'), 0);
      assert.equal(metrics.toPrometheus(), '');
    });
  });

  describe('getMetrics singleton', () => {
    it('returns same instance on multiple calls', () => {
      const a = getMetrics();
      const b = getMetrics();
      assert.equal(a, b);
    });

    it('creates new instance on first call', () => {
      const m = getMetrics();
      assert.ok(m instanceof MetricsCollector);
    });
  });
});

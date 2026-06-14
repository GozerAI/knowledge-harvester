// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Simple in-process metrics collection for Knowledge Harvester.
 * Exposes Prometheus-compatible text format at GET /metrics.
 */

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

let _instance = null;
export function getMetrics() {
  if (!_instance) _instance = new MetricsCollector();
  return _instance;
}

export { MetricsCollector };

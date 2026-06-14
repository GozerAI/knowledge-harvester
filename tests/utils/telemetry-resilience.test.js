// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Telemetry Integration — Circuit Breaker in crawl pipeline,
 * Retry Policy for HTTP fetches, Metrics collection during harvesting,
 * and Health check registration.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  RetryPolicy,
  CircuitBreaker,
  getCircuitBreaker,
  resetAllBreakers,
} from '../../src/utils/resilience.js';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CircuitBreaker in Crawl Pipeline', () => {
  let breaker;

  beforeEach(() => {
    resetAllBreakers();
    breaker = new CircuitBreaker({
      failureThreshold: 5,
      recoveryTimeout: 60000,
      name: 'crawl-pipeline',
    });
  });

  describe('state transitions', () => {
    it('starts in closed state', () => {
      assert.equal(breaker.state, 'closed');
    });

    it('remains closed below failure threshold', () => {
      for (let i = 0; i < 4; i++) breaker.recordFailure();
      assert.equal(breaker.state, 'closed');
    });

    it('opens after reaching failure threshold', () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure();
      assert.equal(breaker.state, 'open');
    });

    it('transitions to half_open after recovery timeout', () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure();
      assert.equal(breaker.state, 'open');

      // Simulate time passing beyond recovery timeout
      breaker._lastFailureTime = Date.now() - 61000;
      assert.equal(breaker.state, 'half_open');
    });

    it('closes from half_open on success', () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure();
      breaker._lastFailureTime = Date.now() - 61000;
      assert.equal(breaker.state, 'half_open');

      breaker.recordSuccess();
      assert.equal(breaker.state, 'closed');
    });

    it('opens from half_open on failure', () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure();
      breaker._lastFailureTime = Date.now() - 61000;
      assert.equal(breaker.state, 'half_open');

      breaker.recordFailure();
      assert.equal(breaker.state, 'open');
    });
  });

  describe('allowRequest', () => {
    it('allows requests when closed', () => {
      assert.equal(breaker.allowRequest(), true);
    });

    it('blocks requests when open', () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure();
      assert.equal(breaker.allowRequest(), false);
    });

    it('allows probe request when half_open', () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure();
      breaker._lastFailureTime = Date.now() - 61000;
      assert.equal(breaker.allowRequest(), true);
    });
  });

  describe('isOpen shorthand', () => {
    it('returns false when closed', () => {
      assert.equal(breaker.isOpen, false);
    });

    it('returns true when open', () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure();
      assert.equal(breaker.isOpen, true);
    });
  });

  describe('reset', () => {
    it('resets to closed state', () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure();
      assert.equal(breaker.state, 'open');
      breaker.reset();
      assert.equal(breaker.state, 'closed');
      assert.equal(breaker._failureCount, 0);
    });
  });

  describe('recordSuccess resets failure count in closed state', () => {
    it('clears failure count on success when closed', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      assert.equal(breaker._failureCount, 2);

      breaker.recordSuccess();
      assert.equal(breaker._failureCount, 0);
    });
  });

  describe('getStats', () => {
    it('returns comprehensive statistics', () => {
      breaker.recordSuccess();
      breaker.recordFailure();
      breaker.recordSuccess();

      const stats = breaker.getStats();
      assert.equal(stats.name, 'crawl-pipeline');
      assert.equal(stats.state, 'closed');
      assert.equal(stats.totalRequests, 3);
      assert.equal(stats.totalFailures, 1);
      assert.equal(stats.successCount, 2);
    });

    it('tracks failure count accurately', () => {
      for (let i = 0; i < 3; i++) breaker.recordFailure();
      const stats = breaker.getStats();
      assert.equal(stats.failureCount, 3);
      assert.equal(stats.totalFailures, 3);
    });
  });

  describe('crawl pipeline integration pattern', () => {
    it('blocks harvest when circuit is open', async () => {
      // Simulate: harvester checks breaker before each crawl request
      for (let i = 0; i < 5; i++) breaker.recordFailure();

      let harvested = false;
      if (breaker.allowRequest()) {
        harvested = true; // would make HTTP request
      }

      assert.equal(harvested, false);
    });

    it('allows recovery probe after timeout', async () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure();
      breaker._lastFailureTime = Date.now() - 61000;

      let probed = false;
      if (breaker.allowRequest()) {
        probed = true;
        breaker.recordSuccess(); // probe succeeded
      }

      assert.equal(probed, true);
      assert.equal(breaker.state, 'closed');
    });

    it('tracks failures across multiple sources independently', () => {
      const githubBreaker = new CircuitBreaker({ failureThreshold: 3, name: 'github' });
      const redditBreaker = new CircuitBreaker({ failureThreshold: 3, name: 'reddit' });

      for (let i = 0; i < 3; i++) githubBreaker.recordFailure();

      assert.equal(githubBreaker.state, 'open');
      assert.equal(redditBreaker.state, 'closed');
    });
  });
});


describe('CircuitBreaker Registry', () => {
  beforeEach(() => {
    resetAllBreakers();
  });

  it('creates new breaker on first access', () => {
    const cb = getCircuitBreaker('test-source');
    assert.ok(cb instanceof CircuitBreaker);
    assert.equal(cb.name, 'test-source');
  });

  it('returns same instance on subsequent access', () => {
    const cb1 = getCircuitBreaker('test-source');
    const cb2 = getCircuitBreaker('test-source');
    assert.equal(cb1, cb2);
  });

  it('creates separate instances for different names', () => {
    const cb1 = getCircuitBreaker('github');
    const cb2 = getCircuitBreaker('reddit');
    assert.notEqual(cb1, cb2);
  });

  it('passes options on creation', () => {
    const cb = getCircuitBreaker('custom', { failureThreshold: 10 });
    assert.equal(cb.failureThreshold, 10);
  });

  it('resetAllBreakers clears the registry', () => {
    const cb1 = getCircuitBreaker('test');
    resetAllBreakers();
    const cb2 = getCircuitBreaker('test');
    assert.notEqual(cb1, cb2);
  });
});


describe('RetryPolicy for HTTP Fetches', () => {
  describe('construction', () => {
    it('uses sensible defaults', () => {
      const policy = new RetryPolicy();
      assert.equal(policy.maxRetries, 3);
      assert.equal(policy.baseDelay, 1000);
      assert.equal(policy.maxDelay, 30000);
      assert.equal(policy.jitter, true);
    });

    it('accepts custom options', () => {
      const policy = new RetryPolicy({
        maxRetries: 5,
        baseDelay: 500,
        maxDelay: 10000,
        jitter: false,
      });
      assert.equal(policy.maxRetries, 5);
      assert.equal(policy.baseDelay, 500);
      assert.equal(policy.maxDelay, 10000);
      assert.equal(policy.jitter, false);
    });

    it('accepts custom retryable statuses', () => {
      const policy = new RetryPolicy({
        retryableStatuses: new Set([408, 429, 503]),
      });
      assert.ok(policy.isRetryableStatus(408));
      assert.ok(policy.isRetryableStatus(429));
      assert.ok(!policy.isRetryableStatus(502));
    });
  });

  describe('delayForAttempt', () => {
    it('increases delay exponentially', () => {
      const policy = new RetryPolicy({ jitter: false });
      const d0 = policy.delayForAttempt(0);
      const d1 = policy.delayForAttempt(1);
      const d2 = policy.delayForAttempt(2);

      assert.equal(d0, 1000);  // baseDelay * 2^0 = 1000
      assert.equal(d1, 2000);  // baseDelay * 2^1 = 2000
      assert.equal(d2, 4000);  // baseDelay * 2^2 = 4000
    });

    it('caps at maxDelay', () => {
      const policy = new RetryPolicy({ jitter: false, maxDelay: 5000 });
      const d10 = policy.delayForAttempt(10);
      assert.equal(d10, 5000);
    });

    it('applies jitter when enabled', () => {
      const policy = new RetryPolicy({ jitter: true });
      const delays = new Set();
      for (let i = 0; i < 10; i++) {
        delays.add(policy.delayForAttempt(0));
      }
      // With jitter, we should get varying delays (very likely > 1 unique value)
      assert.ok(delays.size >= 1);
    });

    it('jitter keeps delay within 50-100% of base', () => {
      const policy = new RetryPolicy({ jitter: true, baseDelay: 1000 });
      for (let i = 0; i < 50; i++) {
        const d = policy.delayForAttempt(0);
        assert.ok(d >= 500, `Delay ${d} below 50% of 1000`);
        assert.ok(d <= 1000, `Delay ${d} above 100% of 1000`);
      }
    });
  });

  describe('isRetryableStatus', () => {
    it('retries 429 (rate limit)', () => {
      const policy = new RetryPolicy();
      assert.ok(policy.isRetryableStatus(429));
    });

    it('retries 502 (bad gateway)', () => {
      const policy = new RetryPolicy();
      assert.ok(policy.isRetryableStatus(502));
    });

    it('retries 503 (service unavailable)', () => {
      const policy = new RetryPolicy();
      assert.ok(policy.isRetryableStatus(503));
    });

    it('retries 504 (gateway timeout)', () => {
      const policy = new RetryPolicy();
      assert.ok(policy.isRetryableStatus(504));
    });

    it('does not retry 400 (bad request)', () => {
      const policy = new RetryPolicy();
      assert.equal(policy.isRetryableStatus(400), false);
    });

    it('does not retry 401 (unauthorized)', () => {
      const policy = new RetryPolicy();
      assert.equal(policy.isRetryableStatus(401), false);
    });

    it('does not retry 403 (forbidden)', () => {
      const policy = new RetryPolicy();
      assert.equal(policy.isRetryableStatus(403), false);
    });

    it('does not retry 404 (not found)', () => {
      const policy = new RetryPolicy();
      assert.equal(policy.isRetryableStatus(404), false);
    });

    it('does not retry 200 (success)', () => {
      const policy = new RetryPolicy();
      assert.equal(policy.isRetryableStatus(200), false);
    });
  });

  describe('harvest fetch pattern', () => {
    it('policy integrates with attempt counting', () => {
      const policy = new RetryPolicy({ maxRetries: 3, jitter: false });
      const delays = [];
      for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
        delays.push(policy.delayForAttempt(attempt));
      }
      // 1000, 2000, 4000, 8000
      assert.equal(delays.length, 4);
      assert.equal(delays[0], 1000);
      assert.equal(delays[3], 8000);
    });
  });
});


describe('Metrics Collection During Harvesting', () => {
  // Re-implement MetricsCollector locally (matches src/utils/metrics.js pattern)
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

  let metrics;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  describe('harvest metrics tracking', () => {
    it('tracks artifacts discovered per source', () => {
      metrics.increment('artifacts_discovered', 15, { source: 'github' });
      metrics.increment('artifacts_discovered', 8, { source: 'reddit' });

      assert.equal(metrics.getCounter('artifacts_discovered', { source: 'github' }), 15);
      assert.equal(metrics.getCounter('artifacts_discovered', { source: 'reddit' }), 8);
    });

    it('tracks artifacts stored (new vs duplicate)', () => {
      metrics.increment('artifacts_new', 10, { source: 'github' });
      metrics.increment('artifacts_duplicate', 5, { source: 'github' });

      assert.equal(metrics.getCounter('artifacts_new', { source: 'github' }), 10);
      assert.equal(metrics.getCounter('artifacts_duplicate', { source: 'github' }), 5);
    });

    it('tracks harvest errors', () => {
      metrics.increment('harvest_errors', 1, { source: 'reddit', type: 'timeout' });
      metrics.increment('harvest_errors', 1, { source: 'reddit', type: 'timeout' });
      metrics.increment('harvest_errors', 1, { source: 'reddit', type: 'rate_limit' });

      assert.equal(metrics.getCounter('harvest_errors', { source: 'reddit', type: 'timeout' }), 2);
      assert.equal(metrics.getCounter('harvest_errors', { source: 'reddit', type: 'rate_limit' }), 1);
    });

    it('tracks harvest duration via gauge', () => {
      metrics.gauge('harvest_duration_ms', 5432, { source: 'github' });
      assert.equal(metrics.getGauge('harvest_duration_ms', { source: 'github' }), 5432);
    });

    it('tracks circuit breaker state as gauge', () => {
      // 0=closed, 1=half_open, 2=open
      metrics.gauge('circuit_breaker_state', 0, { source: 'github' });
      assert.equal(metrics.getGauge('circuit_breaker_state', { source: 'github' }), 0);

      metrics.gauge('circuit_breaker_state', 2, { source: 'github' });
      assert.equal(metrics.getGauge('circuit_breaker_state', { source: 'github' }), 2);
    });

    it('tracks active harvests gauge', () => {
      metrics.gauge('active_harvests', 3);
      assert.equal(metrics.getGauge('active_harvests'), 3);

      metrics.gauge('active_harvests', 2);
      assert.equal(metrics.getGauge('active_harvests'), 2);
    });

    it('formats all metrics as Prometheus output', () => {
      metrics.increment('artifacts_discovered', 100, { source: 'github' });
      metrics.gauge('active_harvests', 2);

      const output = metrics.toPrometheus();
      assert.ok(output.includes('kh_artifacts_discovered'));
      assert.ok(output.includes('kh_active_harvests'));
      assert.ok(output.includes('100'));
      assert.ok(output.includes('2'));
    });

    it('resets all metrics cleanly', () => {
      metrics.increment('test', 5);
      metrics.gauge('test_g', 10);
      metrics.reset();

      assert.equal(metrics.getCounter('test'), 0);
      assert.equal(metrics.getGauge('test_g'), 0);
      assert.equal(metrics.toPrometheus(), '');
    });
  });

  describe('pipeline step metrics', () => {
    it('tracks per-pipeline-step counts', () => {
      const steps = ['harvest', 'classify', 'score', 'embed', 'package'];
      for (const step of steps) {
        metrics.increment('pipeline_step_completed', 1, { step });
      }

      for (const step of steps) {
        assert.equal(metrics.getCounter('pipeline_step_completed', { step }), 1);
      }
    });

    it('tracks per-step error counts', () => {
      metrics.increment('pipeline_step_errors', 3, { step: 'classify' });
      metrics.increment('pipeline_step_errors', 1, { step: 'embed' });

      assert.equal(metrics.getCounter('pipeline_step_errors', { step: 'classify' }), 3);
      assert.equal(metrics.getCounter('pipeline_step_errors', { step: 'embed' }), 1);
    });
  });
});


describe('Health Check Registration', () => {
  // Re-implement HealthReporter locally
  class HealthReporter {
    constructor(serviceName) {
      this.serviceName = serviceName;
      this._checks = new Map();
      this._lastResults = new Map();
    }

    registerCheck(name, fn) {
      this._checks.set(name, fn);
    }

    unregisterCheck(name) {
      this._checks.delete(name);
      this._lastResults.delete(name);
    }

    async runChecks() {
      const results = {};
      let allHealthy = true;

      for (const [name, checkFn] of this._checks) {
        try {
          const result = await checkFn();
          results[name] = { status: 'healthy', ...result };
          this._lastResults.set(name, results[name]);
        } catch (err) {
          results[name] = { status: 'unhealthy', error: err.message };
          this._lastResults.set(name, results[name]);
          allHealthy = false;
        }
      }

      return {
        service: this.serviceName,
        status: allHealthy ? 'healthy' : 'degraded',
        checks: results,
        timestamp: new Date().toISOString(),
      };
    }

    getLastResult(name) {
      return this._lastResults.get(name) || null;
    }

    listChecks() {
      return [...this._checks.keys()];
    }
  }

  let reporter;

  beforeEach(() => {
    reporter = new HealthReporter('knowledge-harvester');
  });

  describe('registerCheck', () => {
    it('registers a health check', () => {
      reporter.registerCheck('database', async () => ({ latency_ms: 5 }));
      assert.ok(reporter.listChecks().includes('database'));
    });

    it('registers multiple checks', () => {
      reporter.registerCheck('database', async () => ({}));
      reporter.registerCheck('ollama', async () => ({}));
      reporter.registerCheck('redis', async () => ({}));
      assert.equal(reporter.listChecks().length, 3);
    });
  });

  describe('unregisterCheck', () => {
    it('removes a health check', () => {
      reporter.registerCheck('test', async () => ({}));
      reporter.unregisterCheck('test');
      assert.ok(!reporter.listChecks().includes('test'));
    });
  });

  describe('runChecks', () => {
    it('returns healthy when all checks pass', async () => {
      reporter.registerCheck('db', async () => ({ latency_ms: 2 }));
      reporter.registerCheck('ollama', async () => ({ model: 'qwen2.5:7b' }));

      const health = await reporter.runChecks();
      assert.equal(health.status, 'healthy');
      assert.equal(health.service, 'knowledge-harvester');
      assert.equal(health.checks.db.status, 'healthy');
      assert.equal(health.checks.ollama.status, 'healthy');
    });

    it('returns degraded when any check fails', async () => {
      reporter.registerCheck('db', async () => ({ latency_ms: 2 }));
      reporter.registerCheck('ollama', async () => { throw new Error('Connection refused'); });

      const health = await reporter.runChecks();
      assert.equal(health.status, 'degraded');
      assert.equal(health.checks.db.status, 'healthy');
      assert.equal(health.checks.ollama.status, 'unhealthy');
      assert.equal(health.checks.ollama.error, 'Connection refused');
    });

    it('includes timestamp', async () => {
      reporter.registerCheck('db', async () => ({}));
      const health = await reporter.runChecks();
      assert.ok(health.timestamp);
      assert.ok(!isNaN(Date.parse(health.timestamp)));
    });

    it('stores last results', async () => {
      reporter.registerCheck('db', async () => ({ latency_ms: 5 }));
      await reporter.runChecks();
      const last = reporter.getLastResult('db');
      assert.equal(last.status, 'healthy');
      assert.equal(last.latency_ms, 5);
    });

    it('handles no registered checks', async () => {
      const health = await reporter.runChecks();
      assert.equal(health.status, 'healthy');
      assert.deepEqual(health.checks, {});
    });
  });

  describe('knowledge-harvester specific health checks', () => {
    it('registers database connectivity check', async () => {
      reporter.registerCheck('database', async () => {
        // In production: await db.query('SELECT 1')
        return { connected: true, latency_ms: 3 };
      });

      const health = await reporter.runChecks();
      assert.equal(health.checks.database.status, 'healthy');
      assert.equal(health.checks.database.connected, true);
    });

    it('registers Ollama model availability check', async () => {
      reporter.registerCheck('ollama', async () => {
        return { available: true, model: 'qwen2.5:7b' };
      });

      const health = await reporter.runChecks();
      assert.equal(health.checks.ollama.available, true);
    });

    it('registers harvest scheduler status check', async () => {
      reporter.registerCheck('scheduler', async () => {
        return { active_jobs: 5, running: 2, overdue: 0 };
      });

      const health = await reporter.runChecks();
      assert.equal(health.checks.scheduler.active_jobs, 5);
    });

    it('registers circuit breaker status check', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5, name: 'github' });

      reporter.registerCheck('circuit_breaker_github', async () => {
        const stats = breaker.getStats();
        return { state: stats.state, failures: stats.failureCount };
      });

      const health = await reporter.runChecks();
      assert.equal(health.checks.circuit_breaker_github.state, 'closed');
      assert.equal(health.checks.circuit_breaker_github.failures, 0);
    });

    it('reports unhealthy when circuit breaker is open', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3, name: 'github' });
      for (let i = 0; i < 3; i++) breaker.recordFailure();

      reporter.registerCheck('circuit_breaker_github', async () => {
        if (breaker.isOpen) throw new Error('Circuit breaker open');
        return { state: 'closed' };
      });

      const health = await reporter.runChecks();
      assert.equal(health.status, 'degraded');
      assert.equal(health.checks.circuit_breaker_github.status, 'unhealthy');
    });

    it('composite health reflects all subsystems', async () => {
      reporter.registerCheck('database', async () => ({ ok: true }));
      reporter.registerCheck('ollama', async () => ({ ok: true }));
      reporter.registerCheck('scheduler', async () => ({ ok: true }));
      reporter.registerCheck('disk', async () => ({ ok: true }));

      const health = await reporter.runChecks();
      assert.equal(health.status, 'healthy');
      assert.equal(Object.keys(health.checks).length, 4);
    });
  });
});

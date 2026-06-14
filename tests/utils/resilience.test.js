// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  RetryPolicy,
  CircuitBreaker,
  getCircuitBreaker,
  resetAllBreakers,
  resilientFetch,
} from '../../src/utils/resilience.js';


// --- RetryPolicy ---

describe('RetryPolicy', () => {
  it('has sensible defaults', () => {
    const p = new RetryPolicy();
    assert.equal(p.maxRetries, 3);
    assert.equal(p.baseDelay, 1000);
    assert.equal(p.maxDelay, 30000);
    assert.equal(p.jitter, true);
    assert.ok(p.retryableStatuses.has(429));
    assert.ok(p.retryableStatuses.has(503));
  });

  it('computes exponential backoff without jitter', () => {
    const p = new RetryPolicy({ baseDelay: 100, jitter: false });
    assert.equal(p.delayForAttempt(0), 100);   // 100 * 2^0
    assert.equal(p.delayForAttempt(1), 200);   // 100 * 2^1
    assert.equal(p.delayForAttempt(2), 400);   // 100 * 2^2
    assert.equal(p.delayForAttempt(3), 800);   // 100 * 2^3
  });

  it('caps delay at maxDelay', () => {
    const p = new RetryPolicy({ baseDelay: 1000, maxDelay: 2000, jitter: false });
    assert.equal(p.delayForAttempt(0), 1000);
    assert.equal(p.delayForAttempt(1), 2000);
    assert.equal(p.delayForAttempt(5), 2000); // would be 32000, capped
  });

  it('jitter produces values in [delay*0.5, delay]', () => {
    const p = new RetryPolicy({ baseDelay: 1000, jitter: true });
    const samples = Array.from({ length: 50 }, () => p.delayForAttempt(0));
    for (const s of samples) {
      assert.ok(s >= 500, `${s} should be >= 500`);
      assert.ok(s <= 1000, `${s} should be <= 1000`);
    }
    // Check variance — not all samples should be identical
    const unique = new Set(samples.map(s => Math.round(s)));
    assert.ok(unique.size > 1, 'Jitter should produce variance');
  });

  it('identifies retryable statuses', () => {
    const p = new RetryPolicy();
    assert.ok(p.isRetryableStatus(429));
    assert.ok(p.isRetryableStatus(502));
    assert.ok(p.isRetryableStatus(503));
    assert.ok(p.isRetryableStatus(504));
    assert.ok(!p.isRetryableStatus(400));
    assert.ok(!p.isRetryableStatus(404));
    assert.ok(!p.isRetryableStatus(500));
  });

  it('accepts custom retryable statuses as array', () => {
    const p = new RetryPolicy({ retryableStatuses: [500, 502] });
    assert.ok(p.isRetryableStatus(500));
    assert.ok(p.isRetryableStatus(502));
    assert.ok(!p.isRetryableStatus(429));
  });
});


// --- CircuitBreaker ---

describe('CircuitBreaker', () => {
  it('starts in closed state', () => {
    const cb = new CircuitBreaker();
    assert.equal(cb.state, 'closed');
    assert.ok(cb.allowRequest());
    assert.equal(cb.isOpen, false);
  });

  it('opens after failure threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.state, 'closed');
    cb.recordFailure();
    assert.equal(cb.state, 'open');
    assert.ok(!cb.allowRequest());
    assert.equal(cb.isOpen, true);
  });

  it('success resets failure count', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    // Count should be reset; two more failures should not open
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.state, 'closed');
  });

  it('transitions to half_open after recovery timeout', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeout: 100 });
    cb.recordFailure();
    assert.equal(cb.state, 'open');
    // Simulate time passing
    cb._lastFailureTime = Date.now() - 200;
    assert.equal(cb.state, 'half_open');
    assert.ok(cb.allowRequest());
  });

  it('half_open success transitions to closed', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeout: 50 });
    cb.recordFailure();
    cb._lastFailureTime = Date.now() - 100;
    assert.equal(cb.state, 'half_open');
    cb.recordSuccess();
    assert.equal(cb.state, 'closed');
  });

  it('half_open failure transitions back to open', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeout: 50 });
    cb.recordFailure();
    cb._lastFailureTime = Date.now() - 100;
    assert.equal(cb.state, 'half_open');
    cb.recordFailure();
    assert.equal(cb.state, 'open');
  });

  it('getStats returns accurate counters', () => {
    const cb = new CircuitBreaker({ name: 'test-svc', failureThreshold: 5 });
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordFailure();
    const stats = cb.getStats();
    assert.equal(stats.name, 'test-svc');
    assert.equal(stats.state, 'closed');
    assert.equal(stats.totalRequests, 3);
    assert.equal(stats.totalFailures, 1);
    assert.equal(stats.successCount, 2);
    assert.equal(stats.failureCount, 1);
  });

  it('reset restores closed state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    cb.recordFailure();
    assert.equal(cb.state, 'open');
    cb.reset();
    assert.equal(cb.state, 'closed');
    assert.ok(cb.allowRequest());
  });
});


// --- Registry ---

describe('CircuitBreaker registry', () => {
  beforeEach(() => {
    resetAllBreakers();
  });

  it('creates a new breaker on first call', () => {
    const cb = getCircuitBreaker('svc-a');
    assert.ok(cb instanceof CircuitBreaker);
    assert.equal(cb.name, 'svc-a');
  });

  it('returns same instance for same name', () => {
    const a = getCircuitBreaker('svc-b');
    const b = getCircuitBreaker('svc-b');
    assert.equal(a, b);
  });

  it('returns different instances for different names', () => {
    const a = getCircuitBreaker('svc-c');
    const b = getCircuitBreaker('svc-d');
    assert.notEqual(a, b);
  });

  it('resetAllBreakers clears the registry', () => {
    const a = getCircuitBreaker('svc-e');
    a.recordFailure();
    resetAllBreakers();
    const b = getCircuitBreaker('svc-e');
    assert.notEqual(a, b);
    assert.equal(b._failureCount, 0);
  });
});


// --- resilientFetch with circuit breaker ---

describe('resilientFetch', () => {
  beforeEach(() => {
    resetAllBreakers();
  });

  it('returns null when circuit breaker is open', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    cb.recordFailure(); // opens the breaker
    assert.equal(cb.state, 'open');

    const result = await resilientFetch('http://localhost:9999/nope', {
      circuitBreaker: cb,
    });
    assert.equal(result, null);
    // Should not have incremented requests (short-circuited)
    assert.equal(cb._totalRequests, 1); // only the initial failure
  });

  it('returns null on connection error (no server)', async () => {
    // Port 19999 should have nothing listening
    const policy = new RetryPolicy({ maxRetries: 0 });
    const result = await resilientFetch('http://127.0.0.1:19999/nothing', {
      retryPolicy: policy,
      timeout: 500,
    });
    assert.equal(result, null);
  });

  it('records failure to circuit breaker on connection error', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    const policy = new RetryPolicy({ maxRetries: 0 });
    await resilientFetch('http://127.0.0.1:19999/nothing', {
      retryPolicy: policy,
      circuitBreaker: cb,
      timeout: 500,
    });
    assert.equal(cb._totalFailures, 1);
  });
});

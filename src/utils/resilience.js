// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Production resilience utilities — retry with exponential backoff + circuit breaker.
 * Zero dependencies.
 */

/**
 * @typedef {Object} RetryOptions
 * @property {number} [maxRetries=3]
 * @property {number} [baseDelay=1000] - milliseconds
 * @property {number} [maxDelay=30000] - milliseconds
 * @property {boolean} [jitter=true]
 * @property {Set<number>} [retryableStatuses] - HTTP status codes to retry
 */

const DEFAULT_RETRYABLE = new Set([429, 502, 503, 504]);

class RetryPolicy {
  constructor({
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    jitter = true,
    retryableStatuses = DEFAULT_RETRYABLE,
  } = {}) {
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
    this.jitter = jitter;
    this.retryableStatuses = retryableStatuses instanceof Set
      ? retryableStatuses
      : new Set(retryableStatuses);
  }

  delayForAttempt(attempt) {
    let delay = Math.min(this.baseDelay * 2 ** attempt, this.maxDelay);
    if (this.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }
    return delay;
  }

  isRetryableStatus(status) {
    return this.retryableStatuses.has(status);
  }
}

class CircuitBreaker {
  constructor({
    failureThreshold = 5,
    recoveryTimeout = 60000,
    name = 'unnamed',
  } = {}) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
    this.name = name;
    this._state = 'closed';
    this._failureCount = 0;
    this._lastFailureTime = 0;
    this._successCount = 0;
    this._totalRequests = 0;
    this._totalFailures = 0;
  }

  get state() {
    if (this._state === 'open') {
      if (Date.now() - this._lastFailureTime >= this.recoveryTimeout) {
        this._state = 'half_open';
      }
    }
    return this._state;
  }

  get isOpen() {
    return this.state === 'open';
  }

  allowRequest() {
    const s = this.state;
    return s === 'closed' || s === 'half_open';
  }

  recordSuccess() {
    this._totalRequests++;
    this._successCount++;
    if (this._state === 'half_open') {
      this._state = 'closed';
      this._failureCount = 0;
    } else if (this._state === 'closed') {
      this._failureCount = 0;
    }
  }

  recordFailure() {
    this._totalRequests++;
    this._totalFailures++;
    this._failureCount++;
    this._lastFailureTime = Date.now();

    if (this._state === 'half_open') {
      this._state = 'open';
    } else if (this._state === 'closed' && this._failureCount >= this.failureThreshold) {
      this._state = 'open';
    }
  }

  getStats() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this._failureCount,
      totalRequests: this._totalRequests,
      totalFailures: this._totalFailures,
      successCount: this._successCount,
    };
  }

  reset() {
    this._state = 'closed';
    this._failureCount = 0;
    this._lastFailureTime = 0;
  }
}

// Global circuit breaker registry
const _breakers = new Map();

function getCircuitBreaker(name, options = {}) {
  if (!_breakers.has(name)) {
    _breakers.set(name, new CircuitBreaker({ name, ...options }));
  }
  return _breakers.get(name);
}

function resetAllBreakers() {
  _breakers.clear();
}

/**
 * Resilient HTTP fetch with retry + circuit breaker.
 * Uses Node.js built-in fetch (Node 18+).
 * Returns parsed JSON or null on failure.
 */
async function resilientFetch(url, {
  method = 'GET',
  body = null,
  headers = {},
  timeout = 5000,
  retryPolicy = null,
  circuitBreaker = null,
} = {}) {
  const policy = retryPolicy || new RetryPolicy();

  if (circuitBreaker && !circuitBreaker.allowRequest()) {
    return null;
  }

  let lastError = null;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const fetchOptions = {
        method,
        headers: { Accept: 'application/json', ...headers },
        signal: controller.signal,
      };
      if (body && method !== 'GET') {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        fetchOptions.headers['Content-Type'] = 'application/json';
      }

      const resp = await fetch(url, fetchOptions);
      clearTimeout(timer);

      if (!resp.ok) {
        if (policy.isRetryableStatus(resp.status) && attempt < policy.maxRetries) {
          const delay = policy.delayForAttempt(attempt);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        if (circuitBreaker) circuitBreaker.recordFailure();
        return null;
      }

      const data = await resp.json();
      if (circuitBreaker) circuitBreaker.recordSuccess();
      return data;

    } catch (err) {
      lastError = err;
      if (attempt < policy.maxRetries) {
        const delay = policy.delayForAttempt(attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }
  }

  if (circuitBreaker) circuitBreaker.recordFailure();
  return null;
}

export {
  RetryPolicy,
  CircuitBreaker,
  getCircuitBreaker,
  resetAllBreakers,
  resilientFetch,
};

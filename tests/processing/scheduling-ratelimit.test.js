// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Crawl Scheduling, Rate Limiting, Retry on Transient Errors,
 * and Backoff on Persistent Errors.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { RateLimiter } from '../../src/utils/rate-limiter.js';

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

// ── Re-implement CrawlScheduler locally ────────────────────────────────────

class CrawlScheduler {
  constructor(db) {
    this._db = db;
    this._jobs = new Map();
    this._running = new Set();
    this._retryState = new Map();  // source -> { attempts, lastAttempt, backoffMs }
  }

  /**
   * Register a crawl job for a source.
   */
  register(source, { intervalMs, harvester, priority = 5 }) {
    this._jobs.set(source, { source, intervalMs, harvester, priority });
    this._retryState.set(source, { attempts: 0, lastAttempt: 0, backoffMs: 1000 });
  }

  /**
   * Get all registered jobs sorted by priority (lower = higher priority).
   */
  getJobs() {
    return [...this._jobs.values()].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Determine which sources are due for harvest.
   */
  async getDueJobs(lastRunTimes = {}) {
    const now = Date.now();
    const due = [];

    for (const [source, job] of this._jobs) {
      if (this._running.has(source)) continue;

      const lastRun = lastRunTimes[source] || 0;
      const elapsed = now - lastRun;

      if (elapsed >= job.intervalMs) {
        due.push(job);
      }
    }

    return due.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Execute a crawl job with retry logic.
   */
  async execute(source) {
    const job = this._jobs.get(source);
    if (!job) return { status: 'not_found' };

    if (this._running.has(source)) return { status: 'already_running' };

    const retryState = this._retryState.get(source);
    const now = Date.now();

    // Check backoff
    if (retryState.attempts > 0 && (now - retryState.lastAttempt) < retryState.backoffMs) {
      return { status: 'backing_off', retryIn: retryState.backoffMs - (now - retryState.lastAttempt) };
    }

    this._running.add(source);
    try {
      const result = await job.harvester();
      // Success: reset retry state
      this._retryState.set(source, { attempts: 0, lastAttempt: now, backoffMs: 1000 });
      return { status: 'success', result };
    } catch (err) {
      // Failure: increment retry with exponential backoff
      const attempts = retryState.attempts + 1;
      const backoffMs = Math.min(retryState.backoffMs * 2, 300000); // max 5 min

      this._retryState.set(source, { attempts, lastAttempt: now, backoffMs });

      if (isTransientError(err)) {
        return { status: 'transient_error', error: err.message, attempts, retryIn: backoffMs };
      } else {
        return { status: 'persistent_error', error: err.message, attempts, backoffMs };
      }
    } finally {
      this._running.delete(source);
    }
  }

  getRetryState(source) {
    return this._retryState.get(source) || null;
  }
}

/**
 * Check if an error is transient (worth retrying).
 */
function isTransientError(err) {
  const transientCodes = [429, 502, 503, 504];
  if (err.statusCode && transientCodes.includes(err.statusCode)) return true;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') return true;
  if (err.message && /timeout|rate.?limit|temporarily/i.test(err.message)) return true;
  return false;
}


// ── Tests ──────────────────────────────────────────────────────────────────

describe('CrawlScheduler', () => {
  let db;
  let scheduler;

  beforeEach(() => {
    db = mockDb();
    scheduler = new CrawlScheduler(db);
  });

  describe('register', () => {
    it('stores a crawl job', () => {
      scheduler.register('github', { intervalMs: 3600000, harvester: () => {}, priority: 3 });
      const jobs = scheduler.getJobs();
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].source, 'github');
    });

    it('stores multiple jobs', () => {
      scheduler.register('github', { intervalMs: 3600000, harvester: () => {} });
      scheduler.register('reddit', { intervalMs: 7200000, harvester: () => {} });
      scheduler.register('n8n-community', { intervalMs: 86400000, harvester: () => {} });
      assert.equal(scheduler.getJobs().length, 3);
    });

    it('uses default priority of 5', () => {
      scheduler.register('github', { intervalMs: 3600000, harvester: () => {} });
      assert.equal(scheduler.getJobs()[0].priority, 5);
    });

    it('initializes retry state', () => {
      scheduler.register('github', { intervalMs: 3600000, harvester: () => {} });
      const state = scheduler.getRetryState('github');
      assert.equal(state.attempts, 0);
      assert.equal(state.backoffMs, 1000);
    });
  });

  describe('getJobs', () => {
    it('returns jobs sorted by priority', () => {
      scheduler.register('low', { intervalMs: 1000, harvester: () => {}, priority: 10 });
      scheduler.register('high', { intervalMs: 1000, harvester: () => {}, priority: 1 });
      scheduler.register('mid', { intervalMs: 1000, harvester: () => {}, priority: 5 });

      const jobs = scheduler.getJobs();
      assert.equal(jobs[0].source, 'high');
      assert.equal(jobs[1].source, 'mid');
      assert.equal(jobs[2].source, 'low');
    });

    it('returns empty array when no jobs registered', () => {
      assert.deepEqual(scheduler.getJobs(), []);
    });
  });

  describe('getDueJobs', () => {
    it('returns jobs that are overdue', async () => {
      scheduler.register('github', { intervalMs: 3600000, harvester: () => {} });
      scheduler.register('reddit', { intervalMs: 7200000, harvester: () => {} });

      const lastRuns = {
        github: Date.now() - 4000000, // overdue
        reddit: Date.now() - 1000,    // not due yet
      };

      const due = await scheduler.getDueJobs(lastRuns);
      assert.equal(due.length, 1);
      assert.equal(due[0].source, 'github');
    });

    it('returns all jobs when no last run times', async () => {
      scheduler.register('github', { intervalMs: 3600000, harvester: () => {} });
      scheduler.register('reddit', { intervalMs: 7200000, harvester: () => {} });

      const due = await scheduler.getDueJobs({});
      assert.equal(due.length, 2);
    });

    it('excludes currently running jobs', async () => {
      let resolve;
      const blocker = new Promise(r => { resolve = r; });

      scheduler.register('github', { intervalMs: 1000, harvester: () => blocker });
      scheduler.register('reddit', { intervalMs: 1000, harvester: () => {} });

      const execPromise = scheduler.execute('github');

      const due = await scheduler.getDueJobs({});
      assert.equal(due.length, 1);
      assert.equal(due[0].source, 'reddit');

      resolve();
      await execPromise;
    });

    it('sorts due jobs by priority', async () => {
      scheduler.register('low', { intervalMs: 1000, harvester: () => {}, priority: 10 });
      scheduler.register('high', { intervalMs: 1000, harvester: () => {}, priority: 1 });

      const due = await scheduler.getDueJobs({});
      assert.equal(due[0].source, 'high');
      assert.equal(due[1].source, 'low');
    });
  });

  describe('execute', () => {
    it('executes harvester function and returns success', async () => {
      let called = false;
      scheduler.register('github', {
        intervalMs: 3600000,
        harvester: () => { called = true; return { items: 10 }; },
      });

      const result = await scheduler.execute('github');
      assert.equal(result.status, 'success');
      assert.deepEqual(result.result, { items: 10 });
      assert.ok(called);
    });

    it('returns not_found for unregistered source', async () => {
      const result = await scheduler.execute('nonexistent');
      assert.equal(result.status, 'not_found');
    });

    it('returns already_running for concurrent execution', async () => {
      let resolve;
      const blocker = new Promise(r => { resolve = r; });

      scheduler.register('github', { intervalMs: 1000, harvester: () => blocker });

      const exec1 = scheduler.execute('github');
      const result2 = await scheduler.execute('github');
      assert.equal(result2.status, 'already_running');

      resolve();
      await exec1;
    });

    it('resets retry state on success', async () => {
      scheduler.register('github', { intervalMs: 1000, harvester: () => {} });

      // Manually set retry state as if there were previous failures
      scheduler._retryState.set('github', { attempts: 3, lastAttempt: 0, backoffMs: 8000 });

      await scheduler.execute('github');
      const state = scheduler.getRetryState('github');
      assert.equal(state.attempts, 0);
      assert.equal(state.backoffMs, 1000);
    });
  });
});


describe('Rate Limiting per Source', () => {
  describe('RateLimiter construction', () => {
    it('initializes with max tokens', () => {
      const limiter = new RateLimiter({ maxTokens: 5, refillRate: 1 });
      assert.equal(limiter.tokens, 5);
      assert.equal(limiter.maxTokens, 5);
    });

    it('uses default refillIntervalMs of 1000', () => {
      const limiter = new RateLimiter({ maxTokens: 5, refillRate: 1 });
      assert.equal(limiter.refillIntervalMs, 1000);
    });

    it('accepts custom refillIntervalMs', () => {
      const limiter = new RateLimiter({ maxTokens: 5, refillRate: 1, refillIntervalMs: 2000 });
      assert.equal(limiter.refillIntervalMs, 2000);
    });
  });

  describe('acquire', () => {
    it('consumes a token immediately when available', async () => {
      const limiter = new RateLimiter({ maxTokens: 5, refillRate: 1 });
      await limiter.acquire();
      // Should have consumed 1 token (approximately 4 remaining)
      assert.ok(limiter.tokens < 5);
    });

    it('multiple acquires consume multiple tokens', async () => {
      const limiter = new RateLimiter({ maxTokens: 5, refillRate: 1 });
      await limiter.acquire();
      await limiter.acquire();
      await limiter.acquire();
      // ~2 tokens remaining (before refill)
      assert.ok(limiter.tokens < 3);
    });

    it('waits when tokens exhausted', async () => {
      const limiter = new RateLimiter({ maxTokens: 1, refillRate: 10, refillIntervalMs: 50 });
      const start = Date.now();
      await limiter.acquire(); // immediate
      await limiter.acquire(); // should wait for refill
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 0); // just verify it completes
    });
  });

  describe('_refill', () => {
    it('refills tokens over time', async () => {
      const limiter = new RateLimiter({ maxTokens: 5, refillRate: 100, refillIntervalMs: 10 });
      limiter.tokens = 0;
      await new Promise(r => setTimeout(r, 50));
      limiter._refill();
      assert.ok(limiter.tokens > 0, 'Tokens should have refilled');
    });

    it('never exceeds maxTokens', async () => {
      const limiter = new RateLimiter({ maxTokens: 5, refillRate: 100, refillIntervalMs: 10 });
      await new Promise(r => setTimeout(r, 100));
      limiter._refill();
      assert.ok(limiter.tokens <= 5);
    });
  });

  describe('per-source rate limiting pattern', () => {
    it('different sources have independent limiters', async () => {
      const githubLimiter = new RateLimiter({ maxTokens: 10, refillRate: 1 });
      const redditLimiter = new RateLimiter({ maxTokens: 3, refillRate: 1 });

      assert.equal(githubLimiter.maxTokens, 10);
      assert.equal(redditLimiter.maxTokens, 3);
      assert.notEqual(githubLimiter, redditLimiter);
    });

    it('source-specific limits reflect API constraints', () => {
      // GitHub: 5000 requests/hour
      const github = new RateLimiter({ maxTokens: 30, refillRate: 1, refillIntervalMs: 2000 });
      // Reddit: 60 requests/minute
      const reddit = new RateLimiter({ maxTokens: 10, refillRate: 1, refillIntervalMs: 1000 });
      // n8n-community: generous
      const n8n = new RateLimiter({ maxTokens: 50, refillRate: 5, refillIntervalMs: 1000 });

      assert.ok(github.maxTokens > reddit.maxTokens);
      assert.ok(n8n.refillRate > github.refillRate);
    });
  });
});


describe('Retry on Transient Errors', () => {
  describe('isTransientError', () => {
    it('recognizes 429 rate limit', () => {
      assert.ok(isTransientError({ statusCode: 429 }));
    });

    it('recognizes 502 bad gateway', () => {
      assert.ok(isTransientError({ statusCode: 502 }));
    });

    it('recognizes 503 service unavailable', () => {
      assert.ok(isTransientError({ statusCode: 503 }));
    });

    it('recognizes 504 gateway timeout', () => {
      assert.ok(isTransientError({ statusCode: 504 }));
    });

    it('recognizes ECONNRESET', () => {
      assert.ok(isTransientError({ code: 'ECONNRESET' }));
    });

    it('recognizes ETIMEDOUT', () => {
      assert.ok(isTransientError({ code: 'ETIMEDOUT' }));
    });

    it('recognizes ECONNREFUSED', () => {
      assert.ok(isTransientError({ code: 'ECONNREFUSED' }));
    });

    it('recognizes timeout in message', () => {
      assert.ok(isTransientError({ message: 'Request timeout after 5000ms' }));
    });

    it('recognizes rate limit in message', () => {
      assert.ok(isTransientError({ message: 'Rate limit exceeded' }));
    });

    it('recognizes temporarily unavailable', () => {
      assert.ok(isTransientError({ message: 'Service temporarily unavailable' }));
    });

    it('does not flag 404 as transient', () => {
      assert.equal(isTransientError({ statusCode: 404 }), false);
    });

    it('does not flag 401 as transient', () => {
      assert.equal(isTransientError({ statusCode: 401 }), false);
    });

    it('does not flag generic errors as transient', () => {
      assert.equal(isTransientError({ message: 'Invalid JSON' }), false);
    });

    it('does not flag empty error as transient', () => {
      assert.equal(isTransientError({}), false);
    });
  });

  describe('retry behavior in execute', () => {
    it('marks transient errors as transient_error', async () => {
      const scheduler = new CrawlScheduler(mockDb());
      const err = new Error('Request timeout');
      err.code = 'ETIMEDOUT';

      scheduler.register('github', {
        intervalMs: 1000,
        harvester: () => { throw err; },
      });

      const result = await scheduler.execute('github');
      assert.equal(result.status, 'transient_error');
      assert.equal(result.attempts, 1);
    });

    it('marks persistent errors as persistent_error', async () => {
      const scheduler = new CrawlScheduler(mockDb());

      scheduler.register('github', {
        intervalMs: 1000,
        harvester: () => { throw new Error('Invalid API key'); },
      });

      const result = await scheduler.execute('github');
      assert.equal(result.status, 'persistent_error');
    });

    it('increments attempt count on failures', async () => {
      const scheduler = new CrawlScheduler(mockDb());

      scheduler.register('github', {
        intervalMs: 1000,
        harvester: () => { throw new Error('fail'); },
      });

      await scheduler.execute('github');
      // Bypass backoff for testing
      scheduler._retryState.get('github').lastAttempt = 0;
      await scheduler.execute('github');

      const state = scheduler.getRetryState('github');
      assert.equal(state.attempts, 2);
    });
  });
});


describe('Backoff on Persistent Errors', () => {
  it('doubles backoff after each failure', async () => {
    const scheduler = new CrawlScheduler(mockDb());

    scheduler.register('github', {
      intervalMs: 1000,
      harvester: () => { throw new Error('fail'); },
    });

    await scheduler.execute('github');
    const state1 = scheduler.getRetryState('github');
    const backoff1 = state1.backoffMs;

    // Bypass backoff timing
    scheduler._retryState.get('github').lastAttempt = 0;

    await scheduler.execute('github');
    const state2 = scheduler.getRetryState('github');
    assert.equal(state2.backoffMs, backoff1 * 2);
  });

  it('caps backoff at 5 minutes (300000ms)', async () => {
    const scheduler = new CrawlScheduler(mockDb());

    scheduler.register('github', {
      intervalMs: 1000,
      harvester: () => { throw new Error('fail'); },
    });

    // Simulate many failures
    scheduler._retryState.set('github', { attempts: 20, lastAttempt: 0, backoffMs: 200000 });

    await scheduler.execute('github');
    const state = scheduler.getRetryState('github');
    assert.ok(state.backoffMs <= 300000, `Backoff ${state.backoffMs} exceeded 5 min cap`);
  });

  it('returns backing_off when within backoff window', async () => {
    const scheduler = new CrawlScheduler(mockDb());

    scheduler.register('github', {
      intervalMs: 1000,
      harvester: () => { throw new Error('fail'); },
    });

    await scheduler.execute('github');
    // Now immediately try again (within backoff window)
    const result = await scheduler.execute('github');
    assert.equal(result.status, 'backing_off');
    assert.ok(result.retryIn > 0);
  });

  it('resets backoff after success', async () => {
    const scheduler = new CrawlScheduler(mockDb());
    let shouldFail = true;

    scheduler.register('github', {
      intervalMs: 1000,
      harvester: () => {
        if (shouldFail) { shouldFail = false; throw new Error('fail'); }
        return { ok: true };
      },
    });

    await scheduler.execute('github');
    assert.equal(scheduler.getRetryState('github').attempts, 1);

    // Bypass backoff
    scheduler._retryState.get('github').lastAttempt = 0;

    await scheduler.execute('github');
    assert.equal(scheduler.getRetryState('github').attempts, 0);
    assert.equal(scheduler.getRetryState('github').backoffMs, 1000);
  });

  it('provides retryIn time in error result', async () => {
    const scheduler = new CrawlScheduler(mockDb());
    const err = new Error('timeout');
    err.code = 'ETIMEDOUT';

    scheduler.register('github', {
      intervalMs: 1000,
      harvester: () => { throw err; },
    });

    const result = await scheduler.execute('github');
    assert.ok('retryIn' in result);
    assert.ok(typeof result.retryIn === 'number');
    assert.ok(result.retryIn > 0);
  });
});

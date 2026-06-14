// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../../src/utils/rate-limiter.js';


describe('RateLimiter', () => {
  it('initializes with full token bucket', () => {
    const rl = new RateLimiter({ maxTokens: 5, refillRate: 1 });
    assert.equal(rl.tokens, 5);
    assert.equal(rl.maxTokens, 5);
  });

  it('acquire consumes a token', async () => {
    const rl = new RateLimiter({ maxTokens: 3, refillRate: 1 });
    await rl.acquire();
    assert.ok(rl.tokens < 3);
  });

  it('drains tokens after repeated acquire', async () => {
    const rl = new RateLimiter({ maxTokens: 2, refillRate: 1, refillIntervalMs: 60000 });
    await rl.acquire();
    await rl.acquire();
    // With 60s refill interval, tokens should be near zero
    assert.ok(rl.tokens < 1, `Expected < 1, got ${rl.tokens}`);
  });

  it('refills tokens over time', async () => {
    const rl = new RateLimiter({ maxTokens: 5, refillRate: 10, refillIntervalMs: 100 });
    // Drain
    rl.tokens = 0;
    rl.lastRefill = Date.now() - 200; // 200ms ago
    rl._refill();
    assert.ok(rl.tokens > 0);
  });

  it('does not exceed maxTokens on refill', () => {
    const rl = new RateLimiter({ maxTokens: 3, refillRate: 100, refillIntervalMs: 100 });
    rl.lastRefill = Date.now() - 10000;
    rl._refill();
    assert.equal(rl.tokens, 3);
  });

  it('uses default refillIntervalMs of 1000', () => {
    const rl = new RateLimiter({ maxTokens: 5, refillRate: 1 });
    assert.equal(rl.refillIntervalMs, 1000);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Token-bucket rate limiter.
 * Each harvester creates its own instance with source-appropriate limits.
 *
 * Usage:
 *   const limiter = new RateLimiter({ maxTokens: 5, refillRate: 1, refillIntervalMs: 2000 });
 *   await limiter.acquire(); // waits until a token is available
 */
export class RateLimiter {
  /**
   * @param {object} options
   * @param {number} options.maxTokens     Maximum tokens in the bucket
   * @param {number} options.refillRate    Tokens added per refill interval
   * @param {number} options.refillIntervalMs  Milliseconds between refills (default 1000)
   */
  constructor({ maxTokens, refillRate, refillIntervalMs = 1000 }) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.refillIntervalMs = refillIntervalMs;
    this.lastRefill = Date.now();
  }

  /**
   * Wait until a token is available, then consume it.
   */
  async acquire() {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Calculate wait time for one token to become available
    const waitMs = Math.ceil(
      ((1 - this.tokens) / this.refillRate) * this.refillIntervalMs
    );
    await new Promise(r => setTimeout(r, waitMs));
    this._refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const refillCount = (elapsed / this.refillIntervalMs) * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + refillCount);
    this.lastRefill = now;
  }
}

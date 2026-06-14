// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Adaptive batch sizing for API calls (item #213).
 *
 * Dynamically adjusts batch sizes based on observed latency, error rates,
 * and throughput. Uses AIMD (Additive Increase / Multiplicative Decrease).
 */

import { logger } from '../utils/logger.js';

export class AdaptiveBatchSizer {
  /**
   * @param {object} [options]
   * @param {number} [options.initialSize=10]
   * @param {number} [options.minSize=1]
   * @param {number} [options.maxSize=200]
   * @param {number} [options.targetLatencyMs=2000]
   * @param {number} [options.maxErrorRate=0.1]
   * @param {number} [options.increaseStep=2]
   * @param {number} [options.decreaseFactor=0.5]
   * @param {number} [options.windowSize=20]
   */
  constructor({
    initialSize = 10,
    minSize = 1,
    maxSize = 200,
    targetLatencyMs = 2000,
    maxErrorRate = 0.1,
    increaseStep = 2,
    decreaseFactor = 0.5,
    windowSize = 20,
  } = {}) {
    this._currentSize = initialSize;
    this._minSize = minSize;
    this._maxSize = maxSize;
    this._targetLatencyMs = targetLatencyMs;
    this._maxErrorRate = maxErrorRate;
    this._increaseStep = increaseStep;
    this._decreaseFactor = decreaseFactor;
    this._windowSize = windowSize;

    this._observations = [];
    this._totalBatches = 0;
    this._totalItems = 0;
    this._adjustments = 0;
  }

  /**
   * Get the current recommended batch size.
   * @returns {number}
   */
  get currentSize() {
    return this._currentSize;
  }

  /**
   * Record an observation from a completed batch.
   * @param {object} observation
   * @param {number} observation.latencyMs
   * @param {number} observation.batchSize
   * @param {number} observation.errors
   * @param {number} observation.total
   */
  record(observation) {
    this._observations.push({
      ...observation,
      ts: Date.now(),
    });

    if (this._observations.length > this._windowSize) {
      this._observations.shift();
    }

    this._totalBatches++;
    this._totalItems += observation.total || observation.batchSize;
    this._adjust();
  }

  /** @private AIMD adjustment */
  _adjust() {
    if (this._observations.length < 3) return;

    const recent = this._observations.slice(-this._windowSize);
    const avgLatency = recent.reduce((s, o) => s + o.latencyMs, 0) / recent.length;
    const totalErrors = recent.reduce((s, o) => s + (o.errors || 0), 0);
    const totalItems = recent.reduce((s, o) => s + (o.total || o.batchSize), 0);
    const errorRate = totalItems > 0 ? totalErrors / totalItems : 0;

    const prevSize = this._currentSize;

    if (errorRate > this._maxErrorRate) {
      this._currentSize = Math.max(
        this._minSize,
        Math.floor(this._currentSize * this._decreaseFactor)
      );
    } else if (avgLatency > this._targetLatencyMs) {
      this._currentSize = Math.max(
        this._minSize,
        Math.floor(this._currentSize * this._decreaseFactor)
      );
    } else if (avgLatency < this._targetLatencyMs * 0.7 && errorRate < this._maxErrorRate * 0.5) {
      this._currentSize = Math.min(
        this._maxSize,
        this._currentSize + this._increaseStep
      );
    }

    if (this._currentSize !== prevSize) {
      this._adjustments++;
    }
  }

  /**
   * Get rolling statistics from the observation window.
   * @returns {object}
   */
  getWindowStats() {
    if (this._observations.length === 0) {
      return { avgLatency: 0, p95Latency: 0, errorRate: 0, throughput: 0, samples: 0 };
    }

    const obs = this._observations;
    const latencies = obs.map(o => o.latencyMs).sort((a, b) => a - b);
    const avgLatency = latencies.reduce((s, l) => s + l, 0) / latencies.length;
    const p95Idx = Math.floor(latencies.length * 0.95);
    const p95Latency = latencies[Math.min(p95Idx, latencies.length - 1)];
    const totalErrors = obs.reduce((s, o) => s + (o.errors || 0), 0);
    const totalItems = obs.reduce((s, o) => s + (o.total || o.batchSize), 0);
    const errorRate = totalItems > 0 ? totalErrors / totalItems : 0;

    const timeSpanMs = obs.length > 1 ? obs[obs.length - 1].ts - obs[0].ts : 1;
    const throughput = timeSpanMs > 0 ? (totalItems / timeSpanMs) * 1000 : 0;

    return {
      avgLatency: Math.round(avgLatency),
      p95Latency: Math.round(p95Latency),
      errorRate: parseFloat(errorRate.toFixed(4)),
      throughput: Math.round(throughput),
      samples: obs.length,
    };
  }

  /**
   * Execute a batch function with the current adaptive size.
   * @param {Array} items
   * @param {Function} batchFn - async (batch) => { results, errors }
   * @returns {Promise<{ results: Array, totalErrors: number }>}
   */
  async execute(items, batchFn) {
    const allResults = [];
    let totalErrors = 0;

    for (let i = 0; i < items.length; i += this._currentSize) {
      const batch = items.slice(i, i + this._currentSize);
      const start = Date.now();
      let errors = 0;

      try {
        const result = await batchFn(batch);
        if (result.errors !== undefined) errors = result.errors;
        if (result.results) allResults.push(...result.results);
        else allResults.push(result);
      } catch (err) {
        errors = batch.length;
      }

      totalErrors += errors;
      this.record({
        latencyMs: Date.now() - start,
        batchSize: batch.length,
        errors,
        total: batch.length,
      });
    }

    return { results: allResults, totalErrors };
  }

  /**
   * Get overall statistics.
   * @returns {object}
   */
  getStats() {
    return {
      currentSize: this._currentSize,
      minSize: this._minSize,
      maxSize: this._maxSize,
      totalBatches: this._totalBatches,
      totalItems: this._totalItems,
      adjustments: this._adjustments,
      windowStats: this.getWindowStats(),
    };
  }

  reset(initialSize) {
    this._currentSize = initialSize || this._currentSize;
    this._observations = [];
    this._totalBatches = 0;
    this._totalItems = 0;
    this._adjustments = 0;
  }
}

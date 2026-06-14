// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import { logOperationSafely } from '../db/operation-log-store.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';

/**
 * Base harvester class providing:
 * - Harvest run tracking (harvest_runs table)
 * - AbortController for graceful shutdown
 * - Consecutive error threshold (auto-abort after too many failures)
 * - Standard run() method — subclasses override _harvest()
 */
export class BaseHarvester {
  /**
   * @param {string} source - Source identifier (n8n-community, github, reddit)
   * @param {import('../utils/rate-limiter.js').RateLimiter} rateLimiter
   */
  constructor(source, rateLimiter) {
    this.source = source;
    this.rateLimiter = rateLimiter;
    this.abortController = new AbortController();
    this.stats = {
      discovered: 0,
      new: 0,
      duplicate: 0,
      invalid: 0,
      errors: 0,
    };
    this.runId = null;
    this.maxConsecutiveErrors = 10;
    this.consecutiveErrors = 0;
  }

  /**
   * Execute the harvest. Tracks the run in the database.
   * @returns {object} Final stats
   */
  async run() {
    this.runId ||= randomUUID();
    await db.query(
      `INSERT INTO harvest_runs (id, source, status) VALUES ($1, $2, 'running')`,
      [this.runId, this.source]
    );
    logger.info('Harvest run started', { source: this.source, runId: this.runId });

    try {
      await this._harvest(this.abortController.signal);
      await this._completeRun('completed');
      logger.info('Harvest run completed', { source: this.source, ...this.stats });
    } catch (err) {
      if (err.name === 'AbortError') {
        await this._completeRun('aborted');
        logger.warn('Harvest run aborted', { source: this.source, ...this.stats });
        await logOperationSafely({
          level: 'warn',
          category: 'harvest',
          eventType: 'harvest.run.aborted',
          message: `Harvest run aborted for ${this.source}`,
          source: this.source,
          runId: this.runId,
          error: err,
          metadata: { stats: this.stats },
        });
      } else {
        await this._completeRun('failed', err.message);
        logger.error('Harvest run failed', { source: this.source, error: err.message });
        await logOperationSafely({
          level: 'error',
          category: 'harvest',
          eventType: 'harvest.run.failed',
          message: `Harvest run failed for ${this.source}`,
          source: this.source,
          runId: this.runId,
          error: err,
          metadata: { stats: this.stats },
        });
        throw err;
      }
    }

    return this.stats;
  }

  /**
   * Signal the harvester to stop gracefully.
   */
  abort() {
    this.abortController.abort();
  }

  /**
   * Record a per-item error. Aborts if too many consecutive errors.
   */
  recordError(err) {
    this.stats.errors++;
    this.consecutiveErrors++;
    logger.warn('Harvest item error', {
      source: this.source,
      error: err.message,
      consecutiveErrors: this.consecutiveErrors,
    });
    logOperationSafely({
      level: 'warn',
      category: 'harvest',
      eventType: 'harvest.item.error',
      message: `Harvest item error for ${this.source}`,
      source: this.source,
      runId: this.runId,
      error: err,
      metadata: {
        consecutive_errors: this.consecutiveErrors,
        stats: this.stats,
      },
    });
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      logger.error('Too many consecutive errors, aborting', {
        count: this.consecutiveErrors,
      });
      logOperationSafely({
        level: 'error',
        category: 'harvest',
        eventType: 'harvest.abort.threshold_exceeded',
        message: `Harvest aborted after too many consecutive errors for ${this.source}`,
        source: this.source,
        runId: this.runId,
        metadata: {
          consecutive_errors: this.consecutiveErrors,
          max_consecutive_errors: this.maxConsecutiveErrors,
        },
      });
      this.abort();
    }
  }

  /**
   * Reset the consecutive error counter (call after a successful item).
   */
  resetConsecutiveErrors() {
    this.consecutiveErrors = 0;
  }

  /**
   * Update the harvest_runs record with final stats.
   */
  async _completeRun(status, errorMessage = null) {
    try {
      await db.query(
        `UPDATE harvest_runs SET
          completed_at = NOW(), status = $1,
          items_discovered = $2, items_new = $3,
          items_duplicate = $4, items_invalid = $5,
          error_message = $6
        WHERE id = $7`,
        [
          status,
          this.stats.discovered,
          this.stats.new,
          this.stats.duplicate,
          this.stats.invalid,
          errorMessage,
          this.runId,
        ]
      );
    } catch (dbErr) {
      logger.error('Failed to update harvest run', { error: dbErr.message });
    }
  }

  /**
   * Subclasses MUST override this method.
   * @param {AbortSignal} signal
   */
  async _harvest(signal) {
    throw new Error('Subclasses must implement _harvest()');
  }
}
